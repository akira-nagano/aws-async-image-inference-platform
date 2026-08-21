# 設計書一覧

番号付き設計書と`DESIGN.md`は、現在の実装を説明する文書である。
ExecPlanは実施時点の判断と検証結果を残す履歴であり、現在の操作手順としては使わない。

## 現行設計

| ファイル | 内容 |
|---|---|
| `DESIGN.md` | 全体設計の要約 |
| `01_requirements.md` | 機能要件と非機能要件 |
| `02_concurrency_and_tiers.md` | Cognito Tierと同時実行枠 |
| `03_async_workflow.md` | Step Functions非同期処理 |
| `04_api_specification.md` | HTTP API仕様 |
| `05_data_model.md` | DynamoDBとS3のデータ設計 |
| `06_security.md` | 認証、認可、IAM、ログ |
| `07_floci_local_development.md` | Flociローカル再現 |
| `08_cdk_and_deployment.md` | CDK、CI/CD、環境分離 |
| `09_operations.md` | 監視、障害対応、枠回収 |
| `10_test_strategy.md` | テスト戦略と合格基準 |
| `11_model_integration.md` | モデル統合手順と未実装境界 |
| `12_risks_and_open_questions.md` | 未確定事項とリスク |
| `REFERENCES.md` | 公式一次資料 |
| `adr/` | 採用中の主要判断 |

## 構成図

| ファイル | 内容 |
|---|---|
| `diagrams/source/imgflow-architecture.drawio` | AWSサービスと通信経路を含む全体構成の編集元 |
| `diagrams/imgflow-architecture.png` | 全体構成の表示用画像 |
| `diagrams/source/sequence-job.drawio` | Job受付から終端化までのシーケンスの編集元 |
| `diagrams/sequence-job.svg` | Job受付から終端化までのシーケンスの表示用画像 |

図の編集元はすべて非圧縮Draw.io形式で`docs/diagrams/source/`へ置き、Markdownへ埋め込むSVG/PNGは`docs/diagrams/`直下へ置く。
Draw.io Desktopを導入済みのWindowsでは、次のコマンドで表示用画像を再生成できる。

```powershell
& 'C:\Program Files\draw.io\draw.io.exe' -x -f png -e -b 10 -o docs\diagrams\imgflow-architecture.png docs\diagrams\source\imgflow-architecture.drawio
& 'C:\Program Files\draw.io\draw.io.exe' -x -f svg -e -b 10 -o docs\diagrams\sequence-job.svg docs\diagrams\source\sequence-job.drawio
```

## 完了済みExecPlan

| ファイル | 記録対象 |
|---|---|
| `plans/initial-implementation.md` | 初期実装とFloci基盤 |
| `plans/aws-dev-primary-development.md` | AWS devを基準にした開発フロー |
| `plans/cognito-managed-login.md` | Cognitoマネージドログイン移行 |
| `plans/product-image-retrieval-poc.md` | 商品画像検索PoC |
| `plans/web-search-experience.md` | Web検索画面と認証遷移 |
| `plans/dispatcher-terminal-failure.md` | Dispatcher失敗処理と監視簡素化 |
| `plans/imgflow-rename-and-deploy.md` | ImgFlowへの改名とAWS再デプロイ |
| `plans/drawio-source-unification.md` | Draw.io形式統一、重複図の整理、編集元の集約 |

ExecPlan内の旧Stack名、廃止したSQS構成、当時のAWSリソースIDは履歴として残す。
現在の名称、構成、実行コマンドは番号付き設計書、`DESIGN.md`、ルート`README.md`を基準にする。
