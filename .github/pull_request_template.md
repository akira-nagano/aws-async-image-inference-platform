## 変更概要

## アーキテクチャ不変条件への影響

- [ ] Tier判定はJWTの`cognito:groups`のみを使用
- [ ] 枠確保はDynamoDBトランザクション
- [ ] 枠解放は`slotState=HELD`条件で冪等
- [ ] 429/503の意味を維持
- [ ] API/状態遷移/データモデル変更時にdocsを更新

## 検証

- [ ] lint
- [ ] typecheck
- [ ] unit tests
- [ ] CDK synth
- [ ] Floci integration（該当時）
