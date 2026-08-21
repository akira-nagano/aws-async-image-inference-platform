# Cognito Tierと同時実行管理

## 1. Tier判定

JWTの `cognito:groups` を解析し、以下のTierグループだけを抽出する。

```text
tier-basic
tier-standard
tier-premium
```

許可例:

```json
{
  "cognito:groups": ["tier-standard", "administrator"]
}
```

拒否例:

```json
{
  "cognito:groups": ["tier-basic", "tier-premium"]
}
```

Tier値をリクエストJSONから受け取らない。

### 自己登録時のTier

AWS環境ではCognitoマネージドログインからメールアドレスを必須入力として自己登録できる。
入力したアドレスへ届く確認コードを検証するまでログインできない。
確認完了時のPost Confirmation Lambdaは、`PostConfirmation_ConfirmSignUp`だけを処理してユーザーを`tier-basic`へ追加する。
パスワード再設定確認ではグループを変更しない。
利用者がTierを指定する属性、画面、APIは設けない。
`tier-standard`と`tier-premium`への変更は管理者操作に限定する。
Flociローカル環境は自己登録とPost Confirmation Lambdaを作らず、結合試験用seedユーザーへ明示的にTierを設定する。

## 2. 上限の単位

初期実装では次の2種類を管理する。

1. ユーザー単位上限
2. システム全体上限

必要になれば、Tier全体プール上限を同じトランザクションへ追加できる。

```text
USER#<cognito-sub>
SYSTEM#INFERENCE
```

### システム受付上限とLambda実容量

`systemConcurrencyLimit`はDynamoDBで確保できるシステム全体の受付枠であり、Lambda実行数を直接制御する値ではない。
両者を独立した数値として設定すると、受付済みJobが推論Lambdaの実容量を超えて滞留する構成を作れてしまう。

CDK Contextは次の容量契約を使用する。

| `capacityMode` | 推論LambdaのReserved Concurrency | デプロイ前に必要な未予約枠 |
|---|---:|---:|
| `shared` | 設定しない | `systemConcurrencyLimit + 6` |
| `reserved` | `systemConcurrencyLimit`から導出 | `max(10, 6)` |

`reserved`では受付上限とLambda予約枠を一つの入力から生成するため、異なる値にできない。
`shared`では対象リージョンのLambdaアカウント設定をデプロイ直前に読み、受付枠と制御系Lambda用余白を同時に確保できない場合はデプロイを中止する。
AWS devの既定値は受付4、制御系余白6、共有枠である。
制御系余白6はAPI、Dispatcher、Finalize、Reaperなどを継続できるようにするアーキテクチャ定数であり、Contextから変更できない。
各Tier上限はBasic、Standard、Premiumの順に単調増加し、すべてシステム受付上限以下でなければならない。
Tier上限の合計はシステム受付上限を超えてよく、複数利用者間の実際の受付可否は後述の原子的トランザクションで決まる。

### 日次受付契約

自己登録ユーザーによる継続的な費用増加を抑えるため、UTC日単位でJob数を制限する。

| Tier | ユーザー単位Job上限/日 | アップロードURL上限/日 | アップロード予約容量/日 |
|---|---:|---:|---:|
| Basic | 10 | 20 | 50MiB |
| Standard | 30 | 60 | 150MiB |
| Premium | 100 | 200 | 500MiB |
| システム全体 | 100 | 200 | 500MiB |

最大画像サイズは5MiBである。
アップロードURL上限は日次Job上限の2倍、予約容量は日次Job上限と最大画像サイズの積として導出する。
小さい画像は未使用URLや再アップロードの余裕を件数側で利用できるが、最大サイズの画像はJob上限と同数までに制限される。
日次上限は同時実行上限とは別であり、日付が変わるまで枠を解放しない。
Workflow起動失敗を含むJob終端化では同時実行枠だけを解放し、受付済みJobとして消費した日次Job数は返却しない。
Idempotency-Keyの再送は既存Jobを返し、日次Job数を二重加算しない。

## 3. 枠消費のタイミング

Job受付APIで、Step Functions起動前に枠を確保する。

理由:

- 上限超過をHTTP 429として即時通知できる。
- Queue待ちを含む未完了Job数をTier上限として扱える。
- 実行基盤の起動タイミングに依存しない。

## 4. 原子的な枠確保

DynamoDB `TransactWriteItems` で以下を一括実行する。

1. ユーザーカウンターを+1
2. システムカウンターを+1
3. ユーザー日次Jobカウンターを+1
4. システム日次Jobカウンターを+1
5. Jobを `RESERVED` / `HELD` で作成

概念条件:

```text
USER activeCount < tierLimit
SYSTEM activeCount < systemLimit
USER daily usageCount < tierDailyJobLimit
SYSTEM daily usageCount < systemDailyJobLimit
Jobが未作成
```

いずれかが失敗した場合、全更新をロールバックする。

## 5. 競合時のHTTP判定

トランザクション失敗後にカウンターを読み、原因を判定する。

| 条件 | HTTP | code |
|---|---:|---|
| ユーザー枠が上限 | 429 | `TIER_CONCURRENCY_LIMIT_EXCEEDED` |
| ユーザー日次枠が上限 | 429 | `DAILY_JOB_LIMIT_EXCEEDED` |
| システム枠が上限 | 503 | `INFERENCE_CAPACITY_EXHAUSTED` |
| システム日次枠が上限 | 503 | `DAILY_INFERENCE_CAPACITY_EXHAUSTED` |
| 同じ冪等キーのJobあり | 202 | 既存Jobを返す |
| その他の競合 | 409 | `JOB_SUBMISSION_CONFLICT` |

競合判定用の事後読取はレスポンス分類のためであり、枠確保の正当性はトランザクション条件で保証する。

## 6. 冪等性

- クライアントは `Idempotency-Key` を送る。
- `userId + Idempotency-Key` のSHA-256からJob IDを決定論的に生成する。
- 同じユーザーが同じキーで再送した場合、既存Jobを返す。
- 異なるユーザーの同じキーは別Jobになる。
- 同じキーで異なる入力S3キーを送った場合は409とする。

## 7. 枠解放

Jobsテーブルの `slotState` を利用する。

```text
HELD → RELEASED
```

解放トランザクション:

1. Jobの `slotState=HELD` を条件に終端状態へ更新
2. ユーザーカウンターを-1
3. システムカウンターを-1

`slotState` が既に `RELEASED` の場合は成功扱いで何もしない。

## 8. リース

Jobに `leaseExpiresAt` を持たせる。

- Job受付時: 短い初期リース
- RUNNING開始時: 推論タイムアウト + 安全余裕へ延長
- 完了時: GSI用属性を削除

Workflowが作成されていないと確定するDispatcher起動拒否は、初期リースを待たず`FAILED`へ終端化して同じ解放処理を呼ぶ。
通信失敗や5xxなどWorkflow作成結果が曖昧な場合は解放せず、再試行後も取り残された期限切れの`HELD` JobだけをReaperが`TIMED_OUT`へ終端化する。

## 9. Tier変更

Job受付時のTierと上限をJobへ保存する。

- 実行中JobのTierは途中変更しない。
- Tierを下げた結果、現在実行数が新上限を超えても既存Jobは停止しない。
- 新規Jobだけを拒否する。
- Cognitoグループ変更は既発行JWTへ即反映されないため、アクセストークン有効期限を運用要件に合わせる。
- Tier変更後は新しいアクセストークンを取得するまで以前の`cognito:groups`が使われる。
- 管理者は旧Tierグループを削除してから新Tierグループを追加し、Tierグループを常に一つだけにする。

## 10. 将来拡張

### Tier全体プール

```text
TIER#tier-basic
TIER#tier-standard
TIER#tier-premium
```

### 優先度

Step Functions起動前にTier別SQSへ投入する構成へ拡張可能。

### 組織単位

Cognitoカスタム属性または別テーブルで `tenantId` を管理し、`TENANT#<id>` カウンターを追加可能。
