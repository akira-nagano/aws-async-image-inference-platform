# Draw.io図面ソース統合

このExecPlanは生きた文書であり、作業の進行、判断、検証結果を継続して更新する。リポジトリ直下の`PLANS.md`に従って維持する。

## 目的と利用者価値

設計図の編集元をDraw.ioへ統一し、役割が重複する全体構成図を一つへ絞る。編集元は`docs/`直下へ散在させず`docs/diagrams/source/`へ集約し、表示用PNG/SVGは`docs/diagrams/`直下へ置く。設計者は構成を確認するときは`imgflow-architecture`、処理順序を確認するときは`sequence-job`を選べばよく、編集元と表示用成果物の対応もパスから判断できる。

## 対象範囲

`docs/imgflow-architecture.drawio`を全体構成の唯一の編集元として`docs/diagrams/source/imgflow-architecture.drawio`へ移動する。手動補正済みの`docs/sequence-job.drawio`は内容を変えず`docs/diagrams/source/sequence-job.drawio`へ移動する。役割が重複する`docs/architecture-lambda.drawio`と表示用`docs/diagrams/architecture-lambda.svg`を削除する。設計書、図面一覧、再生成手順、関連ExecPlanの参照を新しい配置へ更新する。手動補正済みシーケンス図から表示用`docs/diagrams/sequence-job.svg`を再生成する。全体構成図では上部の重なった領域見出しを専用の見出し帯へ移し、表示用`docs/diagrams/imgflow-architecture.png`を再生成する。

## 対象外

保持する2件のDraw.io図面の意味、AWSアーキテクチャ、API、状態遷移、CDK、AWSリソースは変更しない。全体構成図の配置と見出し分割だけを可読性のため変更する。AWS環境へのデプロイまたは破棄は行わない。ユーザーが`docs/sequence-job.drawio`へ加えた手動補正を自動整形で置き換えない。

## 現状調査

DOTからDraw.ioへの形式統一は完了しているが、`docs/architecture-lambda.drawio`と`docs/imgflow-architecture.drawio`はいずれもCloudFront、Cognito、API Gateway、Lambda、DynamoDB、Step Functions、推論、Reaper、CloudWatchまでの同じエンドツーエンド経路を番号付きで説明している。前者はコンポーネント概要、後者は現行CDKデプロイ詳細という名目だが、利用者が図を選ぶための役割差より重複の方が大きい。`docs/sequence-job.drawio`は状態遷移と失敗分岐を時系列で表すため、構成図とは明確に役割が異なる。

現在、`docs/sequence-job.drawio`にはユーザーによる未コミットの手動補正がある。この差分はユーザー所有であり、移動前後のSHA-256を比較して内容が保持されたことを確認する。

## アーキテクチャ上の制約

全体構成は`imgflow-architecture.drawio`だけを正とし、文書はその表示用PNGを参照する。非同期処理は`sequence-job.drawio`だけを正とし、文書はその表示用SVGを参照する。Draw.ioは非圧縮の`mxfile > diagram > mxGraphModel` XML、公式AWS4シェイプ、Helvetica、明暗テーマ対応色を維持する。表示用成果物は編集元から再生成可能でなければならない。

## 実装方針

`docs/diagrams/source/`を編集元専用ディレクトリとして作り、2件の`.drawio`を移す。`docs/diagrams/`直下には文書が直接表示する`.png`と`.svg`だけを置く。移動は内容を変えないファイル操作として行い、特に`sequence-job.drawio`は移動前後のハッシュ一致を合格条件にする。

`docs/DESIGN.md`は重複していた2枚の構成図を1枚へ減らし、`imgflow-architecture.png`だけを全体構成図として掲載する。`docs/03_async_workflow.md`は表示用SVGを維持し、編集元リンクだけを新配置へ変える。`docs/README.md`は新しいディレクトリ規約とDraw.io CLIの再生成コマンドを示す。完了済みExecPlan内の成果物パスも、現在参照可能な場所へ更新する。

全体構成図の`Edge / Web / Authentication`と`Authenticated API`はAWS Cloud上部の専用見出し帯へ置く。上段のFrontend S3とInput S3を見出し帯の下へ移し、`Durable Job Dispatch`はDynamoDBとDispatcherの直上に独立した見出しとして置く。これにより、見出しとS3接続線、サービスラベル、ユーザーからInput S3への直接アップロード線を分離する。

## マイルストーン

第一マイルストーンでは、重複図の役割と全参照を確定し、本ExecPlanへ最終配置を記録する。完了時には、残す図、削除する図、移動先がこの文書だけで判断できる。

第二マイルストーンでは、`docs/diagrams/source/`を作成して2件の編集元を移し、重複する`architecture-lambda`の編集元と表示用SVGを削除する。完了時には、編集元2件と表示用画像2件だけが役割ごとに対応する。

第三マイルストーンでは、設計書、図面一覧、再生成コマンド、関連ExecPlanのパスを更新する。完了時には、削除済みファイルへの現行リンクがなく、新しい編集元をMarkdownから開ける。

第四マイルストーンでは、Draw.io XML、edge参照、手動補正の保持、表示用SVG、リポジトリ全体の検査を行う。完了時には、検証コマンドが成功し、`mise run check`が回帰なしで完了する。

## 具体的な変更ファイル

追加先は`docs/diagrams/source/imgflow-architecture.drawio`と`docs/diagrams/source/sequence-job.drawio`であり、移動元はそれぞれ`docs/imgflow-architecture.drawio`と`docs/sequence-job.drawio`である。`docs/architecture-lambda.drawio`と`docs/diagrams/architecture-lambda.svg`を削除する。`docs/DESIGN.md`、`docs/03_async_workflow.md`、`docs/README.md`、`docs/plans/drawio-source-unification.md`、図面パスを成果物として記載する関連ExecPlanを更新する。`docs/diagrams/sequence-job.svg`は手動補正を反映して再生成し、`docs/diagrams/imgflow-architecture.png`は見出し配置の修正を反映して再生成する。

## データ移行・互換性

実行データの移行はない。表示用`docs/diagrams/imgflow-architecture.png`と`docs/diagrams/sequence-job.svg`のパスは変えないため、GitHubなどDraw.ioを直接表示しない閲覧環境との互換性を保つ。編集元リンクは新配置へ更新する。削除する`architecture-lambda.svg`は`DESIGN.md`から参照を外してから削除する。

## テスト計画

移動前後の`sequence-job.drawio`のSHA-256を比較する。保持する2件を`validate_drawio_bundle.py`で検証し、全edgeのsource/targetが存在するcellを指すことを確認する。Draw.io CLIで`sequence-job.svg`と`imgflow-architecture.png`を再生成し、有効な成果物であることを確認する。PNGのEntry領域とAPI領域を目視し、見出しが線、S3、サービスラベルと重ならないことを確認する。Markdown内に削除済み`architecture-lambda`や旧編集元パスが残っていないこと、`docs/`直下に`.drawio`が残っていないこと、`docs/diagrams/source/`に編集元2件だけがあることを確認する。最後に`git diff --check`と`mise run check`を実行する。

## ローカル確認手順

作業ディレクトリはリポジトリルート`C:\projects\lambda-async-inference-cdk-floci-starter`とする。

    Get-FileHash docs\diagrams\source\sequence-job.drawio -Algorithm SHA256
    mise exec -- uv run ./.agents/skills/aws-architecture-diagram/scripts/validate_drawio_bundle.py ./docs/diagrams/source/imgflow-architecture.drawio
    mise exec -- uv run ./.agents/skills/aws-architecture-diagram/scripts/validate_drawio_bundle.py ./docs/diagrams/source/sequence-job.drawio
    & 'C:\Program Files\draw.io\draw.io.exe' -x -f png -e -b 10 -o docs\diagrams\imgflow-architecture.png docs\diagrams\source\imgflow-architecture.drawio
    & 'C:\Program Files\draw.io\draw.io.exe' -x -f svg -e -b 10 -o docs\diagrams\sequence-job.svg docs\diagrams\source\sequence-job.drawio
    rg -n 'architecture-lambda|docs/imgflow-architecture\.drawio|docs/sequence-job\.drawio' docs/DESIGN.md docs/03_async_workflow.md docs/README.md docs/plans/dispatcher-terminal-failure.md docs/plans/imgflow-rename-and-deploy.md
    Get-ChildItem docs -File -Filter *.drawio
    Get-ChildItem docs\diagrams\source -File
    git diff --check
    mise run check

期待結果は、Draw.io検証2件が成功し、旧パス検索と`docs/`直下のDraw.io検索が0件、編集元ディレクトリに2件、`git diff --check`と`mise run check`が成功することである。

## AWS確認手順

文書と図面配置だけの変更なのでAWS確認は不要である。CloudFormation、CDKテンプレート、デプロイ済みStackへ影響しない。

## リスクと緩和策

最大のリスクはユーザーの手動補正を移動や検証処理で失うことである。移動前にハッシュと一時バックアップを取り、移動後のハッシュ一致を確認する。検証スクリプトが内容を正規化する可能性があるため、必要ならバックアップと比較し、意図しない変更を戻したうえで読み取り専用のXML検査を行う。次のリスクは旧パスの取り残しであり、Markdownに限定した全リテラル検索で防ぐ。表示用成果物の陳腐化は、手動補正後のソースからSVGを再生成して防ぐ。

## 進捗

- [x] 2026-07-27 JST: DOT 2件をDraw.ioへ変換し、元DOTを削除した。
- [x] 2026-07-27 JST: 3件のDraw.ioを比較し、2件の全体構成図が実質的に重複していると確認した。
- [x] 2026-07-27 JST: `imgflow-architecture`を全体構成、`sequence-job`を非同期処理の正として残す方針を決定した。
- [x] 2026-07-27 JST: `docs/diagrams/source/`へ編集元2件を移し、手動補正済み`sequence-job.drawio`のSHA-256一致を確認した。
- [x] 2026-07-27 JST: 重複する`architecture-lambda`の編集元と表示用SVGを削除した。
- [x] 2026-07-27 JST: 設計書、図面一覧、再生成手順、関連ExecPlanの参照を更新した。
- [x] 2026-07-27 JST: 全体構成図の重なった見出しを分割・再配置し、Entry領域とAPI領域をPNGで目視確認した。
- [x] 2026-07-27 JST: Draw.io、PNG/SVG、リンク、差分を検証し、`mise run check`を再実行して全ゲートの成功を確認した。

## 決定ログ

- 2026-07-27: `imgflow-architecture.drawio`を唯一の全体構成図として残す。`architecture-lambda.drawio`より情報が多く、現行CDKデプロイの具体的な構成を保持しているためである。
- 2026-07-27: `sequence-job.drawio`は構成図と異なり、状態遷移と失敗分岐を時系列で示すため残す。
- 2026-07-27: 以前の`docs/*.drawio`配置を廃止し、編集元を`docs/diagrams/source/*.drawio`、表示用成果物を`docs/diagrams/*.{png,svg}`へ分離する。`docs/`直下の管理負荷を下げ、図面関連ファイルを一箇所へまとめるためである。
- 2026-07-27: ユーザーが手動補正した`sequence-job.drawio`は内容を変更せず移動し、そのソースから表示用SVGだけを更新する。
- 2026-07-27: `Authenticated API / Durable Job Dispatch`を`Authenticated API`と`Durable Job Dispatch`へ分割する。前者はAPI Gateway、API Lambda、Input S3の上部、後者はDynamoDBとDispatcherの直上に置き、見出しの意味と配置対象を一致させるためである。

## 発見事項

- `docs/DESIGN.md`は2件の構成図を連続掲載しており、概要と詳細という説明だけでは保守対象を分けられていなかった。
- `docs/sequence-job.drawio`にはユーザーの未コミット手動補正があるため、通常の自動正規化より内容保持を優先する必要がある。
- 完了済みの`docs/plans/dispatcher-terminal-failure.md`と`docs/plans/imgflow-rename-and-deploy.md`にも旧Draw.ioパスが成果物として残っている。
- Windowsサンドボックス補助`codex-windows-sandbox-setup.exe`が見つからず、一部コマンドは許可済みの外側実行が必要になる場合がある。
- 全体構成図の上段S3がAWS Cloud上端から20pxの位置にあり、`section-entry`と`section-api`がS3接続線およびラベルと同じ領域を使っていた。S3を50px下げ、見出しを上端の専用帯へ移すことで重なりを解消できた。
- Draw.io検証がstep badgeを移動するとXML全体を再シリアライズする。検証が示した`step-6`座標だけを局所パッチへ取り込み、バックアップから再適用した結果、`Post-processing: no changes needed`で合格し、差分を17行に限定できた。
- 最初の`mise run check`はユーザーの追加指摘で中断され、CDK synthの子プロセスが残った。開始時刻と親子関係を確認して当該プロセスだけを停止し、図面修正後に再実行した結果、108.4秒で終了コード0になった。

## 完了結果

`docs/diagrams/source/`へ`imgflow-architecture.drawio`と`sequence-job.drawio`を集約し、表示用画像を`docs/diagrams/`直下へ維持した。重複していた`architecture-lambda.drawio`と`architecture-lambda.svg`を削除し、`docs/DESIGN.md`は全体構成図を`imgflow-architecture.png`一枚だけ掲載する構成へ変更した。設計書、図面一覧、再生成手順、関連ExecPlanは新しい編集元パスへ更新済みである。

手動補正済み`sequence-job.drawio`は移動前、一時バックアップ、移動後のSHA-256がすべて`7DBB97AD4E61217B20FE91AC352DA66B2C319407576B6DA467BC0BA6760EE665`で一致した。そのソースから`sequence-job.svg`を再生成した。全体構成図は`Edge / Web / Authentication`と`Authenticated API`を上部の専用帯へ移し、`Durable Job Dispatch`をDynamoDBとDispatcherの直上へ分離した。Frontend S3とInput S3を50px下げ、修正後PNGの2領域を目視して線、サービス、ラベルとの重なりが解消したことを確認した。

保持する2件のDraw.ioは`validate_drawio_bundle.py`に合格し、最終の全体構成図は`Post-processing: no changes needed`だった。全体構成図17 edge、シーケンス図18 edgeの不正参照はいずれも0件、現行文書内の旧パス0件、`docs/`直下のDraw.io 0件、`git diff --check`成功を確認した。`mise run check`は終了コード0で、format、lint、型検査、52件のBunテスト、推論14件とローカル11件のPythonテスト、build、CDK synth、cdk-nagを含む全ゲートが成功した。AWS確認は不要である。

2026-07-27追記: ユーザーから全体構成図の重複解消とDraw.io編集元のサブディレクトリ管理を求められたため、完了済みだった形式統一計画を最終配置の統合計画へ改訂した。

2026-07-27追記: ユーザーの目視指摘により、全体構成図の上部見出しが線とサービスへ重なる問題を対象範囲へ追加し、見出し分割と専用帯への再配置を記録した。
