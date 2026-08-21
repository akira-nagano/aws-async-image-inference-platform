# Flociローカル開発

## 1. 目的

AWS開発環境を通常の統合確認先としたうえで、AWSへデプロイせず主要なアプリケーションフローをローカルで素早く確認する。Flociはオフライン作業、AWS資格情報を使えない環境、競合・二重解放・Reaperなどの障害系結合試験に使う補助環境とする。

対象:

- S3
- Cognito
- API Gateway v2
- Lambda
- ECR / DockerImageFunction
- DynamoDB
- Step Functions
- EventBridge Scheduled Rule
- CloudWatch Logs
- Floci UIによる対応済みAWSリソースの表示

## 2. 再現しないもの

- CloudFrontの実コンテンツ配信・キャッシュ
- OACの実配信経路
- Route 53 DNS
- ACM実証明書
- WAF実遮断
- AWS Lambda固有のCPU、メモリ、コールドスタート
- AWS IAMの完全な権限評価（Floci側設定による）
- CloudWatch Dashboard（ローカルContextでは作成しない）
- Cognito User Poolドメインとマネージドログイン

フロントエンドはローカルではViteで配信する。
認証はローカル専用の直接認証画面を使用する。

## 3. Floci開発環境の起動

```bash
mise run dev-local
```

このタスクは次を順番に行い、最後にViteを前面プロセスとして起動する。

1. FlociとFloci UIを起動する。
2. Flociのreadyと、Floci UIから見たAWS runtimeの`reachable`を待つ。
3. `CDKToolkit`がない初回だけCDK bootstrapを実行する。
4. `ImgFlow-local`がない初回だけCDK deployを実行する。
5. 既存Stackを使う場合もStack出力から`apps/web/public/config.json`を再生成する。
6. BasicのCognito開発ユーザーを冪等に作成・更新する。
7. Viteを起動する。

`local/compose.yaml`はDocker SocketをFlociへマウントする。Lambdaコンテナの実行に必要。
Floci UIは公式release 0.2.0の単一imageを検証済みOCI digestへ固定し、同じCompose networkの`http://floci:4566`へ接続する。

Windowsの予約済みTCPポート範囲とFlociのECR既定ポート5100が重なる環境に対応するため、このリポジトリはECRレジストリの範囲を5200から5299へ固定する。

システム識別子変更前の`local/data`は、新しいStackへ自動変換しない。古いリソースをFloci UIへ残したくない場合は、`mise run dev-local-down`で停止してから`local/data`をリポジトリ外へ退避し、空の`local/data`で`mise run dev-local`を実行する。

Floci 1.5.33は既存CloudFormation Stackの更新時にIAM名衝突を起こす場合があるため、通常の`dev-local`は永続化済みStackを自動更新しない。API Lambda、CDK、推論コンテナを変更した場合は、Viteとは別のターミナルで明示的に再デプロイする。

```bash
mise run dev-local-refresh
```

このタスクはFlociとFloci UIを起動し、必要ならbootstrapした後、ローカル向けCDK deployとCognito seedを実行して終了する。

Floci UIなしでbootstrapから結合試験まで一括実行する場合は次を使う。

```bash
mise run e2e-local
```

`e2e-local`は、開発用の`local/data/`と分離した一時データ領域でFlociを起動する。
一時領域には既存Stackがないため、現在のソースからbootstrapとdeployを実行する。
その後、Cognito seed、smoke、Tier上限、503、二重解放、Reaperを確認する。
成功時も失敗時もFlociを停止し、失敗時は停止前にComposeログを出力する。
終了時に一時データ領域を削除するが、開発用の`local/data/`は変更しない。

## 4. 環境変数

シェル側:

```bash
export AWS_ENDPOINT_URL=http://localhost:4566
export AWS_DEFAULT_REGION=ap-northeast-1
export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
```

## 5. CDK bootstrap / deploy

`dev-local`、`dev-local-refresh`、`e2e-local`が必要なCDK bootstrapとdeployを内部で実行する。個別のmiseタスクとしては公開しない。

CDKのDockerImageFunctionは、ローカルDockerfileをビルドし、FlociのECR互換レジストリへpushし、Lambdaコンテナとして実行する。

ローカルでも標準の`cdk` CLIを使い、`AWS_ENDPOINT_URL=http://localhost:4566`でFlociへ向ける。
`aws-cdk-local`は現在のCDK CLI内部APIと互換性がないため使用しない。

標準bootstrapはECRリポジトリも作成する。
このスタックは推論用のDockerImageFunctionを含むため、ECRを省いたbootstrapへ置き換えない。

## 6. Cognitoユーザー

`dev-local`と`e2e-local`は初期ユーザーを冪等に作成する。手動でseed処理だけを再実行する場合:

```bash
mise exec -- bash ./local/seed-cognito-user.sh
```

初期ユーザー:

```text
username: basic@example.test
password: LocalPassw0rd!
group: tier-basic
```

StandardとPremiumもスクリプトの引数で作成できる。

## 7. アプリケーションWeb UI

`mise run dev-local`がViteを起動する。Flociを使わずViteだけを起動する必要がある場合は`mise run dev-web`を使う。

`apps/web/public/config.json`は`local/export-stack-outputs.sh`が生成する。`dev-local`は既存Stackを再利用する場合もこの生成処理を実行するため、永続データから再開した後も現在のAPI ID、User Pool ID、User Pool Client IDを参照する。
ローカル設定は`authMode=direct`となり、ユーザー名・パスワード画面からFlociのCognito互換APIを呼ぶ。

アプリケーションWeb UIは`http://localhost:5173`で開く。

ローカル設定のCognito endpointは`/_local/cognito`である。Viteの開発用proxyがこの同一オリジンURLを`http://localhost:4566`へ転送する。Floci 1.5.33はブラウザのCORS preflightへ対応していないため、Cognitoだけをproxyし、API GatewayとS3は従来どおりFlociへ直接接続する。本番設定にはこのendpoint overrideを含めない。

## 8. Floci管理UI

Flociを使う開発環境ではFloci管理UIを常に起動する。

```text
http://localhost:4500
```

このリポジトリでは、Floci UIからFloci account `000000000000`、region `ap-northeast-1`を参照する。S3 bucketとLambda functionはCloud Explorerから確認できる。

Floci UI 0.2.0では、DynamoDBは新しいCloud Explorerへ未統合であり、Cognitoなど一部サービスはプレースホルダーである。Floci UIはスモークテストやAWS CLIを置き換えず、対応済みリソースを観察する補助コンソールとして使う。

ログ:

```bash
mise run floci-logs
```

## 9. スモークテスト

通常は`mise run e2e-local`の一部として実行する。起動済みのローカル環境に対して単独でデバッグする場合:

```bash
mise exec -- bash ./local/smoke-test.sh
```

確認内容:

1. Cognitoトークン取得
2. Upload URL取得
3. S3へ署名付きフォームPOST
4. Job作成202
5. Job状態ポーリング
6. SUCCEEDED
7. 上位3候補

## 10. Tier上限テスト

スタブ推論に遅延を入れ、同一ユーザーから並列送信する。

```text
tier-basic limit=1
2件同時送信
期待: 202が1件、429が1件
```

Standard:

```text
limit=3
10件同時送信
期待: 202が3件、429が7件
```

次のコマンドはBasicとStandardの並列送信後、受理されたJobがすべて`SUCCEEDED`となり、利用中の枠が0へ戻るまで確認する。

```bash
mise exec -- python ./local/run-integration.py
```

同じスクリプトは、システム枠を検査用に上限まで埋めた場合の503、Finalize二重実行、期限切れJobのReaper回収も確認する。通常は`mise run e2e-local`からsmokeと続けて実行する。

## 11. ローカル認証

Floci 1.5.33では、CloudFormationがHTTP API v2のJWT Authorizerを作成済みと報告しても、AuthorizerのclaimsがLambdaイベントへ渡らない。
この状態ではLambda側がCognitoの`sub`と`cognito:groups`を取得できない。

ローカル向けCDK deployは`local=true`と`localAuthBypass=true`を同時に指定し、APIルートのAuthorizerを外す。
ローカル設定生成は`apps/web/public/config.json`へ`authMode: "direct"`と`localAuthBypass: true`を明示する。Web UIは直接認証で得たアクセストークンの`sub`と`cognito:groups`から`x-local-user-id`と`x-local-groups`を生成し、このフラグがtrueの場合だけAPIリクエストへ追加する。スモークテストと結合テストも同じヘッダーをテストアダプターから渡す。
CDKアプリは`local=false`でのバイパス指定をエラーにするため、AWS向けテンプレートにはこの経路が入らない。

ローカル結合試験でもCognitoユーザーを作成し、アクセストークンの発行、issuer、client ID、Tierグループを確認する。
ただし、実JWT Authorizerによる署名検証とclaims伝播はAWS開発環境で確認する。

## 12. Floci差異の扱い

- Floci非対応の挙動をアプリコードへ恒久的に混ぜない。
- 必要な回避は `local` Contextまたはテストアダプターへ閉じ込める。
- AWS開発環境で確認すべき項目をテスト計画へ記録する。
- `latest`ではなく検証済みFlociタグをCIで固定する。
- Floci UIもrelease tagとOCI digestの両方へ固定する。
- Floci 1.5.33は既存CloudFormation Stackの更新時にリソースを再作成し、IAM名の衝突で失敗する場合がある。
- Floci 1.5.33はCloudFormationで`StreamSpecification`を受理してもDynamoDB Streams APIへStreamを作成しないため、ローカルStackだけJob SubmitからDispatcher Lambdaを明示呼び出しする。
- AWS向けStackはDynamoDB Streams Event Source Mappingを使用し、上記ローカル呼び出しの環境変数とIAM権限を含めない。
- 再デプロイが必要な場合はFlociを停止し、`local/data`を時刻付きディレクトリへ退避してから新しい`local/data`を作る。

## 13. 停止

```bash
mise run dev-local-down
```

`dev-local-down`は停止スクリプトを呼び出す。このタスクはFloci UI、Floci本体、Flociが動的に作成したLambdaコンテナ、ECRレジストリを停止する。
Docker Volumeや`local/data`は削除しない。

## 14. トラブルシュート

### ログイン時の`Failed to fetch`

`apps/web/public/config.json`の`cognitoEndpoint`が`/_local/cognito`であることを確認する。`http://localhost:4566`になっている場合は古い設定なので、`mise run dev-local`または次のコマンドで再生成する。

```bash
mise exec -- bash ./local/export-stack-outputs.sh
```

Vite設定を変更した直後は開発サーバーを再起動し、ブラウザを再読み込みする。正しい設定でも失敗する場合は、Flociがreadyであること、Viteの`/_local/cognito`へのPOSTがHTTP 200を返すことを確認する。

### Docker Socket

Flociコンテナに `/var/run/docker.sock` が必要。

### Linux UFW

LambdaコンテナからFloci Runtime APIへ到達できずタイムアウトする場合、Docker bridgeへの通信制御を確認する。

### ECRレジストリ

FlociのローカルECRはHTTPの場合がある。返却URIがloopbackでない場合、Dockerのinsecure registry設定が必要になることがある。

Windowsでポート5200を利用できない場合は、`local/compose.yaml`の`FLOCI_SERVICES_ECR_REGISTRY_BASE_PORT`と`FLOCI_SERVICES_ECR_REGISTRY_MAX_PORT`を、予約範囲外の連続した値へ変更する。

### Floci UI

`http://localhost:4500`を開けない場合は、`mise run floci-logs`で`floci-ui`のログを確認する。
`/api/clouds/aws/status`が`unavailable`の場合は、Floci本体がreadyであることと、Compose network内の`http://floci:4566`へ接続できることを確認する。

### S3所有者メタデータとサイズ上限

Upload URL Lambdaは署名付きPOSTのフォームフィールドへ`x-amz-meta-owner`を含める。
クライアントは返却された`uploadFields`を変更せず、画像の`file`フィールドより先にmultipart bodyへ追加する。
Floci 1.5.33はPOST Policyの`content-length-range`とownerメタデータを検証できるため、AWSと同じ契約をローカル結合試験で使う。

### 大型モデル

利用者提供モデルをローカルE2Eに毎回含めない。
現在の通常CIとFloci E2Eは`stub`だけを使う。
利用者提供モデル用の`real`は未実装であり、モデル形式と依存関係が確定してから手動試験または夜間試験の経路を追加する。
