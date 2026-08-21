# ADR-0002: DynamoDBトランザクションで同時実行枠を管理する

- Status: Accepted
- Date: 2026-07-23

## Context

Tier上限到達時にHTTP 429を即時返し、並列リクエストでも上限を超えない必要がある。

## Decision

ユーザーカウンター、システムカウンター、Job作成をDynamoDB `TransactWriteItems`で原子的に実行する。枠解放もJobの `slotState=HELD` 条件とカウンター減算を同一トランザクションで行う。

## Consequences

- 競合時にも厳密な上限を維持できる。
- システムカウンターが高TPS時のホットキーになる可能性がある。
- 冪等性とTransactionCanceledの分類実装が必要。
