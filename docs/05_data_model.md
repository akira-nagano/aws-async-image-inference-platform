# データモデル

## 1. Jobsテーブル

### キー

```text
PK: jobId (String)
```

### 属性

| 属性 | 型 | 説明 |
|---|---|---|
| `jobId` | String | Job ID |
| `userId` | String | Cognito `sub` |
| `tier` | String | 受付時Tier |
| `tierLimit` | Number | 受付時ユーザー上限 |
| `status` | String | Job状態 |
| `slotState` | String | `HELD` / `RELEASED` |
| `objectKey` | String | 入力画像S3キー |
| `idempotencyKeyHash` | String | 冪等キーのハッシュ |
| `executionArn` | String | Step Functions実行ARN |
| `createdAt` | String | ISO 8601 |
| `queuedAt` | String | DispatcherがWorkflow起動を受理した時刻 |
| `startedAt` | String | ISO 8601 |
| `completedAt` | String | ISO 8601 |
| `leaseExpiresAt` | Number | Epoch seconds |
| `activeKey` | String | 活性Jobは `ACTIVE` |
| `modelVersion` | String | モデルバージョン |
| `processingTimeMs` | Number | 推論時間 |
| `predictions` | List | 上位候補 |
| `errorCode` | String | 内部エラーコード |
| `errorMessage` | String | 利用者向け要約 |
| `ttl` | Number | 古いJobの削除時刻 |

### GSI: ActiveJobsIndex

```text
PK: activeKey
SK: leaseExpiresAt
```

Reaperが期限切れJobを検索する。

Jobsテーブルは`NEW_IMAGE`のDynamoDB Streamを有効にする。
Dispatcherは`RESERVED`かつ`HELD`のイメージをWorkflow起動要求として扱い、それ以外の更新イベントを無視する。
Workflowが作成されていないと確定する起動拒否では、`status=RESERVED`かつ`slotState=HELD`を条件に`FAILED`、`RELEASED`、`errorCode=DISPATCH_FAILED`へ更新する。
通信失敗やサービス一時エラー、Workflow開始後の更新失敗ではJobを変更せず、再試行またはReaperによる期限切れ回収へ委ねる。

### 状態遷移条件

| 遷移 | 実行主体 | 条件 |
|---|---|---|
| `RESERVED` → `QUEUED` | Dispatcher | `slotState=HELD`かつWorkflow起動済み |
| `RESERVED` → `FAILED` | Dispatcher | Workflow未作成が確定し、`slotState=HELD` |
| `QUEUED` → `RUNNING` | MarkRunning | `slotState=HELD` |
| `RUNNING` → `SUCCEEDED` / `FAILED` / `TIMED_OUT` | Finalize | `slotState=HELD` |
| `RESERVED` / `QUEUED` / `RUNNING` → `TIMED_OUT` | Reaper | リース期限切れかつ`slotState=HELD` |

すべての終端化は同じDynamoDBトランザクションで`slotState=RELEASED`とユーザー・システム同時実行カウンター減算を行う。
`slotState=HELD`の条件により二重解放を防止する。

### Prediction要素

| 属性 | 型 | 必須 | 説明 |
|---|---|---:|---|
| `rank` | Number | 必須 | 1から始まる順位 |
| `productCode` | String | 必須 | 登録済みカタログの型番またはSKU |
| `confidence` | Number | 必須 | 0から1の検索類似度 |
| `productName` | String | 任意 | 商品名。最大256文字 |
| `brand` | String | 任意 | ブランド名。最大128文字 |

`productCode`は最大128文字とする。
既存stubの結果には`productName`と`brand`が存在しない。
候補なしは空のListとして保存する。

### GSI: UserJobsIndex（将来）

```text
PK: userId
SK: createdAt
```

推論履歴画面を追加する場合に利用する。

## 2. Concurrencyテーブル

### キー

```text
PK: scopeKey (String)
```

### Item例

```json
{
  "scopeKey": "USER#cognito-sub",
  "activeCount": 2,
  "tier": "tier-standard",
  "updatedAt": "2026-07-23T10:00:00Z"
}
```

```json
{
  "scopeKey": "SYSTEM#INFERENCE",
  "activeCount": 4,
  "updatedAt": "2026-07-23T10:00:00Z"
}
```

### 日次利用量Item

Job受付は次のItemを同時実行枠とJob作成と同じトランザクションで更新する。

```json
{
  "scopeKey": "USAGE#JOB#USER#cognito-sub#2026-07-24",
  "usageCount": 3,
  "tier": "tier-basic",
  "usageDate": "2026-07-24",
  "updatedAt": "2026-07-24T10:00:00Z",
  "ttl": 1785542400
}
```

```json
{
  "scopeKey": "USAGE#JOB#SYSTEM#2026-07-24",
  "usageCount": 20,
  "usageDate": "2026-07-24",
  "updatedAt": "2026-07-24T10:00:00Z",
  "ttl": 1785542400
}
```

アップロードURL発行は次のユーザーItemと対応する`USAGE#UPLOAD#SYSTEM#<UTC date>` Itemを一つのトランザクションで更新する。

```json
{
  "scopeKey": "USAGE#UPLOAD#USER#cognito-sub#2026-07-24",
  "usageCount": 4,
  "reservedBytes": 10485760,
  "tier": "tier-basic",
  "usageDate": "2026-07-24",
  "updatedAt": "2026-07-24T10:00:00Z",
  "ttl": 1785542400
}
```

`reservedBytes`は実際にS3へ保存された容量ではなく、URL発行時にクライアントが申告した容量の合計である。
URL未使用時も当日中は減算しない。
利用量ItemはUTC日付の8日後をTTLとし、直近の調査期間を残しながら自動削除する。
同時実行カウンターItemにはTTLを設定しない。
Jobが失敗またはタイムアウトしても、受付済みJobの日次`usageCount`は減算しない。

## 3. 入力S3バケット

```text
uploads/<cognito-sub>/<generated-id>-<safe-filename>
```

ルール:

- ユーザーIDプレフィックスをサーバーが生成する。
- クライアント指定のS3キーを信用しない。
- Job作成時にキー所有者とオブジェクト存在を確認する。
- Lifecycleで1日後に削除する。
- バケットは非公開。

## 4. フロントエンドS3バケット

- HTML / JS / CSSのみ。
- Block Public Access有効。
- CloudFront OACだけ読取可能。
- `index.html` は短いキャッシュ。
- ハッシュ付きアセットは長期キャッシュ。

## 5. 結果保存

初期実装の上位3候補は小さいためJobsテーブルへ保存する。

次の場合はS3へ分離する。

- 大きな説明データ
- 中間画像
- 特徴量
- 監査用詳細結果
- DynamoDBのItem上限へ近づく場合

## 6. TTL

- Jobsの保持期間は環境設定とする。
- TTLは古いJob削除用であり、リアルタイム枠解放には使わない。
- ConcurrencyテーブルのTTLは日次利用量Itemだけに設定する。
- 画像削除はS3 Lifecycleを使う。
