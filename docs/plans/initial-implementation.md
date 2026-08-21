# Lambdaコンテナ版 初期実装ExecPlan

## 目的と利用者価値

Web UIから画像を送信し、Cognito Tierに基づく同時実行上限を守りながら、非同期推論Jobを開始・追跡・完了表示できる状態を、実モデルなしのstubで成立させる。

## 対象範囲

- CDK
- Cognito Tier
- S3署名付きURL
- HTTP API
- DynamoDB枠管理
- Step Functions Standard
- Lambdaコンテナstub
- Reaper
- React UI
- Floci結合試験
- Flociを日常開発用バックエンドとして起動する統合miseタスク
- Floci UIを日常開発時に常時起動する管理コンソール
- 特定の商品カテゴリに依存しない汎用的な非同期画像推論デモ
- miseによる開発ツールとタスクの統一管理
- BunによるJavaScript/TypeScriptの依存管理・実行・テスト
- TypeScript 7.0のネイティブコンパイラー
- OxlintとOxfmtによるlint・format
- tyによるPython型検査
- cdk-nagによるCDKセキュリティ検査
- DynamoDB Streams Dispatcherによる耐障害なWorkflow起動

## 対象外

- 実モデル
- GPU
- ECS/SageMaker本実装
- 本番DNS/WAF
- 管理者UI

## 現状調査

- [x] 依存関係がinstall可能か確認
- [x] TypeScript/Pythonの型とテスト状況確認
- [x] CDK APIの互換性確認
- [x] Flociで利用するサービス統合を確認
- [x] Makefileのタスクと参照箇所を調査

## アーキテクチャ上の制約

- `AGENTS.md`の不変条件を守る。
- Job受付時点で枠を確保する。
- 枠解放は冪等。
- 画像はサイズ上限を署名条件に含めてS3へ直接アップロードする。
- APIは非同期。

## 実装方針

既存のスターターを小さなマイルストーンで完成させる。各マイルストーン後にテストを実行し、本ファイルを更新する。

## マイルストーン

### M1: ビルド基盤

- [x] Makefileをmiseタスクへ移行
- [x] Floci用AWS CLI 1.45.53、Bun 1.3.14、Node.js 22、Python 3.12をmiseで管理
- [x] ローカル文書とGitHub Actionsをmiseコマンドへ統一
- [x] mise install
- [x] mise run install
- [x] lint/typecheck/test
- [x] CDK synth
- [x] Python test
- [x] npm/package-lockからBun/bun.lockへ移行
- [x] TypeScriptを正式版7.0.2へ固定
- [x] ESLintとPrettier相当処理をOxlint/Oxfmtへ移行
- [x] API、Web、結合テストをBun testへ移行
- [x] CDKテストをNode.js標準テストランナーへ移行
- [x] Bun・TypeScript 7・Oxc構成で全検証を再実行

### M2: 認証・Storage・API

- [x] CognitoとTierグループ
- [x] S3
- [x] DynamoDB
- [x] Upload URL
- [x] Job status

### M3: 同時実行管理

- [x] Tier解析
- [x] 原子的枠確保
- [x] 429/503
- [ ] 冪等Job
- [x] 冪等解放

### M4: Workflow

- [x] MarkRunning
- [x] Lambdaコンテナstub
- [ ] Success/Failure/Timeout Finalize
- [x] Reaper

### M5: UI

- [ ] Cognitoログイン
- [ ] Drag & Drop
- [ ] S3 upload
- [ ] Job submit
- [ ] polling
- [ ] result/error/concurrency表示

### M6: Floci E2E

- [x] bootstrap/deploy
- [x] seed user
- [x] smoke
- [x] Basic 2並列
- [x] Standard 10並列
- [x] 二重解放
- [x] Reaper

### M7: ドキュメント・レビュー

- [x] 実装との整合
- [ ] IAMレビュー
- [ ] CDK diff確認手順
- [x] 未確認事項

### M8: Floci日常開発環境

- [x] `mise run dev-local`でFloci起動、初回bootstrap/deploy、Cognito seed、Vite起動を一連化
- [x] 既存スタックを再利用する通常起動と、バックエンド変更を反映する明示的な再デプロイを分離
- [x] 開発環境の停止タスクと利用手順を文書化
- [x] オーケストレーション判定の単体テストと実Floci起動確認
- [x] FlociのJWT claims非伝播を補うローカル限定ヘッダーをWeb UIから送信し、画面からAPIを利用可能にする

### M9: Floci UI

- [x] 参照されていない配布用`MANIFEST.sha256`を削除
- [x] 公式Floci UI 0.2.0を検証済みmulti-architecture image digestへ固定
- [x] `dev-local`でFloci本体とFloci UIを常時起動し、E2E単独起動はFloci本体だけに維持
- [x] Floci UIのready確認、ログ、停止をmiseタスクへ統合
- [x] `http://localhost:4500`とAWS runtime status、既存S3/Lambdaリソース表示を確認
- [x] ドキュメント、構成ツリー、検証記録を更新

### M10: 汎用画像推論デモ化

- [x] UIタイトルと説明から特定カテゴリへの用途限定を除去
- [x] スタブ推論結果を汎用的な`DEMO-*`へ変更
- [x] CDK Stack、AWSタグ、Dashboard、Docker、Web保存キーを`AsyncImageInference`系へ変更
- [x] Bun workspace scopeを`@async-image-inference/*`へ変更し、lockfileを再生成
- [x] API例、設計書、テスト、検証記録からカテゴリ固有表現を除去
- [x] 旧名称が残っていないことと、全品質ゲートを確認

### M11: Floci Cognitoのブラウザログイン

- [x] Floci Cognitoへ直接アクセスした場合のCORS失敗を再現して原因を記録
- [x] ViteにローカルCognito専用の同一オリジンproxyを追加
- [x] API Gateway用Floci endpointとブラウザCognito endpointをruntime config生成で分離
- [x] 相対Cognito endpointの解決と設定生成に回帰テストを追加
- [x] 実ブラウザでBasicユーザーのログインとTier表示を確認
- [x] 全品質ゲート、ローカル推論、ローカル開発文書を更新

### M12: リポジトリのLF正規化

- [x] `.gitattributes`でGit管理対象のテキストをLFへ固定
- [x] 未追跡を含む既存テキストをLFへ正規化
- [x] CRLFと単独CRが残っていないことを検査
- [x] 正規化後に全品質ゲートを再実行

### M13: mypyからtyへの移行

- [x] ty 0.0.63で既存のmypy対象を事前検証
- [x] tyをmise管理へ追加し、Python型検査タスクを置換
- [x] mypy依存、設定、Docker除外設定を削除
- [x] mypy strictの型注釈検査をRuffルールで維持
- [x] `.mypy_cache`を安全に削除し、実行設定にmypy参照が残っていないことを確認
- [x] frozen依存導入と全品質ゲートを再実行

### M14: セキュリティと非同期信頼性の強化

このマイルストーンでは、Job予約後にAPI Lambdaが停止してもWorkflow起動要求を失わず、AWS側の起動結果が不明な場合にも実行中Jobの枠を誤解放しない構成へ変更する。JobsテーブルのDynamoDB StreamsをDispatcher Lambdaへ接続し、Job Submit Lambdaは枠確保と`RESERVED` Job作成までを同期処理として202を返す。DispatcherはStreamの`RESERVED`レコードを受け、Job IDをStep Functions実行名として冪等に起動し、Jobを`QUEUED`へ進める。Dispatcher失敗はEvent Source Mappingが再試行し、枠解放は行わない。再試行を使い切ったレコードはSQS DLQへ送り、初期リースを超えたJobは既存Reaperが`TIMED_OUT`へ回収する。

同時に、`cdk-nag`の`AwsSolutionsChecks`をCDKアプリへ適用し、`mise run check`とCIでエラーを失敗扱いにする。LambdaのIAM RoleはCDKの広い`grantReadWriteData`ではなく、各ハンドラーが実行するDynamoDB、S3、Step Functions、DynamoDB Streams、SQSのActionへ限定する。AWSサービス仕様上ワイルドカードが避けられない権限とPoCの意図的な例外だけ、リソース単位の抑制理由をコードへ残す。

Workflowは失敗とタイムアウトのFinalize後にFail stateへ到達させ、Step Functionsの実行メトリクスがJob失敗を隠さないようにする。Lambdaランタイムの`Sandbox.Timedout`と`Lambda.Unknown`も`TIMED_OUT`へ分類し、Lambda timeoutをTask timeoutより短くする。ReaperはGSIをページングし、時間と件数の上限内で並列回収し、失敗数と残件有無を返す。

アップロードは署名付きPUTから署名付きPOSTへ変更し、S3 POST Policyの`content-length-range`で1 byte以上、環境設定の最大サイズ以下をAWS側で強制する。Webは返却されたフォームフィールドを変更せず`multipart/form-data`でS3へ送る。API Gatewayはローカル以外でCloudFront同一オリジンを前提として不要なCORSを公開せず、ステージ単位のスロットリングを設定する。JWT routeはaccess tokenのscopeを要求し、Lambda側も`token_use=access`を確認する。

- [x] `cdk-nag`を含む`mise run check`品質ゲート
- [x] DynamoDB Streams DispatcherとDLQ
- [x] Workflow失敗メトリクスとtimeout分類
- [x] 最小権限IAM Role
- [x] 署名付きPOSTとアップロードサイズ強制
- [x] Reaperページング、並列処理、失敗可視化
- [x] 環境名、CORS、APIスロットリング、access token検証
- [x] CDK ContextとWeb runtime configの最大アップロードサイズ同期
- [x] 実モデルをDocker build contextへ含められる除外設定
- [x] 故障注入単体テスト、CDK検査、PR上のFloci結合試験
- [x] 設計書、API仕様、データモデル、運用手順の同期
- [x] 全品質ゲートとFloci E2E

### M15: mise公開タスクの整理

`mise tasks`を、人が直接選ぶ12個のワークフローだけを示す公開インターフェースへ縮小する。format check、lint、型検査、単体テスト、build、CDK synth、cdk-nagは`check`の内部コマンドとして実行し、Flociの起動、必要なbootstrap/deploy、seed、smoke、結合テスト、停止は開発用Pythonスクリプトと`e2e-local`へ集約する。CIは凍結lockfileによる依存導入やコンテナbuildを直接実行し、削除する内部miseタスクへ依存しない。

- [x] 公開miseタスクを`install`、`format`、`check`、`dev-web`、`dev-local`、`dev-local-refresh`、`dev-local-down`、`floci-logs`、`e2e-local`、`deploy-dev`、`deploy-web`、`clean`の12個へ限定
- [x] `local/dev_local.py`から内部miseタスク呼び出しを除去
- [x] Floci E2Eの準備、検証、失敗時ログ、後片付けを`local/e2e_local.py`へ集約
- [x] GitHub Actionsを12タスク構成へ同期
- [x] README、AGENTS、Floci開発文書、テスト戦略から削除タスクの操作手順を除去
- [x] mise設定、単体テスト、全品質ゲートを再検証

## 具体的な変更ファイル

`mise.toml`を開発ツールとタスクの唯一の入口とする。Makefileは削除し、`README.md`、`AGENTS.md`、`docs/07_floci_local_development.md`、`local/README.md`、GitHub Actionsの呼び出しを`mise run`へ統一する。

Flociの日常開発では、`local/dev_local.py`を安全なオーケストレーターとして追加する。このスクリプトはFlociを起動し、`CDKToolkit`と`AsyncImageInference-local`の存在をAWS互換CloudFormation APIで確認する。初回だけbootstrapとdeployを行い、既存のアプリケーションStackがある通常起動ではStack出力からWeb設定を再生成してCognitoユーザーを冪等にseedする。その後、前面プロセスとしてViteを起動する。API Lambda、CDK、推論コンテナの変更を反映するときは、CDK deployを直接実行する`mise run dev-local-refresh`を明示的に使う。停止は`mise run dev-local-down`から停止スクリプトを実行する。

Floci 1.5.33はHTTP API v2のJWT claimsをLambdaイベントへ渡さないため、ローカルWeb設定には`localAuthBypass: true`を明示する。`apps/web/src/auth.ts`はCognitoアクセストークンから`sub`と`cognito:groups`をSessionへ保存し、`apps/web/src/api.ts`は上記フラグがtrueの場合だけ`x-local-user-id`と`x-local-groups`をAPIリクエストへ加える。本番用設定ではフラグをfalseとし、Bearer token以外のローカル認証ヘッダーを送らない。

Floci UIは上流リポジトリをsubmoduleとして取り込まず、公式release 0.2.0が公開する単一コンテナimageを利用する。このimageはフロントエンドとAPI proxyを同じポート4500で提供する。`local/compose.yaml`へ`dev` profileの`floci-ui`サービスを追加し、`local/dev_local.py`は日常開発時に必ずprofileを有効にする。これにより日常開発ではUIが常時起動する一方、`local/e2e_local.py`を使うE2EではUIを起動しない。imageは`floci/floci-ui:0.2.0`に加えてmulti-architecture index digestを記述し、タグの差し替えによる変動を防ぐ。

汎用画像推論デモ化では、利用者が目にするタイトルを「非同期画像推論デモ」とし、スタブ結果を`DEMO-*`へ変更する。APIの`productCode`フィールドは既存クライアントとの互換性を保つため変更せず、「推論候補を表す文字列」として扱う。CDK Stack名は`AsyncImageInference-<environment>`、Bun workspaceは`@async-image-inference/*`、Dockerコンテナは`async-image-inference-*`へ統一する。変更前のStackは自動移行せず、新名称のStackを別リソースとして作成する。

Floci Cognitoのブラウザログインでは、`apps/web/vite.config.ts`に`/_local/cognito`から`http://localhost:4566`への開発専用proxyを追加する。proxyはブラウザから見てViteと同じoriginでCognitoリクエストを受け、Flociへサーバー間転送するため、Floci Cognitoが処理できないCORS preflightを発生させない。`scripts/generate-web-config.py`はAPI Gateway接続用の`--aws-endpoint`とブラウザCognito用の`--cognito-endpoint`を別引数にし、ローカル設定だけCognito endpointを`/_local/cognito`とする。本番設定はCognito endpointを指定せず、AWS SDKの標準endpointを維持する。

JavaScript/TypeScript側はBun workspacesと`bun.lock`へ統一する。TypeScriptはネイティブ実装の正式版`7.0.2`を各workspaceで利用し、lintとformatはリポジトリルートのOxlint/Oxfmtで実行する。API、Web、結合テストはBun testへ移行し、ESLint、typescript-eslint、Vitest、ts-node、`package-lock.json`は削除する。

CDKのbuildとCLI呼び出しもBun scriptを入口にする。ただし、Windows上でCDK asset stagingをBunランタイムから実行すると停止するため、TypeScript 7で`dist`へコンパイルしたCDKアプリとCDK単体テストはNode.js 22で実行する。CDKのNodejsFunction bundlingがWindowsで要求する`bun.cmd`は、mise実行時だけPATHへ加える薄い転送スクリプトで補う。

Python型検査はmypyからty 0.0.63へ移行する。`mise.toml`でtyを固定し、リポジトリルートの`ty.toml`でPython 3.12、`missing-type-argument`、`possibly-unresolved-reference`を設定する。`mise run check`は`services/inference/app`とローカルPythonオーケストレーターを一度の`ty check`で検査する。tyは型注釈欠落を報告しないため、同じ品質ゲート内のRuffへ`ANN001`、`ANN002`、`ANN003`、`ANN201`、`ANN202`、`ANN204`、`ANN205`、`ANN206`を追加し、mypy strictが担っていた関数シグネチャの注釈要求を維持する。`services/inference/requirements-dev.txt`、`services/inference/pyproject.toml`、`services/inference/.dockerignore`からmypy専用設定を除去し、既存の`.mypy_cache`は対象をリポジトリ直下へ限定して削除する。

M14では`services/api/src/job-submit.ts`からStep Functions直接起動と起動失敗時の補償解放を除き、`services/api/src/job-dispatcher.ts`を追加する。`infra/cdk/lib/platform-stack.ts`はJobsテーブルStream、AWS向けDispatcher Event Source Mapping、DLQ、明示的なLambda実行Role、WorkflowのFail state、API stage throttle、CloudWatchアラーム、必要最小限のnag抑制理由を定義する。Floci 1.5.33は実測でDynamoDB Streamを作成しなかったため、`local` ContextだけJob SubmitからDispatcher Lambdaを明示呼び出しするアダプターを使用する。`infra/cdk/bin/app.ts`は`cdk-nag`を適用する。`services/api/src/upload-url.ts`と`apps/web/src/api.ts`は署名付きPOST契約へ移行する。Reaper、環境設定、Web設定生成、CDK・API・ローカル・結合テスト、GitHub Actions、関連設計書を同時更新する。

M15では`mise.toml`の品質検査を`check`へ直接展開し、ローカルFloci操作を`local/dev_local.py`へ移す。`local/e2e_local.py`はFloci UIを起動せず、必要な環境準備、smoke、結合試験、失敗時ログ、必須cleanupを一括実行する。既存Stackへの強制更新はFloci 1.5.33のIAM名衝突を再現するため、永続化済みStackは再利用し、CIの空環境だけ初回deployする。GitHub Actions、README、AGENTS、Floci手順、セキュリティ、CDK、テスト戦略を公開12タスクへ同期する。

## データ移行・互換性

初期構築のため本番データ移行はない。API契約と状態名は将来互換性の基準となる。

M10ではAPIの`productCode`を維持するためクライアント契約の移行は不要である。CDK Stack名を変更するため、AWSとFlociの変更前Stackは自動更新されず、`AsyncImageInference-<environment>`が新規Stackとして作成される。Webのsession storage keyも変更するため、既存ブラウザセッションは引き継がず再ログインする。検証時の変更前Flociデータはリポジトリ外へ退避し、空の`local/data`から新Stackを構築する。

M14ではJobsテーブルへDynamoDB Streamを追加するため、既存AWS StackはCloudFormation更新でStreamとEvent Source Mappingを追加できる。既存の`RESERVED` JobはStream追加前のレコードなのでDispatcherへ流れず、初期リース後にReaperが回収する。署名付きアップロードのレスポンスは`requiredHeaders`から`uploadFields`へ変更するため、WebとAPIを同時デプロイする。Job受付成功直後の状態はWorkflow起動前の事実を表す`RESERVED`を返し、クライアントは従来どおり終端状態までポーリングする。

## テスト計画

`docs/10_test_strategy.md` に従う。mise移行自体は`mise tasks validate`と`mise tasks ls`で設定を検証し、依存導入後に`mise run check`を実行する。Bun移行ではlockfileの固定導入、Oxlint、Oxfmt check、TypeScript 7の型検査、Bun test、Node.js標準CDKテスト、Vite/CDKビルド、CDK synthを同じgateで確認する。

Floci日常開発の追加では、初回構築、既存Stack再利用、強制再デプロイの分岐を`local/tests/test_dev_local.py`で検証する。Webのローカル認証ヘッダーは`apps/web/src/api.test.ts`で、明示的なローカル設定では付与し、本番設定では付与しないことを検証する。実環境では`dev-local`によるVite HTTP 200、生成設定の`localAuthBypass: true`、E2E smokeの推論成功、`dev-local-down`後に対象コンテナが残らないことを確認する。

Floci UI追加では`docker compose config`と`mise tasks validate`で設定を検証する。`mise run dev-local`の準備処理を実行し、`http://localhost:4500`がHTTP 200、`/api/clouds/aws/status`がFloci runtimeを`reachable`として返すことを確認する。CDK deploy済みのS3 bucketとLambda functionがAPI proxy経由で取得できることも確認する。最後に`mise run dev-local-down`を実行し、Floci UI、Floci本体、動的Lambda、ECR registryのコンテナが残らないことを確認する。

汎用画像推論デモ化では、カテゴリ固有の旧名称がリポジトリに残っていないことを大文字小文字を区別しない全文検索で確認する。Pythonスタブテストへ`DEMO-*`の回帰検証を追加し、CDKテストで新しいDashboard名とシステムタグを確認する。`bun install`でworkspace名をlockfileへ反映し、`mise tasks validate`と`mise run check`でlint、型検査、全単体テスト、build、CDK synthを確認する。

Floci Cognito修正では、変更前に`Origin: http://localhost:5173`を付けた`OPTIONS http://localhost:4566/`が405を返すことを再現する。Bun testで相対endpointがVite originの絶対URLへ解決されること、pytestで生成設定のAPI endpointとCognito endpointが分離されることを確認する。実環境では設定再生成後にブラウザから`basic@example.test`でログインし、Tier表示と推論Jobの`SUCCEEDED`まで確認する。最後に`mise run check`を実行する。

ty移行では、`mise install`、`bun install --frozen-lockfile`、Python依存導入で固定ツールと依存を再構築し、`mise run check`内のty 0.0.63と厳格化したRuffが成功することを確認する。`.mypy_cache`削除後にmypy専用の依存、設定、実行コマンド、Docker除外設定が残っていないことを全文検索で確認し、最後に`mise tasks validate`と`mise run check`を実行する。

M14では`mise run check`が抑制されていない`AwsSolutionsChecks`エラー0件で終了することを確認する。API単体テストは、予約済みJob再送が追加カウントしないこと、Dispatcherの一時エラーが枠解放せず再試行されること、ローカルDispatcherイベント、署名付きPOSTが最大サイズ条件を含むこと、Reaperが複数ページを処理すること、ID tokenを拒否することを検証する。CDKテストは非ローカルStackのStream Event Source Mapping、ローカルStackの明示Dispatcher設定、DLQ、Workflow Fail state、timeout階層、API throttle、access token scope、最小IAMを検証する。GitHub ActionsはFlociを起動し、deploy、Cognito seed、smoke、429/503、二重解放、ReaperをPRごとに実行する。最後に`mise run check`、Dockerによるstubコンテナbuild、`mise run e2e-local`を実行する。

## ローカル確認手順

`docs/07_floci_local_development.md` に従う。

最初に`mise install`と`mise run install`を実行し、通常検証は`mise run check`で行う。

日常開発はリポジトリルートで`mise run dev-local`を実行し、Floci上のローカルAWSリソースとViteをまとめて起動する。初回はCDK bootstrap/deployを実行するため時間がかかるが、2回目以降は永続化済みStackを再利用する。バックエンド変更後は別ターミナルで`mise run dev-local-refresh`を実行し、開発終了時はViteをCtrl+Cで止めてから`mise run dev-local-down`を実行する。

Docker/Floci E2Eでは、`docker version`と`docker compose version`で実行環境を確認し、必要に応じて`docker build -t inference-stub services/inference`でstub推論コンテナを単独ビルドする。続けて`mise run e2e-local`を実行し、Floci起動、必要なbootstrap/deploy、Cognito seed、smoke、結合試験、停止を一括検証する。永続化済みStackは再利用する。失敗時はタスクが停止前にComposeログを出力し、`local/data`の永続データは削除しない。

## AWS確認手順

- CDK deploy dev
- CloudFront/OAC
- Cognito JWT
- 実Lambda性能
- IAM

## リスクと緩和策

`docs/12_risks_and_open_questions.md` を参照。

## 進捗

- 2026-07-23: スターター作成。実装検証は未実施。
- 2026-07-24: Makefileからmiseへの移行を開始。mise設定、文書、CIの更新を実施。
- 2026-07-24: `mise tasks validate`で20タスクを検証し、`mise run check`でlint、型検査、17件の単体テスト、ビルド、CDK synthの成功を確認。
- 2026-07-24: Bun、TypeScript 7、Oxcへの移行を開始。参考記事と各ツールの正式版・現行仕様を確認。
- 2026-07-24: `bun.lock`を生成し、TypeScript 7.0.2、Oxlint 1.75.0、Oxfmt 0.60.0、Bun testへ移行。
- 2026-07-24: frozen lockfile導入と、`mise run check`によるformat、lint、型検査、17件の単体テスト、全workspaceビルド、CDK synthの成功を確認。
- 2026-07-24: Docker/Floci E2Eの実測を開始。stubコンテナのビルド、Floci起動、ローカルCDK bootstrap/deploy、Cognitoユーザー作成、smoke、Tier並列結合テストを対象とする。
- 2026-07-24: Docker preflightはDocker Engine 29.6.1、Docker Desktop 4.81.0、Compose 5.2.0で成功。ホストにAWS CLIがなかったため、再現可能なE2E前提としてFloci用AWS CLI 1.45.53をmiseのpipxバックエンドへ追加。
- 2026-07-24: 標準CDK CLIからFlociへのbootstrap/deployに成功し、Cognito、S3、DynamoDB、HTTP API、Lambda、ECR、Step Functionsを作成。
- 2026-07-24: smokeはS3 PUT、Job 202、Python推論コンテナ、`SUCCEEDED`、枠数0まで成功。
- 2026-07-24: 結合試験はBasic 2並列で202が1件と429が1件、Standard 10並列で202が3件と429が7件を確認。
- 2026-07-24: システム枠上限時の503、Finalize二重実行時の単一解放、Reaperによる期限切れJobの`TIMED_OUT`化と枠解放を確認。
- 2026-07-24: FlociをE2E専用経路ではなく日常開発の標準バックエンドにするM8を開始。統合起動、明示的な再デプロイ、停止タスク、文書とテストを対象とする。
- 2026-07-24: M8を完了。`dev-local`が永続化済みCDK Stackを再利用し、Web設定再生成、Cognito seed、Vite起動まで行うことを実Flociで確認し、ViteのHTTP 200と`dev-local-down`による停止を確認。
- 2026-07-24: Vite起動後のWeb API経路にローカル認証ヘッダーがなく、画面からはFlociのAPIを利用できない不足を発見。M8を再開し、ローカルruntime config、Cognito `sub`、Tierグループからヘッダーを生成する修正を開始。
- 2026-07-24: Webのローカル認証ヘッダー経路を追加してM8を完了。ローカル設定生成、本番設定との分離、Webテスト、smokeの`SUCCEEDED`、全26件の単体テストと`mise run check`の成功を確認。
- 2026-07-24: M9を開始。不要な`MANIFEST.sha256`を削除し、Floci UIを日常開発時に常時起動する構成、ready確認、管理タスク、実リソース表示検証を対象とする。
- 2026-07-24: M9を完了。公式Floci UI 0.2.0をdigest固定で導入し、`dev-local`準備時の常時起動、runtime `reachable`、S3 4件とLambda 7件の取得、E2E単独起動との分離、停止を実コンテナで確認した。
- 2026-07-24: M10を開始。カテゴリ固有のUI、スタブ値、Stack・package・コンテナ識別子、API例を汎用画像推論デモへ変更する。
- 2026-07-24: M10を完了。旧名称の全文検索0件、全28件の単体テスト、build、CDK synth、新しいFloci Stackの初回deploy、UI接続、`DEMO-*`推論成功を確認した。
- 2026-07-24: M11を開始。Web UIログイン時の`Failed to fetch`を調査し、Floci CognitoへのCORS preflightが405を返すことを原因として確認した。
- 2026-07-24: CognitoだけをViteの`/_local/cognito` proxyへ通す修正を実装。実ブラウザでBasicユーザーのログイン、`tier-basic`表示、推論画面への遷移を確認した。
- 2026-07-24: M12を開始。`.gitattributes`でテキストをLFへ固定し、既存ファイルも正規化する。
- 2026-07-24: M11を完了。proxy経由のトークン発行、実ブラウザログイン、smokeの`SUCCEEDED`、全32件のテストと品質ゲートを確認した。
- 2026-07-24: M12を完了。管理対象候補132件のうちテキスト130件にCRLF・単独CRが残っていないこと、バイナリ2件が正規化対象外であること、正規化後の`mise run check`成功を確認した。
- 2026-07-24: M13を開始。ty 0.0.63の標準設定と`missing-type-argument`、`possibly-unresolved-reference`を有効にした検査で、既存のmypy対象が成功することを確認した。
- 2026-07-24: M13を完了。tyをmiseへ固定し、型検査タスク、厳格なRuff注釈検査、依存と設定の削除、約7.5MBのキャッシュ削除、frozen依存導入、全32件のテスト、build、CDK synthの成功を確認した。
- 2026-07-24: M14を開始。レビューで確認したWorkflow起動境界、監視、timeout分類、IAM、アップロード制限、Reaper、環境検証、CIの問題をExecPlanへ反映し、Floci 1.5.33がDynamoDB StreamsのLambda Event Source MappingとS3署名付きPOSTの`content-length-range`を実装していることを上流sourceで確認した。
- 2026-07-24: M14の実装を反映。DispatcherとDLQ、Workflow Fail state、最小権限Role、署名付きPOST、Reaperページング、access token検証、API throttle、アクセスログ、PITR、SNSアラーム通知、cdk-nag、PR用Floci結合Job、設計書同期を完了し、型検査と未抑制finding 0件のCDK synthに成功した。
- 2026-07-24: Floci E2EでDynamoDB Streamが作成されずJobが`RESERVED`へ留まる差異を確認。AWS向けStreams経路を維持したまま`local` Context専用のDispatcher Lambda明示呼び出しへ分離し、新規Stackでsmokeと全結合試験に成功した。
- 2026-07-24: M14を完了。`mise run check`、stubコンテナbuild、Floci新規deploy、smoke、Basic/Standard 429、システム503、二重Finalize、Reaperが成功し、ローカルStackにStream Event Source Mappingがなく専用Dispatcher設定だけが入ることも確認した。
- 2026-07-24: M15を完了。mise公開タスクを28件から12件へ縮小し、内部処理を`check`、Pythonオーケストレーター、CIへ移した。削除タスク名の実行参照0件、全44件のテストを含む`mise run check`、既存Stack再利用の`mise run e2e-local`が成功した。

## 決定ログ

- 2026-07-23: Step Functions Standardを採用。
- 2026-07-23: 初期構成ではSQSを採用しない。
- 2026-07-23: 同時実行管理はDynamoDBトランザクション。
- 2026-07-24: Bun 1.3.14、Node.js 22、Python 3.12、Python仮想環境、開発タスクを`mise.toml`で一元管理する。ローカルとCIの実行入口を一致させるため。
- 2026-07-24: TypeScriptは`@typescript/native-preview`を採用せず、正式版`typescript@7.0.2`を採用する。TypeScript 7ではGo実装が正式な`typescript`パッケージへ統合され、実行ファイル名も`tsgo`から`tsc`へ変更されたため。
- 2026-07-24: TypeScript 7にはProgrammatic APIがまだないため、そのAPIに依存するtypescript-eslintを併用せず、Oxlintへ全面移行する。
- 2026-07-24: API、Web、結合テストはVitestからBun testへ移行し、依存管理と通常のscript・テスト実行をBunへ一本化する。
- 2026-07-24: CDKアプリとCDK単体テストはTypeScript 7で事前コンパイルし、Node.js 22で実行する。Windows上でこのスタックのasset stagingをBunランタイムから実行すると停止したため。Bunは引き続きbuild、CDK CLI、esbuild bundlingの入口として使用する。
- 2026-07-24: Flociスクリプトが利用するAWS CLIはmiseのpipxバックエンドで1.45.53へ固定する。ホストへの別途インストールに依存せず、ローカルとCIで同じCLIを使用するため。実AWSへのデプロイではAWS CLI v2を使用する。
- 2026-07-24: ローカルCDKは`aws-cdk-local`を使わず、標準の`cdk` CLIへ`AWS_ENDPOINT_URL`を設定する。`aws-cdk-local`が現在のCDK CLIの非公開モジュールを読み込めないため。
- 2026-07-24: Floci向けdeployだけは`localAuthBypass=true`を指定する。Floci 1.5.33がHTTP API v2のJWT claimsをLambdaイベントへ渡さず、Lambda側でCognitoのclaimsを取得できないため。
- 2026-07-24: S3所有者メタデータを署名付きURLの必須ヘッダーとする。Floci 1.5.33がクエリへ移された`x-amz-meta-owner`をオブジェクトメタデータとして保存しないため。
- 2026-07-24: Lambdaログ保持は`Custom::LogRetention`ではなく明示的な`LogGroup`で定義する。Floci上のCustom Resourceが実AWS形式のLogs endpointへ到達できないため。
- 2026-07-24: `dev-local`は既存のローカルアプリケーションStackがあれば再デプロイせず再利用する。Floci 1.5.33のStack更新がIAM名衝突で失敗する場合があり、日常の起動を不安定にしないため。バックエンド変更の反映は`dev-local-refresh`として明示する。
- 2026-07-24: Webのローカル認証ヘッダーは`localAuthBypass: true`がruntime configに明示された場合だけ送る。Floci差異を本番経路へ混入させず、AWS向けAPIではJWT Authorizerを認証境界として維持するため。
- 2026-07-24: Floci UIはsubmoduleではなく、公式`floci/floci-ui:0.2.0` imageをOCI index digest `sha256:03a261144e0708993c8e48b763a0edb072415feae4325f254beeb1835fa424d9`へ固定して利用する。上流source treeを親repoへ持ち込まず、公式release成果物をamd64/arm64で再現可能に利用できるため。
- 2026-07-24: Floci UIは`dev-local`で常時起動し、`e2e-local`では起動しない。日常開発の可視性を既定で提供しながら、CI/E2Eの起動時間と外部image依存を増やさないため。
- 2026-07-24: miseタスクは人が選ぶ12個のワークフローだけを公開する。品質検査の個別工程、CI専用依存導入、Flociの低レベル操作は公開タスクにせず、集約タスクまたはスクリプトの内部実装とする。
- 2026-07-24: `e2e-local`は永続化済みFloci Stackを再利用する。既存Stackへの強制deployでFloci 1.5.33のIAM Policy名衝突とrollbackを再現したため、バックエンド更新は`dev-local-refresh`または空の`local/data`からの再構築として明示する。
- 2026-07-24: 汎用化ではAPIの`productCode`を維持する。外部契約を壊さず、カテゴリ固有の値と表示だけを除去して任意の分類・候補コードを返せるデモにするため。
- 2026-07-24: 新しいシステム識別子は`AsyncImageInference`と`async-image-inference`へ統一する。リポジトリ名と用途に一致し、特定の商品カテゴリを示さないため。
- 2026-07-24: Floci Cognitoのブラウザ接続だけをViteの同一オリジンproxyへ通す。FlociのCORS非対応を開発サーバーへ限定して吸収し、AWS向けCognito endpointやAPI/S3の直接接続を変更しないため。
- 2026-07-24: Git管理対象のテキストはOSにかかわらずLFへ統一する。Windows上でもシェル、Docker、CIと同じ改行を維持し、不要な全行差分を防ぐため。
- 2026-07-24: Python型検査はmiseで固定したty 0.0.63へ移行し、型注釈欠落の検査はRuffの限定した`ANN`ルールで補う。tyはPython 3.12と現在のコードを検査できる一方、mypyの`--strict`と同名のモードを持たず、型注釈欠落を単独では報告しないため。
- 2026-07-24: Job予約とWorkflow起動の間は、Job Submit Lambdaによる同期`StartExecution`ではなくJobsテーブルのDynamoDB StreamsとDispatcher Lambdaで接続する。予約トランザクションの確定後に処理要求が永続化され、Dispatcherの通信結果不明は同名Standard Workflow起動の再試行で安全に解決できるため。
- 2026-07-24: Workflowの業務失敗とタイムアウトはFinalize後にFail stateへ遷移させる。Jobsテーブルの終端状態とStep Functions実行メトリクスを一致させ、`ExecutionsFailed`アラームが推論失敗を検知できるようにするため。
- 2026-07-24: S3直接アップロードは署名付きPOSTへ変更する。POST Policyの`content-length-range`により、クライアント申告値だけでなくS3受付時の実サイズを制限できるため。
- 2026-07-24: `cdk-nag`は`AwsSolutionsChecks`を全Stackへ適用し、抑制はリソースとルールを限定して理由を記録する。品質ゲートは抑制されていないErrorを許可しない。
- 2026-07-24: Flociの`local` ContextはJob SubmitからDispatcher Lambdaを同期Invokeする。Floci 1.5.33がCloudFormationの`StreamSpecification`を受理してもDynamoDB Streams APIへStreamを作らないためで、AWS向けStackは従来どおりStream Event Source Mappingを使用する。

## 発見事項

- Windowsの既定環境からも同じタスクを呼べるよう、既存のPOSIXシェルスクリプトはmiseタスク内で`bash`を明示して実行する。
- `mise run install`の初回実行で、存在しない`aws-cdk@2.261.0`の指定によりnpmが`ETARGET`で停止した。npmレジストリで確認できたCLI `2.1132.1`とライブラリ`2.262.0`へ修正した。
- `mise run check`の初回実行で、`apps/web/tsconfig.node.json`の`allowImportingTsExtensions`に必要な`noEmit`がなくTypeScript `TS5096`で停止した。Vite設定の型検査専用構成として`noEmit: true`を追加した。
- Web依存導入後、CDKテストがVitest経由でReact/Viteの型定義を参照し、CDK自身が使わないDOM型とBundler解決の診断で失敗した。CDKはNode.js専用なので`types: ["node"]`へ限定し、外部ライブラリ宣言の診断を`skipLibCheck`で除外した。
- Pythonのstrict mypy検査はboto3とbotocoreの型情報がなく失敗した。実行依存と対応する`boto3-stubs[s3]`を開発依存へ追加した。
- boto3型定義の導入後、汎用`dict[str, object]`を展開してS3クライアントを作る実装が厳密なoverloadに一致しなかった。ローカルendpointの有無を分岐し、型付けされた引数を直接渡す同等実装へ整理した。
- CDKテストは各assertionごとにスタックを再生成し、6本のLambdaバンドルを繰り返したため全6件が5秒でタイムアウトした。既定構成と非ローカル構成のTemplateを一度ずつ生成して共有し、assertion自体を高速化した。
- CDK `2.262.0`ではDynamoDBの`pointInTimeRecovery`とLambdaの`logRetention`に廃止予定警告が出る。今回のmise移行では動作に影響しないため、API移行は後続課題とした。
- 参考記事は同じCDK向けのBun、mise、TypeScriptネイティブコンパイラー、Oxc構成を扱っており方針は直接参考になる。一方、記事公開時点ではTypeScript 7がRCだったため`@typescript/native-preview`を使っている。翌日の正式版公開後は`typescript@7.0.x`自身がネイティブコンパイラーとなったため、その箇所だけ現行仕様へ読み替える。
- TypeScript 7では`moduleResolution: "Node"`が指す`node10`モードが削除された。CDKのCommonJS出力は`module`と`moduleResolution`を`Node16`へ揃えた。
- TypeScript 7のside-effect import検査に対応するため、Webの型環境へ`vite/client`を明示した。Bun testの型は`@types/bun`と各対象tsconfigの`bun` typeで解決した。
- Bunのisolated workspaceではCDKがリポジトリルートから呼ぶesbuildをCDK workspaceの開発依存から参照できなかった。esbuildをルート開発依存へ移し、CDK bundlingの実行位置と一致させた。
- CDKアプリをBunランタイムで起動するとWindows上でasset staging中にプロセスが停止した。CDKアプリとCDKテストのみNode.js 22へ限定すると、12回のテストasset bundlingと6回のsynth asset bundlingが完了した。
- CDKを`dist`から起動すると`__dirname`の階層が変わるため、`bun.lock`を親方向へ探索してリポジトリルートを特定する実装へ変更した。
- mise標準の`awscli = "2.36.6"`はWindowsで`unsupported env: windows/amd64`となった。aquaバックエンドのAWS CLI v2配布がLinux/macOS限定のため、Flociローカル検証はWindowsでも導入できる`pipx:awscli`を使用する。
- `aws-cdk-local` 2.19.2は`aws-cdk` 2.1132.1の`aws-cdk/lib/cdk-toolkit`を読み込もうとして`ERR_PACKAGE_PATH_NOT_EXPORTED`で停止した。標準CDK CLIは同じFloci endpointへbootstrap/deployできる。
- Windowsの予約済みTCPポート範囲にFlociのECR既定ポート5100が含まれていた。ローカルECR範囲を5200から5299へ変更すると、DockerImageFunctionのasset pushと実行に成功した。
- FlociのCloudFormationはCognitoグループを作成済みと報告しても、Cognito APIのグループ一覧へ反映しなかった。seedスクリプトが3つのTierグループを冪等に作成してからユーザーを追加する。
- Floci 1.5.33のHTTP API v2では、JWT AuthorizerリソースとLambdaイベントのclaims伝播を確認できなかった。Cognitoのトークン発行は別に確認し、APIの結合試験はローカル限定ヘッダーを使う。
- AWS SDKのS3 presignerは`x-amz-meta-owner`を署名URLのクエリへ移したが、Flociはその値をS3メタデータへ保存しなかった。ヘッダーをunhoistableにして署名対象へ残すと所有者検査が通った。
- Job終端更新はDynamoDB予約語`ttl`をエスケープしていなかったため、推論成功後のFinalizeが失敗した。`#ttl`へ修正し、`slotState=HELD`条件と3項目のTransactWriteを維持する回帰テストを追加した。
- Floci 1.5.33は既存Stack更新時にIAM Policyを再作成し、同名リソース衝突でrollbackした。検証中の`local/data`は時刻付きディレクトリへ退避し、クリーンな永続領域から再デプロイした。
- リポジトリ外の通常`python`は別アプリケーションの仮想環境を指し、Ruffとmypyを利用できなかった。`mise exec -- python`とmiseタスクでは固定済みPython 3.12.13とリポジトリの`.venv`が選択され、同じ検査が成功した。
- `dev-local`の実測では`CDKToolkit`とローカルアプリケーションStackを検出し、再デプロイせずWeb設定再生成とCognito seedへ進んだ。その後のViteは`http://127.0.0.1:5173`へHTTP 200を返した。
- Webの`apps/web/src/api.ts`はBearer tokenだけを送っていたが、Floci向けの`localAuthBypass`は`x-local-user-id`と`x-local-groups`を要求する。ViteのHTTP 200だけでは日常開発のAPI経路が成立した証拠にならない。
- 修正後のローカルWeb設定は`localAuthBypass: true`を含み、Web単体テストは本番設定でローカルヘッダーが付かないことを確認した。Floci上のsmokeはJobを`SUCCEEDED`へ進め、同時実行枠を0へ解放した。
- Floci UI 0.2.0はフロントエンドとAPI proxyを同じimageで提供する。`/api/clouds/aws/status`からCompose network内のFloci接続を検証でき、デプロイ済み環境ではStorage 4件とServerless 7件を取得できた。
- Floci UI 0.2.0のCloud ExplorerはS3とLambdaを表示できる一方、DynamoDBは未統合で、Cognitoなど一部サービスはプレースホルダーである。ローカルAWSリソースの完全な検証は引き続きスモークテストとAWS CLIで行う。
- 変更前のFloci永続データにはカテゴリ固有のStack名、AWSタグ、物理リソース名が残っていた。約40MBの`local/data`をリポジトリ外へ退避し、空の永続領域から`AsyncImageInference-local`を構築すると、旧名称の全文検索は生成済みローカル状態を含めて0件になった。
- workspace scope変更後の`bun install`は旧workspace参照4件をlockfileから除去した。新しい`@async-image-inference/*` filterで型検査、テスト、build、synthがすべて成功した。
- Floci 1.5.33のCognito APIはAWS CLIからの`InitiateAuth`には成功する一方、ブラウザが先に送るCORS preflightの`OPTIONS /`へ405を返し、Cognitoリクエスト自体がFlociへ届かなかった。Web画面の`Failed to fetch`は認証情報ではなくブラウザのcross-origin制約だった。
- Vite proxy経由のCognito `InitiateAuth`はHTTP 200となり、実ブラウザでも同じBasicユーザーでログインできた。PowerShellの`Invoke-WebRequest.Content`はこのレスポンスを`byte[]`で返すため、検証時はUTF-8へデコードしてJSONを確認する必要があった。
- LF正規化前の全件検査でもCRLFと単独CRは0件だった。既存ファイルの内容変更は不要で、`.gitattributes`が今後のcheckoutと追加ファイルをLFへ固定する。
- ty 0.0.63は既存のmypy対象を変更なしで検査できた。mypy専用キャッシュはリポジトリ直下に3ファイル、約7.5MB存在しており、移行完了時に削除する。
- tyの推奨例どおりRuffの`ANN`と`PYI`を全有効化してpreviewも有効にすると、既存の明示的`Any`とpreview版import整列で4件失敗した。mypy strictの注釈欠落検査に必要な`ANN001`、`ANN002`、`ANN003`、`ANN201`、`ANN202`、`ANN204`、`ANN205`、`ANN206`だけへ限定すると成功した。
- Windowsで検証済みパスへの再帰的`Remove-Item`が実行ポリシーに拒否されたため、`.mypy_cache`内の3ファイルを列挙し、固定した絶対パスのファイルと空ディレクトリだけを削除した。削除後の`Test-Path`は`False`だった。
- `boto3-stubs[s3]`は配布パッケージ名として`mypy-boto3-s3`へ依存する。このパッケージはtyも利用するS3型スタブであり、mypy型チェッカー本体ではないため維持した。
- Floci 1.5.33の上流sourceにはDynamoDB StreamsからLambda Event Source Mappingを起動する実装があるが、実デプロイでは`describe-table`にStream情報がなく、`dynamodbstreams list-streams`も空だった。CloudFormationが固定形式のStream ARNでEvent Source Mappingを作るためポーラーは`Stream not found`を繰り返し、Jobが`RESERVED`に留まった。
- ローカルStackだけEvent Source Mappingを省き、Job SubmitからDispatcher Lambdaを明示呼び出しすると、同じDispatcher実装でStep Functions起動、推論、Finalize、枠解放まで完走した。AWS向けStackのStream Event Source MappingはCDKテストで検証し、実配信はAWS dev層の確認事項とする。

## 完了結果

Bun、mise、TypeScript 7、Oxcへの移行は完了した。
`bun.lock`で依存を固定し、CIはfrozen lockfileを検証する。
API/Webの11件はBun test、CDKの10件はNode.js標準テストランナー、推論Pythonの2件とローカル開発オーケストレーターの5件はpytestで成功した。
`mise run check`はOxfmt check、Oxlint/Ruff、TypeScript 7/ty型検査、28件の単体テスト、全workspaceビルド、CDK synthまで成功した。

Docker/Floci E2Eは、stubコンテナのbuild、標準CDK CLIによるbootstrap/deploy、Cognito seed、署名付きS3 PUT、Job 202、Step Functions、推論成功、枠解放まで完走した。
結合試験はBasic 2並列とStandard 10並列の429、システム上限503、Finalize二重実行、Reaperを確認した。

日常開発は`mise run dev-local`だけでFloci、Floci UI、ローカルStack、Cognitoユーザー、Viteを準備できる。通常起動は永続化済みStackを再利用し、バックエンド変更は`mise run dev-local-refresh`、終了は`mise run dev-local-down`として役割を分離した。Webはローカル設定時だけCognitoの`sub`とTierグループをFloci回避ヘッダーへ載せ、画面からローカルAPIを利用できる。実Flociで既存Stack再利用、Vite HTTP 200、推論成功、Floci UI HTTP 200とruntime接続、S3/Lambdaリソース取得、停止後に対象コンテナが残らないことを確認した。

汎用デモ化では、UIを「非同期画像推論デモ」、スタブ候補を`DEMO-*`、CDKとDockerのシステム識別子を`AsyncImageInference`系、workspaceを`@async-image-inference/*`へ統一した。APIの`productCode`は互換性のため維持した。空のFloci永続領域へ`AsyncImageInference-local`を新規deployし、管理UI HTTP 200、runtime `reachable`、スモークJob `SUCCEEDED`、候補3件すべてが`DEMO-*`、同時実行枠0を確認した。

AWSデプロイ、実JWT Authorizer、IAM評価、CloudFront/OAC、実Lambda性能、Step Functionsの実タイムアウト経路は未確認である。

Floci CognitoのブラウザCORS差異はViteの開発専用proxyへ閉じ込めた。Web単体テスト2件と設定生成テスト2件を追加し、`mise run check`ではAPI/Web 13件、CDK 10件、推論2件、ローカル開発7件の合計32件が成功した。実ブラウザログインとsmokeの推論成功も確認した。

Git管理対象のテキストは`.gitattributes`でLFへ固定した。未追跡を含む候補132件を検査し、テキスト130件はすでにLFのみ、画像2件はバイナリとして除外された。正規化後にも全品質ゲートが成功した。

mypyからty 0.0.63への移行では、`ty.toml`へPython 3.12と厳格化ルールを固定し、Ruffの型注釈ルールでmypy strictの注釈要求を維持した。mypy本体と専用依存、設定、Docker除外、仮想環境の関連パッケージ、約7.5MBの`.mypy_cache`を削除した。frozen依存導入、`mise tasks validate`、`mise run check`が成功し、最終ゲートでは合計32件のテスト、全workspace build、CDK synthが成功した。

M14では`cdk-nag` 2.38.2を固定し、`AwsSolutionsChecks`の未抑制finding 0件を品質ゲートへ追加した。指摘を起点にWorkflow起動境界、失敗メトリクス、timeout分類、IAM最小化、S3署名付きPOST、Reaperページング、access token限定、API throttle、アクセスログ、PITR、通知付きアラームを修正した。最終`mise run check`ではAPI/Web 21件、CDK 12件、推論2件、ローカル7件の合計42件が成功し、stubコンテナbuildとFloci E2Eも完走した。AWS devでの実Stream配信、JWT Authorizer、IAM評価、CloudFront/OAC、実Lambda性能、timeout注入は未確認である。

M15ではmise公開タスクを12件へ限定し、format check、lint、型検査、単体テスト、build、CDK synth、cdk-nagを`check`へ内包した。Flociの低レベル操作はPythonへ移し、`e2e-local`で環境準備、smoke、Basic/Standard上限、503、二重Finalize、Reaper、cleanupまで完走した。最終`mise run check`ではAPI/Web 21件、CDK 12件、推論2件、ローカル9件の合計44件が成功した。

更新メモ: 2026-07-24にFloci日常開発用の統合miseタスク、Floci UI常時起動、汎用画像推論デモ化、Cognitoブラウザログイン修正、LF固定、ty移行、M14セキュリティ・信頼性是正、M15 mise公開タスク整理、実測結果、再デプロイ分離方針を反映した。
