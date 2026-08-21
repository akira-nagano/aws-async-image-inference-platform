# ADR-0003: 初期推論基盤をLambdaコンテナとする

- Status: Accepted, pending model validation
- Date: 2026-07-23

## Context

利用頻度が不明で、未使用時の固定費を避けたい。モデルは約3.6GBとの情報があるが、形式と実行時メモリは不明。

## Decision

最初はLambdaコンテナで実装し、実モデル受領後にサイズ、最大RSS、初期化時間、推論時間を測定する。推論コアはLambdaアダプターから分離する。

## Consequences

- 小規模利用時の固定費を抑えやすい。
- 10GBイメージ、10,240MBメモリ、15分実行時間の制約がある。
- 不成立時はStep FunctionsのTaskだけをECS FargateまたはSageMakerへ差し替える。
