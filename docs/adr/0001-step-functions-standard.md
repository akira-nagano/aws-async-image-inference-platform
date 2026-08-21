# ADR-0001: Step Functions Standardで非同期推論を管理する

- Status: Accepted
- Date: 2026-07-23

## Context

推論時間と実行基盤が未確定で、同期HTTPのタイムアウトに依存できない。成功・失敗・タイムアウトで同時実行枠を確実に解放する必要がある。

## Decision

Step Functions Standard WorkflowをJob単位のオーケストレーターにする。初期の推論TaskはLambdaコンテナとし、将来ECS `RunTask.sync`へ差し替え可能にする。

## Consequences

- 実行履歴と状態遷移が明確になる。
- APIは202 + ポーリングになる。
- 状態遷移コストが増える。
- Job受付とStartExecution間の整合性対策が必要になる。
