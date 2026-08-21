# ImgFlow — Lambdaコンテナ / CDK / Floci

このリポジトリは、次の構成を実装するためのスターターです。

- フロントエンド: Amazon S3 + Amazon CloudFront（AWSでは日本からのみ許可）
- 認証・ユーザー管理: Amazon Cognito User Poolsマネージドログイン（AWS、メール検証付き自己登録）
- Tier: `tier-basic` / `tier-standard` / `tier-premium`
- API: Amazon API Gateway HTTP API
- 非同期ジョブ: AWS Step Functions Standard Workflow
- 同時実行数管理: Amazon DynamoDB の条件付きトランザクション
- 推論: AWS Lambda コンテナイメージ
- 入力画像: Amazon S3 署名付き URL でブラウザから直接アップロード
- 明確なDispatcher起動失敗の即時解放と、異常時の最終回収: EventBridge Scheduled Rule + Reaper Lambda
- IaCセキュリティ検査: cdk-nag `AwsSolutionsChecks`
- IaC: AWS CDK v2 / TypeScript
- ローカルAWS互換環境: Floci

## 重要な前提

- 実モデルはまだ提供されていないため、このリポジトリには含めません。
- `services/inference` には、画像内容から決定論的な疑似結果を返すスタブモデルを含めています。
- 商品画像検索を評価するため、DINOv2-smallと登録済みカタログを使う任意の`catalog`プロファイルを含めています。
- `catalog`は汎用デモ用のPoCであり、未提供の実モデルを置き換えるものではありません。
- 実モデルが提供された後、`ModelAdapter` を差し替えます。
- Lambdaコンテナで実モデルが成立しない場合に備え、API契約と推論コアを実行基盤から分離します。

## 商品画像検索PoC

`catalog`プロファイルは、入力画像の型番を生成しません。
DINOv2-smallで入力画像と参照画像を埋め込みへ変換し、登録済みカタログから類似商品を上位3件まで返します。
結果には商品名、ブランド、型番またはSKU、類似度を含めます。
類似度がしきい値未満の場合は、Jobを成功させたうえで「該当商品なし」と表示します。

30商品、各3枚の参照画像、各1枚の評価画像を持つABO subsetは、次の手順でGit管理外の`local/data/abo-catalog`へ準備できます。
ABOはCC BY 4.0であり、実行前に[配布物のLICENSE](https://amazon-berkeley-objects.s3.amazonaws.com/LICENSE-CC-BY-4.0.txt)を確認してください。

```bash
mise exec -- python scripts/prepare-abo-catalog.py --accept-license --products 30
mise exec -- python scripts/fetch-dinov2-model.py
mise exec -- uv pip install --index-url https://download.pytorch.org/whl/cpu "torch==2.13.0+cpu" "torchvision==0.28.0+cpu"
mise exec -- uv pip install -r services/inference/requirements-catalog.txt
mise exec -- python scripts/build-product-catalog.py local/data/abo-catalog/catalog-source.json --unknown-image examples/sample-image.png
```

最後のコマンドは評価画像のtop-1正解数を表示し、`services/inference/model-runtime/catalog-index.json`を生成します。
モデルロード時間、warm推論時間、RSSは次のコマンドで計測できます。

```bash
mise exec -- python scripts/benchmark-product-catalog.py <evaluation-image>
```

2026-07-24の基準評価では、25カテゴリの30商品に対し、しきい値適用後のtop-1が19/30、しきい値なしの順位top-1が22/30でした。
カタログ外の汎用サンプル画像は候補なしとなりました。
3008 MiB制限付きのLinuxコンテナでは、イメージサイズ617.2 MB、初期化5.801秒、初回推論576.316 ms、最大RSS 467.1 MiBでした。

モデル重み、生成した索引、ABO画像は`.gitignore`の対象です。
`mise run deploy-dev`はAWS devへ`catalog`をデプロイするため、実行前にこの節の手順で成果物を準備します。
通常のCI、cdk-nag、Flociは`stub`を明示します。
詳細は[実モデル統合設計](docs/11_model_integration.md)と[商品画像検索PoCのExecPlan](docs/plans/product-image-retrieval-poc.md)を参照してください。

## 非同期ジョブの基本フロー

1. ユーザーがCognitoマネージドログインで登録または認証する。自己登録の確認後は`tier-basic`へ自動所属する。Flociローカル環境だけは直接認証画面を使う。
2. UI が `POST /api/upload-url` を呼び、署名付きURLを取得する。
3. ブラウザが画像を入力用 S3 バケットへ直接アップロードする。
4. UI が `POST /api/jobs` を呼ぶ。
5. Job Submit Lambda が Cognito グループから Tier を判定する。
6. DynamoDB トランザクションで、ユーザー枠・システム枠を確保し、Jobを作成する。
7. 上限超過時は `429 Too Many Requests`、システム上限時は `503 Service Unavailable` を返す。
8. 受付成功時は `202 Accepted` と Job ID を返す。
9. JobsテーブルのStreamを受けたDispatcherが、Job IDを実行名としてStep Functionsを起動する。
10. Workflowが作成されていないと確定する起動拒否は、Jobを即座に`FAILED`へ終端化して同時実行枠を解放する。
11. 結果が曖昧な通信失敗や一時エラーはStreamから再試行し、取り残されたJobだけをReaperが最終回収する。
12. Step Functions Standard が Lambdaコンテナを非同期実行する。
13. 成功・失敗・タイムアウトのいずれでも Job を終端状態にし、枠を解放する。
14. UI は `GET /api/jobs/{jobId}` をポーリングして結果を表示する。

## リポジトリ構成

```text
.
├── AGENTS.md                    # Codexが自動読込するプロジェクト指示
├── PLANS.md                     # 長時間タスク用ExecPlan規約
├── docs/                        # 日本語設計書・ADR・図
├── apps/web/                    # React/Vite Web UI
├── services/api/                # API用Lambda群（TypeScript）
├── services/inference/          # 推論Lambdaコンテナ（Python）
├── infra/cdk/                   # AWS CDK v2
├── tests/integration/           # Floci/AWS結合テスト
├── local/                       # Floci起動・ユーザー作成・スモークテスト
├── scripts/                     # モデル取得・設定生成等
└── .github/workflows/           # CI/CD例
```

## 最初に読むファイル

1. `AGENTS.md`
2. `docs/DESIGN.md`
3. `docs/02_concurrency_and_tiers.md`
4. `docs/03_async_workflow.md`
5. `docs/07_floci_local_development.md`

## 必要ツール

- mise 2026.7.0 以上
- Python 3.12 以上
- Docker / Docker Compose
- AWS CLI v2
- AWS CDK v2

Flociローカル検証用AWS CLI 1.45.53、Bun 1.3.14、Node.js 22、Python 3.12、ty 0.0.63は`mise.toml`で管理する。実AWSへのデプロイにはAWS CLI v2を使用する。依存管理、workspace script、API/WebテストにはBunを使う。TypeScriptはネイティブ実装の正式版7.0.2、lint/formatはOxlint/Oxfmt、Python型検査はtyを利用する。ty単独では検査しない関数シグネチャの型注釈はRuffの`ANN`ルールで補完する。

CDKアプリとCDK単体テストだけはNode.js 22で実行する。Windows上では、このスタックが含むasset stagingをBunランタイムで実行すると停止するためである。ビルドやCDK CLIの起動は引き続きBun scriptを入口とする。

## セットアップ

```bash
mise install
mise run install
```

依存関係はBun workspacesと`bun.lock`で固定する。CIでは`bun install --frozen-lockfile`を直接実行する。

### VS CodeでのSemble利用

`.vscode/mcp.json`にプロジェクト用のSemble MCP serverを定義している。
VS Codeでこのリポジトリを開くと、`mise exec`経由の`uvx`が隔離環境で`semble[mcp]==0.4.1`を起動し、コード、文書、設定ファイルを検索対象にする。
`AGENTS.md`にはSembleを優先するコード探索規約を定義し、`.github/agents/semble-search.agent.md`にはVS Code/GitHub Copilotから選択・委譲できるプロジェクト専用エージェントを定義している。

前提として`mise`がVS Codeから参照できる`PATH`に必要である。`uv`と`uvx`は`mise.toml`で0.11.26へ固定している。
グローバルに導入済みのSemble CLIやCodex用MCPとは設定元と実行環境が異なるため、併存して問題ない。

## 基本コマンド

```bash
mise run format
mise run check
```

`check`はformat check、lint、型チェック、単体テスト、全workspace build、CDK synth、cdk-nagをまとめて実行する。公開タスクの一覧は`mise tasks ls`で確認できる。

## 開発環境の方針

通常の統合確認はAWS開発環境を基準とする。
現在の`catalog`、単一dev Stack、軽量な開発利用では継続費用は月1米ドル未満を運用上の目安とし、実JWT Authorizer、DynamoDB Streams、IAM、CloudFront/OAC、AWS Lambdaの性能を実サービス上で確認する。
試算条件とサービス別の内訳は[開発費用の目安](docs/08_cdk_and_deployment.md#開発費用の目安)を参照する。

Flociは、AWS資格情報を使わない高速なローカル確認、オフライン作業、競合・二重解放・Reaperなどの障害系結合試験に使う補助環境として維持する。単体テストと`mise run check`は引き続きローカルで実行する。

AWS環境の認証には、Cognito提供のプレフィックスドメインと新しいマネージドログインを使う。
Web UIは有効なセッションがなければマネージドログインへ自動遷移し、OAuth callbackまたは認証エラーを処理している場合だけ再試行用のログイン画面を表示する。
Web UIで保存した日本語または英語を`lang=ja` / `lang=en`としてCognitoへ渡し、マネージドログイン、自己登録、パスワード再設定でも同じ言語を維持する。
カスタムドメイン、Route 53、ACM証明書は必須ではない。
自己登録フォームはメールアドレスを必須入力とし、そのアドレスへ届く確認コードで検証する。
利用者がTierを選択する画面やAPIは設けない。
上位Tierへの変更はCognitoグループを管理する運用者だけが実施する。

AWS環境のCloudFrontは標準のGeo Restrictionで`JP`だけを許可する。
この制限はCloudFront経由のWebと`/api/*`に適用されるが、別サービスのCognito提供ドメイン、API Gatewayのexecute-api直URL、発行後のS3署名付きアップロードURLには適用されない。
VPNやプロキシによる迂回も完全には防止しないため、全公開endpointを厳密に日本限定にする本番要件ではWAFまたは追加のオリジン制御が必要になる。

## Floci ローカル環境

Flociを使う場合は、次の1コマンドでFloci、Floci UI、ローカルAWSリソース、Cognito開発ユーザー、Viteを準備・起動する。
Flociではマネージドログインを再現せず、ローカル専用のユーザー名・パスワード画面を使う。

```bash
mise run dev-local
```

起動後のURL:

- アプリケーションWeb UI: `http://localhost:5173`
- Floci管理UI: `http://localhost:4500`

Floci管理UIは公式`floci/floci-ui:0.2.0` imageを検証済みdigestへ固定して使用する。S3 bucketやLambda functionなど、Flociへデプロイした対応済みリソースをブラウザで確認できる。

初回だけCDK bootstrapとdeployを実行し、2回目以降は`local/data`へ永続化されたStackを再利用する。フロントエンド変更はViteが反映する。API Lambda、CDK、推論コンテナを変更した場合は、別ターミナルで次を実行する。

```bash
mise run dev-local-refresh
```

ViteはCtrl+Cで停止する。FlociとFlociが起動したLambdaコンテナを停止する場合は次を実行する。

```bash
mise run dev-local-down
```

Floci本体とFloci UIのログ:

```bash
mise run floci-logs
```

Flociのbootstrap、deploy、seed、smoke、Tier結合試験を一括実行する場合:

```bash
mise run e2e-local
```

このタスクはFloci UIを起動せず、開発用の`local/data/`と分離した一時データ領域へ現在のソースを新規deployする。
推論成功、BasicとStandardのTier上限、503、二重解放、Reaperを確認し、失敗時はログを出力してからFlociを停止する。
終了時に一時データを削除するため、開発用Stackの更新や`dev-local-refresh`は必要ない。
詳細は `docs/07_floci_local_development.md` を参照してください。

## AWS開発環境へのデプロイ

```bash
mise run check
bun run cdk:bootstrap
mise run deploy-dev
mise run deploy-web
```

`deploy-dev`はCognito提供ドメイン、Authorization Code Grant用App Client、マネージドログインの既定branding、自己登録確認後のBasic付与Lambda、CloudFrontの日本許可リストを作成する。
推論Lambdaには`catalog`プロファイルを使用し、モデル重みまたは生成索引がなければDocker buildを失敗させる。
GitHub Actionsの手動`deploy-dev` Workflowは、固定したDINOv2モデルとABO subsetから必要な成果物を生成してからデプロイする。
ドメインprefixは既定で`imgflow-<environment>-<AWS account ID>`となり、必要な場合だけCDK Context `cognitoDomainPrefix`で上書きする。

`deploy-dev`はCloudFormationを開始する前に対象リージョンのLambdaアカウントquotaを確認する。
AWS devの既定容量契約は共有枠、Job受付4、制御系Lambda用余白6である。
予約枠を使う場合もLambda Reserved Concurrencyは受付上限から導出され、別々の値にはできない。
制御系余白6は変更可能なContextにせず、Tier上限はすべてシステム受付上限以下になるようsynth時に検証する。
容量契約を満たせない場合はデプロイ前に停止する。
設定の意味とquota引き上げ後の切替方法は[CDK・デプロイ設計](docs/08_cdk_and_deployment.md)を参照する。

`deploy-web`はAWS Stackの出力から、マネージドログインURLとCloudFront callback URLを含む実AWS用runtime configを必ず再生成してからbuild、S3 sync、CloudFront invalidationを実行する。
Floci用の`localhost` endpoint、直接認証、ローカル認証バイパスはAWS配信物へ引き継がれない。
WindowsではBunスクリプトが`C:\Program Files\Amazon\AWSCLIV2\aws.exe`を自動検出する。別のAWS CLIを使う場合は環境変数`AWS_CLI`で実行ファイルを指定する。

AWSへの初回デプロイ前に、[CDK・デプロイ設計](docs/08_cdk_and_deployment.md)と[セキュリティ設計](docs/06_security.md)を確認してください。

### 検証用画像

`catalog`プロファイルで一致結果を確認する場合は、[サイドテーブルのサンプル画像](examples/catalog-match-ct-355c.jpg)をWeb UIへドラッグ&ドロップする。
現在の30商品indexでは商品コード`CT-355C`、商品名「Amazon Brand – Rivet Bristol Natural Edge Black Metal Side Table, Walnut」へtop-1一致し、類似度は`0.951272`である。
この画像はABOの参照画像とは別の評価画像であり、ライセンスと帰属情報は[ABO sample image attribution](examples/ABO-ATTRIBUTION.md)に記載する。

[汎用サンプル画像](examples/sample-image.png)はABOカタログ外の画像である。
`catalog`プロファイルでは「該当商品なし」、画像の意味を判定しない`stub`プロファイルでは決定論的な疑似結果の確認に使用する。

## AWS開発環境の破棄

次のPowerShellコマンドで認証先と対象Stackを確認してから、`ImgFlow-dev`を破棄する。
`<profile>`は利用するAWS CLIプロファイル名へ置き換える。

```powershell
$env:AWS_PROFILE = "<profile>"
$env:AWS_REGION = "ap-northeast-1"
$env:AWS_DEFAULT_REGION = "ap-northeast-1"
aws sts get-caller-identity
aws cloudformation describe-stacks --stack-name ImgFlow-dev
mise exec -- bun run --cwd infra/cdk cdk destroy --all --force -c environment=dev -c inferenceModelProfile=stub
aws cloudformation describe-stacks --stack-name ImgFlow-dev
```

最後の`describe-stacks`がStack不存在の`ValidationError`を返せば、CloudFormationからの削除は完了している。
`inferenceModelProfile=stub`は破棄時のCDK synthでcatalog成果物を要求しないための指定であり、破棄対象はStack名`ImgFlow-dev`だけである。
devではFrontend、Input、Access Logsの3 BucketをCDKの自動削除Custom Resourceが空にしてから削除するため、事前に`aws s3 rm`を実行しない。
破棄するとS3オブジェクト、DynamoDBデータ、Cognitoユーザーを含むdev Stackのデータは復元できない。
共有のCDK bootstrap Stack、asset用S3 Bucket、ECR repositoryとそのキャッシュは`ImgFlow-dev`の管理外であり、この手順では削除しない。

## Tier初期値

| Cognitoグループ | ユーザー単位の未完了ジョブ上限 |
|---|---:|
| `tier-basic` | 1 |
| `tier-standard` | 3 |
| `tier-premium` | 4 |

AWS devのシステム全体初期上限は4です。
Tier上限とシステム全体上限はCDK Contextで変更できますが、全Tier上限がシステム全体上限以下になる組み合わせだけを許可します。
AWSで自己登録を完了した利用者は`tier-basic`へ自動所属します。
利用者が登録時やAPIリクエストでTierを指定することはできません。

UTC日単位のJob上限はBasic 10、Standard 30、Premium 100、システム全体100です。
アップロードURL件数は日次Job上限の2倍、予約容量は日次Job上限×最大画像サイズ5MiBから導出します。
入力画像は推論前にJPEGまたはPNGとして実デコードし、S3では1日後に削除します。

## HTTPステータス

| 状況 | ステータス |
|---|---:|
| Job受付成功 | 202 |
| 入力不正 | 400 |
| 未認証 | 401 |
| Tier設定不正 / 他ユーザーJob | 403 |
| Jobなし | 404 |
| 冪等キー競合 | 409 |
| Tier上限 | 429 |
| システム処理枠上限 | 503 |

## 完了条件

最初のマイルストーンでは、実モデルなしで以下を満たします。

- Cognitoの3 TierをCDKで作成できる。
- UIから画像アップロード、Job開始、状態確認ができる。
- `tier-basic` の同一ユーザーが同時に2件送信すると、1件が202、1件が429になる。
- 推論成功・失敗・タイムアウトに加え、確定的なWorkflow起動失敗でも枠が確実に解放される。
- 同じ完了処理を複数回実行してもカウンターが二重減算されない。
- Floci環境で主要フローを結合試験できる。
- AWS CDKの `synth`、cdk-nag、テストが通る。

## 注意

このリポジトリは実装開始用の設計済みスターターです。実モデルのランタイム、ファイル形式、最大RSS、推論時間、入力画像制約が未確定のため、実モデル統合は別マイルストーンとします。
