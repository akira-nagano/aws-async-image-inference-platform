# Cognitoマネージドログインへの移行

このExecPlanは生きた文書である。
作業中は `進捗 (Progress)`、`発見事項 (Surprises & Discoveries)`、`決定ログ (Decision Log)`、`完了結果 (Outcomes & Retrospective)` を更新する。

この計画はリポジトリルートの `PLANS.md` に従って維持する。

## 目的と利用者価値

AWS開発環境の利用者が、アプリケーション独自のユーザー名とパスワード入力画面ではなく、Amazon Cognitoが提供するマネージドログイン画面で認証できるようにする。
アプリケーションはパスワードを受け取らず、OAuth 2.0 Authorization Code GrantとPKCEでアクセストークンを取得する。
新規利用者はマネージドログインからメールアドレスを検証して自己登録し、確認完了時に`tier-basic`へ自動所属する。
利用者がTierを申告する経路は設けず、上位Tierへの変更は管理者操作に限定する。
マネージドログインの登録フォームにはメールアドレス入力欄が表示され、登録後にそのアドレスへ確認コードが届かなければならない。

開発者はAWSへStackとWebをデプロイし、CloudFront上のアプリケーションからログイン操作を開始する。
ブラウザがCognito提供ドメインへ遷移し、認証後にCloudFrontへ戻って推論APIを利用できれば完了である。
公開するCloudFront Distributionは、WAFを使わずCloudFront標準の地理的制限で日本からのアクセスだけを許可する。

## 対象範囲

AWSのdevとprod環境にCognito提供のプレフィックスドメインを作成する。
User PoolはEssentialsプランを明示し、ドメインのbranding versionは新しいマネージドログインを指定する。
App Clientはクライアントシークレットを持たない公開クライアントとし、Authorization Code Grant、PKCE、許可済みcallback URL、許可済みlogout URLを設定する。

Web UIはマネージドログインへの遷移、callback処理、認可コードとトークンの交換、state検証、ログアウトを実装する。
CDK出力からWeb runtime configへCognitoドメインとredirect URIを渡す。
非local環境ではCognitoの自己登録とメール検証を有効にする。
自己登録の確認後トリガーは、登録を完了した利用者を`tier-basic`グループへ追加する。
非local環境のCloudFront Distributionには`JP`の許可リストを設定する。

Flociのlocal環境では、Cognitoドメインとマネージドログインを作成しない。
Floci 1.5.33の機能差を避けるため、既存の直接認証画面とローカル認証バイパスを維持する。

## 対象外

独自ドメイン、Route 53、ACM証明書、外部IdP、MFA、パスキー、Cognito Plus、トークン自動更新は対象外とする。
マネージドログインのロゴや色を独自に設定せず、Cognito提供の既定brandingを利用する。
本番環境へのデプロイと実利用者アカウントでの認証は対象外とする。
WAF、VPN、CloudFront Functions、Lambda@Edge、API Gateway Resource Policyによる追加のネットワーク制御は対象外とする。
Cognito提供ドメイン、API Gatewayのexecute-api直URL、発行後のS3署名付きアップロードURLはCloudFrontの地理的制限を通らないため、今回の日本限定はCloudFront経由のWebと`/api/*`に限定する。

## 現状調査

`apps/web/src/Login.tsx`は、ユーザー名とパスワードをアプリケーションのフォームへ入力する。
`apps/web/src/auth.ts`はAWS SDKの`InitiateAuthCommand`と`USER_PASSWORD_AUTH`を使い、ブラウザからCognito User Pools APIを直接呼ぶ。

`infra/cdk/lib/platform-stack.ts`はUser Poolと公開App Clientを作るが、User Poolドメイン、OAuth callback URL、logout URL、マネージドログインbrandingを作らない。
App ClientはAPI Gateway JWT Authorizerのaudienceとして使われる。
当初はaccess tokenの`aws.cognito.signin.user.admin` scopeをAPIルートが要求していたが、後続の最小権限化で管理APIを呼ばないWebには不要と判断した。

CloudFrontのdistribution domain nameはCDKデプロイ時に決まる。
App Clientのcallback URLはこのCloudFront URLを参照する必要がある。
CloudFront DistributionはHTTP APIだけを参照し、HTTP API本体はApp Clientを参照しないため、App ClientからCloudFrontへの参照を追加してもCloudFormationの依存関係は循環しない。

Amazon Cognitoは、User Poolへドメインを追加した時点でマネージドログインとOAuth/OIDC endpointを有効にする。
Cognito提供ドメインまたは独自ドメインのどちらかが必要であり、独自ドメイン自体は必須ではない。

現在のUser Poolは`selfSignUpEnabled=false`であり、マネージドログインに登録導線を表示しない。
APIはJWTの`cognito:groups`にTierグループが一つだけ含まれることを必須としているため、自己登録だけを有効にすると新規利用者は403になる。
CloudFront Distributionには地理的制限がなく、cdk-nagの`AwsSolutions-CFR1`を理由付きで抑制している。

2026-07-24の自己登録実装後、実User Poolの`email`属性は`Required=false`のままであることが判明した。
`autoVerify.email=true`は、SignUp要求にemailが含まれた場合の確認方法を指定する設定であり、マネージドログインへemail入力欄を追加する設定ではない。
マネージドログインはUser Poolスキーマの必須属性だけを登録フォームへ追加するため、email欄を表示せず、登録時に`Invalid input: User Pool not configured properly for confirmation code delivery.`を返した。

AWS公式仕様では、既存User Poolの必須属性を変更できない。
実AWSには有効なユーザーが0件で、失敗した未確認ユーザーが1件だけ存在する。
このためdev環境では、emailを必須にした新User Poolを旧Poolと並行作成し、App Client、Tierグループ、JWT Authorizer、Post Confirmationトリガー、CloudFormation出力を新Poolへ切り替えてから旧Poolを削除する。

## アーキテクチャ上の制約

ブラウザアプリケーションへクライアントシークレットを保存しない。
認可コードの横取りに備え、RFC 7636のPKCEで`S256` code challengeを送る。
認証要求ごとにランダムなstateを生成し、callback時にsessionStorageの値と一致することを確認する。

API GatewayにはID tokenではなくaccess tokenを送る。
access tokenから`sub`と`cognito:groups`を取得する既存の認可境界は変更しない。
OAuth scopeは`openid`、`email`、`profile`だけとし、Lambdaで`token_use=access`を確認する。
自己登録要求やリクエスト本文からTierを受け取らない。
Post Confirmationトリガーは`PostConfirmation_ConfirmSignUp`だけを処理し、パスワード再設定確認ではグループを変更しない。

Cognito提供ドメインのprefixは1文字から63文字の小文字英数字とハイフンに限定する。
prefixには予約語`aws`、`amazon`、`cognito`を含めない。
既定値は`inference-<environment>-<AWS account ID>`とし、同一リージョンでの衝突を避ける。
必要な場合はCDK Contextの`cognitoDomainPrefix`で上書きする。

## 実装方針

`infra/cdk/lib/config.ts`へ任意の`cognitoDomainPrefix`を追加し、文字数、書式、予約語を検証する。
`infra/cdk/lib/platform-stack.ts`では、非local環境だけUser PoolをEssentialsプランにする。
同じ非local環境だけ自己登録とメール自動検証を有効にする。
非local環境では`standardAttributes.email.required=true`と`mutable=true`をUser Pool作成時に設定する。
既存dev Poolのスキーマは更新できないため、AWS用Construct IDを`UserPoolV2`へ変更し、CloudFormationが新Poolを並行作成するようにする。
Floci用Construct IDは`UserPool`のまま維持し、既存のローカルStackを置き換えない。

`services/api/src/post-confirmation.ts`へPost Confirmationハンドラーを追加する。
ハンドラーは`PostConfirmation_ConfirmSignUp`に対してだけ`AdminAddUserToGroup`を実行し、固定値の`tier-basic`へ追加する。
実行ロールは対象User Poolの`cognito-idp:AdminAddUserToGroup`だけを許可する。
User PoolとLambdaトリガーの循環依存を避けるため、この権限はLambdaロールのインラインポリシーではなく独立したIAM Policyとして関連付け、生成テンプレートの依存関係をsynthで検証する。

HTTP API作成後にCloudFront Distributionを作り、そのHTTPSルートURLをApp Clientのcallback URLとlogout URLへ設定する。
App ClientはAuthorization Code GrantだけをOAuth grantとして許可し、`openid`、`email`、`profile`をscopeへ含める。

非local環境では、`ManagedLoginVersion.NEWER_MANAGED_LOGIN`を指定したCognito prefix domainを作る。
L2 Constructが未提供のbranding styleだけは`CfnManagedLoginBranding`を使い、`useCognitoProvidedValues=true`でCognito既定デザインをApp Clientへ割り当てる。
local環境では既存の`USER_PASSWORD_AUTH`とSRPを維持する。
新Poolと旧Poolのドメインを同時に作れるよう、既定prefixは`inference-<environment>-v2-<AWS account ID>`へ変更する。

CloudFront Distributionには、非local環境だけ`cloudfront.GeoRestriction.allowlist("JP")`を設定する。
地理的制限はDistribution全体へ適用されるため、S3配信のWebとCloudFrontの`/api/*`経由のAPIを同じ境界で拒否する。
Floci localと、明示的にedgeを含めるlocalテンプレートにはこの制限を適用しない。

`scripts/generate-web-config.py`は、AWS出力がある場合に`authMode=managed-login`、Cognito base URL、OAuth redirect URIを生成する。
local出力では`authMode=direct`を生成し、既存のCognito endpointと認証バイパスを維持する。

`apps/web/src/auth.ts`へPKCE生成、authorize URL生成、callback時のtoken交換、access token解析、Cognito logout URL生成を追加する。
AWSモードは、有効なセッションとOAuth応答パラメータがない場合にCognitoマネージドログインを自動開始する。
callback処理中または認証エラー時は自動開始を繰り返さず、再試行ボタンだけを持つ画面を表示する。
localモードでは既存の`Login`コンポーネントを使用する。

## マイルストーン

最初のマイルストーンでCDKの認証リソースを変更する。
非local templateにEssentials、OAuth App Client、User Pool Domain version 2、既定brandingが存在し、local templateにはドメインが存在しないことをCDKテストで確認する。

次のマイルストーンでWebのAuthorization Code GrantとPKCEを実装する。
URL生成、tokenからのSession生成、local直接認証の維持をBunテストで確認する。

最後のマイルストーンでruntime config、例示設定、README、セキュリティ設計、デプロイ設計、テスト戦略、公式資料を更新する。
`mise run check`と`mise run e2e-local`を実行し、AWS向けsynthとFloci経路の両方が成功することを確認する。

追加マイルストーンで、非local User Poolの自己登録とメール検証、Post Confirmation Lambda、最小権限、CloudFrontの`JP`許可リストを実装する。
CDKテストとハンドラー単体テストを追加し、`mise run check`、cdk-nag付きsynth、AWS devの差分確認と更新deployを行う。

不具合修正マイルストーンで、email必須の新User Poolへdev環境を移行する。
CDKテストは非local templateのemailスキーマが`Required=true`であることと、local templateのConstruct IDが維持されることを検査する。
AWS差分では旧Poolを直接置換せず、新Poolと新しいドメインを先に作成できることを確認する。
deploy後にWeb runtime configを再生成し、実ブラウザの登録フォームにemail欄があること、確認コードが送信されること、確認後に`tier-basic`が付与されることを確認する。

認証導線の改善マイルストーンで、AWS Webの未認証アクセスからマネージドログインを自動開始する。
`apps/web/src/auth.ts`に副作用のない開始条件判定を置き、既存セッション、Floci直接認証、OAuth callback、認証エラーを除外する。
`ManagedLogin`は自動開始に失敗した場合の再試行画面として維持する。
Web単体テスト、全品質ゲート、Web再デプロイを順に実行し、CloudFrontの未認証アクセスがCognitoへ移動できる配信物へ更新する。

## 具体的な変更ファイル

`infra/cdk/lib/config.ts`へドメインprefix設定を追加する。
`infra/cdk/lib/platform-stack.ts`へEssentials、OAuth App Client、CloudFront callback URL、User Pool Domain、ManagedLoginBranding、CloudFormation Outputsを追加する。
`infra/cdk/test/platform-stack.test.ts`へlocalと非localの認証構成テストを追加する。
`services/api/src/post-confirmation.ts`へ自己登録確認後のBasic付与処理を追加する。
`services/api/test/post-confirmation.test.ts`へ確認種別と固定Tierの単体テストを追加する。
`services/api/package.json`と`bun.lock`へCognito Identity Provider SDKを追加する。

`apps/web/src/config.ts`へ認証モード、Cognito base URL、OAuth redirect URIを追加する。
`apps/web/src/auth.ts`へPKCEを使うOAuth処理を追加する。
`apps/web/src/App.tsx`でcallback処理と認証モード分岐を行う。
`apps/web/src/ManagedLogin.tsx`へAWS向けログイン開始画面を追加する。
`apps/web/src/auth.test.ts`へOAuth URLとSession生成のテストを追加する。
認証導線の改善では、同じ`auth.ts`、`App.tsx`、`auth.test.ts`へ自動開始条件と回帰テストを追加し、`ManagedLogin.tsx`は再試行画面として変更せずに維持する。

`scripts/generate-web-config.py`、`local/tests/test_generate_web_config.py`、`apps/web/public/config.example.json`、`apps/web/public/config.local.example.json`を新しいruntime config契約へ合わせる。
READMEと`docs/01_requirements.md`、`docs/DESIGN.md`、`docs/06_security.md`、`docs/07_floci_local_development.md`、`docs/08_cdk_and_deployment.md`、`docs/10_test_strategy.md`、`docs/REFERENCES.md`を更新する。
追加マイルストーンではREADME、`docs/DESIGN.md`、`docs/02_concurrency_and_tiers.md`、`docs/06_security.md`、`docs/08_cdk_and_deployment.md`、`docs/10_test_strategy.md`、`docs/12_risks_and_open_questions.md`を更新する。

## データ移行・互換性

初回の自己登録変更ではUser Pool自体を置き換えず、既存ユーザーとTierグループを維持した。
App ClientのOAuth設定とUser Poolのfeature planを同じCloudFormation resourceへ追加する。
自己登録設定、メール検証設定、Post Confirmationトリガーは既存User Poolの更新として適用する。
既存ユーザーのTierは変更せず、新しく自己登録を確認したユーザーだけを`tier-basic`へ追加する。

しかし、emailの必須属性は既存User Poolへ追加できない。
不具合修正では、email必須の新Pool、新App Client、新Tierグループ、新Cognitoドメインを作成し、API AuthorizerとWeb runtime configを切り替える。
旧Poolには有効ユーザーが0件であるため、ユーザー移行は行わず、失敗した未確認ユーザー1件を旧Poolとともに削除する。
新Poolが先に作成できるようドメインprefixをv2へ変更し、同一prefixの競合によるCloudFormation失敗を避ける。

AWS Web runtime configは`authMode=managed-login`を必須とする。
Floci runtime configは`authMode=direct`を出力するため、ローカルのユーザー作成、token取得、smoke、結合試験を継続できる。

User Poolドメインprefixは同じリージョン内で利用可能でなければならない。
既定prefixが既存リソースと衝突した場合は、`cognitoDomainPrefix` Contextを別の有効な値へ変更して再デプロイする。

## テスト計画

CDKテストは、非local templateの`UserPoolTier=ESSENTIALS`、`ManagedLoginVersion=2`、Authorization Code Grant、callback URL、logout URL、Cognito provider、既定brandingを検査する。
同じテストはemailスキーマの`Required=true`と`Mutable=true`を検査する。
local templateはUser Pool DomainとManagedLoginBrandingが0件であり、`ALLOW_USER_PASSWORD_AUTH`を維持することを検査する。

Webテストは、authorize URLが`response_type=code`、PKCE、state、必要scope、正しいredirect URIを含むことを検査する。
access tokenから`sub`、`cognito:groups`、ユーザー表示名、有効期限をSessionへ変換できることを検査する。
自動開始条件は、AWSモードかつセッションとOAuth応答パラメータがない場合だけ真になることを検査する。
runtime configテストはAWSとlocalの認証モードを検査する。
Post Confirmation単体テストは、自己登録確認で`tier-basic`への追加を一度だけ要求し、パスワード再設定確認では何もしないことを検査する。
CDKテストは、非localの自己登録、メール検証、Post Confirmationトリガー、対象User PoolだけへのIAM権限、CloudFrontの`JP`許可リストを検査する。
localテンプレートは自己登録と地理的制限を追加せず、Flociの既存経路を維持することを検査する。

全体確認では `mise run check` を実行する。
local互換性確認では `mise run e2e-local`を実行する。

## ローカル確認手順

作業ディレクトリを `C:\projects\lambda-async-inference-cdk-floci-starter` として次を実行する。

    mise run check
    mise run e2e-local

`mise run check`はformat check、lint、型検査、Bunテスト、CDKテスト、Pythonテスト、build、cdk-nag付きsynthを成功させる。
`mise run e2e-local`はFlociの直接認証、推論成功、Tier上限、503、二重解放、Reaperを成功させ、最後にComposeリソースを停止する。

## AWS確認手順

AWSアカウントとデプロイ許可が明示された環境で次を実行する。

    mise run deploy-dev
    mise run deploy-web

CloudFormation出力のCognito base URLを開き、マネージドログイン画面が表示されることを確認する。
登録画面にemail入力欄が表示されることを確認する。
CloudFront上のアプリケーションを新しいブラウザーセッションで開き、ログインボタンを押さずにCognitoドメインへ遷移することを確認する。
認証後にCloudFrontへ戻り、URLから認可コードとstateが除去され、`GET /api/jobs/{jobId}`を含むAPI呼び出しが成功することを確認する。
ログアウト後はCognitoのsession cookieが無効になり、CloudFrontへ戻ることを確認する。
自己登録APIで検証用ユーザーを作成し、管理者確認後にPost Confirmationトリガーで`tier-basic`へ所属することを確認する。
実ブラウザでは受信可能なメールアドレスで登録し、届いたコードを入力して確認画面を完了する。
CloudFront Distributionの設定に`RestrictionType=whitelist`と`JP`が含まれることを確認し、日本からCloudFront URLへアクセスできることを確認する。
国外からの403はこの環境だけでは実測せず、CloudFront設定値とCDKテストを証跡とする。

## リスクと緩和策

CloudFront domain nameをApp Clientが参照するため、認証設定と配信設定の変更が同じStack更新に含まれる。
HTTP API本体がApp Clientへ依存しない構成を維持し、CloudFormationの循環参照をCDK synthで検出する。

sessionStorageへ保存するPKCE verifierとstateはcallback処理後に削除する。
callbackのstateが一致しない場合はtoken endpointを呼ばず、認証を失敗させる。

新しいCognito prefix domainは反映まで約1分かかる場合がある。
デプロイ直後のsmoke testは、domain endpointの準備完了を待ってから実行する。

自己登録を公開すると、メールアドレスを持つ任意の利用者がBasic枠を取得できる。
メール検証、API Gatewayのスロット上限とレート制限、Basicの同時実行上限を維持し、必要になった時点でWAFや招待制を追加する。

CloudFrontの国判定は接続元IPに基づくため、VPNやプロキシを使った迂回を完全には防止しない。
またCognito提供ドメイン、execute-api直URL、S3署名付きアップロードURLはCloudFrontを経由しないため、厳密な日本限定が必要な本番環境ではWAF、独自認可、オリジン直アクセスの遮断、アップロード経路の変更を別途設計する。

## 進捗 (Progress)

- [x] (2026-07-24 JST) 現行の直接認証、CDK認証構成、runtime config、テストを調査した。
- [x] (2026-07-24 JST) Cognitoドメイン、Managed Login version 2、Authorization Code GrantとPKCEの公式仕様を確認した。
- [x] (2026-07-24 JST) CDKへEssentials、Cognito prefix domain、OAuth App Client、既定brandingを実装した。
- [x] (2026-07-24 JST) Web UIへPKCE付きマネージドログイン、callback処理、state検証、ログアウトを実装した。
- [x] (2026-07-24 JST) AWSとFlociを分離するruntime config、単体テスト、設計書を更新した。
- [x] (2026-07-24 JST) `mise run check`と`mise run e2e-local`を完走した。
- [x] (2026-07-24 JST) AWS devの初回`cdk diff --change-set=false`で新規作成だけであることを確認した。
- [x] (2026-07-24 JST) 初回deployで新規アカウントのLambdaメモリ上限3008MBを実測し、失敗Stackのrollbackと削除を確認した。
- [x] (2026-07-24 JST) dev stubの既定メモリを3008MBへ変更し、費用試算とリスクを更新した。
- [x] (2026-07-24 JST) 2回目のdeployで同時実行quota全体が10であることを実測し、devのReserved Concurrencyを省略可能にした。
- [x] (2026-07-24 JST) 3回目のdeployでStackの`CREATE_COMPLETE`を確認した。
- [x] (2026-07-24 JST) 実ブラウザでManaged Loginへの遷移、PKCE callback、Tier表示、logoutを確認した。
- [x] (2026-07-24 JST) 一時ユーザーでCognito認証、S3 upload、202受付、stub推論の`SUCCEEDED`を確認し、一時ユーザーと入力画像を削除した。
- [x] (2026-07-24 JST) `mise run deploy-web`をBun実装へ変更し、WindowsからAWS CLI v2で完走した。
- [x] (2026-07-24 JST) 自己登録、Basic自動付与、WAFなしのCloudFront日本限定について公式仕様と既存実装の差分を調査した。
- [x] (2026-07-24 JST) 非localの自己登録、メール検証、Post Confirmation Lambda、最小権限を実装した。
- [x] (2026-07-24 JST) CloudFrontの`JP`許可リストとCDKテストを実装した。
- [x] (2026-07-24 JST) 設計書を更新し、`mise run check`とFloci互換性を確認した。
- [x] (2026-07-24 JST) AWS devへ更新をデプロイし、Basic自動付与とCloudFront設定を確認した。
- [x] (2026-07-24 JST) マネージドログインの登録フォームにemail欄がなく、確認コード送信先不在で登録が失敗することを実AWS設定から特定した。
- [x] (2026-07-24 JST) 実AWSのUser Pool利用者が有効0件、未確認1件であることと、必須属性が作成後に変更できない公式仕様を確認した。
- [x] (2026-07-24 JST) email必須の新User Poolを並行作成するCDK変更と回帰テストを実装した。
- [x] (2026-07-24 JST) `mise run check`、Floci互換性、AWS差分を確認した。
- [x] (2026-07-24 JST) AWS devとWebを更新し、登録フォームのemail欄、EMAIL配送設定、Basic付与を確認した。
- [x] (2026-07-24 JST) AWS Webの未認証アクセスを自動開始へ変更し、既存セッション、Floci、OAuth応答を除外する単体テストを追加した。
- [x] (2026-07-24 JST) 全品質ゲートとWeb再デプロイを実行し、CloudFront配信物を更新した。

## 決定ログ (Decision Log)

- Decision: 開発環境はCognito提供のprefix domainを使う。
  Rationale: マネージドログインにはUser Poolドメインが必要だが、独自ドメイン、DNS、証明書は開発環境の成立条件ではないため。
  Date/Author: 2026-07-24 / Codex

- Decision: AWS WebはAuthorization Code GrantとPKCEを使う。
  Rationale: ブラウザへクライアントシークレットを保存せず、implicit grantでtokenをURL fragmentへ返す構成を避けるため。
  Date/Author: 2026-07-24 / Codex

- Decision: Flociは既存の直接認証を維持する。
  Rationale: Floci 1.5.33にはHTTP API JWT claims伝播の差異があり、CognitoマネージドログインのAWS固有動作を基準にできないため。
  Date/Author: 2026-07-24 / Codex

- Decision: 新しいマネージドログインの既定brandingをCloudFormationで明示的に割り当てる。
  Rationale: Domainのbranding versionだけでなくApp Clientへstyleを関連付け、手動コンソール操作なしで再現できる構成にするため。
  Date/Author: 2026-07-24 / Codex

- Decision: 非local環境の自己登録確認後に、固定の`tier-basic`グループへ自動所属させる。
  Rationale: APIは検証済みJWTのTierグループだけを信頼するため、利用者入力を増やさず初回ログインから既存認可契約を満たせる。
  Date/Author: 2026-07-24 / Codex

- Decision: WAFを追加せず、CloudFront標準の地理的制限で`JP`だけを許可する。
  Rationale: 開発用の公開WebとCloudFront経由APIを追加料金なしの単純な国境界で絞り、WAFの固定費を避ける。
  Date/Author: 2026-07-24 / Codex

- Decision: 日本限定の保証範囲をCloudFront Distributionに限定する。
  Rationale: Cognito提供ドメインとAPI Gateway直URLはCloudFront設定の適用対象外であり、WAFなしで全公開エンドポイントを同じ国境界へ閉じることはできない。
  Date/Author: 2026-07-24 / Codex

- Decision: email必須の新User Poolを旧Poolと並行作成してdev環境を移行する。
  Rationale: Cognitoは既存Poolの必須属性を変更できず、usernameだけの自己登録では確認コードを送信できない。旧Poolに有効ユーザーはおらず、新しいConstruct IDとv2ドメインprefixを使えば旧Poolを先に削除せず移行できる。
  Date/Author: 2026-07-24 / Codex

- Decision: AWS Webは未認証時にマネージドログインを自動開始し、手動ボタンは失敗時の再試行に限定する。
  Rationale: 認証後だけ利用できるアプリケーションで中間画面を表示する必要はなく、OAuth応答パラメータを除外すればcallback処理や認証エラーからの無限リダイレクトも避けられるため。
  Date/Author: 2026-07-24 / Codex

## 発見事項 (Surprises & Discoveries)

- Observation: マネージドログインの利用に独自ドメインは必要ないが、Cognito提供ドメインまたは独自ドメインのどちらかは必要である。
  Evidence: AWS公式資料は、User Poolにドメインを追加するとマネージドログインendpointが有効になり、Cognito prefix domainとcustom domainの二つを選択肢として示している。

- Observation: Cognito prefixには予約語がある。
  Evidence: AWS公式資料は`aws`、`amazon`、`cognito`をprefixへ含められないと記載している。

- Observation: CDK 2.262.0はUserPoolDomainとManagedLoginVersionのL2を提供するが、ManagedLoginBrandingはL1のみ提供する。
  Evidence: 導入済み型定義には`UserPool.addDomain`と`ManagedLoginVersion.NEWER_MANAGED_LOGIN`があり、branding styleは`CfnManagedLoginBranding`で定義されている。

- Observation: CDKの`CfnResource.addDependency`は非推奨である。
  Evidence: CDKテスト時のdeprecation警告に従い、ManagedLoginBrandingからUserPoolDomainへの依存は`addResourceDependency`で定義した。

- Observation: この新規AWSアカウントでは、Lambda関数へ3008MBを超えるメモリを設定できない。
  Evidence: AWS devの初回deployは`MemorySize=10240`を指定したInferenceFunctionで、上限3008以下を要求するLambda APIエラーとなった。CloudFormationは他リソースを連鎖キャンセルして`ROLLBACK_COMPLETE`となり、残存リソースなしで失敗Stackを削除した。

- Observation: この新規AWSアカウントのLambda同時実行quotaは10であり、推論関数へReserved Concurrencyを設定できない。
  Evidence: 2回目のdeployは推論関数の予約によって未予約同時実行数が最小値10を下回るため失敗した。`lambda get-account-settings`とService Quotas APIはいずれもリージョン全体の上限10を返した。

- Observation: Stack分割は今回のquotaエラーを解消しない。
  Evidence: 2件の失敗はいずれもInferenceFunction単体のLambda API検証で発生した。Stackを分けても同じ関数設定は同じAPI制約を受ける。

- Observation: Windowsの`mise`から`bash`を呼ぶとWSLへ入り、Windows用のAWS CLI、Python、Bunを直接実行できない。
  Evidence: 旧`deploy-web.sh`はmise管理のAWS CLI v1 shimで失敗した。Bun実装へ置き換えた後、同じ`mise run deploy-web`がAWS CLI v2を自動検出して完走した。

- Observation: Cognito Post Confirmationは自己登録確認だけでなく、パスワード再設定確認でも起動する。
  Evidence: AWS公式のPost Confirmationトリガー仕様は`PostConfirmation_ConfirmSignUp`と`PostConfirmation_ConfirmForgotPassword`を列挙しているため、ハンドラーでtrigger sourceを限定する必要がある。

- Observation: CloudFront標準の地理的制限はDistribution全体へ適用され、国コードの許可リストまたは拒否リストを設定できる。
  Evidence: AWS公式CloudFront資料は、国単位のallowlistとdenylist、拒否時のHTTP 403、追加料金なしを説明している。

- Observation: CloudFrontの地理的制限はCognito提供ドメイン、API Gateway直URL、S3署名付きアップロードURLへ波及しない。
  Evidence: いずれもCloudFront Distributionとは別の公開サービスendpointであり、Distributionのviewer requestを通過しない。

- Observation: 既存のSPAフォールバックはCloudFrontの403を`index.html`とHTTP 200へ変換していた。
  Evidence: Geo Restrictionも国外アクセスを403で拒否し、CloudFrontは地理的制限に対してカスタムエラーページを設定できるため、403フォールバックを残すと拒否結果を隠す可能性があった。

- Observation: Post Confirmation LambdaのUser Pool限定権限は、独立したIAM Policyで循環依存なしにデプロイできた。
  Evidence: CDK synthでLambda関数はログ用DefaultPolicyだけへ依存し、Group PolicyはUser Pool ARNとLambda Roleを参照する独立リソースとなった。AWS dev更新は`UPDATE_COMPLETE`となり、一時自己登録ユーザーへ`tier-basic`が付与された。

- Observation: `autoVerify.email=true`だけではマネージドログインの登録フォームにemail入力欄が追加されない。
  Evidence: 実User Poolは`AutoVerifiedAttributes=["email"]`でも`SchemaAttributes.email.Required=false`であり、登録画面にはusernameとpasswordだけが表示され、確認コード送信先不在のエラーになった。

- Observation: User Poolの必須属性は作成後に変更できない。
  Evidence: AWS公式資料はRequired attributesを変更する場合に新User Poolを作成するよう明記している。

- Observation: APIによる自己登録テストだけではManaged Loginの登録フォーム契約を検証できない。
  Evidence: 旧PoolへのSignUpテストはemail属性を明示したため成功したが、実フォームは任意属性のemailを表示せず、利用者の登録だけが失敗した。

- Observation: 新Poolではemail必須スキーマとManaged Loginのemail入力欄が一致した。
  Evidence: 実AWSの`SchemaAttributes.email`は`Required=true`かつ`Mutable=true`となり、Managed Loginの`/signup`は`type="email"`のinputを1件返した。emailなしのSignUpは拒否され、emailありの応答は`DeliveryMedium=EMAIL`となった。

## 完了結果 (Outcomes & Retrospective)

AWS環境の自前パスワード画面を、Cognito提供prefix domainのManaged Login version 2へ切り替えた。
WebはAuthorization Code GrantとPKCE S256で認証し、callbackのstateとverifierを検証してからtoken endpointを呼ぶ。
logoutはCognitoのlogout endpointを経由してCloudFrontへ戻る。

Floci環境はUser Pool Domainを作らず、`authMode=direct`とローカル認証バイパスを維持した。
`mise run e2e-local`では生成設定、Cognito token、推論成功、BasicとStandardのTier上限、503、二重解放、Reaper、枠の0復帰を確認した。

AWS dev Stackは3回目のdeployで`CREATE_COMPLETE`となった。
Inference Lambdaはコンテナイメージ、3008MB、予約同時実行なしでActiveになり、Cognito Essentials、Managed Login version 2、CloudFront配信も有効になった。

実ブラウザでCognitoへの遷移、PKCE callback、CloudFront復帰、`tier-basic`表示、logoutを確認した。
AWSスモークでは、アクセストークン取得、署名付きS3 uploadのHTTP 204、Job受付のHTTP 202、`RESERVED`から`SUCCEEDED`への遷移、`stub-001`の予測3件を確認した。
検証用Cognitoユーザーと入力画像は確認後に削除した。

最終`mise run check`では、APIとWeb 25件、CDK 16件、推論Python 2件、ローカルPython 10件の合計53件、format、lint、型検査、全workspace build、AWS dev向けCDK synth、cdk-nagが成功した。
`mise run e2e-local`も再実行し、推論成功、BasicとStandardのTier上限、503、二重解放、Reaper、枠の0復帰、Floci停止を確認した。
実デプロイ後の`cdk diff --change-set=false`は差分0件となった。

追加マイルストーンで、AWS環境のメール検証付き自己登録、自己登録確認後の`tier-basic`自動付与、CloudFrontの`JP`許可リストを実装した。
Post Confirmation Lambdaは確認種別を限定し、対象User Poolの`AdminAddUserToGroup`だけを許可する。
Geo Restrictionの403を200へ変換しないよう、SPAの403カスタムエラーを削除した。

`mise run check`ではAPIとWeb 27件、CDK 18件、推論Python 2件、ローカルPython 10件の合計57件、format、lint、型検査、全workspace build、AWS dev向けCDK synth、cdk-nagが成功した。
`mise run e2e-local`では既存Stackを再利用し、推論成功、BasicとStandardのTier上限、503、二重解放、Reaper、枠の0復帰、Floci停止を確認した。

AWS dev Stackは`UPDATE_COMPLETE`となった。
実設定のUser Poolは自己登録許可、メール自動検証、Post Confirmation Lambdaを保持し、CloudFrontは`whitelist`と`JP`だけを保持する。
一時ユーザーをSignUpして管理者確認した結果、Post Confirmation Lambdaが`tier-basic`を付与し、確認後に一時ユーザーを削除した。
日本の接続元からCloudFrontはHTTP 200、マネージドログインの`/signup`はHTTP 200を返した。
国外からの403は国外検証地点を用意していないため未実測である。
デプロイ後の`cdk diff --change-set=false`は差分0件となった。

追加マイルストーン後の実利用で、登録フォームにemail欄がない回帰を検出した。
APIによる検証はemail属性を明示していたため成功したが、マネージドログインが生成する実フォームの入力契約を検証できていなかった。
email必須の新User Poolへ移行する不具合修正を完了した。

不具合修正では、AWS用Construct IDを`UserPoolV2`へ変更し、email標準属性を必須かつ変更可能として新Poolを作成した。
新しいCognitoドメインは`inference-dev-v2-579111114227`であり、旧Poolと同時に作成してAuthorizerとCloudFormation出力を切り替えた後、旧Poolを削除した。
旧Poolには有効ユーザーが0件だったため、失敗した未確認ユーザー1件だけが削除された。

AWS dev StackとWebは新Pool ID `ap-northeast-1_jX7B18q1G`、新App Client ID `1ko33vkhcmd2qnk39e3qpdb21p`へ更新された。
実Managed LoginはHTTP 200を返し、email入力欄を1件含む。
emailなしのSignUpは拒否され、emailありのSignUpは確認コードの`DeliveryMedium=EMAIL`と`AttributeName=email`を返した。
管理者確認による実経路ではPost Confirmation Lambdaが`tier-basic`を付与し、検証ユーザーを削除した。
外部の受信可能な検証用メールボックスは使用していないため、メール本文の実受信とコード手入力は利用者による再確認事項として残る。

`mise run check`は合計57件のテスト、format、lint、型検査、build、cdk-nag付きsynthを成功させた。
`mise run e2e-local`は既存Floci Stackを再利用し、推論成功、Tier上限、503、二重解放、Reaper、停止まで完走した。
AWS dev Stackは`UPDATE_COMPLETE`で、デプロイ後の`cdk diff --change-set=false`は差分0件である。

認証導線の改善では、AWS Webの未認証アクセスからマネージドログインを自動開始するよう変更した。
有効なセッション、Floci直接認証、OAuth callback、認証エラーでは自動開始しないため、既存の認証方式とエラー回復を維持する。
`ManagedLogin`は自動開始に失敗した場合の再試行画面として残した。
`mise run check`はWebとAPI 36件、CDK 32件、推論Python 14件、ローカルPython 10件、format、lint、型検査、build、cdk-nag付きsynthを成功させた。
`mise run deploy-web`で新しいWeb成果物をS3へ同期し、CloudFront Invalidation `IDAZ2B0IPQXRSZVY85X3187AQB`の`Completed`を確認した。
CloudFrontはHTTP 200で新しい`assets/index-AfDS2jGN.js`を返し、runtime configは`authMode=managed-login`と`localAuthBypass=false`を維持している。

更新メモ: 2026-07-24に、Cognitoマネージドログインへの移行判断、ドメイン要件、PKCE、Floci互換性を記録して本計画を作成した。
同日に実装、文書、品質ゲート、Floci E2E、AWS dev deploy、実ブラウザとAPIのスモーク結果を追記した。
同日に自己登録、Basic自動付与、CloudFrontの`JP`許可リストを追加マイルストーンとして追記した。
同日に実装、全体検証、Floci E2E、AWS dev更新、実自己登録とBasic付与の確認結果を追記して追加マイルストーンを完了した。
同日にマネージドログインの実登録でemail欄欠落を検出し、原因、User Pool再作成方針、回帰テストを不具合修正マイルストーンとして追記した。
同日にemail必須の`UserPoolV2`へ移行し、全体検証、Floci E2E、AWS devとWebの更新、実Managed Loginフォーム、EMAIL配送設定、Basic付与の確認結果を追記した。
同日の後続セキュリティ強化で、利用していないCognito管理scopeとWeb sessionへのRefresh Token保存を削除した。
同日にAWS Webの未認証アクセスからマネージドログインを自動開始し、callbackと認証エラーの無限リダイレクトを防ぐ認証導線へ変更した。
同日に全品質ゲート、Web再デプロイ、CloudFront無効化完了、新しいJavaScript成果物とruntime configの配信を確認した。
