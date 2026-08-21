# セキュリティ設計

## 1. 認証

- Cognito User Poolを利用する。
- App Clientはクライアントシークレットなし。
- AWS環境はCognito提供のプレフィックスドメインと新しいマネージドログインを利用する。
- AWS環境はメールアドレスを必須属性とする自己登録を許可し、確認コードによる検証後のユーザーを固定の`tier-basic`へ追加する。
- AWS環境のWeb UIはAuthorization Code GrantとPKCE S256を使い、ユーザーのパスワードを取得しない。
- AWS環境のWeb UIは未認証時にマネージドログインを自動開始するが、OAuth callbackまたは認証エラーを示すURLでは自動開始せず、無限リダイレクトを防ぐ。
- 認証要求ごとにランダムな`state`とPKCE verifierを`sessionStorage`へ保存し、callback時に一致を検証してからtoken endpointを呼ぶ。
- callback URLとlogout URLはCloudFrontのルートURLだけをApp Clientへ登録する。
- API Gateway HTTP APIのJWT AuthorizerでIssuerとAudienceを検証する。
- OAuth scopeは`openid`、`email`、`profile`だけを要求し、Cognito管理API用scopeを要求しない。
- Lambdaで`token_use=access`を確認し、ID TokenをAPI認証に使用しない。
- Webは未使用のRefresh Tokenをsessionへ保存せず、30分のAccess Token期限後は再ログインする。
- `sub` と `cognito:groups` は検証済みJWTだけから取得する。
- Post Confirmation Lambdaは自己登録確認だけを処理し、対象User Poolの`AdminAddUserToGroup`だけを許可する。

## 2. 認可

- Tierグループは1つだけ許可。
- Tierは登録入力やリクエスト本文から受け取らず、Cognitoグループを管理者だけが変更する。
- Job取得時に `job.userId == token.sub` を確認する。
- 入力S3キーは `uploads/<sub>/` のみ許可する。
- 署名付きURLは短時間有効とする。

## 3. S3

- Block Public Accessを有効化する。
- SSE-S3またはSSE-KMSを使用する。
- フロントエンドS3はCloudFront OACのみ読取可能。
- 入力S3はUpload URL Lambdaが発行した署名付きPOST Policyだけを許可する。
- POST Policyの`content-length-range`で実アップロードサイズを制限する。
- URL発行時の申告値に加え、Job受付時にS3 HeadObjectで実サイズ、Content-Type、ownerメタデータを再検証する。
- 推論Lambdaはモデル呼出し前にPillowでJPEGまたはPNGを実デコードし、形式、寸法、画素数を検証する。
- 入力オブジェクトはLifecycleで1日後に削除する。

## 4. IAM

### Upload URL Lambda

- 入力バケットの限定プレフィックスへのPutObject用署名
- Concurrencyテーブルの日次アップロード件数と予約バイト量のGetItem、UpdateItem
- PutObject以外を不要にする

### Job Submit Lambda

- 入力バケットHeadObject
- Jobs / Concurrencyの限定操作
- Flociの`local` ContextだけDispatcher LambdaのInvokeFunction

### Job Status Lambda

- Jobs / ConcurrencyのGetItem

### Lifecycle Lambda

- Jobs / Concurrencyの限定更新

### Dispatcher Lambda

- JobsテーブルStream読取（AWS環境）
- Step Functions StartExecution
- Jobs GetItem、UpdateItem
- Concurrency UpdateItem
- Workflow未作成が確定する場合だけ、共有FinalizeによるJob終端化と同時実行枠解放

### Inference Lambda

- 入力バケットGetObject
- CloudWatch Logs
- 必要に応じて結果バケットPutObject

### Reaper

- ActiveJobsIndex Query
- Jobs / Concurrencyの限定更新

### Post Confirmation Lambda

- 対象User PoolのAdminAddUserToGroupのみ
- 固定の`tier-basic`だけを追加
- メールアドレスを含むイベント内容をログへ出力しない

## 5. ログ

ログへ出力しないもの:

- JWT
- Authorizationヘッダー
- 署名付きURL
- 画像バイナリ
- 個人情報
- モデルの機密内容

ログへ出力するもの:

- requestId
- jobId
- userIdのハッシュまたは必要最小限のsub
- tier
- status遷移
- 処理時間
- エラーコード
アクセスログは現在のAWS Stackで有効化する。
CloudFrontはAccess Logs Bucket、S3は同じBucketのサービス別prefix、HTTP APIは専用CloudWatch Logs Log Groupへ記録する。
HTTP APIのアクセスログにはrequest ID、route、status、response length、integration errorだけを含め、JWT、署名付きURL、画像内容は含めない。

## 6. API保護

初期:

- Cognito JWT
- CORS制限
- API Gatewayスロットリング
- 受付上限とLambda実容量を結ぶデプロイ前容量契約
- DynamoDBシステム上限
- ユーザー別・システム別の日次Job上限とアップロード予約上限
- CloudFront標準のGeo Restrictionによる`JP`許可リスト

CloudFrontはCSP、HSTS、`X-Content-Type-Options`、`X-Frame-Options: DENY`、Referrer Policy、Permissions Policyを全Behaviorへ付与する。
CSPは同一origin、Cognito提供ドメイン、AWSのS3アップロード先だけを接続先として許可する。

Geo Restrictionは接続元IPを国へ対応付け、CloudFront Distribution全体で日本以外を403にする。
CloudFrontが国を特定できない場合はコンテンツを配信し、VPNやプロキシによる迂回も完全には防止しない。
既存のSPA用403カスタムエラーは国外拒否を200へ置き換えないよう削除し、404だけを`index.html`へ変換する。

適用範囲はCloudFront経由のWebと`/api/*`である。
Cognito提供ドメイン、API Gatewayのexecute-api直URL、発行後のS3署名付きアップロードURLはCloudFrontを通らないため、Geo Restrictionの対象外となる。

本番検討:

- AWS WAF
- Cognito、API Gateway直URL、S3署名付きアップロードを含む国・IP制限
- Bot Control
- CloudTrail

## 7. IaC検査

- CDKアプリ全体へcdk-nagの`AwsSolutionsChecks`を適用する。
- `mise run check`とCIは未抑制のErrorを失敗扱いにする。
- 動的なCloudWatch Logs streamやS3の`uploads/*`など、仕様上ワイルドカードを避けられない権限だけを対象限定・理由付きで抑制する。
- Step FunctionsのIAM5抑制は制御系APIの`Resource=*`と専用Workflow Lambdaのqualified ARNだけへ限定する。
- Cognito Plus、MFA、WAF、独自証明書は、コストや利用者要件を伴うためスターターでは理由付き例外とし、本番設計時に再評価する。
- AWS環境のCloudFront Geo Restrictionは`JP`を許可し、cdk-nagの`AwsSolutions-CFR1`を抑制しない。

## 8. ローカル認証バイパス

Floci 1.5.33がHTTP API v2のJWT claimsをLambdaイベントへ渡さないため、ローカル向けCDK deployはContext `localAuthBypass=true`を指定する。
FlociではCognito User Poolドメインとマネージドログインを作らず、直接認証画面をローカル開発に限定して維持する。

制約:

- `local=true` のときだけ有効。
- 本番ContextではCDKがエラーにする。
- ヘッダー `x-local-user-id` / `x-local-groups` を利用する。
- `apps/web/public/config.json`の`localAuthBypass=true`はFloci向け設定生成時だけ出力する。
- Web UIはCognitoアクセストークンから`sub`と`cognito:groups`を取得し、上記フラグが明示された場合だけローカルヘッダーを送る。
- Flociを使うローカル開発と結合テストに限定し、Cognitoトークン発行とAWS上のJWT Authorizer試験を別に残す。
- AWS向けAPIはJWT Authorizerを維持し、ローカルヘッダーを認証情報として使用しない。
