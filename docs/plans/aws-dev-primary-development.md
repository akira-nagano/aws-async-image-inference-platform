# AWS開発環境を基準にした開発フロー

このExecPlanは生きた文書である。作業中は `進捗 (Progress)`、`発見事項 (Surprises & Discoveries)`、`決定ログ (Decision Log)`、`完了結果 (Outcomes & Retrospective)` を更新する。

この計画はリポジトリルートの `PLANS.md` に従って維持する。

## 目的と利用者価値

AWS開発環境を通常の統合確認先とし、Flociは高速なローカル確認、オフライン作業、障害系結合試験に限定した補助環境として扱う。
変更後は、開発者が `mise run deploy-dev` と `mise run deploy-web` を順に実行すると、AWS Stackの出力から生成された実AWS用Web設定が配信され、手元のFloci用設定がAWSへ混入しない。
READMEと設計書から、どの確認をAWSとFlociのどちらで行うべきか判断できる。

2026-07-24の容量契約強化フェーズでは、受付上限とLambda実行容量を別々に指定できる構成を廃止する。
開発者は共有枠または予約枠という容量モードを選び、予約枠を使う場合のLambda Reserved Concurrencyは受付上限から導出する。
AWSへのデプロイ前には対象リージョンのLambdaアカウント設定を読み、共有枠では受付上限と制御系Lambda用余白を同時に満たせない構成を拒否する。
これにより、CDK synthには成功しても受付済みJobがLambda容量不足で滞留する、またはCloudFormationがReserved Concurrencyの制約で失敗する構成を正規のデプロイ経路から排除する。

## 対象範囲

Webデプロイ時のruntime config生成、AWS開発環境とFlociの責務分担、概算費用と費用監視方針、容量設定モデル、AWSデプロイ前後検証、日次利用量ガードレール、入力検証、無料枠内の監視、Web防御、サプライチェーン固定、関連する単体・結合テストを対象とする。
容量契約強化と追加ガードレールではCDK Stack、デプロイ入口、APIエラー契約、既存ConcurrencyテーブルのItem種別、最小権限IAMを同時に変更するが、非同期状態遷移と実モデルの接続点は変更しない。

## 対象外

GitHub ActionsのAWS資格情報追加、Flociタスクの削除、実モデル統合、本番費用見積りは対象外とする。
Floci結合試験はAWS資格情報を使わず障害系を再現できるため、PR CIに残す。
WAF、Bot Control、CloudWatch Synthetics、Inspector、Secrets Manager、新しいQueueやTableなど、固定費または構成費を増やす対策は対象外とする。
BudgetとCost Anomaly DetectionのAWS上での作成は通知先メールアドレスとユーザーの明示指示が必要なため、手順の文書化までを対象とする。

## 現状調査

`README.md` と `docs/07_floci_local_development.md` はFlociを日常開発環境と記載している。`docs/10_test_strategy.md` はFloci結合とAWS devの検証対象を分けているが、どちらが基準環境か明示していない。

`mise run deploy-web` は `scripts/deploy-web.ts` を実行する。移行前のスクリプトはWebを先にbuildしていたが、AWS CloudFormation Stack出力から `apps/web/public/config.json` を生成していなかった。このファイルはGit管理外であり、直前に `mise run dev-local` を使った場合はFloci endpointと `localAuthBypass=true` を含む。そのままAWS用Webへ混入する可能性があった。

`scripts/generate-web-config.py` は、出力キーを値へ対応付けたJSONオブジェクトから実AWS用またはFloci用設定を生成する。AWS CLIの `describe-stacks --query 'Stacks[0].Outputs' --output json` は `OutputKey` と `OutputValue` を持つ配列を返すため、現在の生成スクリプトへそのまま渡せない。

## アーキテクチャ上の制約

実JWT Authorizer、DynamoDB Streams Event Source Mapping、IAM評価、CloudFront/OAC、AWS Lambdaの性能はAWSでのみ正しく確認できる。Floci 1.5.33はJWT claims伝播とDynamoDB Streams作成に差異があり、ローカル限定認証ヘッダーとDispatcher直接呼び出しを使う。この差異をAWS向け設定やコードへ混入させない。

Web runtime configはbuild前に生成する。AWS用設定では `apiBaseUrl=/api`、`localAuthBypass=false` とし、`cognitoEndpoint`を出力しない。Floci用設定生成は既存の `local/export-stack-outputs.sh` から引き続き同じ生成スクリプトを使用する。

## 実装方針

`scripts/generate-web-config.py` が従来のJSONオブジェクトに加え、CloudFormationのOutputs配列を正規化できるようにする。`scripts/deploy-web.ts` は対象StackのOutputs配列を一時ファイルへ取得し、AWS用 `apps/web/public/config.json` を生成してからWebをbuildする。一時ファイルは終了時に削除する。

`local/tests/test_generate_web_config.py` にCloudFormation配列形式からAWS用設定を生成する回帰テストを追加する。既存のFloci用設定テストは維持し、ローカル経路との互換性を保証する。

`README.md`、`docs/07_floci_local_development.md`、`docs/08_cdk_and_deployment.md`、`docs/10_test_strategy.md`、`docs/06_security.md` を最小限更新する。AWS devを基準環境とし、Floci使用時はFloci UIを常に起動する既存挙動を維持する。費用は現在のstub・単一dev Stack・軽量利用では月1米ドル未満を運用目安とし、無料枠が同一アカウントの他用途に消費される点と実績確認方法を明記する。`docs/REFERENCES.md`には再評価時に参照するAWS公式料金ページを記録する。

容量設定は `capacityMode=shared|reserved` と `systemConcurrencyLimit` の二要素で表す。
制御系Lambda用余白はアーキテクチャ定数6として導出し、利用者が安全根拠なしに下げられないようにする。
`shared`では推論LambdaへReserved Concurrencyを設定せず、必要共有枠を `systemConcurrencyLimit + 6` とする。
`reserved`では推論LambdaのReserved Concurrencyを `systemConcurrencyLimit` と同値で導出し、独立した数値を受け付けない。
廃止した `inferenceReservedConcurrency` がContextへ渡された場合は移行メッセージ付きで失敗させ、見かけ上無視された設定を残さない。

`mise run deploy-dev` が呼ぶCDK packageのデプロイスクリプトは、CDK deployより先にLambda `GetAccountSettings`を実行する。
`shared`では現在の `UnreservedConcurrentExecutions` が必要共有枠以上であることを検査する。
`reserved`ではアカウント全体の同時実行quotaから導出済み予約枠を引いて、AWSが要求する未予約枠10以上が残ることを検査する。
検査処理の計算部分は副作用のない関数としてCDK単体テストから検証し、AWS CLI実行部分だけをデプロイ入口に置く。
Flociのローカルデプロイでは実AWS quotaを照会しないが、同じ静的容量契約を使用する。

## マイルストーン

最初のマイルストーンでAWS Webデプロイの設定混入を防止する。生成スクリプトとデプロイスクリプトを変更し、CloudFormation配列形式のテストが通ることで確認する。

次のマイルストーンで開発環境の責務分担を文書化する。READMEから通常フローを辿れ、Flociガイドとテスト戦略が同じ方針を示すことを確認する。

最後のマイルストーンでフォーマット、lint、型検査、テスト、build、CDK synth、cdk-nagを含む `mise run check` を実行する。
実AWSデプロイはユーザーの明示指示後に実行し、preflight、post-deploy検証、Web配信、実JWTを使った非同期Jobを確認する。

容量契約強化フェーズの最初のマイルストーンで、予約枠の数値を受付上限から導出する設定モデルへ移行する。
CDKテストで共有枠はReserved Concurrencyを持たず、予約枠は受付上限と同じReserved Concurrencyを持つことを確認する。

次のマイルストーンでAWSデプロイ前検証を追加する。
実AWSから得たアカウント設定のfixtureに対し、共有枠の不足、予約後の未予約枠不足、ちょうど境界の構成を単体テストする。

最後のマイルストーンでAWS devの既定値を、現在の同時実行quota 10に対して受付4、制御系余白6へ変更する。
`mise run check`とFloci結合試験を実行し、実AWSへのデプロイはユーザーから別途指示された場合だけ行う。

追加固定費のないガードレールマイルストーンでは、既存ConcurrencyテーブルへUTC日単位のユーザー別とシステム別利用量Itemを追加する。
Job作成は同時実行枠、日次Job枠、Job本体を一つのDynamoDBトランザクションで確保する。
アップロードURLは日次発行件数と申告バイト量を発行前に予約し、未使用URLも保守的に消費済みとして扱う。

入力防御マイルストーンでは、最大アップロードを5MiB、S3入力保持を1日に下げる。
推論Lambdaはモデル呼出し前にPillowでJPEGまたはPNGを実デコードし、最大辺4096と最大16,777,216画素を検証する。
Flociのsmokeと結合試験は偽のJPEGバイト列をやめ、リポジトリのサンプルPNGを使用する。

運用とWeb防御マイルストーンでは、LambdaエラーとJobタイムアウトを含めてCloudWatch Alarmを無料枠内の10個にする。
CloudFrontへCSP、HSTS、frame拒否、MIME sniffing拒否、Referrer Policy、Permissions Policyを追加する。
Cognito管理scopeを削除し、利用していないRefresh TokenをWeb sessionへ保存しない。

サプライチェーンマイルストーンでは、Bun直接依存、GitHub Actions、Lambda base imageを不変なversionまたはdigestへ固定する。
CIはBun auditとTrivyのHigh/Critical検査を実行する。
CDKはこのversionで推奨されるうち本構成に関係する安全側feature flagを明示する。

## 具体的な変更ファイル

`scripts/generate-web-config.py` にCloudFormation Outputs配列の正規化処理を追加する。`scripts/deploy-web.ts` にStack出力取得とruntime config生成を追加する。`local/tests/test_generate_web_config.py` に回帰テストを追加する。`mise.toml` の既存 `check` タスクへ設定生成スクリプトのRuffとty検査を追加する。公開miseタスクは増やさない。

`README.md` はAWS devを通常の統合確認先として先に説明する。`docs/07_floci_local_development.md` はFlociを任意の補助環境として説明する。`docs/08_cdk_and_deployment.md` は環境方針、AWSデプロイ手順、概算費用を記録する。`docs/10_test_strategy.md` はAWS devを基準統合層、Flociを補助結合層と定義する。`docs/06_security.md` はローカル認証バイパスをFloci利用時だけの仕組みとして表現する。`docs/REFERENCES.md`へAWS公式料金ページを追加する。`docs/README.md` から本計画へ到達できるようにする。

容量契約強化では `infra/cdk/lib/capacity.ts` を容量設定とAWS quota判定の唯一の実装場所とする。
`infra/cdk/lib/config.ts` はCDK Contextを容量契約へ変換し、`infra/cdk/lib/platform-stack.ts` は導出済みReserved Concurrencyだけを使用する。
`infra/cdk/scripts/preflight-capacity.ts` は同じContextを読み、AWS CLIのLambdaアカウント設定を容量契約へ照合する。
CDK packageの`deploy:dev`はpreflight、deploy、post-deploy検証を順に実行する。
`infra/cdk/test/platform-stack.test.ts` と新しい容量テストは、不整合を作れないことと境界条件を確認する。
`infra/cdk/cdk.json`、`docs/02_concurrency_and_tiers.md`、`docs/08_cdk_and_deployment.md`、READMEは同じ容量契約とAWS devの既定値を示す。
Tier上限はBasic、Standard、Premiumの順に単調増加し、すべてシステム受付上限以下であることを静的に検査する。

## データ移行・互換性

データ移行はない。`--outputs`でJSONオブジェクトを受ける既存インターフェースを維持し、Flociの設定生成とテストを壊さない。AWS Webデプロイ時は既存のGit管理外 `apps/web/public/config.json` をAWS用設定で安全に上書きする。

容量契約強化にもデータ移行はない。
既存のDynamoDBカウンターとJobは変更せず、次回デプロイ以降の新規受付にだけ新しい上限を適用する。
旧Context `inferenceReservedConcurrency` は互換目的で推測変換せず、明示的なエラーにする。
予約枠を使いたい利用者は `capacityMode=reserved` を指定し、受付上限を一つだけ変更する。

日次利用量Itemは既存Concurrencyテーブルへ追加し、既存カウンターとは異なる`USAGE#` prefixを使う。
TTLを設定してUTC日付の8日後に削除可能とするため、既存カウンターとJobの移行は不要である。
旧ItemにTTLがなくても有効であり、次回デプロイ後の新規利用量Itemだけが自動削除対象になる。

## テスト計画

`mise exec -- python -m pytest local/tests/test_generate_web_config.py` で、Floci用設定、従来形式のAWS用設定、CloudFormation配列形式のAWS用設定を確認する。`mise exec -- bun run --cwd services/api tsc -p ../../scripts/tsconfig.json` でBunデプロイスクリプトを型検査する。最後に `mise run check` を実行し、全品質ゲートが成功することを確認する。

容量契約の単体テストでは、`shared`の導出値、`reserved`の導出値、未知のmode、旧Contextの拒否、共有枠の不足、予約後の未予約枠不足、境界値を確認する。
CDK templateテストでは、`shared`にReserved Concurrencyがなく、`reserved`では受付上限と同値になることを確認する。
デプロイスクリプトそのものはAWS CLIを呼ぶため、`--check-only`または計算部分の単体テストで破壊的操作なしに検証する。
最後に `mise run check` と `mise run e2e-local` を実行する。

## ローカル確認手順

リポジトリルート `C:\projects\lambda-async-inference-cdk-floci-starter` で次を実行する。

    mise exec -- python -m pytest local/tests/test_generate_web_config.py
    mise exec -- bun run --cwd services/api tsc -p ../../scripts/tsconfig.json
    mise run check

最初のコマンドは全テストが成功し、2番目は出力なしで終了コード0、最後はformat checkからcdk-nagまで成功することを期待する。

## AWS確認手順

AWS資格情報と対象アカウントが明示された環境では次を実行する。

    mise run deploy-dev
    mise run deploy-web

`apps/web/public/config.json` は `apiBaseUrl` が `/api`、`localAuthBypass` が `false`、`cognitoEndpoint` が未定義になる。
CloudFront URLでWeb UIを開き、Cognitoログイン後のAPI呼び出しがlocalhostやFlociへ向かわないことを確認する。

2026-07-24の確認では、`mise run deploy-dev`と`mise run deploy-web`が成功した。
CloudFront上のマネージドログイン、`tier-basic`、実JWT、署名付きS3 POST、Jobの202受付、DynamoDB StreamsからのDispatcher起動、Step Functions、catalog推論、Jobの`SUCCEEDED`、枠の`RELEASED`まで確認した。
汎用サンプル画像はカタログ外であるため、候補0件を正常結果として確認した。

## リスクと緩和策

CloudFormation Outputs形式の変更に備え、生成スクリプトは配列要素の型と必須キーを検証する。デプロイ途中で失敗してもS3 sync前ならAWS配信物は変わらない。`config.json` はGit管理外なので、ローカルFloci利用時は `mise run dev-local` が再生成できる。

無料枠はAWSアカウント単位で共有される。月1米ドル未満はこのシステム単独で無料枠内に収まる軽量stub利用の運用目安であり、保証値にはしない。CloudWatch、ECR、実モデルのサイズと実行時間は実績値で再評価する。

## 進捗 (Progress)

- [x] (2026-07-24 JST) 現行ドキュメント、miseタスク、Webデプロイスクリプト、設定生成処理を調査した。
- [x] (2026-07-24 JST) AWS devを基準環境、Flociを補助環境とする設計判断を計画へ記録した。
- [x] (2026-07-24 JST) AWS Webデプロイ前のruntime config生成と回帰テストを実装した。
- [x] (2026-07-24 JST) 開発環境方針と概算費用を関連ドキュメントへ反映した。
- [x] (2026-07-24 JST) 対象テスト、シェル構文検査、Ruff、ty、`mise run check`を実行し、すべて成功した。
- [x] (2026-07-24 JST) `mise run e2e-local`を実行し、Floci補助経路の互換性と停止処理を確認した。
- [x] (2026-07-24 JST) サービス別、利用量別、無料枠共有時の詳細な費用試算をデプロイ設計へ追記した。
- [x] (2026-07-24 JST) Lambda実容量と受付上限の不整合を設定モデルの問題として調査し、容量契約強化フェーズを本計画へ追加した。
- [x] (2026-07-24 JST) `shared`と`reserved`から実容量を導出する設定モデルを実装した。
- [x] (2026-07-24 JST) AWS Lambdaアカウントquotaを読むデプロイ前検証、デプロイ後検証、境界テストを実装した。
- [x] (2026-07-24 JST) AWS dev既定値と設計文書を容量契約へ移行した。
- [x] (2026-07-24 JST) 既存DynamoDBへ日次Job、アップロード件数、予約バイト量の原子的ガードレールを実装した。
- [x] (2026-07-24 JST) 実画像検証、入力保持1日、最大5MiBへ移行した。
- [x] (2026-07-24 JST) 無料枠内の監視、CloudFrontセキュリティヘッダー、OAuth scope縮小を実装した。
- [x] (2026-07-24 JST) 直接依存、GitHub Actions、Lambda base imageを固定し、CI auditを追加した。
- [x] (2026-07-24 JST) 全品質ゲートと隔離されたFloci E2Eを実行し、日次上限を含む結果を記録した。
- [x] (2026-07-24 JST) 実AWSの応答形式に合わせて容量preflightのAWS CLI JSON解析を修正し、境界テストを追加した。
- [x] (2026-07-24 JST) AWS devとWebを再デプロイし、容量post-deploy検証、CloudFront設定、Cognitoマネージドログインを確認した。
- [x] (2026-07-24 JST) 実JWTで署名付きS3 POSTからcatalog推論まで実行し、DynamoDB Streams、Step Functions、終端状態、枠解放を確認した。

## 決定ログ (Decision Log)

- Decision: AWS devを通常の統合確認先とし、Flociは高速・オフライン・障害系の補助環境として維持する。
  Rationale: 現行stub構成のAWS費用はほぼ無料枠内であり、Flociでは実JWT、DynamoDB Streams、IAM、CloudFront/OACを忠実に検証できないため。
  Date/Author: 2026-07-24 / Codex

- Decision: Flociの公開miseタスクとPR結合試験は削除しない。
  Rationale: AWS資格情報なしで競合、二重解放、Reaperなどを再現できる価値があり、費用以外の役割が残るため。
  Date/Author: 2026-07-24 / Codex

- Decision: AWS Webデプロイ時にruntime configを必ず再生成する。
  Rationale: Git管理外の同一ファイルをFlociとAWSが共有しており、現在はFloci用endpointと認証バイパスをAWSへ配信できてしまうため。
  Date/Author: 2026-07-24 / Codex

- Decision: 開発費用は月1米ドル未満という予算目安だけでなく、前提とサービス別計算を設計書へ残す。
  Rationale: AWSの構成や利用量が変わったとき、元の試算条件との差分から再計算できるようにするため。
  Date/Author: 2026-07-24 / Codex

- Decision: 推論LambdaのReserved Concurrencyを独立した数値Contextとして公開しない。
  Rationale: 受付上限と実行容量を別々に変更できること自体が不整合の原因であり、大小関係の検査だけでは不要な予約や設定漏れを防げないため。
  Date/Author: 2026-07-24 / Codex

- Decision: 共有枠では受付上限に制御系Lambda用余白を加えた値をデプロイ前に実AWS quotaへ照合する。
  Rationale: CDK synthはアカウント固有quotaを知らず、静的検査だけでは共有枠の実容量不足を検出できないため。
  Date/Author: 2026-07-24 / Codex

- Decision: AWS devの初期契約を受付4、制御系余白6、共有枠modeとする。
  Rationale: 現在のap-northeast-1におけるLambda同時実行quota 10を超えず、API、Dispatcher、Finalize、Reaperなどの制御系関数用枠を残すため。
  Date/Author: 2026-07-24 / Codex

- Decision: 制御系余白6はContextにせず、Tier上限はシステム受付上限以下に制約する。
  Rationale: 利用者が余白だけを下げる設定と、Tier契約上は許可されてもシステム全体では到達不能な設定を作れないようにするため。
  Date/Author: 2026-07-24 / Codex

- Decision: 日次Job上限だけを設定し、アップロード件数と予約バイト量はそこから導出する。
  Rationale: 独立した三種類の上限値が互いに到達不能または過大になる設定を避け、未使用URLを含む費用上限を一つの契約から説明できるようにするため。
  Date/Author: 2026-07-24 / Codex

- Decision: 有料の境界防御を追加せず、既存リソースと無料枠内の監視を優先する。
  Rationale: 開発デモの費用方針を維持しながら、自己登録後の乱用、入力偽装、検知漏れという優先度の高い経路を先に閉じるため。
  Date/Author: 2026-07-24 / Codex

- Decision: AWSのJob起動境界にはDynamoDB StreamsとLambda Event Source Mappingを維持する。
  Rationale: Lambdaトリガーが行うStreamの`GetRecords`はDynamoDB Streamsの読み取り課金対象外であり、追加固定費なしでJob作成とWorkflow起動のあいだに永続的な再試行境界を置けるため。
  Date/Author: 2026-07-24 / Codex

## 発見事項 (Surprises & Discoveries)

- Observation: 移行前の`deploy-web`はAWS用runtime configを生成せずにWebをbuildしていた。
  Evidence: `apps/web/public/config.json` は `.gitignore` 対象で、現在の作業環境では `http://localhost:4566` と `localAuthBypass=true` を含む。現行スクリプトはbuildを最初に実行する。

- Observation: tyは、JSONから得た辞書に対する `all(isinstance(...))` 後の `dict(raw_outputs)` を `dict[str, str]` として絞り込まない。
  Evidence: 対象ty検査は `no-matching-overload` を報告した。キーと値を検査しながら新しい文字列辞書へ追加する実装では成功した。

- Observation: 最初の `mise run e2e-local` は呼び出し側の120秒制限を超えた後も子プロセスで停止処理まで継続したため、終了結果を取得できなかった。
  Evidence: Compose状態とプロセスを確認すると `local/stop-floci.py` が実行中で、その後コンテナは削除された。冪等に再実行して終了コード0と全シナリオ成功を取得した。

- Observation: 永続化済みFloci Stackの存在だけでE2Eがdeployを省略すると、旧Lambda環境変数と旧Tableを使って現在のコードを検証してしまう。
  Evidence: 最初の強化後E2Eは旧`maxUploadBytes=15728640`を出力し、新コードのJob transactionが旧リソースに対して`ResourceNotFoundException`になった。既存Stackの強制更新もFlociのIAM Policy再作成制約で失敗した。

- Observation: E2Eを開発用`local/data/`から分離した一時データ領域で実行すれば、現在のソースを新規deployでき、開発状態も破壊しない。
  Evidence: 分離後のE2Eは`maxUploadBytes=5242880`の新規Stackを作成し、推論成功、Tier上限、同時実行503、日次429/503、二重解放、Reaperを完走した。終了後に一時ディレクトリとComposeリソースが残っていないことを確認した。

- Observation: AWS CLI v2の`lambda get-function-concurrency`はReserved Concurrency未設定時に、終了コード0かつ空の標準出力を返す。
  Evidence: 旧preflightは空文字列をJSONとして解析してデプロイ前に停止した。空応答を許可する操作だけ空オブジェクトへ正規化し、他のAWS CLI操作は空応答を引き続き拒否する実装と単体テストを追加した。

- Observation: Lambdaアカウント設定の`UnreservedConcurrentExecutions`は`AccountUsage`ではなく`AccountLimit`に含まれる。
  Evidence: 東京リージョンの実応答は`AccountLimit.ConcurrentExecutions=10`と`AccountLimit.UnreservedConcurrentExecutions=10`を返した。parserのfixtureと実装を実応答へ合わせた。

- Observation: catalog推論の初回E2Eは90秒の待機時間をわずかに超えた。
  Evidence: Job `1cac5896e3f3d46e8b390bf2dae1319c`は2026-07-24 13:39:48 UTCにStep Functionsを開始し、95.6秒後に成功した。Jobは`SUCCEEDED`かつ`RELEASED`、システム枠は0へ戻った。

## 完了結果 (Outcomes & Retrospective)

AWS devを通常の統合確認先、Flociを高速・オフライン・障害系の補助環境とする方針をREADMEと設計書へ反映した。Flociを使う場合にFloci UIを常時起動する既存挙動と、PRでのFloci結合試験は維持した。

`deploy-web`はCloudFormation OutputsをAWS用runtime configへ変換してからWebをbuildするようになり、直前に生成されたFloci用`config.json`をAWSへ配信する経路を閉じた。従来のキー・値JSONとCloudFormation配列JSONの両方を設定生成スクリプトが受け付けるため、Floci経路との互換性も維持している。

検証では、設定生成の対象テスト3件、Bunデプロイスクリプトの型検査、Ruff、tyが成功した。`mise run check`も成功し、Bun 21件、CDK 12件、推論Python 2件、ローカルPython 10件の計45件、全workspace build、CDK synthとcdk-nagが通過した。`mise run e2e-local`は再実行で終了コード0となり、推論成功、Basic/StandardのTier上限、503、二重Finalize、Reaper、枠のゼロ復帰を確認し、FlociコンテナとCompose networkを停止・削除した。

後続のCognitoマネージドログイン作業で、AWS devの`mise run deploy-dev`と`mise run deploy-web`、CloudFront上のログイン、APIスモークまで完了した。
実測結果は`docs/plans/cognito-managed-login.md`へ記録し、残る運用確認は1週間から2週間後のCost Explorer実績である。

費用文書には、月100Jobで0.05米ドルから0.30米ドル、運用予算1米ドル未満、CloudWatch無料枠を別用途で消費済みの場合は5米ドルから7米ドル程度という目安を残した。
Lambda、Step Functions、入力画像保持量、ECRイメージ容量の計算根拠も記録した。

第一弾の固定費なし対策では、`capacityMode`と`systemConcurrencyLimit`を容量契約の入力とし、Reserved Concurrency、共有枠要件、Tier到達可能性を導出または静的拒否する構成へ移行した。
AWS devの既定は共有枠、受付4、制御系余白6であり、デプロイ入口はLambda quotaのpreflightと、Stack状態、実Lambda予約数、メモリ、timeout、モデルprofile、API環境変数のpost-deploy照合を必須にした。

既存ConcurrencyテーブルへUTC日単位のJob件数、アップロードURL件数、予約バイト量を原子的に確保するItemを追加した。
日次Job上限だけを設定値とし、URL件数とバイト量はそこから導出するため、相互に矛盾する上限を作れない。
入力画像は5MiB、保持1日、JPEG/PNG実デコード、最大辺4096、最大16,777,216画素に制限した。
CloudWatch Alarmは10個、CloudFrontセキュリティヘッダー、最小OAuth scope、依存とActionsとbase imageの固定、Bun auditとTrivy CIを追加した。

最終検証では`mise run check`が成功し、Web/API 34件、CDK 32件、推論Python 14件、ローカルPython 10件、全build、CDK synthとcdk-nagが通過した。
`mise run e2e-local`は隔離された一時Floci環境で新規bootstrap/deployから完走し、実画像stub推論、Basic 1、Standard 3、システム受付4、日次Jobとアップロードのユーザー429およびシステム503、二重解放、Reaperを確認した。
固定digestのLambda stub image build、`bun install --frozen-lockfile`、`bun audit --audit-level=high`も成功した。
実AWSでは`poruru` profileで容量preflight、CDK deploy、post-deploy検証、Web deployを完了した。
CloudFrontの設定とセキュリティヘッダー、Cognitoマネージドログイン、`tier-basic`、実JWT Authorizer、署名付きS3 POST、DynamoDB Streams Event Source Mapping、Step Functions、catalog推論、冪等な枠解放を確認した。
確認用入力画像と一時Cognitoユーザーは削除し、成功Jobの記録だけを診断証跡として残した。

更新メモ: 2026-07-24に、AWS devを基準にする方針と、調査中に判明したFloci用Web設定混入リスクを受けて本計画を新規作成した。同日、設定生成、回帰テスト、品質ゲートへの型検査追加、関連文書とAWS公式料金参照の更新、全品質ゲートとFloci E2Eの実測結果を反映した。その後、再計算に必要なサービス別と利用量別の費用内訳を追記した。
同日、受付上限とLambda実容量を独立指定できる不整合を受け、容量モード、導出値、AWSデプロイ前quota検証を追加する強化フェーズへ拡張した。
同日、容量契約、日次利用量、入力検証、無料枠内の監視とWeb防御、サプライチェーン固定を実装し、E2Eを開発用永続データから分離した。全品質ゲートと日次境界を含むFloci E2Eの成功を記録した。
同日、実AWSの応答で判明した容量preflightのJSON解析を修正し、AWS devとWebを再デプロイした。実JWTによる非同期JobでDynamoDB Streamsからcatalog推論と枠解放まで確認し、初回推論が90秒を超え得る実測を反映した。
