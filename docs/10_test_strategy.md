# テスト戦略

## 1. テスト層

AWS devを基準統合層とし、AWS固有の認証、イベント配送、権限、配信経路、性能を確認する。FlociはAWS資格情報を使わず主要フローと障害系を繰り返す補助結合層とし、Floci固有アダプターの成功だけでAWS上の成立性を判断しない。

### 単体

- Tier解析
- JWT claim解析
- Job ID生成
- S3キー検証
- HTTPレスポンス
- DynamoDB式生成
- Dispatcherの確定的起動拒否と曖昧な失敗の分類
- Dispatcher終端化の`RESERVED`条件と二重解放防止
- Stubモデル
- 商品カタログ索引のschemaと整合性
- コサイン類似度、商品単位の参照画像集約、未知商品の拒否

### CDK

- S3 public access block
- Cognito groups
- AWS環境だけのUser Pool domainとManaged Login version 2
- AWS環境だけのメール検証付き自己登録とPost Confirmationトリガー
- AWS環境のemailスキーマが`Required=true`かつ`Mutable=true`
- Post Confirmation Lambdaの対象User Pool限定IAM権限
- Authorization Code Grant、callback URL、logout URL、Cognito provider
- HTTP API JWT authorizer
- CloudFront Security Headers Policy
- DynamoDB GSI
- ConcurrencyテーブルTTLと日次利用量環境変数
- Step Functions Standard
- Lambda timeout/memory
- 共有枠と予約枠の容量導出、旧独立設定の拒否
- Lambda account quotaに対するデプロイ前後の容量照合
- IAMの過剰権限抑制
- cdk-nagの未抑制Error 0件
- DynamoDB Streams Dispatcher、SQS不在、確定的起動拒否の即時終端化、`DispatchAnomaly` Alarm、Workflow Fail state
- APIスロットリングとidentity-only OAuth scope
- CloudFrontの`JP`許可リストと403カスタムエラーの不在
- 既定の`stub`と明示指定した`catalog`のモデルプロファイル

### Post Confirmation

- `PostConfirmation_ConfirmSignUp`で`tier-basic`への追加を一度だけ要求する
- `PostConfirmation_ConfirmForgotPassword`ではグループを変更しない
- User Pool IDとユーザー名はトリガーイベントから取得し、Tierは固定値だけを使う

### Web認証

- Managed Login authorize URLがAuthorization Code Grant、PKCE S256、`state`、必要なscopeを含む
- Managed Login authorize URLが保存済みの日本語または英語を`lang=ja` / `lang=en`として含む
- セッションとOAuth応答パラメータがないAWS環境だけマネージドログインを自動開始する
- 既存セッション、Floci直接認証、OAuth callback、認証エラーでは自動開始しない
- callbackの`state`不一致とverifier欠落を拒否する
- tokenから`sub`と`cognito:groups`をSessionへ取り込む
- 未使用のRefresh TokenをSessionへ保存しない
- logout URLが登録済みCloudFront URLへ戻る
- マネージドログアウトはReact上のセッションを先に消さず、直接認証のログアウトだけが未認証画面へ戻る
- ログアウト中と自動ログイン再遷移中は全画面の状態表示を維持し、正常経路では認証カードを描画しない
- AWS runtime configは`managed-login`、Floci runtime configは`direct`

### Web UI

- JPEGとPNGを上限バイト数まで受理し、別形式と上限超過を選択時に拒否する
- 通常ファイル入力、ドラッグ&ドロップ、`capture="environment"`付きカメラ入力が同じ画像検証経路へ接続される
- 保存済みの日本語または英語を優先し、未保存時はブラウザ言語から初期言語を決める
- 言語切替で`html`の`lang`と文書タイトルを同時に更新する
- デスクトップとモバイル幅で入力面、結果面、ナビゲーションが欠けず、キーボードフォーカスを視認できる
- `prefers-reduced-motion`、`prefers-reduced-transparency`、`prefers-contrast`で代替表示が適用される

### Floci補助結合

- Cognito認証
- 署名付きURL
- S3署名付きPOSTと実サイズ上限
- 実JPEG/PNGのデコード検証
- Job 202
- ローカル専用Dispatcher呼び出し
- 状態ポーリング
- 推論成功
- Tier上限429
- システム上限503
- 枠解放
- Reaper

`mise run e2e-local`は、開発用の`local/data/`とは分離した一時データ領域でFlociを起動し、現在のソースを新規deployしてからCognito seed、署名付きURLから推論成功までのsmoke、Basic 2並列、Standard並列、システム同時実行上限503、日次Jobとアップロードのユーザー429およびシステム503、二重解放、Reaper、停止を一括実行する。終了時に一時データを削除するため、古いStackを誤って検証することも、開発用データを破壊することもない。
FlociではLambdaコンテナのコールドスタートにより、同時に開始したHTTPリクエストが推論完了をまたいで処理される場合がある。
そのためTier結合試験は試験全体の202総数を同時実行数とみなさず、429が発生することと、各202応答の`concurrency.active`がTier上限以下であることを検証する。
GitHub ActionsのPR検証も同じ公開タスクを実行する。
FlociではJWT claimsがLambdaイベントへ渡らないため、Cognitoトークン発行後のAPI呼び出しにはローカル限定認証ヘッダーを併用する。
実JWT AuthorizerはAWS dev層で確認する。

### AWS dev基準統合

- CloudFront/OAC
- Cognito提供ドメインとManaged Login version 2
- Authorization Code GrantとPKCEのcallback
- Cognito logout後のCloudFront復帰
- 自己登録ユーザーのメール確認後に`tier-basic`が付与される
- Managed Loginの登録フォームにemail入力欄が表示される
- 入力したメールアドレスへ確認コードが届き、そのコードで登録を完了できる
- CloudFront Distribution設定が`whitelist`と`JP`を保持する
- 日本の接続元からCloudFront URLを取得できる
- 国外検証地点がある場合はCloudFrontが403を返す
- 実JWT Authorizer
- Lambdaコールドスタート
- メモリ/CPU
- 同時実行
- Step Functions timeout
- DynamoDB Streams Event Source Mappingの実配信
- IAM
- Stack完了後の`MODEL_PROFILE`、受付上限、日次上限の照合

### 費用・入力ガードレール

- 同時実行枠、ユーザー日次Job枠、システム日次Job枠、Job作成が一つのトランザクションであること
- Idempotency-Key再送が日次Job数を二重加算しないこと
- アップロードURL発行前にユーザーとシステムの件数・予約バイト量を一つのトランザクションで確保すること
- JPEGとPNGの実デコード、壊れた画像、別形式、最大寸法超過
- Floci smokeと結合試験が実画像を推論Lambdaへ渡すこと

### サプライチェーン

- `bun install --frozen-lockfile`
- `bun audit --audit-level=high`
- commit SHAへ固定したGitHub Actions
- digestへ固定した推論Lambda base image
- TrivyによるHigh/Criticalのcontainer image検査

## 2. 同時実行テスト

### Basic

```text
limit=1
2リクエスト同時
202=1, 429=1
```

### Standard

```text
limit=3
10リクエスト同時
202=3, 429=7
```

### 異なるユーザー

Basicユーザー2名が各1件を同時実行し、両方202になる。

### システム上限

システム上限を2にして異なるユーザー3名が送信し、202=2、503=1になる。

## 3. 冪等性

- 同じユーザー・同じIdempotency-Key・同じobjectKey → 同じJob、カウンター増加1回
- 同じキー・異なるobjectKey → 409
- タイムアウト再送 → 既存Jobまたは安全な再試行

## 4. 枠解放

- Successを2回Finalize → activeCountは1回だけ減る
- Failureを2回Finalize → 同上
- TimeoutとReaperが競合 → 同上
- Finalize途中の一時エラー → Retry後に解放
- 確定的なStartExecution拒否 → 即時`FAILED`、activeCountは1回だけ減る
- StartExecutionの通信失敗または5xx → 即時解放せずEvent Source Mappingが再試行
- StartExecution成功後のQUEUED更新失敗 → 即時解放せずWorkflowとReaperへ委ねる
- Dispatcher終端化トランザクション失敗 → 部分バッチ失敗として再試行し、`DispatchAnomaly`を記録

## 5. セキュリティ

- Tierなし → 403
- 複数Tier → 403
- 他ユーザーJob → 403
- 他ユーザーS3キー → 403/400
- 不正JWT → 401
- ID token → 401
- 大きすぎる画像 → 400
- 署名付きPOSTの上限超過 → S3が拒否
- 自己登録要求からTierを選択できない
- Post Confirmation Lambdaが対象User Pool以外を操作できない

## 6. 実モデル合格基準（暫定）

| 項目 | 暫定基準 |
|---|---:|
| 非圧縮コンテナ | 10GB未満 |
| 最大RSS | 9GB以下推奨 |
| Lambda timeout | 15分以内 |
| エラーなし連続実行 | 10回以上 |
| 入力仕様 | 明文化済み |
| 結果再現性 | 許容範囲内 |

ビジネス上の応答時間基準はモデル受領後に決める。

## 7. 商品画像検索PoC

通常の品質ゲートはモデル重みや公開データを取得せず、固定ベクトルfixtureで検索契約を検証する。
手動評価はABOから商品カテゴリ当たり2件までの30商品を選び、商品ごとに参照画像3枚と評価画像1枚を分離して使う。
索引作成コマンドは評価画像のtop-1正解数を表示する。

次の値を計測結果として残す。

- 対象商品数と参照画像数
- top-1正解数
- 候補なしのしきい値
- コンテナサイズ
- モデルロード時間
- warm推論時間
- 最大RSS

同じ商品画像を索引と評価の両方へ使わない。
ABO評価は汎用デモの成立性を確認するものであり、利用者固有の商品分布に対する精度保証には使わない。
