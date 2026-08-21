# 運用・監視設計

## 1. 監視対象

### API

AWS環境では、API Gatewayの標準メトリクスとHTTP APIアクセスログを使う。

- 4xx、5xx、LatencyはAPI Gatewayの標準メトリクスで確認する。
- 429と503の件数は、アクセスログの`status`と`routeKey`をCloudWatch Logs Insightsで集計する。
- Job受付処理の実行時間は、Job Submit LambdaのDurationで確認する。

429と503を調べる基本クエリは次のとおりである。

```sql
fields @timestamp, routeKey, status
| filter status = "429" or status = "503"
| stats count() as requests by status, routeKey, bin(5m)
```

現在のOperations DashboardはAPI Gatewayのウィジェットを持たない。
これらの値を常時表示する運用へ移る場合は、CDKでDashboardへ追加する。

### Step Functions

- ExecutionsFailed
- ExecutionsTimedOut
- 実行時間
- 実行中件数

### Lambda

- Errors
- Duration
- Throttles
- ConcurrentExecutions
- MaxMemoryUsed（ログ分析）

### DynamoDB

- ThrottledRequests
- TransactionConflict
- SystemErrors

### カスタムメトリクス

デモ環境では、対応が必要な異常だけをカスタムメトリクスにする。
通常の実行件数、成功件数、失敗件数、実行時間はStep FunctionsとLambdaの標準メトリクスで確認する。
Job ID、失敗分類、Reaperの走査件数と内訳は構造化ログで確認する。

- **DispatchAnomaly**：確定的な起動拒否、再試行対象のDispatcher失敗、起動拒否の終端化失敗を合計する。
- **ReaperAnomaly**：Reaperが解放したJob数と、解放に失敗したJob数を合計する。

両メトリクスのDimensionは`Environment`だけにする。
Job IDや失敗分類をDimensionへ追加しない。

## 2. アラーム

| アラーム | 監視内容 | 初期閾値 |
|---|---|---|
| Workflow異常 | Step Functions `ExecutionsFailed + ExecutionsTimedOut` | 5分間に1件以上 |
| Dispatcher異常 | `DispatchAnomaly + Dispatcher Lambda Errors` | 5分間に1件以上 |
| Reaper異常 | `ReaperAnomaly + Reaper Lambda Errors` | 5分間に1件以上 |
| Job受付エラー | Job Submit Lambda `Errors` | 5分間に1件以上 |

4本のAlarmは、メトリクス数式によって重複する異常を一つの通知へまとめる。
たとえば推論LambdaまたはFinalize LambdaのエラーはWorkflow失敗に現れるため、個別のLambda Alarmを作成しない。
DynamoDB Streamsの部分バッチ失敗はDispatcher Lambdaの`Errors`へ反映されないため、`DispatchAnomaly`を標準`Errors`と合算する。

すべてのAlarmは既存SNS Topicへ接続する。
CDKは購読先を作成しないため、通知を受け取る環境ではCDK Outputの`AlarmTopicArn`へメールなどの購読先を登録する。

## 3. 枠不整合チェック

現在のスターターは、カウンターとJobの全件照合を行う定期バッチ、自動修復、管理スクリプトを実装していない。
Reaperは`ActiveJobsIndex`からリース期限切れの`HELD` Jobだけを取得し、共通Finalizeで枠を解放する。
終端Jobとカウンターだけが不一致になった場合、Reaperは補正しない。

調査時は次の値を読み取り専用で比較する。

```text
ConcurrencyのSYSTEM#INFERENCE.activeCount
vs
JobsのactiveKey=ACTIVEかつslotState=HELDの件数
```

ユーザーカウンターは、同じ`HELD` Jobを`userId`ごとに集計して比較する。
GSIは結果整合性であるため、更新直後の一時的な差を不整合と断定しない。

不一致が継続する場合は、次の順で扱う。

1. 実行中のStep FunctionsとJobのリース期限を確認する。
2. リース期限前はカウンターを変更せず、Workflowとの競合を避ける。
3. 期限切れの`HELD` JobはReaperの実行結果を確認する。
4. Reaperで補正できない不一致は、DynamoDBのバックアップと対象Itemを確定してから、別途レビューした一回限りの補正手順で扱う。

補正手順はdry-runで対象Job、ユーザーカウンター、システムカウンターを提示し、実行後に三者を再照合する。
このリポジトリには補正コマンドを同梱していない。

## 4. Runbook

### 429が多い

1. Tier設定が正しいか
2. `TIER_CONCURRENCY_LIMIT_EXCEEDED`か`DAILY_JOB_LIMIT_EXCEEDED`か
3. 長時間Jobが滞留していないか
4. Reaperが動作しているか
5. 推論時間が悪化していないか
6. Tier上限変更の必要性

### 503が多い

1. システム上限
2. `INFERENCE_CAPACITY_EXHAUSTED`か日次システム上限か
3. `capacityMode`と導出済みLambda Reserved Concurrency
4. AWSアカウントクォータ
5. 推論処理時間
6. ECS移行またはSQS平準化の検討

### HELD Jobが残る

1. `DispatchAnomaly`とDispatcher Lambdaログ
2. `failureKind`が`terminalized`、`retryable`、`finalize`のどれか
3. Step Functions履歴と同名実行の有無
4. Finalize Lambdaログ
5. DynamoDB TransactionCanceled理由
6. Reaperログ
7. リース期限までは手動解放せず、開始済みWorkflowとの競合を避ける
8. 期限後も残る場合は、同梱スクリプトがないことを前提に、前節の一回限りの補正手順をレビューしてからdry-runする

## 5. ログ保持

- dev: 14〜30日
- prod: 90日以上を要件に合わせる
- Jobレコード: 監査要件に合わせる
- 入力画像: devは1日

## 6. 費用通知

AWS Budgetsの標準予算とCost Anomaly Detectionは追加料金なしで利用できる。
通知先メールアドレスと作成指示が確定するまではAWSリソースを作成しない。
設定時は月1米ドルのdev予算通知を初期値とし、Cost Explorerの実績に合わせて調整する。

## 7. モデルリリース

- `modelVersion`
- SHA-256
- コンテナdigest
- ランタイムバージョン
- 検証結果
- リリース日時

を記録する。
