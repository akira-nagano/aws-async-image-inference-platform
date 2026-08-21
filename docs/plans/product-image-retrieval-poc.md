# 商品画像から型番候補を検索するカタログ検索PoC

このExecPlanは生きた文書である。
作業中は `進捗 (Progress)`、`発見事項 (Surprises & Discoveries)`、`決定ログ (Decision Log)`、`完了結果 (Outcomes & Retrospective)` を更新する。

この計画はリポジトリルートの `PLANS.md` に従って維持する。

## 目的と利用者価値

利用者が単一の商品画像をアップロードすると、登録済み商品カタログから画像が近い商品を検索し、商品名、ブランド、型番またはSKU、類似度を上位3件まで確認できるようにする。
現在のハッシュ値から生成する `DEMO-###` は画像内容と無関係であるため、実際の「商品画像から型番候補を絞る」利用感を示せない。
このPoCでは学習を行わず、事前学習済み画像エンコーダーで参照画像と入力画像を同じベクトル空間へ変換し、登録済みカタログだけを検索する。

利用者が確認できる完成状態は、カタログ内の商品画像に対して対応する商品情報が上位候補へ現れ、カタログ外画像では類似度しきい値により候補なしを返せる状態である。
型番を言語モデルに生成させず、必ず索引に存在する `productCode` だけを返す。

## 対象範囲

推論サービスへ非本番用の `catalog` モデルプロファイルを追加する。
`catalog` はDINOv2-smallで入力画像の埋め込みを生成し、正規化済み参照ベクトルとのコサイン類似度で商品を順位付けする。
複数の参照画像がある商品は、最も高い参照画像スコアを商品スコアとして集約する。

再現可能な商品カタログ索引を作るスクリプト、索引形式、モデル取得手順を追加する。
公開データと学習済み重みはGitへ追加せず、固定した配布元、revision、検証情報を使って `services/inference/model-runtime/` に準備する。
テストでは外部ダウンロードを必要としない小さなベクトルfixtureを使う。

APIの既存 `Prediction` に任意の `productName` と `brand` を追加する。
`productCode` と `confidence` は後方互換を維持し、`confidence` は校正済み確率ではなく0から1に正規化した検索スコアとして文書化する。
候補なしはJob成功かつ空の `predictions` とし、UIに該当商品なしと表示する。

CDK Contextから `stub` または `catalog` を選べるようにする。
CI、Floci、通常のsynthは重いモデル成果物を必要としない `stub` を既定に保つ。
AWS開発環境の標準デプロイは、商品画像検索を確認できる `catalog` を必ず選択する。
`real` は利用者提供モデル用の未実装接続点として維持し、このPoCを本番モデル扱いしない。

## 対象外

モデルの追加学習、微調整、OCR、バーコード読取、画像内の複数商品の検出、商品領域の切り出しは対象外とする。
商品マスターを利用者がWebから登録する管理画面、ベクトルデータベース、カタログのオンライン更新は対象外とする。
ABO全量の配布、公開データ画像やモデル重みのGit管理、商用利用可否の判断は対象外とする。
検索スコアを確率として校正する作業と、未知商品のしきい値を本番精度へ調整する作業は対象外とする。

## 現状調査

`services/inference/app/stub_model.py` は画像バイト列のSHA-256から3件の `DEMO-###` とスコアを決定し、画像内容を解析しない。
`services/inference/app/model_factory.py` は `stub` と未実装の `real` だけを選択できる。
推論Lambdaはコンテナイメージ、x86_64、既定3008 MBであり、`MODEL_PROFILE=stub` が固定されている。

APIとDynamoDBの予測契約は `rank`、`productCode`、`confidence` だけである。
Web UIもこの3項目だけを表示する。
推論結果は非同期Jobの終端処理で保存されるため、商品メタデータを追加しても受付、同時実行枠、解放の状態機械は変更しない。

Amazon Berkeley Objectsは商品listing metadataと複数のカタログ画像を提供するため、30商品程度の参照カタログ作成候補になる。
AWS Open Data RegistryはCC BY-NC 4.0と表示するが、公式バケット内のREADMEと`LICENSE-CC-BY-4.0.txt`はCC BY 4.0を指定している。
データ利用時は公式バケット内のライセンスを基準とし、Amazon.comとABO著者への帰属表示を行う。

DINOv2のコードと標準モデル重みは公式リポジトリでApache 2.0として公開され、DINOv2-smallは画像埋め込み取得に利用できる。
Lambdaへ組み込む前に、コンテナサイズ、cold start、モデルロード時間、最大RSSを実測する必要がある。

## アーキテクチャ上の制約

既存の非同期契約、Tier同時実行制御、原子的な枠確保、終端時の冪等な枠解放は変更しない。
推論結果は認証済みJob所有者だけが取得できる既存境界を維持する。
入力画像、JWT、個人情報、埋め込みベクトルをCloudWatchへ出力しない。

モデルと索引はモジュール初期化時に一度だけロードし、warm invocationで再利用する。
索引ベクトルはL2正規化済みとして保存し、ロード時に次元、有限値、正規化、商品ID参照整合性を検証する。
不正なモデル成果物や索引はfail closedで初期化を失敗させる。

商品コード、商品名、ブランドは長さを制限し、DynamoDBへ保存する前に予測契約へ変換する。
外部画像URLや署名付きURLは予測結果へ保存しない。

## 実装方針

`CatalogRetrievalModelAdapter` は画像エンコーダーとカタログ索引を依存として受け取る。
検索計算はNumPyだけへ分離し、単体テストでは固定ベクトルを与える。
DINOv2のロードと画像前処理は別クラスへ分離し、モデル成果物がない通常テストでimportしない。

索引は商品メタデータと正規化済み参照ベクトルを含む単一JSONで構成する。
メタデータはschema version、model ID、model revision、embedding dimension、商品情報、各参照ベクトルの商品参照、しきい値を持つ。
ベクトルは生成時に `float32` で計算し、行単位L2正規化済みの数値配列としてJSONへ保存する。
ビルドスクリプトは参照画像manifestを読み、同じDINOv2モデルで埋め込みを生成して原子的に出力する。

ABO補助スクリプトはlisting metadataと画像metadataから、型番相当フィールドと複数画像を持つ商品を抽出する。
30商品を既定上限とし、選択結果をmanifestへ固定できるようにする。
ダウンロード前に配布物のLICENSEを表示・確認し、画像とmetadataはGit管理外へ置く。

APIは任意の商品名とブランドを検証して保存する。
Webは商品名を主表示、ブランドと型番を補助表示し、空配列を「該当商品なし」と表示する。
既存stubの表示と既存レスポンスは壊さない。

## マイルストーン

最初のマイルストーンで、カタログ索引schema、コサイン検索、商品単位の集約、上位件数、未知商品しきい値を実装し、外部依存なしの単体テストを通す。

次のマイルストーンで、DINOv2-smallの固定revision取得、参照画像manifestからの索引作成、`catalog` プロファイルを実装する。
小さなローカル画像集合で索引を作り、既知画像と未知画像の検索結果を確認する。

次のマイルストーンで、API、DynamoDB保存、Web UI、CDK Contextを後方互換のまま拡張する。
API仕様、データモデル、モデル統合、テスト戦略を同時更新する。

最後のマイルストーンで品質ゲート、CDK synth、Docker buildを実行する。
モデル成果物を含むイメージのサイズ、ロード時間、単一推論時間、最大RSSを記録し、AWS devへ適用できるか判断する。
Flociは既定stub経路の回帰を確認する。

## 具体的な変更ファイル

`services/inference/app/` に索引型、検索コア、DINOv2エンコーダー、catalog adapterを追加し、factoryと型を更新する。
`services/inference/tests/` に索引検証、順位付け、商品集約、未知商品、factoryのテストを追加する。
`services/inference/Dockerfile` と `requirements-catalog.txt` に、catalog実行環境と索引ビルドに必要な固定versionを追加する。

`scripts/` にモデル取得、ABO subset準備、商品索引作成のスクリプトを追加する。
`services/inference/model-runtime/manifest.example.json` を実際の成果物契約に合わせる。

`services/api/src/shared/types.ts`、`services/api/src/shared/job-lifecycle.ts` と対応テストを更新する。
`apps/web/src/api.ts`、`apps/web/src/App.tsx`、スタイルと対応テストを更新する。
`infra/cdk/lib/config.ts`、`infra/cdk/lib/platform-stack.ts`、CDKテストを更新する。

README、`docs/03_async_workflow.md`、`docs/04_api_specification.md`、`docs/05_data_model.md`、`docs/10_test_strategy.md`、`docs/11_model_integration.md`、`docs/12_risks_and_open_questions.md` を更新する。

## データ移行・互換性

既存Jobの予測要素には商品名とブランドがないため、両属性は任意とする。
既存stubは従来どおり3件の `DEMO-###` を返し、APIとWebは両形式を扱う。
DynamoDB tableの再作成や既存項目の移行は不要である。

CDK Context未指定時は `stub` を選択する。
リポジトリが提供するAWS開発環境のデプロイ入口は `catalog` を明示し、Context未指定時のfallbackへ依存しない。
`catalog` を選択したDocker buildは必要なモデルと索引が存在しない場合に明確なエラーで停止する。
Flociの標準開発環境とE2Eはstubを使い続ける。

## テスト計画

検索コアは、同一ベクトルが1位になること、複数参照画像を商品単位へ集約すること、順位が安定すること、上位件数を守ること、しきい値未満で空配列になることを確認する。
索引ローダーはschema version、次元不一致、非有限値、未知の商品参照、非正規化ベクトルを拒否することを確認する。

APIテストは任意の商品メタデータが保存され、従来形式も保存でき、長すぎる値が拒否または安全に切り詰められることを確認する。
Webテストは新表示と候補なし表示を確認する。
CDKテストは既定 `stub`、明示 `catalog`、不正プロファイル拒否を確認する。

全体確認では次を実行する。

    mise run format-check
    mise run lint
    mise run typecheck
    mise run test
    mise run build
    mise run synth

Floci結合へ影響した場合は次も実行する。

    mise run floci-up
    mise run deploy-local
    mise run smoke-local
    mise run integration-local

## ローカル確認手順

作業ディレクトリを `C:\projects\lambda-async-inference-cdk-floci-starter` とする。
まず取得スクリプトで固定revisionのDINOv2-smallを `services/inference/model-runtime/` へ配置する。
次に30商品以下の参照画像manifestを準備し、索引ビルドスクリプトでmetadataとベクトルを生成する。
推論単体コマンドで既知画像を入力し、期待する型番が上位へ現れることを確認する。

通常の `mise run check` は外部モデル成果物なしで完走できなければならない。
catalog成果物を使う検証は明示的なコマンドとしてREADMEへ記載し、通常タスクを増やさない。

## AWS確認手順

Docker buildでcatalog成果物を含むイメージを作成し、サイズがLambdaコンテナ上限内であることを確認する。
ローカルコンテナで初期化時間、推論時間、最大RSSを測定する。
3008 MBの現行アカウント制約で余裕があると確認できた場合だけ、`inferenceModelProfile=catalog` を指定したCDK diffを確認する。

AWS devへ適用する場合は、既知商品画像をS3へアップロードし、Jobが `SUCCEEDED`、予測が登録済み型番だけ、Job終端後のユーザー枠とシステム枠が0へ戻ることを確認する。
検証用画像と一時Jobは確認後に削除する。

## リスクと緩和策

DINOv2とPyTorchはstubよりコンテナサイズとcold startが大きい。
依存versionとモデルrevisionを固定し、モデルロードを初期化時だけ行い、実測が3008 MBへ収まらない場合はONNX Runtimeへの変換を次の判断点とする。

商品画像埋め込みだけでは、外観が同じ色違い、容量違い、世代違いの型番を区別できない場合がある。
PoCは候補検索として表現し、将来はOCR、バーコード、商品属性による再ランキングを追加できる境界を保つ。

未知商品しきい値はデータセット依存であり、任意の値を本番保証に使えない。
検証用既知画像と未知画像で分布を記録し、しきい値をcatalog metadataへ明示する。

ABOのライセンス表記が配布ページ間で一致しない。
配布物内のLICENSEを取得時に確認し、解消するまでデモ・評価用途に限定し、ABO画像をリポジトリやデプロイ成果物へ同梱しない。

## 進捗 (Progress)

- [x] (2026-07-24 JST) 現行stub、model factory、Lambda構成、API保存契約、Web表示を調査した。
- [x] (2026-07-24 JST) 商品型番は生成ではなく登録カタログ検索とし、学習なしの画像埋め込み検索を採用した。
- [x] (2026-07-24 JST) DINOv2-smallとABOの公式配布情報を調査した。
- [x] (2026-07-24 JST) ABOのライセンス表記不一致をリスクとして記録した。
- [x] (2026-07-24 JST) カタログ索引schema、検索コア、単体テストを実装した。
- [x] (2026-07-24 JST) DINOv2取得、索引作成、catalog adapterを実装した。
- [x] (2026-07-24 JST) ABO先頭30商品の初回評価でtop-1 13/30を測定し、商品カテゴリの偏りを特定した。
- [x] (2026-07-24 JST) 25カテゴリの30商品へ多様化し、参照3枚、評価1枚で受理top-1 19/30、順位top-1 22/30、未知画像棄却を確認した。
- [x] (2026-07-24 JST) API、Web、CDK、設計書を更新した。
- [x] (2026-07-24 JST) ローカルと3008 MiB制限付きLinuxコンテナで初期化時間、推論時間、RSSを測定した。
- [x] (2026-07-24 JST) stub 190.3 MBとcatalog 617.2 MBをビルドし、stubへモデル成果物が混入しないことを確認した。
- [x] (2026-07-24 JST) 最終索引 `catalog-dinov2-small-ce240318187c` を生成し、catalog Dockerの重みSHA-256と索引schemaをビルド時に検証した。
- [x] (2026-07-24 JST) 3008 MiB制限付きcatalog Dockerで既知商品画像を検索し、登録済み型番を1位で取得した。
- [x] (2026-07-24 JST) Flociへ最新stub構成を再作成し、BasicとStandardの同時実行上限、二重解放、reaper、503、カウンター0復帰を確認した。
- [x] (2026-07-24 JST) 最終の `mise run check` でformat、lint、型検査、全テスト、build、cdk-nag付きsynthを完走した。
- [x] (2026-07-24 JST) `git diff --check` を通し、モデル重み、生成索引、ABOデータがignoreされ追跡対象外であることを確認した。
- [x] (2026-07-24 JST) 実AWSの推論Lambdaが `MODEL_PROFILE=stub` のまま残っていることを確認した。
- [x] (2026-07-24 JST) AWS devのデプロイ入口を `catalog`、Flociとcdk-nagを `stub` へ固定した。
- [x] (2026-07-24 JST) GitHub Actionsの手動deployでcatalog成果物を生成する手順を追加した。
- [x] (2026-07-24 JST) デプロイ入口の回帰テスト、品質ゲート、catalogとstubのCDK synthを実行した。
- [x] (2026-07-24 JST) Flociの孤立IAMをローカルに限定して除去し、stubのFresh deployとE2Eを完走した。

## 決定ログ (Decision Log)

- Decision: 型番はモデルに生成させず、登録済みカタログの最近傍検索結果だけを返す。
  Rationale: 商品画像だけから任意の正確な型番を生成することはできず、誤った未登録型番を返さないため。
  Date/Author: 2026-07-24 / Codex

- Decision: 最初のPoCは追加学習せず、DINOv2-smallの画像埋め込みを使う。
  Rationale: 30商品程度なら参照画像の索引作成だけで開始でき、データ準備と学習時間を抑えながら検索品質を評価できるため。
  Date/Author: 2026-07-24 / Codex

- Decision: `catalog` を非本番デモプロファイルとして追加し、`stub` と未実装の `real` を維持する。
  Rationale: 公開データと汎用事前学習モデルによるPoCを、利用者提供の本番モデル接続点と混同しないため。
  Date/Author: 2026-07-24 / Codex

- Decision: 通常CIとFlociはstubを既定にする。
  Rationale: モデル重みと公開画像の外部取得を、再現性の高い通常品質ゲートの前提にしないため。
  Date/Author: 2026-07-24 / Codex

- Decision: AWS開発環境の標準デプロイ入口は `catalog` を明示し、`stub` はFloci、CI、インフラだけの疎通確認に限定する。
  Rationale: AWS開発環境は実サービス上で商品画像検索を確認する基準環境であり、画像内容を解析しない架空結果を標準配信する理由がないため。
  Date/Author: 2026-07-24 / Codex

- Decision: ABOは公式バケット内のREADMEとLICENSEが指定するCC BY 4.0として扱う。
  Rationale: データと同じ配布物に含まれる一次資料がライセンス本文と帰属条件を明示しているため。
  Date/Author: 2026-07-24 / Codex

- Decision: デモ索引の類似度しきい値は0.45とする。
  Rationale: 0.40は未知画像を棄却できたが正解受理数を増やさず、誤候補の受理だけを増やしたため。
  Date/Author: 2026-07-24 / Codex

## 発見事項 (Surprises & Discoveries)

- Observation: 現行stubのスコアと商品コードは画像内容ではなくSHA-256だけから生成される。
  Evidence: `services/inference/app/stub_model.py` はdigest byteからスコアを作り、別byteから `DEMO-###` を作る。

- Observation: 商品メタデータ追加は同時実行制御やJob状態遷移を変更せず実装できる。
  Evidence: 推論結果は終端処理の `predictions` 属性だけへ保存され、枠解放transactionは予測要素の構造に依存しない。

- Observation: ABOのライセンス表記が公式配布面で一致しない。
  Evidence: Registry of Open Data on AWSはCC BY-NC 4.0と表示するが、公式S3バケットのREADMEと`LICENSE-CC-BY-4.0.txt`はCC BY 4.0を指定する。

- Observation: ABO listing metadataの16分割名は10進数ではなく16進数である。
  Evidence: 公式S3バケットは`listings_0.json.gz`から`listings_f.json.gz`を列挙する。

- Observation: ABO metadataの先頭から単純に30商品を選ぶと、靴の色違いと共通の補助画像へ偏った。
  Evidence: 参照2枚、評価1枚、しきい値0.55の初回評価はtop-1 13/30であり、複数商品が同じサイズ表画像を共有していた。

- Observation: ABOの実metadataでは`product_type`が文字列ではなく、`value`を持つ要素のListである。
  Evidence: `listings_0.json.gz`の対象行は`[{"value":"SHOES"}]`や`[{"value":"CELLULAR_PHONE_CASE"}]`を保持していた。

- Observation: 商品カテゴリ当たり2件へ制限すると、30商品が25カテゴリへ分散した。
  Evidence: 参照3枚と未使用評価1枚の再評価は、しきい値0.45で19/30、しきい値なしの順位で22/30となり、カタログ外の汎用サンプル画像は棄却された。

- Observation: 現行AWSアカウントのLambdaメモリ上限は3008 MBである。
  Evidence: 既存のCognito移行ExecPlanに、10240 MB指定の実deployがLambda APIで拒否された記録がある。

- Observation: FlociはCloudFormationスタック削除後もIAMロールと管理ポリシーを残す場合があり、同じ論理IDのFresh deployが `already exists` で失敗した。
  Evidence: `AsyncImageInference-local` の再作成時に `JobStatusFunctionRoleDefaultPolicyE6F7AC4D already exists` でロールバックし、ローカル専用の孤立IAMを除去した後は `CREATE_COMPLETE` になった。

- Observation: CDKテストはCommonJSへコンパイルされるため、`import.meta.url`でpackage metadataを読むテストはTypeScriptエラーになった。
  Evidence: 初回テストがTS1470で失敗し、コンパイル後の`__dirname`から`package.json`を解決する方式へ変更すると21テストが合格した。

## 完了結果 (Outcomes & Retrospective)

30商品、25カテゴリ、商品当たり参照3枚、評価1枚のABO subsetで、しきい値適用後のtop-1は19/30、しきい値なしの順位top-1は22/30となった。
汎用サンプル画像は最大類似度0.247782で棄却され、候補なしになった。

最終catalog Dockerイメージは617,151,992 bytes、stub Dockerイメージは190,350,420 bytesとなった。
3008 MiB制限付きLinuxコンテナで、初期化7.962秒、単一推論638.572 ms、最大RSS 463.5 MiBを確認した。
同じ既知画像は型番 `12-05-04` を類似度0.571438で1位に返した。
stubイメージの `/opt/model` は `.gitkeep` だけであり、モデル重みと索引は混入していない。

Flociの標準開発環境とE2Eは既定のstubで完走した。
`catalog` の実AWSデプロイは行っておらず、CDK Context、Docker成果物、3008 MiB内のローカル実測までをAWS適用可否の判断材料とした。
最終 `mise run check` は、WebとAPIの29テスト、CDKの20テスト、推論の8テスト、ローカルの10テスト、build、cdk-nag付きsynthを含めて完走した。
`git diff --check` は問題なく、DINOv2重み、生成索引、ABOデータは既存ignore規則により追跡対象外である。
本PoCで計画したローカル実装と検証は完了した。
AWS開発環境の`deploy-dev`はcatalogを明示し、Flociの`deploy:local`とcdk-nag付きsynthはstubを明示する。
GitHub Actionsの手動deployは、Git管理外のDINOv2モデルとABO catalog索引を実行時に生成する。
catalog指定のsynthではLambda環境変数とDocker build引数がcatalogになり、最終`mise run check`のcdk-nag成果物では両方がstubになった。
更新後の品質ゲートは、WebとAPIの29テスト、CDKの21テスト、推論の8テスト、ローカルの10テスト、build、cdk-nag付きsynthを含めて完走した。
Flociは既知の更新制限で一度ロールバックしたが、ローカル専用スタックと孤立IAMを除去したFresh deployは成功し、E2Eも全項目を通過した。
実AWSはこの変更ではデプロイしていないため、次のAWS deployまで既存のstubで動作する。

更新メモ: 2026-07-24に、30商品程度の汎用商品画像検索PoCとして計画を作成した。
更新メモ: 2026-07-24に、AWS devはcatalog、FlociとCIはstubを明示する方針へ更新した。
