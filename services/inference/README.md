# Inference Lambda Container

`MODEL_PROFILE=stub` が既定です。
実モデルを推測して実装しないでください。

商品画像検索の評価には、任意の`MODEL_PROFILE=catalog`を使用できます。
このプロファイルはDINOv2-smallと生成済み商品カタログ索引を読み込みます。
未提供の本番モデル接続点である`real`とは分離しています。

## ローカルテスト

```bash
python -m pytest services/inference/tests
```

## Docker build

```bash
docker build -t imgflow-stub services/inference
```

## 商品カタログ検索

リポジトリルートでDINOv2とカタログ索引を準備します。

```bash
mise exec -- python scripts/fetch-dinov2-model.py
mise exec -- python scripts/build-product-catalog.py <catalog-source.json>
docker build --build-arg MODEL_PROFILE=catalog -t imgflow-catalog services/inference
```

`catalog-source.example.json`は入力manifestの形式を示します。
参照画像、モデル重み、生成索引はGitへ追加しません。
通常の単体テストは重い依存とモデル成果物を必要としません。

## 実モデル統合

現在の`RealModelAdapter`は`NotImplementedError`を返し、CDK Contextも`real`を受け付けない。
したがって、`real`は現在利用できるプロファイルではない。
次の手順は、利用者提供モデルの仕様が確定した後に実施する。

1. `docs/11_model_integration.md` の未確定情報を確認する。
2. `RealModelAdapter` を実装する。
3. `model-runtime/` へ検証済みモデルを一時配置する。
4. `MODEL_PROFILE=real` を設定する。
5. サイズ、RSS、初期化、推論時間を測定する。
