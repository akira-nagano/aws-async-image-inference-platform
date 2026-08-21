# リスク・未確定事項

## 1. 最優先

| 項目 | 影響 | 対応 |
|---|---|---|
| 実モデル未入手 | Lambda成立性不明 | stubで基盤完成後、実モデルPoC |
| 3.6GBの意味 | 容量・メモリ見積差 | ファイル、形式、展開後RSS確認 |
| 推論時間不明 | timeout/UX | 非同期設計、AWS実測 |
| GPU要否不明 | Lambda/Fargate不可の可能性 | CPU/GPUベンチマーク |
| 新規AWSアカウントのLambdaメモリquota | 3008MBを超える関数を作成できない場合がある | dev stubは3008MB、実モデル導入前にquota確認と引き上げ |
| 新規AWSアカウントのLambda同時実行quota | 全体10ではReserved Concurrencyを確保できない | devは予約を省略し、引き上げ後に未予約枠を残して設定 |
| 商品画像検索の細粒度差 | 色、容量、世代だけが異なる型番を画像埋め込みだけで区別できない | 候補検索として表示し、OCRや属性による再順位付けを別途評価 |
| 未知商品しきい値 | カタログと画像条件で適切な値が変わる | しきい値を索引へ保存し、既知画像と未知画像で調整 |
| DINOv2実行負荷 | stubよりコンテナ、cold start、RSSが増える | 3008MB環境で実測し、超過時はONNX Runtimeを比較 |
| ABOの商品名言語 | 英語名がないlistingではUIに別言語の商品名が出る | 多言語デモとして扱い、本番カタログでは表示言語を正規化 |

## 2. 分散整合性

DynamoDBトランザクションとStep Functions起動は単一トランザクションではないが、起動要求はJobsテーブルのDynamoDB Streamへ永続化する。

緩和:

- 実行名をJob IDに固定
- Dispatcher Event Source MappingのRetryと部分バッチ失敗
- Workflow未作成が確定する起動拒否の即時`FAILED`化
- 曖昧な失敗と終端化失敗を通知する`DispatchAnomaly`アラーム
- 同名実行を成功扱いする冪等Dispatcher
- `RESERVED`条件付きの即時終端化
- RESERVEDの短いリース
- 最後の安全網としてのReaper

Stream追加前から残っていた`RESERVED` JobはDispatcherへ流れないため、初期リース後にReaperが回収する。

## 3. Cognitoグループ

- 複数グループ所属が可能
- JWT更新までTier変更が反映されない
- 管理運用ミスの検知が必要
- メール検証済みの自己登録ユーザーはBasic枠を取得できる

自己登録のTierはPost Confirmation Lambdaで`tier-basic`へ固定し、利用者入力を受け取らない。
公開登録の悪用はBasic上限、システム上限、APIスロットリングで影響を抑えるが、登録数や送信量が増えた場合は招待制、WAF、Bot Controlを検討する。

Cognito User Poolの必須属性は作成後に変更できない。
emailを任意属性として作成したPoolではManaged Loginがemail入力欄を表示しないため、email必須の新Poolを並行作成して切り替える。
本番で同じ変更が必要になった場合は、既存ユーザーの移行方法と再認証を別途設計する。

## 4. DynamoDBホットキー

システム全体カウンターは単一キーとなる。

初期規模では許容する。非常に高い受付TPSになった場合:

- シャードカウンター
- SQS受付
- APIレート制限
- Tierプール分割

を検討する。

## 5. Reaper

Reaperは既知のDispatcher起動拒否を処理する通常経路ではなく、開始結果不明や予期しない停止で期限切れになったJobを回収する最後の安全網である。

- Scheduled Rule遅延
- GSI整合性
- 大量期限切れJob

緩和:

- 安全余裕のあるリース
- ページング
- 冪等Finalize
- 不整合メトリクス

## 6. UI

- アクセストークン更新
- ブラウザを閉じたJobの再表示
- 複数タブからの同時送信

PoCでは簡易対応。本番前に履歴APIとrefresh token対応を検討する。

## 7. 未決定事項

- Tier上限の正式値
- システム上限
- 画像最大サイズ
- 入力画像保持日数
- Job保持期間
- 推論Retry回数
- 商品画像検索のtop-1目標値
- 未知商品を拒否する類似度しきい値
- SLA/SLO
- Cognito提供ドメインとexecute-api直URLを含む国制限の要否
- 独自ドメイン
- 通知方式（ポーリング/WebSocket）

## 8. FlociとAWSの差異

Floci 1.5.33では、HTTP API v2のJWT claims伝播、CloudFormation Stack更新、Cognitoグループ作成、DynamoDB Streams作成にAWSとの差異がある。
ローカル専用Context、seed処理、Job SubmitからDispatcherへの明示呼び出しで結合試験を成立させるが、これらはAWS互換性の保証ではない。

AWS開発環境では、実JWT Authorizer、IAM評価、CloudFront/OAC、DynamoDB Streams Event Source Mapping、Lambdaの性能とクォータ、CDK Stack更新を再確認する。

## 9. CloudFrontの日本限定

AWS環境のCloudFront DistributionはGeo Restrictionで`JP`だけを許可する。
対象はCloudFront経由のWebと`/api/*`であり、Cognito提供ドメイン、API Gatewayのexecute-api直URL、発行後のS3署名付きアップロードURLは対象外である。

国判定は接続元IPデータベースに依存し、CloudFrontが国を特定できない場合は配信される。
VPNやプロキシも完全には排除できない。
厳密な本番要件では、WAFのGeo match、API側の追加認可、オリジン直アクセスの遮断を組み合わせる。
