# CDK・デプロイ設計

## 1. CDK方針

- AWS CDK v2 / TypeScript
- 初期は1つのPlatformStackにまとめ、Construct単位で責務分割する。
- クロススタック参照を増やさず、Flociでのdeployを単純化する。
- 本番規模になった時点でFrontend/Auth/Core/Operationsへ分割可能とする。

## 2. Construct構成

```text
PlatformStack
├── Auth
│   ├── UserPool
│   ├── UserPoolClient
│   ├── UserPoolDomain（AWS）
│   ├── ManagedLoginBranding（AWS）
│   └── Tier Groups
├── Storage
│   ├── Frontend Bucket
│   ├── Input Bucket
│   ├── Access Logs Bucket
│   ├── Jobs Table
│   └── Concurrency Table
├── Compute
│   ├── API Lambdas
│   ├── Job Dispatcher
│   ├── Inference DockerImageFunction
│   └── Reaper
├── Workflow
│   ├── DynamoDB Streams Event Source Mapping（AWS）
│   ├── Job Submit → Dispatcher明示呼び出し（Floci localのみ）
│   ├── 確定的な起動拒否の即時終端化
│   └── Step Functions Standard
├── API
│   ├── HTTP API
│   └── JWT Authorizer
├── Edge
│   ├── CloudFront
│   └── OAC
└── Monitoring
    ├── Log Groups
    ├── Alarms
    └── Dashboard
```

## 3. Context例

```json
{
  "environment": "dev",
  "tierLimits": {
    "tier-basic": 1,
    "tier-standard": 3,
    "tier-premium": 4
  },
  "capacityMode": "shared",
  "systemConcurrencyLimit": 4,
  "dailyJobLimits": {
    "tier-basic": 10,
    "tier-standard": 30,
    "tier-premium": 100
  },
  "systemDailyJobLimit": 100,
  "inferenceMemoryMb": 3008,
  "inferenceTimeoutSeconds": 900,
  "stubInferenceDelayMs": 5000,
  "inputRetentionDays": 1,
  "maxUploadBytes": 5242880,
  "apiThrottleRate": 50,
  "apiThrottleBurst": 100,
  "uploadAllowedOrigin": "https://*.cloudfront.net",
  "cognitoDomainPrefix": "imgflow-dev-123456789012",
  "local": false,
  "localAuthBypass": false
}
```

`cognitoDomainPrefix`は任意である。
省略時は`imgflow-<environment>-<AWS account ID>`を使用する。
Cognito提供prefixはリージョン内で一意である必要があり、1文字から63文字の小文字英数字とハイフンだけを許可する。
カスタムドメイン、Route 53、ACM証明書はこのスターターでは作成しない。

devのstub推論は、新規AWSアカウントの縮小quotaでもデプロイできるよう`inferenceMemoryMb=3008`を既定値とする。
実モデルに3008MBを超えるメモリが必要な場合は、対象リージョンのLambda quotaを確認し、引き上げ後にContextを最大10240まで変更する。

`capacityMode=shared`は、推論LambdaへReserved Concurrencyを設定せず、リージョンの共有枠を使う。
必要な未予約枠はシステム受付上限とアーキテクチャ定数である制御系Lambda用余白6の合計である。
AWS devの既定値は受付上限4、API、Dispatcher、Finalize、Reaperなどの制御系Lambda用余白6であり、現在の同時実行quota 10を全体契約として使用する。
制御系余白はContextから変更できない。

quota引き上げ後に`capacityMode=reserved`を選ぶと、推論LambdaのReserved Concurrencyを`systemConcurrencyLimit`と同値でCDKが導出する。
予約値を別のContextとして指定することはできない。
このため、受付上限よりLambda予約枠が小さい設定や、受付上限を変更したのに予約枠を変更し忘れた設定は作成できない。
旧Context `inferenceReservedConcurrency`を渡した場合はsynthを失敗させる。
`controlPlaneConcurrencyHeadroom`をContextへ渡した場合も、安全根拠なしに余白を下げられないようsynthを失敗させる。

Tier上限はBasic、Standard、Premiumの順に単調増加し、全Tierを`systemConcurrencyLimit`以下にする。
AWS devではBasic 1、Standard 3、Premium 4とする。
Premium 10、システム全体4のようにTier利用者が契約上限へ到達できない構成はsynth時に拒否する。

日次Job上限もBasic、Standard、Premiumの順に単調増加し、全Tierを`systemDailyJobLimit`以下にする。
アップロードURL件数は日次Job上限の2倍、予約バイト量は日次Job上限と`maxUploadBytes`の積として導出する。
件数と容量を独立したContextにしないため、相互に説明できない組み合わせを作れない。

`mise run deploy-dev`はCDK deployより先にLambda `GetAccountSettings`を実行する。
共有枠では受付上限と制御系余白の合計が現在の未予約枠以下であることを確認する。
予約枠では、現在の推論Lambdaが持つ予約枠からの差分を反映した後も、AWSが要求する未予約枠10以上と制御系余白を残せることを確認する。
この検査が失敗した場合、CloudFormationは開始されない。
`cdk deploy`の直接実行はこの検査を迂回するため、AWS devでは公開入口の`mise run deploy-dev`を使用する。

## 4. Lambdaコンテナ

CDK `DockerImageFunction` + `fromImageAsset` を使用する。

- CDK bootstrapのECR asset repositoryを利用
- ローカルではFloci ECRへbuild/push
- AWSではCDK assetとしてECRへpush
- 実モデル用のimmutable digest運用は後続フェーズ

Bun公式のLambdaガイドは、BunアプリをLambda Web Adapter付きコンテナとして動かす場合のDockerfileとECRデプロイ手順に利用できる。
このリポジトリではAPI LambdaをNode.js 24、推論LambdaをPythonコンテナとしているため、現時点ではCDKアプリやLambda runtimeの構成を同ガイドへ置き換えない。
API LambdaをBun runtimeへ変更する場合は、コールドスタート、AWS SDKのbundle、Lambda proxy event互換性を別のアーキテクチャ変更として検証する。

## 5. フロントエンド

CDKはS3とCloudFrontを作る。WebビルドとS3 syncはデプロイパイプラインで行う。

理由:

- `cdk synth` 時に `dist` を必須にしない。
- UIとインフラのデプロイを独立可能にする。
- CloudFront invalidationを明示制御する。

CDKのscriptはBunから起動する。Windows上のasset staging互換性のため、CDKアプリとCDK単体テストのみTypeScript 7で`dist`へコンパイルしてからNode.js 22で実行する。`synth`、`deploy`、`test`の各scriptが事前ビルドを行うため、利用者が`dist`を用意する必要はない。

### S3 Bucketの削除ポリシー

Frontend BucketはWeb buildから再生成でき、Input Bucketは1日保持の一時画像だけを格納する。
この2つは環境にかかわらず`RemovalPolicy.DESTROY`と`autoDeleteObjects: true`を設定する。
CloudFormationがStackを削除すると、CDKの自動削除Custom Resourceがオブジェクト、オブジェクトバージョン、削除マーカーを先に削除してからBucketを削除する。
この処理は不可逆であり、Frontend BucketまたはInput Bucketへ永続保管が必要なデータを置かない。

Access Logs Bucketは監査証跡になり得るため、prodだけ`RemovalPolicy.RETAIN`としてStack削除後も保持する。
devとlocalでは`RemovalPolicy.DESTROY`と自動空化を設定し、検証用Stackを手動で空にせず削除できるようにする。
prod Stackの誤削除は、再生成可能なFrontend Bucketを保持する方法ではなく、Termination Protectionと変更承認で防止する。
S3以外のDynamoDB Tableやログなどは、既存の環境別`removalPolicy`を維持する。

AWS環境のUser PoolはEssentialsプランを明示し、Cognito提供ドメインへManaged Login version 2の既定brandingを割り当てる。
App Clientは公開クライアントとし、Authorization Code Grant、PKCE、Cognito provider、`openid`、`email`、`profile` scopeを使用する。
callback URLとlogout URLはCloudFrontのルートURLとする。
AWS環境ではUser Pool作成時にemail標準属性を必須かつ変更可能に設定し、メール検証付き自己登録を許可する。
User Poolの必須属性は作成後に変更できないため、emailが任意だった既存dev Poolからは`UserPoolV2`へ移行する。
自己登録確認後のPost Confirmation Lambdaは固定の`tier-basic`へ追加し、対象User Poolの`AdminAddUserToGroup`以外のCognito権限を持たない。

AWS環境のCloudFront DistributionはGeo Restrictionのallowlistへ`JP`を設定する。
この設定は追加のWAFを必要とせずDistribution全体へ適用される。
Geo Restrictionが返す403をSPAフォールバックで200へ変換しないため、CloudFrontのカスタムエラーは404だけを`index.html`へ変換する。
CloudFrontを通らないCognito提供ドメイン、execute-api直URL、発行後のS3署名付きアップロードURLは、この国制限の対象外である。

Web runtime configの`authMode`はAWS環境で`managed-login`、Floci環境で`direct`となる。
AWS環境ではマネージドログインbase URLとOAuth redirect URIをStack出力から生成する。

ローカルデプロイも標準の`cdk` CLIを使う。
miseタスクが`AWS_ENDPOINT_URL`とダミー認証情報を設定し、CDK bootstrapとdeployをFlociへ向ける。
`aws-cdk-local`はCDK CLIの非公開モジュールへ依存し、現在のCLIでは起動できないため採用しない。

Floci向けdeployだけは`localAuthBypass=true`を指定する。
Floci 1.5.33がHTTP API v2のJWT claimsをLambdaイベントへ渡さないためである。
非ローカル環境で同じ指定を行うと、CDKアプリはsynth前にエラーにする。

Lambdaログは`Custom::LogRetention`を使わず、CDKの`LogGroup`を各Lambdaへ渡す。
Flociからログ保持期間Custom Resourceを呼ぶ経路が実AWSのLogs endpointへ向かうため、ネイティブなCloudFormationリソースで同じ保持期間を定義する。

## 6. 開発環境の運用方針

通常の統合確認はAWS開発環境を基準とする。実JWT Authorizer、自己登録確認後トリガー、DynamoDB Streams Event Source Mapping、IAM評価、CloudFront/OACとGeo Restriction、Lambdaの実性能とクォータはAWS上で確認する。

Flociは補助環境として維持する。AWS資格情報なしでのローカル確認、オフライン作業、競合、二重Finalize、Reaper、503などの決定論的な障害系結合試験に使用する。Floci固有の認証バイパスとDispatcher直接呼び出しの結果だけでAWS上の成立性を判断しない。

AWS開発環境のデプロイ手順:

```bash
mise run check
bun run cdk:bootstrap
mise exec -- python scripts/prepare-abo-catalog.py --accept-license --products 30
mise exec -- python scripts/fetch-dinov2-model.py
mise exec -- uv pip install --index-url https://download.pytorch.org/whl/cpu "torch==2.13.0+cpu" "torchvision==0.28.0+cpu"
mise exec -- uv pip install -r services/inference/requirements-catalog.txt
mise exec -- python scripts/build-product-catalog.py local/data/abo-catalog/catalog-source.json
mise run deploy-dev
mise run deploy-web
```

`deploy-dev`はLambdaアカウントquotaに対する容量契約を検証してから`catalog`をデプロイする。
Flociの`deploy:local`とcdk-nag付きsynthは`stub`をCDK Contextへ明示する。
CDK deploy成功後はStack状態、推論Lambdaの`MODEL_PROFILE=catalog`、Job Submit Lambdaの受付上限と日次上限、Lambdaアカウント容量契約を再取得して照合する。
`deploy-web`はCloudFormation StackのOutputsを取得し、`apps/web/public/config.json`を実AWS用に再生成してからWebをbuildする。AWS用設定は`apiBaseUrl=/api`、`authMode=managed-login`、`localAuthBypass=false`とし、Cognitoマネージドログインbase URLとCloudFront callback URLを含める。Floci用の`cognitoEndpoint`を含めない。
デプロイ処理はBunスクリプトで実行し、Windowsではシステムに導入されたAWS CLI v2を自動検出する。別の実行ファイルを使う場合は環境変数`AWS_CLI`で指定する。

デプロイ後はCloudFront Distribution設定の`Restrictions.GeoRestriction`が`whitelist`と`JP`であることを確認する。
自己登録の検証では、マネージドログインの登録フォームにemail入力欄があることを確認する。
受信可能な一時メールアドレスで確認コードを受け取り、確認後に`tier-basic`へ所属したことを確認してからユーザーを削除する。
国外からの403は国外の検証地点を用意できる場合だけ実測し、それ以外はCDKテストとDistribution設定値を証跡とする。

### AWS開発環境の破棄手順

破棄前にAWS CLIの認証先と`ImgFlow-dev`の状態を確認する。
次のPowerShellコマンドの`<profile>`は利用するAWS CLIプロファイル名へ置き換える。

```powershell
$env:AWS_PROFILE = "<profile>"
$env:AWS_REGION = "ap-northeast-1"
$env:AWS_DEFAULT_REGION = "ap-northeast-1"
aws sts get-caller-identity
aws cloudformation describe-stacks --stack-name ImgFlow-dev
mise exec -- bun run --cwd infra/cdk cdk destroy --all --force -c environment=dev -c inferenceModelProfile=stub
aws cloudformation describe-stacks --stack-name ImgFlow-dev
```

CDK DestroyはCloudFormationの削除完了まで待機する。
最後の`describe-stacks`がStack不存在の`ValidationError`を返すことを削除完了の確認とする。
`inferenceModelProfile=stub`は破棄時のsynthを未提供のcatalog成果物へ依存させないための指定であり、環境Contextが`dev`なので対象Stackは`ImgFlow-dev`になる。

devのFrontend Bucket、Input Bucket、Access Logs Bucketには`autoDeleteObjects`が設定されている。
CDKの自動削除Custom Resourceが内容を削除してからBucketを削除するため、利用者は事前にBucketを空にしない。
この処理は不可逆であり、S3オブジェクト、DynamoDBデータ、Cognitoユーザーを含むdev Stackのデータは削除される。

`CDKToolkit` Stack、bootstrapのasset用S3 Bucket、ECR repositoryと保存済みassetは共有リソースであり、`ImgFlow-dev`のDestroy対象ではない。
不要なbootstrap assetの整理は、同じbootstrap環境を使う他Stackへの影響とCDKのライフサイクル設定を確認して別に実施する。

### 開発費用の目安

AWS devをcatalogで運用する場合、AWSの継続無料枠をこのシステムだけで利用できるなら、月額は0.05米ドルから0.30米ドル程度と見積もる。
料金改定、リージョン差、税、同じAWSアカウントにある別システムの利用量は含まないため、月1米ドル未満を運用上の予算目安とする。

#### 試算条件

| 項目 | 前提 |
|---|---:|
| リージョン | 東京（`ap-northeast-1`） |
| 環境数 | dev Stack 1環境 |
| Cognito利用者 | 5 MAU |
| 推論Job | 月100件 |
| 入力画像 | 1件5MiB、1日保持 |
| catalog推論 | Lambdaメモリ3008MiB、全件cold startとして1件約8.6秒 |
| HTTP API | 1Jobあたり6リクエスト |
| Step Functions | 1Jobあたり約4状態遷移 |
| CloudWatch Logs | 月5GB未満 |
| ECR | 推論イメージ1世代 |

MAUは、その月にCognitoで認証した重複しない利用者数を表す。

#### サービス別の概算

| サービス | 月間使用量の目安 | 無料枠を利用できる場合の概算 |
|---|---:|---:|
| Cognito Essentials | 5 MAU | 0米ドル |
| Lambda | catalog推論約2,527GB秒、API Lambda、Reaper | 0米ドル |
| Step Functions Standard | 約400状態遷移 | 0米ドル |
| CloudWatch | 2カスタムメトリクス、4アラーム、1ダッシュボード、ログ5GB未満 | 0米ドル |
| SNS、EventBridge | 開発用途の少量リクエスト | 0米ドル相当 |
| API Gateway HTTP API | 約600リクエスト | 0米ドルから0.01米ドル未満 |
| DynamoDB On-Demand、PITR、Streams | 数千リクエスト、小容量の2テーブル、Lambdaトリガー | 0.01米ドル未満から数セント |
| S3、CloudFront | 入力画像の平均保持量約117MiB、Web、アクセスログ | 数セント未満 |
| ECR | ローカル計測で617.2MBのcatalogイメージを1世代 | 約0.03米ドルから0.08米ドル |
| **合計** | 上記の合計 | **約0.05米ドルから0.30米ドル** |

カスタムメトリクスは`DispatchAnomaly`と`ReaperAnomaly`の2種類だけを使用する。
AlarmはWorkflow異常、Dispatcher異常、Reaper異常、Job受付エラーの4本とし、すべて既存SNS Topicへ接続する。
通常のJob成否とLambda稼働状況はAWS標準メトリクスを使用し、内訳は構造化ログへ残す。

Lambdaのcatalog推論は、全件で約7.962秒の初期化と約0.639秒の推論が発生する保守的な条件でも、1件あたり約25.27GB秒を消費する。
月100件では約2,527GB秒となり、API Lambdaと5分間隔のReaperを加えても、月400,000GB秒の無料枠を大きく下回る。

Step Functionsは、1Jobを約4状態遷移として月100件で約400状態遷移になる。
月4,000状態遷移の無料枠に対して、Retryや失敗分を除けば約1,000Jobが一つの境界になる。

DynamoDB Streamsは、Lambda Event Source Mappingが行う`GetRecords`を課金しない。
この構成ではStreamがアイドルでも読み取り料金は発生せず、レコード処理時のDispatcher Lambda実行量だけをLambda料金へ含める。
Lambda以外のコンシューマーを追加した場合は別の扱いとなるが、最初の月250万Stream read requestはアカウントとリージョン単位の無料枠に含まれる。

入力画像の平均保持量は、`100件 × 5MiB × 1日 ÷ 30日`で約17MiBとなる。
フロントエンドとアクセスログを加えても、軽い開発利用ではS3とCloudFrontの費用は数セント未満を想定する。

ECRの617.2MBはローカルDockerイメージの仮想サイズである。
ECRは圧縮後の保存容量を課金するため、実際の費用はデプロイ後の`imageSizeInBytes`で更新する。

#### 利用量別の目安

| 利用状況 | 月額の目安 | 主な費用 |
|---|---:|---|
| ほぼアイドル | 0.03米ドルから0.15米ドル | ECR、少量のPITRとS3 |
| 月100Job程度 | 0.05米ドルから0.30米ドル | ECR、DynamoDB、S3、API Gateway |
| 運用上の予算枠 | 1米ドル未満 | 小幅な利用増加と見積り誤差を含む |
| CloudWatch無料枠を別用途で消費済み | 5米ドルから7米ドル程度 | ダッシュボード、カスタムメトリクス、アラーム |

無料枠はAWSアカウント単位で共有される。
同じアカウントの別システムがCloudWatchの無料枠を消費している場合、実行量が少なくても監視リソースが主な費用になる。

Cognito提供ドメインを利用するため、Route 53 hosted zoneと独自ドメイン用証明書はこの試算へ含めない。
Cognitoマネージドログインの利用者は上表のEssentials MAUとして数える。

実モデルのイメージ容量、推論時間、ログ量、複数のdev Stackは、この試算に含めない。
実モデルを導入した時点で、ECRの圧縮後容量、Lambdaの実行時間とメモリ、CloudWatch Logsの取込量を再計測する。

全リソースの`System`と`Environment`タグをコスト配分タグとして有効化し、devデプロイ後1〜2週間のCost Explorer実績で見積りを更新する。
料金前提を再評価するときは、`docs/REFERENCES.md`に記録した各サービスの公式料金ページを使用する。

AWS Budgetsの標準予算とCost Anomaly Detectionは追加料金なしで利用できるが、通知先がない設定は作成しない。
通知先メールアドレスと作成指示が確定した時点で、月1米ドルの予算通知とdev用Cost Anomaly Detection monitorを別途設定する。

## 7. CI

Pull Request:

```text
bun install --frozen-lockfile
→ bun audit（High/Critical）
→ oxfmt --check
→ oxlint
→ typecheck
→ bun test（API/Web）
→ node --test（CDK）
→ Python test
→ cdk-nag付きCDK synth
→ stub Docker build
→ Trivyによるstub imageのHigh/Critical検査
→ Floci bootstrap/deploy/seed/smoke/integration
```

直接依存はpackage manifestでも完全versionへ固定する。
GitHub Actionsはmajor tagではなく、確認済みcommit SHAへ固定する。
推論LambdaのAWS base imageは`public.ecr.aws/lambda/python:3.12`のmulti-architecture manifest digestへ固定する。
CDK Contextはsecret利用、IAM policy最小化、S3 public accessなど、この構成に関係する安全側feature flagを明示する。

PRで必須の統合CI:

```text
Floci起動
→ cdk bootstrap（Floci用のAWS_ENDPOINT_URLを指定）
→ cdk deploy（Floci用のAWS_ENDPOINT_URLを指定）
→ Cognito seed
→ E2E
→ Floci停止
```

`mise run check`はCDK synth時に全Stackへ`AwsSolutionsChecks`を適用する。
未抑制ErrorはCIを失敗させ、抑制には対象リソースと理由をコードで残す。

## 8. AWS dev deploy

```text
OIDCでGitHub Actions認証
→ build/test
→ DINOv2モデルとABO catalog索引を準備
→ cdk diff
→ cdk deploy
→ web build
→ S3 sync
→ CloudFront invalidation
→ smoke test
```

初回deploy後は、`CognitoManagedLoginBaseUrl`出力へアクセスしてマネージドログイン画面が表示されることを確認する。
Cognito提供ドメインは作成直後に利用可能になるまで時間がかかる場合がある。
CloudFrontからログインを開始し、Cognitoドメインへの遷移、callback、API呼び出し、ログアウトを実ブラウザで確認する。

## 9. 本番

- 手動承認
- `cdk diff`レビュー
- Lambda Version / Alias
- 必要に応じてCodeDeploy Canary
- モデルmanifestとchecksum記録
- Rollback手順を先に検証

## 10. タグ

全リソースへ以下を付与する。

```text
System=ImgFlow
Environment=dev|stg|prod
ManagedBy=CDK
DataClassification=<分類>
```

現在のスターターは`DataClassification=Internal`を設定する。
`Owner`は所有組織が未確定のため付与しない。
所有組織が決まった時点で値の供給方法をCDK Contextまたはデプロイ設定として定義し、全Stackへ追加する。
