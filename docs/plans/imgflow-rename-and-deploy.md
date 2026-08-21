# ImgFlowへのシステム名称移行とAWS再デプロイ

このExecPlanは生きた文書である。作業中は`進捗`、`決定ログ`、`発見事項`、`完了結果`を更新し、別セッションの担当者がこのファイルだけで再開できる状態を維持する。本計画はリポジトリルートの`PLANS.md`に従う。

## 目的と利用者価値

現在の`AsyncImageInference`と`async-image-inference`はAWSコンソール上の物理名、ローカルコンテナ名、workspace名として長く、画像を入力してコンテナ処理を非同期実行する汎用基盤という役割も必要以上に推論へ限定している。システム識別子を短い`ImgFlow`、URLや表示名に使うslugを`imgflow`へ統一し、AWSコンソールでAPI、認証、監視対象を見つけやすくする。

完了後は旧CloudFormation Stack `AsyncImageInference-dev`がAWS ap-northeast-1から削除され、新しいStack `ImgFlow-dev`が作成される。Web UI、Cognitoマネージドログイン、API、DynamoDB Streams、Step Functions、Lambdaコンテナ、4つのAlarm、SNS Topicが新Stack内で動作し、Web UIは新しいCloudFront Distributionへ配信される。

2026-07-27の追補では、Stack削除時のS3運用を手動空化からCDK管理へ移す。Frontend BucketとInput Bucketは全環境で再生成または破棄可能なデータとして扱い、CloudFormation削除時にCDKが内容を自動削除してBucketも削除する。Access Logs Bucketだけはprodで保持し、devとlocalでは同じ自動削除を使う。これにより、利用者は非空BucketをAWSコンソールで個別に空にせずStackを削除できる。

## 対象範囲

現在の実行識別子を`ImgFlow`または`imgflow`へ変更する。対象はCDK Stack名、Systemタグ、カスタムメトリクス名前空間、CloudWatch Dashboard、API Gatewayの表示名、Cognito User PoolとApp Clientの表示名、Cognito提供ドメインprefix、CloudFrontの説明とResponse Headers Policy名、CloudWatch Alarm名、Bun workspace scope、ローカルFloci Stackとコンテナ名、Webのブラウザ保存キー、デプロイスクリプトの既定Stack名、現行設計文書、構成図である。

最新CDKがSQSを含まず4 Alarmを作ることも新Stackで検証する。`mise run check`、`mise run e2e-local`、CDK synth、旧Stack削除、AWSデプロイ後検証、Web配信を実施する。

AWS破棄前にCloudFormationから旧Stack配下のS3 Bucket名を再取得して削除対象を固定し、その3 Bucketだけを空にする。続いて旧Stackを削除し、削除完了を確認してから新Stackを作る。旧Cognitoユーザー、DynamoDBのJobと同時実行カウンター、S3の画像とWeb配信物、旧CloudWatch履歴を新環境へ移行しない。

2026-07-27の追補では`infra/cdk/lib/platform-stack.ts`の3つのS3 Bucketだけを対象に削除ポリシーを分離する。Frontend BucketとInput Bucketは環境にかかわらず`RemovalPolicy.DESTROY`と`autoDeleteObjects: true`を使用する。Access Logs Bucketはprodだけ`RemovalPolicy.RETAIN`、devとlocalでは`RemovalPolicy.DESTROY`と自動空化を使用する。CDK単体テスト、`docs/08_cdk_and_deployment.md`、ローカルFloci結合試験を同時に更新・実行する。

## 対象外

GitHubリポジトリ`poruru210/aws-async-image-inference-platform`の名称変更とローカルディレクトリ名変更は行わない。外部URLを変更する操作であり、このデプロイに必要ないためである。

旧Stackのバックアップ、Cognitoユーザー、S3データ、DynamoDBデータの移行は行わない。利用者は旧Stackを一度破棄して再デプロイすること、および旧データが不要であることを明示したためである。

実モデルやAPI契約、DynamoDB属性、Job状態遷移、Tier上限は変更しない。ページタイトル「AI画像検索デモ」も利用者向け機能名なので変更しない。

2026-07-27の追補はS3 Bucketの削除時動作だけを変更する。DynamoDB Table、CloudWatch Logs、Cognito、推論モデル、API契約、既存の入力画像1日ライフサイクルは変更しない。AWSのprod環境は操作対象外とし、live確認は削除ライフサイクルを検証するdev/stubの一時デプロイとDestroyだけに限定する。

## 現状調査

CDKアプリは`infra/cdk/bin/app.ts`で`AsyncImageInference-<environment>`をStack IDとして作成する。`infra/cdk/lib/platform-stack.ts`は`System=AsyncImageInference`タグ、`AsyncImageInference`メトリクス名前空間、`AsyncImageInference-<environment>` Dashboardを使用する。S3、DynamoDB、Lambda、IAM、Step Functions、SNS、EventBridge、Log Groupの物理名は明示せず、CloudFormation生成名に任せている。

2026-07-25時点の最新synthは84リソースで、SQSを含まず4 Alarmを含む。一方、AWSの既存`AsyncImageInference-dev`は92リソースで、削除前のSQS QueueとQueue Policy、旧10 Alarmを保持している。新しい`ImgFlow-dev`は最新テンプレートから作るため、初回からSQSなし、4 Alarmとなる。

現在のAPI Gateway表示名は`HttpApi`、Cognito User Pool表示名は`UserPoolV2AAED3EE9-...`、App Client表示名は`UserPoolV2WebClientF261439E-...`である。CloudFront Response Headers PolicyもCDK生成の長い名前で、Distribution Commentは空である。

2026-07-27、`ImgFlow-dev`の削除はFrontend Bucket内のWeb成果物9件により`DELETE_FAILED`となった。CDKはprod以外へ`RemovalPolicy.DESTROY`を設定していたが、3つのS3 Bucketに`autoDeleteObjects`がなく、S3が要求する「Bucket削除前に全オブジェクトを削除する」処理をCloudFormationが実行できなかった。手動でFrontend Bucketの9件とAccess Logs Bucketの49件を空にした後、標準削除は`DELETE_COMPLETE`となった。この実測が今回の再発防止変更の根拠である。

## アーキテクチャ上の制約

CDK Construct IDを変更するとCloudFormation Logical IDが変化する。既存Stackでは置換を招くため、`JobsTable`、`ConcurrencyTable`、各LambdaなどのConstruct IDは変更しない。今回Stack自体は新規になるが、コードの安定性と将来の更新安全性を保つため同じ原則を維持する。

S3 Bucket、DynamoDB Table、Lambda Function、IAM Role/Policy、Step Functions State Machine、SNS Topic、EventBridge Rule、Log Groupへ固定物理名を付けない。固定名は同じアカウントへの複数Stack展開とCloudFormationによるcreate-before-delete置換を妨げるためである。

人がAWSコンソールで直接探す可変な表示名だけを`imgflow-<environment>-<component>`へ統一する。Cognito Tier Groupの`tier-basic`、`tier-standard`、`tier-premium`、GSIの`ActiveJobsIndex`は実装契約なので変更しない。

新StackのCognito提供ドメインは`imgflow-<environment>-<account-id>`とする。旧`inference-dev-v2-<account-id>`は旧Stack削除時に解放されるが、新旧で異なるprefixを使う。Webデプロイスクリプトは新Stack出力からcallback URLと認証URLを再生成する。

APIは非同期契約を維持し、画像をAPI Gatewayへ送らずS3署名付きPOSTを使う。同時実行枠の原子的確保、429/503、`slotState=HELD`条件、全終端経路の冪等解放を変更しない。

S3は中身があるBucketを直接削除できない。CDKの`autoDeleteObjects`はこの制約を回避するのではなく、Custom Resourceと呼ばれる削除補助処理をStackへ追加し、Bucket削除より先にオブジェクト、オブジェクトバージョン、削除マーカーを消す。Frontend BucketとInput BucketはWeb成果物と短期入力であり永続保管対象ではない。Access Logs Bucketは監査証跡になり得るためprodだけ保持する。prod Stackの誤削除防止はFrontend Bucketを孤立させるのではなく、StackのTermination Protectionと変更承認で扱う。

## 実装方針

`infra/cdk/lib/naming.ts`にシステム識別子と表示名生成関数を集約する。`SYSTEM_ID`は`ImgFlow`、`SYSTEM_SLUG`は`imgflow`とし、`resourceDisplayName(environment, component)`は`imgflow-${environment}-${component}`を返す。Stack IDは`stackName(environment)`で`ImgFlow-${environment}`を返す。

`infra/cdk/lib/platform-stack.ts`はこの命名関数を使い、Systemタグ、カスタムメトリクス名前空間、API表示名、Cognito表示名、CloudFront表示名、4 Alarm名、Dashboard名を設定する。固定物理名を付けないリソースには新しいnameプロパティを追加しない。

Bun workspace scopeは`@imgflow/*`へ変更し、root package名は`imgflow`へ変更する。`bun install`で`bun.lock`を機械的に更新する。ローカルPythonとCompose、mise task、deploy scriptも新scopeと新Stack名へ合わせる。

現行文書と構成図はImgFlowへ更新する。完了済みExecPlanに記録された過去の名称や絶対作業パスは歴史的証拠なので一括書換えしない。今回のExecPlanから旧名称を新しい実行入口として参照しない。

2026-07-27の追補では、共通の`removalPolicy`をS3へ一律適用しない。Frontend BucketとInput Bucketには明示的な`RemovalPolicy.DESTROY`と`autoDeleteObjects: true`を設定する。Access Logs Bucketは既存の環境別`removalPolicy`を維持し、prod以外だけ`autoDeleteObjects: true`とする。S3以外のstateful resourceは既存の環境別`removalPolicy`を引き続き使用する。

## マイルストーン

第一マイルストーンでは命名契約とテストを実装する。CDK synthでStack名が`ImgFlow-dev`となり、人向け表示名が`imgflow-dev-*`、固定すべきでない物理名プロパティが未設定であることをテストする。

第二マイルストーンではworkspace、ローカルFloci、Web保存キー、スクリプト、文書、構成図をImgFlowへ揃える。`mise run check`と構成図バリデーターが成功することを確認する。

第三マイルストーンでは空のFloci環境に`ImgFlow-local`を作成して`mise run e2e-local`を通す。既存ローカルデータが旧Stackだけを含む場合は、リポジトリ内の生成データを直接削除せず、既存の安全なe2e初期化手順に従う。

第四マイルストーンではAWS認証と削除対象を再確認し、旧Stackの3つのS3 Bucketを空にして`AsyncImageInference-dev`を削除する。CloudFormationから旧Stackが取得不能になり、旧CloudFront Distribution、Cognito User Pool、SQSを含む旧リソースが削除されたことを確認する。削除中にAccess Logs Bucketへログが追加されてBucket削除が失敗した場合は、その正確なBucketだけを再度空にしてStack削除を再試行する。

第五マイルストーンでは容量preflightを実行し、`ImgFlow-dev`を新規デプロイする。CloudFormationがCREATE_COMPLETEで、84リソース、SQS 0、Alarm 4、CognitoドメインとCloudFrontが新名称であることを確認する。

第六マイルストーンでは`mise run deploy-web`で新Stack出力からWeb設定を生成し、新CloudFrontへ配信する。CloudFront URLがHTTP 200を返し、runtime configが新Cognito User Poolと`/api`を参照することを確認する。

第七マイルストーンは2026-07-27のS3削除追補である。CDK単体テストを先に追加し、prodテンプレートではAccess Logs Bucketだけが`Retain`、Frontend BucketとInput Bucketが`Delete`になることを確認する。local、dev、prodの各テンプレートで自動空化Custom Resourceが意図したBucket数だけ生成されることも確認する。実装と`docs/08_cdk_and_deployment.md`を同期し、`mise run check`を通す。Floci E2Eの実行不能範囲は記録し、AWS dev/stubを一時デプロイして3つの非空Bucketを手動空化なしでDestroyできることをlive確認する。prodは操作しない。

## 具体的な変更ファイル

`infra/cdk/lib/naming.ts`を新規作成する。`infra/cdk/bin/app.ts`、`infra/cdk/lib/platform-stack.ts`、`infra/cdk/lib/config.ts`、`infra/cdk/test/platform-stack.test.ts`を更新する。

`package.json`、`bun.lock`、`apps/web/package.json`、`services/api/package.json`、`infra/cdk/package.json`、`tests/integration/package.json`、`mise.toml`を`@imgflow/*`へ更新する。

`scripts/deploy-web.ts`、`infra/cdk/scripts/preflight-capacity.ts`、`local/dev_local.py`、`local/get-output.py`、`local/stop-floci.py`、`local/verify-lifecycle.py`、`local/presigned_post.py`、`local/compose.yaml`、`local/tests/test_dev_local.py`を更新する。

`apps/web/src/auth.ts`の保存キーを`imgflow-*`へ更新する。これは新Cognito環境への移行に伴い既存セッションを引き継がない意図的変更である。

`README.md`、`docs/DESIGN.md`、`docs/07_floci_local_development.md`、`docs/08_cdk_and_deployment.md`、表示用画像、AWS Draw.io構成図を更新する。現在の編集元は`docs/diagrams/source/imgflow-architecture.drawio`に置く。

2026-07-27の追補で変更するファイルは`infra/cdk/lib/platform-stack.ts`、`infra/cdk/test/platform-stack.test.ts`、`docs/08_cdk_and_deployment.md`、本ExecPlanである。APIとデータモデルは変わらないため`docs/04_api_specification.md`と`docs/05_data_model.md`は変更しない。

## データ移行・互換性

旧`AsyncImageInference-dev`を削除してから、新しい`ImgFlow-dev`を作成する。Cognito User Pool ID、App Client ID、CloudFront URL、S3 Bucket、DynamoDB Table、Lambda ARN、State Machine ARNはすべて新規になる。利用者は新しいCognitoマネージドログインでアカウントを再登録する必要がある。

APIのパス、リクエスト、レスポンス、Job ID、DynamoDBデータモデルは変わらない。Webは新Stack出力から生成した設定を使うため、コード上でAWS IDを固定しない。

旧Stackのデータは移行せず削除する。S3 BucketはCloudFormationの`RemovalPolicy.DESTROY`だけでは中身がある場合に削除できないため、CloudFormationが列挙した正確な旧Frontend/Input/AccessLogs Bucketだけを先に空にする。Bucketのバージョニングは無効なので現行オブジェクトの削除でよい。

追補適用後に新しく作成または更新されたStackでは、Frontend BucketとInput Bucketの内容はStack削除時に不可逆に削除される。Access Logs Bucketはprod Stackを削除してもCloudFormationから切り離されて残る。devとlocalのAccess Logs Bucketは内容とBucketの両方が削除される。既存Bucketの物理名、API、DynamoDBデータには移行を発生させないプロパティ更新であるが、CDKの自動削除用Custom Resourceと権限がStackへ追加される。

## テスト計画

CDK単体テストでは、Stack名、API Name、Cognito UserPoolNameとClientName、Response Headers Policy Name、CloudFront Comment、4 AlarmName、DashboardName、Systemタグを検証する。同時にS3 `BucketName`、DynamoDB `TableName`、Lambda `FunctionName`、IAM `RoleName`、Step Functions `StateMachineName`、SNS `TopicName`、EventBridge `Name`、Log Group `LogGroupName`を明示していないことを検証する。

既存の32 CDKテスト、52 Bunテスト、Python推論14テスト、ローカルPython 10テストを含む`mise run check`を通す。Floci影響があるため`mise run e2e-local`も通す。

追補のCDK単体テストでは、prodテンプレートの3つのS3 BucketをConstruct由来のLogical IDで識別する。Access Logs Bucketの`DeletionPolicy`と`UpdateReplacePolicy`が`Retain`、Frontend BucketとInput Bucketが`Delete`であることを検証する。local、dev、prodテンプレートに生成される`Custom::S3AutoDeleteObjects`の数を検証し、prodではAccess Logs Bucketに自動削除が付かないことを保証する。続いて`mise run check`で型検査、CDK synth、cdk-nagを含む全ゲートを実行し、Custom ResourceのIAMやFloci互換性を`mise run e2e-local`で確認する。

## ローカル確認手順

作業ディレクトリは`C:\projects\lambda-async-inference-cdk-floci-starter`とする。

    mise run check
    mise run e2e-local

期待結果はformat、lint、TypeScript/Python型検査、全テスト、build、CDK synth、cdk-nagが成功し、Flociに`ImgFlow-local`が作成され、Tier 429/503、成功、二重解放、Reaperがすべて成功することである。

追補ではCDK単体テストにS3削除ポリシーの検証が追加される。`mise run e2e-local`のCDK deployで自動削除Custom ResourceがFloci上でも作成でき、既存の推論、Tier上限、二重解放、Reaper検証を壊さないことを期待する。FlociがCustom Resourceを実行できない場合は、AWS向け自動削除とlocal向け削除方法を分離し、その事実と代替を本計画の発見事項へ記録する。

構成図は次で検証する。

    mise exec -- uv run ./.agents/skills/aws-architecture-diagram/scripts/validate_drawio_bundle.py ./docs/diagrams/source/imgflow-architecture.drawio

## AWS確認手順

最初に認証先を確認する。

    aws sts get-caller-identity --profile poruru

新Stackがまだ存在しないこと、旧Stackが存在することを確認する。続いてCloudFormationが管理する旧S3 Bucketの物理名を`list-stack-resources`で取得し、出力されたFrontend/Input/AccessLogsの3 Bucketと一致することを目視確認する。

    aws cloudformation describe-stacks --stack-name ImgFlow-dev --profile poruru --region ap-northeast-1
    aws cloudformation describe-stacks --stack-name AsyncImageInference-dev --profile poruru --region ap-northeast-1
    aws cloudformation list-stack-resources --stack-name AsyncImageInference-dev --profile poruru --region ap-northeast-1

確認した3つの旧Bucketを正確な物理名で空にし、旧Stackを削除する。ワイルドカードや環境変数は使わない。削除開始後は短い間隔で状態を確認し、`DELETE_COMPLETE`すなわちStackが存在しない状態まで待つ。

    aws s3 rm s3://<old-frontend-bucket> --recursive --profile poruru --region ap-northeast-1
    aws s3 rm s3://<old-input-bucket> --recursive --profile poruru --region ap-northeast-1
    aws s3 rm s3://<old-access-logs-bucket> --recursive --profile poruru --region ap-northeast-1
    aws cloudformation delete-stack --stack-name AsyncImageInference-dev --profile poruru --region ap-northeast-1

旧Stack削除完了後、容量preflightとデプロイは既存の入口を使う。

    mise run deploy-dev

デプロイ後はStack状態、総数、SQS、Alarm、Outputを確認する。

    aws cloudformation describe-stacks --stack-name ImgFlow-dev --profile poruru --region ap-northeast-1
    aws cloudformation list-stack-resources --stack-name ImgFlow-dev --profile poruru --region ap-northeast-1

Webを配信する。

    mise run deploy-web

出力されたCloudFront URLへHTTP GETし、200を確認する。配信された`config.json`が新User Pool ID、Client ID、Cognito domain、`apiBaseUrl=/api`を含むことを確認する。

2026-07-27の追加検証では、利用者の明示指示に基づきAWSのdev環境だけを再作成して削除する。実モデル成果物は変更せず、削除ライフサイクルの検証に不要なcatalog成果物を要求しない`inferenceModelProfile=stub`で`ImgFlow-dev`をデプロイする。CloudFormationが作成したFrontend、Input、Access Logsの正確な3 Bucketへ無害な検証用オブジェクトを配置して非空を確認した後、CDK `destroy`を実行する。手動でBucketを空にせず`DELETE_COMPLETE`まで待ち、Stackが取得不能、3 Bucketが404、自動削除Providerを含むStack管理リソースが残らないことを確認する。AWSのprod Stackにはデプロイ、更新、削除のいずれも実行しない。

実行コマンドは、workspaceが固定するBunとCDK CLIを使い、AWS認証先を`poruru`へ明示する。既存`deploy:dev`はcatalog成果物を前提にするため今回は直接CDKを呼び、環境名とstubプロファイルを明示する。

    $env:AWS_PROFILE = "poruru"
    mise exec -- bun run --cwd infra/cdk build
    mise exec -- bun run --cwd infra/cdk cdk deploy --all --require-approval never -c environment=dev -c inferenceModelProfile=stub
    mise exec -- bun run --cwd infra/cdk cdk destroy --all --force -c environment=dev -c inferenceModelProfile=stub

## リスクと緩和策

最大のリスクは旧Stack削除による不可逆なデータ損失と切替中の停止時間である。利用者が旧Stack破棄を明示したため、移行やバックアップは行わないが、削除前にAWSアカウント、リージョン、Stack名、CloudFormation管理下の3 Bucketを再取得して対象違いを防ぐ。

旧Stackと新Stackを並存させないため、Lambdaアカウント同時実行quotaと重複コストへの影響は抑えられる。既定はshared modeでReserved Concurrencyを使わず、デプロイ前preflightが新Stackに必要な未予約枠を確認する。

CloudFront削除中もAccess Logs Bucketへ新しいログが届き、最初のStack削除が`DELETE_FAILED`になる可能性がある。その場合はCloudFormationイベントで失敗した物理Bucketを確認し、そのBucketだけを再度空にして同じ旧Stack削除を再実行する。新StackがROLLBACK状態になった場合はイベントを確認して同じ`ImgFlow-dev`へ修正後再デプロイする。旧環境へのフォールバックは存在しない。

追補後の最大のリスクは、Frontend BucketとInput BucketがprodでもStack削除時に不可逆に空になることである。両Bucketは再生成可能なWeb成果物と短期入力だけを格納する設計であり、永続データを置かないことを運用契約とする。監査用途のAccess Logs Bucketだけはprodで`Retain`する。CDK自動削除処理が追加するIAM権限は対象Bucketへ限定されることをsynthとcdk-nagで確認する。

## 冪等性と復旧

コード生成とテストは何度でも実行できる。`cdk deploy`は同じ`ImgFlow-dev`へ収束する。Web配信はS3 syncとCloudFront invalidationを再実行できる。

旧Stack削除は再実行できる。Stackが`DELETE_FAILED`ならイベントで残存リソースを特定し、正確な旧Bucketを空にして`AsyncImageInference-dev`だけを再削除する。削除が完了してStackが見つからない場合は成功として先へ進む。失敗した新Stackが`ROLLBACK_COMPLETE`になった場合、その新Stackだけを削除して再試行できるが、削除前に対象が正確に`ImgFlow-dev`であることを確認する。

## 進捗

- [x] (2026-07-25 JST) 最新synth 84リソースとAWS旧Stack 92リソースを棚卸しした。
- [x] (2026-07-25 JST) 利用者の明示指示に基づき、旧`AsyncImageInference-dev`を先に削除してから`ImgFlow-dev`を作る方針へ再計画した。
- [x] (2026-07-25 JST) 命名契約、CDK、workspace、ローカル環境、文書をImgFlowへ更新した。
- [x] (2026-07-25 JST) `mise run check`とdraw.io検証を通した。CDK 34件、Bun 52件、Python 25件が成功した。
- [x] (2026-07-25 JST) `mise run e2e-local`で空のFlociへ`ImgFlow-local`を作成し、stub推論、Tier上限、429/503、二重解放、Reaperを検証した。
- [x] (2026-07-25 JST) AWSアカウントと旧Stack管理下の3 Bucketを再確認し、内容を削除して旧`AsyncImageInference-dev`を完全削除した。
- [x] (2026-07-25 JST) catalogプロファイルの`ImgFlow-dev`をAWSへ新規デプロイし、`CREATE_COMPLETE`、84リソース、SQS 0、Alarm 4を検証した。
- [x] (2026-07-25 JST) Webを新CloudFrontへ配信し、invalidation完了、トップページHTTP 200、新Cognitoを参照するruntime configを検証した。
- [x] (2026-07-27 JST) `ImgFlow-dev`の削除失敗を調査し、Frontend Bucket 9件とAccess Logs Bucket 49件を手動で空にしてStackの`DELETE_COMPLETE`を確認した。
- [x] (2026-07-27 JST) Access Logs Bucketだけをprodで保持し、Frontend/Inputを全環境で自動削除する方針と検証計画を本ExecPlanへ追加した。
- [x] (2026-07-27 JST) CDK実装、単体テスト、`docs/08_cdk_and_deployment.md`を更新した。
- [x] (2026-07-27 JST) `mise run check`が成功した。`mise run e2e-local`はDocker起動後に2回実行したが、既存Lambda assetのS3 publishが`*.localhost`のDNS解決に失敗し、Custom Resource実行前に停止した。
- [x] (2026-07-27 JST) `ImgFlow-dev`をstubプロファイルでAWSへ再デプロイし、3つの非空Bucketを手動で空にせずCDK Destroyが完了することを確認した。active Stackは0件、3 Bucketは404、全89管理リソースは`DELETE_COMPLETE`であり、prodは操作していない。

## 決定ログ

- 決定: システムIDを`ImgFlow`、slugを`imgflow`とする。
  理由: 利用者が選択した短い名称であり、画像を入力として処理を流す汎用基盤を推論へ限定せず表現できる。
  日付/担当: 2026-07-25 / Codex

- 決定: 旧`AsyncImageInference-dev`を先に完全削除し、その後`ImgFlow-dev`を新規デプロイする。
  理由: 利用者が旧環境の破棄を明示した。並存によるLambda quota圧迫と重複コストを避け、古いSQSとAlarmを確実に除去できる。旧Cognitoユーザー、S3、DynamoDBデータは失われ、切替中は停止する。
  日付/担当: 2026-07-25 / 利用者・Codex

- 決定: 固定物理名を全リソースへ一律設定せず、人が直接探す表示名だけを`imgflow-<environment>-<component>`へ統一する。
  理由: AWSコンソールの視認性を改善しつつ、CloudFormationの置換安全性と複数Stack展開可能性を維持するため。
  日付/担当: 2026-07-25 / Codex

- 決定: Flociの初回bootstrapだけを最大3回、2秒間隔で再試行する。
  理由: ready endpointとCDKが利用するAWS APIの起動に短い競合があり、bootstrapは同じStackへ収束する冪等操作である。AWS本番デプロイには再試行を適用しない。
  日付/担当: 2026-07-25 / Codex

- 決定: S3 Bucketのうちprodで保持するのはAccess Logs Bucketだけとする。Frontend BucketとInput Bucketは全環境で`DESTROY`と自動空化を使い、Access Logs Bucketはprodで`RETAIN`、devとlocalで`DESTROY`と自動空化を使う。
  理由: Frontendは再生成可能なWeb成果物、Inputは1日保持の一時画像であり、Stack削除後に孤立させる価値がない。一方、アクセスログは監査証跡になり得るためprod保持の価値がある。非空Bucketによる削除失敗を手動運用へ戻さないため、削除対象にはCDKの自動空化を付ける。
  日付/担当: 2026-07-27 / 利用者・Codex

- 決定: AWSでの削除ライフサイクル検証はdev Stackだけを`inferenceModelProfile=stub`で作成して行う。
  理由: 今回の検証対象はS3自動空化とCloudFormation削除であり、未提供の実モデルやcatalog成果物を取得・変更する必要がない。prodへは一切のライブ操作を行わない。
  日付/担当: 2026-07-27 / 利用者・Codex

## 発見事項

- 発見: AWS旧StackはまだSQS 2リソースと旧10 Alarmを保持している。
  根拠: 2026-07-25の`aws cloudformation list-stack-resources --stack-name AsyncImageInference-dev`は92件を返し、最新synthはSQS 0、Alarm 4の84件だった。

- 発見: API Gatewayの表示名は単なる`HttpApi`で、CognitoとCloudFront PolicyもCDK生成の長い表示名だった。
  根拠: AWS CLIの`get-api`、`describe-user-pool`、`describe-user-pool-client`、CloudFront設定取得で確認した。

- 発見: Flociの`/_floci/init`がreadyを返した直後でも、clean環境の初回CDK bootstrapが一時的な`ECONNREFUSED`になることがある。
  根拠: 最初の`mise run e2e-local`再実行はbootstrapで接続拒否となったが、同じ空データ環境への直後のbootstrapは成功した。`local/dev_local.py`へローカル限定・最大3回・2秒間隔の再試行を追加し、単体テストとE2Eで成功を確認した。

- 発見: このWindows環境にはGraphvizの`dot`コマンドがない。
  根拠: DOTからSVG再生成を試みると`dot is not recognized`となった。図の構造は変更せず、既存SVG内のタイトルだけをDOTと同じ`ImgFlow`へ同期した。

- 発見: 新StackのCloudFormation進捗はStack自身を含む`85/85`と表示されたが、`list-stack-resources`で管理対象を数えると計画どおり84件だった。
  根拠: `ImgFlow-dev`のデプロイは`CREATE_COMPLETE`で終わり、AWS CLI集計はTotal 84、SQS 0、Alarms 4を返した。

- 発見: Bun 1.3.14は通常の`bun install`でworkspace名を更新したがroot package名を旧値のまま残し、lockfileを全面再生成すると未固定の推移依存まで更新した。
  根拠: 差分にAWS SDK内部パッケージ等の目的外更新が現れた。HEADの`bun.lock`を基準にroot/workspace名だけを変更し、`bun install --frozen-lockfile`が`no changes`で成功する状態へ戻した。

- 発見: `RemovalPolicy.DESTROY`だけでは非空S3 Bucketを削除できず、2026-07-27の`ImgFlow-dev`削除はFrontend Bucketで`DELETE_FAILED`になった。
  根拠: CloudFormationイベントは`FrontendBucketEFE2E19C`にS3 409 `The bucket you tried to delete is not empty`を記録した。バージョニング無効のWeb成果物9件とAccess Logs 49件を空にした後、同じStackの標準削除は`DELETE_COMPLETE`になった。

- 発見: 現在のWindows環境ではFloci向けCDK asset publisherがS3 staging bucketのvirtual-host名を解決できず、E2EはStack作成前に停止する。
  根拠: Docker Engine 29.6.1とFloci 1.5.33の起動後に2回再現し、`ReaperFunction`など既存assetのpublishが`getaddrinfo ENOTFOUND cdk-hnb659fds-assets-000000000000-ap-northeast-1.localhost`を返した。自動削除Providerのbuildは成功したが、CloudFormationによるCustom Resource作成・実行までは到達していない。

- 発見: AWS devでは3つの非空Bucketを含むStack削除が手動空化なしで完了した。
  根拠: account `579111114227`、region `ap-northeast-1`へ`inferenceModelProfile=stub`でStack ARN `arn:aws:cloudformation:ap-northeast-1:579111114227:stack/ImgFlow-dev/d58f5810-8956-11f1-b5ea-0a194c87842f`を作成した。Access Logs、Frontend、Input Bucketへ検証用オブジェクトを各1件配置して`KeyCount=1`を確認した後、CDK `destroy --all --force`だけを実行した。3つの自動削除Custom Resource、Input、Frontend、Access Logs Bucketは順に`DELETE_COMPLETE`となり、Stackは2026-07-27 10:14:52 JSTに`DELETE_COMPLETE`になった。

- 発見: 削除後のlive照合ではStack管理リソースの残存を検出しなかった。
  根拠: activeな`ImgFlow-dev`は0件、削除履歴の全89管理リソースは`DELETE_COMPLETE`で非完了一覧が空だった。3 Bucketの`HeadBucket`はすべて404、自動削除Provider Lambdaは`ResourceNotFoundException`、CloudFront Distributionは`NoSuchDistribution`だった。Provider IAM Roleの直接照会はSSO PowerUserに`iam:GetRole`権限がなく判定不能だったが、CloudFormationイベントでは当該Roleが`DELETE_COMPLETE`である。

## 完了結果

完了。システムIDを`ImgFlow`、slugを`imgflow`へ統一し、人が探すAWS表示名だけを`imgflow-<environment>-<component>`に揃えた。S3、DynamoDB、Lambda、IAM、Step Functions、SNS、EventBridge、Log Groupの物理名はCloudFormation生成のまま維持した。workspace scope、Floci Stackとコンテナ、Web保存キー、デプロイスクリプト、現行文書、DOT/SVG、draw.io構成図も同期した。

ローカルでは`mise run check`が成功し、CDK 34件、Bun 52件、推論Python 14件、ローカルPython 11件が通った。`mise run e2e-local`は空のFlociへ`ImgFlow-local`を作成し、stub推論、Tier同時実行上限、429/503、二重解放防止、Reaper回収を完走した。draw.ioバリデーターも成功した。

AWSではaccount `579111114227`、region `ap-northeast-1`の旧`AsyncImageInference-dev`を、CloudFormation管理下のFrontend、Input、AccessLogs Bucketだけ空にして削除した。旧StackはCloudFormationから取得不能になった。その後catalogプロファイルで`ImgFlow-dev`を新規作成し、`CREATE_COMPLETE`、84リソース、SQS 0、Alarm 4、Reserved Concurrency 0、受付上限4を確認した。

新CloudFront Distribution IDは`EEIKLQSEL9KJA`、URLは`https://d3sf6b3groqhjt.cloudfront.net/`である。トップページはHTTP 200を返し、配信済み`config.json`はUser Pool `ap-northeast-1_Qh0NhOl7d`、Client `7v6fs2vc4tiu460bsme1bg5hlr`、Cognito domain `imgflow-dev-579111114227`を参照する。利用者は旧Cognitoユーザーを引き継いでいないため、新環境で再登録する必要がある。

2026-07-27追補の実装は完了した。Frontend BucketとInput Bucketは全環境で`Delete`と自動空化、Access Logs Bucketはprodで`Retain`、dev/localで`Delete`と自動空化になった。CDKテストはlocal/devで自動削除3件、prodでFrontend/Inputの2件を検証し、prod Access Logsだけが`Retain`であることを確認する。

`mise run check`は成功し、format、lint、型検査、CDKテスト35件、Bunテスト52件、Pythonテスト25件、build、dev CDK synth、cdk-nagが通った。`mise run e2e-local`はDocker停止を解消して2回再実行したが、FlociのS3 staging bucket向けDNS解決が既存Lambda asset publishで失敗したため、Floci上のCustom Resource実行は未確認である。このローカル未確認範囲は、後述するAWS devでのliveデプロイとDestroy検証によって補完した。

その後、利用者の明示指示によりAWSのdevだけでlive削除検証を実施した。`ImgFlow-dev`をstubプロファイルで`CREATE_COMPLETE`まで作成し、Access Logs、Frontend、Inputの3 Bucketを各1オブジェクトで非空にした。手動のS3空化を行わずCDK Destroyを実行し、3つの自動削除Custom Resource、3 Bucket、Provider Lambdaを含む全89管理リソースとStackが`DELETE_COMPLETE`になった。削除後の3 Bucketはすべて404で、activeな`ImgFlow-dev`は0件である。AWSのprodにはデプロイ、更新、削除を実行していない。

## 成果物と注記

主要な成果物は`infra/cdk/lib/naming.ts`、更新されたCDKテンプレート、`docs/diagrams/source/imgflow-architecture.drawio`、S3削除ポリシーの実装・テスト・運用文書である。検証用のAWS Stack `ImgFlow-dev`とCloudFront配信はlive確認後にDestroy済みで、現在は存在しない。

## インターフェースと依存関係

`infra/cdk/lib/naming.ts`は次のexportを提供する。

    export const SYSTEM_ID = "ImgFlow";
    export const SYSTEM_SLUG = "imgflow";
    export function stackName(environment: EnvironmentName): string;
    export function resourceDisplayName(
      environment: EnvironmentName,
      component: string,
    ): string;

`infra/cdk/bin/app.ts`は`stackName(config.environment)`を使用する。`platform-stack.ts`はこのモジュール以外でシステムprefixを組み立てない。

変更履歴: 2026-07-25、利用者の`imgflow`採用とデプロイ依頼を受け、新規作成。最初は旧Stackを保持する並行移行を採用した。同日、利用者が旧Stackを一度destroyしてから再デプロイするよう明示したため、旧データを移行せず削除し、削除完了後に新Stackを作る計画へ全面更新した。 同日、実装、Floci E2E、旧Stack削除、catalogプロファイルの新Stack作成、Web配信とHTTP検証まで完了し、実測結果を反映した。2026-07-27、`ImgFlow-dev`の削除失敗を受け、Frontend/Inputは全環境で自動削除し、Access Logsだけをprodで保持する追補を追加した。同日、CDK、テスト、設計書を実装し、`mise run check`成功とFloci asset publishのDNS失敗を反映して追補を完了した。さらに利用者の明示指示を受け、dev/stubをAWSへ再デプロイし、各1件のオブジェクトを持つ3 Bucketを手動で空にせずCDK Destroyした。全89管理リソースとStackの`DELETE_COMPLETE`、3 Bucketの404、active Stack 0件を確認し、prodを操作せず検証を完了した。
