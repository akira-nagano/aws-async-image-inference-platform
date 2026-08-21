# 実モデル統合設計

## 1. 未確定情報

実装開始前に以下を入手する。

- モデル形式（ONNX / PyTorch / TensorFlow / 独自）
- ファイルサイズ（3.6GB情報の正確な単位）
- 依存ライブラリとバージョン
- CPU/GPU要件
- モデルロード後のメモリ
- 入力画像サイズ・色空間・正規化
- ラベルファイル
- 上位3候補の算出方法
- 1画像の推論時間
- ライセンス

## 2. インターフェース

```python
class ModelAdapter(Protocol):
    @property
    def version(self) -> str: ...

    def predict(self, image_bytes: bytes) -> list[Prediction]: ...
```

Lambdaハンドラーはモデル固有APIを直接呼ばず、Adapterだけを利用する。

## 3. プロファイル

推論コンテナのmodel factoryは、次の識別子を予約している。

```text
MODEL_PROFILE=stub
MODEL_PROFILE=catalog
MODEL_PROFILE=real
```

- **stub**：外部成果物を使わない固定応答であり、PR、通常CI、cdk-nag、Flociで使用する。
- **catalog**：DINOv2-smallと登録済み商品カタログを使うデモ実装であり、AWS開発環境で使用する。
- **real**：利用者提供モデル用に予約した接続点であり、現在は実行できない。

CDK Context `inferenceModelProfile`が受け付ける値は`stub`と`catalog`だけである。
`mise run deploy-dev`は`inferenceModelProfile=catalog`を明示し、`deploy:local`とcdk-nagは`inferenceModelProfile=stub`を明示する。

`real`のAdapterは意図的に`NotImplementedError`を返す。
このため、`MODEL_PROFILE=real`を指定しても、ローカル試験やAWS性能試験は実行できない。

利用者提供モデルの形式、依存ライブラリ、入力前処理、ラベル対応が確定した後に、Adapterと依存関係を実装する。
その実装を検証してから、CDKの許可値、Docker build、手動試験、AWS性能試験へ`real`を追加する。
`catalog`の実装から利用者提供モデルの形式を推測しない。

## 4. 商品画像検索PoC

`catalog`は、入力画像から型番文字列を生成しない。
入力画像をDINOv2-smallの埋め込みへ変換し、索引内の正規化済み参照ベクトルとコサイン類似度を計算する。
商品に複数の参照画像がある場合は、最も高い参照画像スコアを商品スコアとする。
上位3商品だけを返し、最高スコアがしきい値未満の場合は空の候補を返す。

索引は次の情報を持つJSONである。

- schema version
- model IDと固定revision
- 埋め込み次元
- 類似度しきい値
- 商品名、ブランド、型番またはSKU
- 参照画像ごとの正規化済み埋め込み

索引ローダーは次元、有限値、L2正規化、商品参照を検証する。
入力不正時はLambda初期化を失敗させる。
`modelVersion`は入力manifest、参照画像内容、モデルID、revision、類似度しきい値から決定する。

モデルと索引は次のコマンドで準備する。

```bash
mise exec -- python scripts/fetch-dinov2-model.py
mise exec -- python scripts/build-product-catalog.py <catalog-source.json>
```

モデル取得スクリプトは`facebook/dinov2-small`のrevisionを固定し、3ファイルのサイズとSHA-256を検証する。
商品カタログ作成スクリプトは参照画像を埋め込みへ変換し、評価画像がある場合はtop-1正解数を表示する。
生成物は`services/inference/model-runtime/`へ置き、Gitへ追加しない。
ロード時間、warm推論時間、RSSは`benchmark-product-catalog.py`で計測する。

評価用のABO subsetは次のコマンドで準備できる。

```bash
mise exec -- python scripts/prepare-abo-catalog.py --accept-license --products 30
```

ABO配布物のREADMEとLICENSEはCC BY 4.0を指定している。
データを共有する場合はAmazon.comとABO著者への帰属表示が必要である。
ABO subset全体の画像とmetadataは`local/data/abo-catalog/`へ保存し、Gitへ追加しない。
例外として、Web UIで一致結果を再現する評価画像1枚だけを`examples/catalog-match-ct-355c.jpg`へ無加工で配置し、`examples/ABO-ATTRIBUTION.md`にCC BY 4.0の帰属、元パス、SHA-256、変更有無を記録する。

### PoC基準値

2026-07-24に、商品カテゴリ当たり2件までの30商品を選び、参照画像3枚と未使用評価画像1枚で測定した。
しきい値0.45を適用したtop-1は19/30であり、しきい値なしの順位top-1は22/30だった。
カタログ外の汎用サンプル画像は、最高類似度0.247782で候補なしとなった。

ローカルWindowsでは、初期化8.131秒、warm推論中央値246.348 ms、最大RSS 424.6 MiBだった。
3008 MiB制限付きのLinuxコンテナでは、初期化5.801秒、初回推論576.316 ms、最大RSS 467.1 MiBだった。
stubイメージは190.3 MBであり、DINOv2成果物を含まなかった。
catalogイメージは617.2 MBだった。

この結果はABO subsetに対する基準値であり、利用者の商品カタログに対する精度保証ではない。
画像だけで区別しにくい型番には、OCR、バーコード、商品属性による再順位付けが必要になる。

## 5. モデル配置

初期候補:

- コンテナイメージ内 `/opt/model`

理由:

- バージョン対応が明確
- 初期化時のS3ダウンロード不要
- コンテナdigestとモデルを一体管理

ただし10GB制限に近づく場合は以下を比較する。

- S3から `/tmp` へ取得
- EFS
- ECS Fargate
- SageMaker Real-Time

## 6. ビルド

実モデルをGitへ入れない。

```text
モデル成果物S3
→ 取得スクリプト
→ SHA-256検証
→ services/inference/model-runtime/
→ docker build
→ ECR
```

`catalog`イメージはCPU版PyTorchを専用indexから取得し、DINOv2の依存を追加する。
`stub`イメージは重い依存をインストールしない。

## 7. 計測

- Docker image size / uncompressed size
- import時間
- model load時間
- init完了時間
- peak RSS
- `/tmp`使用量
- warm inference p50/p95
- cold end-to-end
- 同時実行時の失敗率

## 8. Lambda継続判断

継続候補:

- 10GBイメージ制限内
- 10,240MBメモリ内
- 15分内
- コールド待ちが許容
- CPU推論で成立

切替候補:

- メモリ超過
- GPU必須
- 初期化が長すぎる
- CPU推論が非現実的
- 常時利用でFargate/SageMakerが経済的
