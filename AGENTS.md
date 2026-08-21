# Repository instructions for Codex

## 最優先事項

- 作業前に `README.md`、`docs/DESIGN.md`、`docs/02_concurrency_and_tiers.md`、`docs/03_async_workflow.md` を読む。
- 複数ファイルにまたがる機能、インフラ変更、非同期処理、データモデル変更では、`PLANS.md` に従うExecPlanを作成・更新する。
- 実モデルは未提供である。モデル形式やライブラリを推測して本番実装しない。`stub` を維持し、接続点を明確にする。

## Code Search

- 意味や振る舞いからコードを探索するときは、grepやglobよりSembleを優先する。
- Semble MCPが利用できる場合は`search`から開始し、関連実装、呼び出し元、テストの探索には`find_related`を使う。
- MCPを利用できない場合は、次のCLIを使う。

```bash
semble search "authentication flow" . --max-snippet-lines 10
semble search "save model to disk" . --top-k 10
```

- 文書は`--content docs`、設定ファイルは`--content config`、コードを含む全対象は`--content all`を指定する。
- Sembleが返したファイルと行を直接開き、同じ発見目的でgrepやglobを繰り返さない。
- 関連箇所は`semble find-related <file_path> <line> .`で探索する。
- 文字列置換など、すべてのリテラル出現箇所が必要な場合だけ`rg`を使う。
- `semble`が`PATH`にない場合は、`mise exec -- uvx --from "semble[mcp]==0.4.1" semble`を使う。

## アーキテクチャ上の不変条件

- Cognitoの検証済みJWTから `sub` と `cognito:groups` を取得する。リクエスト本文のTierは信用しない。
- Tierグループは `tier-basic` / `tier-standard` / `tier-premium` のいずれか1つのみを許可する。
- Job受付時点で同時実行枠を消費する。対象状態は `RESERVED`、`QUEUED`、`RUNNING`。
- 同時実行枠の確保とJob作成は、DynamoDB `TransactWriteItems` で原子的に行う。
- Tier上限はHTTP 429、システム全体上限はHTTP 503で返す。
- 成功、失敗、タイムアウト、キャンセルの全経路で枠を解放する。
- 枠解放は冪等でなければならない。`slotState=HELD` の条件付き更新を崩さない。
- APIは非同期契約を維持する。`POST /api/jobs` は推論完了を待たず202を返す。
- Web UIは `GET /api/jobs/{jobId}` で状態を確認する。
- 画像バイナリをAPI Gatewayへ送らず、S3署名付きURLで直接アップロードする。

## 実装規約

- TypeScriptはstrict modeを維持する。
- LambdaのAWS SDK依存はデプロイパッケージへバンドルする。
- Pythonは型ヒントを付け、推論コアとLambdaハンドラーを分離する。
- 秘密情報、実モデル、AWS認証情報、生成物をGitへ追加しない。
- 既存APIのリクエスト・レスポンスを変更する場合、`docs/04_api_specification.md` とテストを同時更新する。
- DynamoDB属性や状態遷移を変更する場合、`docs/05_data_model.md` と `docs/03_async_workflow.md` を同時更新する。
- CDKのL2/L3 Constructを優先し、必要な場合だけL1を使う。
- 本番で `*` IAM権限を追加しない。ローカル用例外は明示的なContextで限定する。

## 検証コマンド

変更範囲に応じて以下を実行する。

```bash
mise run check
```

Floci結合に影響する変更では次も実行する。

```bash
mise run e2e-local
```

DockerまたはFlociを実行できない環境では、実行できなかったコマンドと理由を明記する。

## Definition of Done

- 対応する単体テスト・結合テストが追加されている。
- 型チェック、lint、テスト、CDK synthが通る。
- 429/503、冪等性、二重解放、タイムアウト回収の回帰がない。
- 設計書と実装が一致する。
- 最終回答に変更概要、確認済みコマンド、未確認事項を記載する。

## Code Review Rules

- カウンター更新が競合時に上限を突破しないことを最優先で確認する。
- Jobが終端状態なのに `slotState=HELD` のまま残る経路を探す。
- 同じリクエストやイベントの再実行で二重Job、二重推論、二重解放が起きないか確認する。
- Cognitoグループ判定、Job所有者確認、S3キー所有者確認の欠落を重大問題として扱う。
- CloudWatchへ画像内容、JWT、個人情報を出力しない。
