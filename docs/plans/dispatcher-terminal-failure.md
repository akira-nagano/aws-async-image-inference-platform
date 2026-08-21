# Dispatcherの既知失敗を即時終端化する

このExecPlanは生きた文書である。
作業中は`進捗（Progress）`、`発見事項（Surprises & Discoveries）`、`決定ログ（Decision Log）`、`完了結果（Outcomes & Retrospective）`を更新する。
この文書は、リポジトリルートの`PLANS.md`に従って維持する。

## 目的と利用者価値

Job受付後にStep Functionsを開始できないと判明した場合、利用者は数分間`RESERVED`のまま待たず、速やかに`FAILED`を確認できるようになる。
同時実行枠も同じトランザクションで即時解放されるため、Basic利用者でも失敗したJobが枠を占有したまま次の検索を妨げない。
検索そのものは運用者が再実行せず、利用者が失敗表示を確認して必要な場合だけ新しい検索を開始する。

## 対象範囲

対象は、DynamoDB StreamsまたはFlociのローカルアダプターから呼び出されるDispatcher Lambdaの失敗処理である。
Step Functionsが確実に開始されていない恒久エラーだけを`FAILED`へ即時終端化し、`slotState=HELD`の同時実行枠を冪等に解放する。
開始状態が不明なエラーと、開始成功後のDynamoDB更新エラーは従来どおり再試行する。
未使用のSQS DLQとそのAlarmを削除し、Dispatcherの部分バッチ失敗をCloudWatch Embedded Metric Formatで監視できるようにする。
AWSとFlociの経路、CDK、テスト、設計書、構成図を同時に更新する。

追補として、デモ用途に過剰だった監視を整理する。
カスタムメトリクスは`DispatchAnomaly`と`ReaperAnomaly`の2種類だけにし、Alarmは受付、Workflow、Dispatcher、Reaperの4本へ集約する。
SNS Topicと各AlarmからのSNS Actionは維持する。

## 対象外

推論失敗、推論タイムアウト、ユーザーによるキャンセル、日次利用枠の計算方法は変更しない。
Dispatcher失敗を運用者が再実行する機能は追加しない。
Step Functions、推論モデル、HTTP APIのJSON構造は変更しない。
AWSへのデプロイはローカル検証が完了した後の別工程とし、このExecPlanでは自動実行しない。
SNS購読先の追加と変更も対象外とし、既存のTopicとCDK Outputだけを維持する。

## 現状調査

`services/api/src/job-dispatcher.ts`は、`StartExecution(name=jobId)`の後にJobsテーブルを`QUEUED`へ更新する。
同名実行の`ExecutionAlreadyExists`は成功した再送として扱い、`MarkRunning`が先行した条件競合では状態を戻さず`executionArn`だけを保存する。
Handlerはレコード単位の例外を捕捉して`batchItemFailures`を返すため、Lambda呼び出し自体は成功として記録される場合がある。

`services/api/src/shared/job-lifecycle.ts`には、Job終端化とユーザー枠およびシステム枠の減算を一つのDynamoDBトランザクションで行う`finalizeJob`が既に存在する。
新しい共通関数を作らず、この関数へ許可する遷移元状態を指定できる条件を追加する。

`infra/cdk/lib/platform-stack.ts`は、DynamoDB Event Source Mappingの再試行を使い切ったレコードをSQS DLQへ送る。
このQueueを処理するコンシューマーは存在せず、CloudWatch Alarmだけが構成されている。
DynamoDB StreamsのSQS失敗先には元のJobレコードが含まれないため、現在のQueueからJobを直接終端化することもできない。

`services/api/src/job-submit.ts`は、FlociでJob作成後にDispatcher Lambdaを同期呼び出しする。
Dispatcherが例外を返すとHTTP 500になるが、Jobと同時実行枠は既に作成済みである。
新しいDispatcher処理はAWSとFlociで共通にし、Flociでも既知失敗を終端状態として確認できるようにする。

## アーキテクチャ上の制約

同時実行枠はJob受付時に確保し、`RESERVED`、`QUEUED`、`RUNNING`の間だけ保持する。
枠解放はJobsテーブルの`slotState=HELD`を条件にし、Job更新、ユーザーカウンター減算、システムカウンター減算を同じ`TransactWriteItems`で実行する。

Step Functions Standardの実行名はJob IDで固定する。
`ExecutionAlreadyExists`は冪等な成功として扱う。
通信断やタイムアウトでは、AWSが実行を受理した後に応答だけ失われた可能性があるため、開始していないと推測して枠を解放しない。

Dispatcherによる即時終端化では、Jobが`RESERVED`かつ`HELD`であることをDynamoDB条件式で保証する。
すでに`QUEUED`または`RUNNING`へ進んだJobはDispatcherから終端化しない。

Reaperは既知のDispatcher失敗を処理する通常経路には使わない。
Lambdaが起動しない、開始状態を判定できない、終端化トランザクションも失敗し続けるなど、状態が不明な場合の最後の回収手段として維持する。

ログへ画像内容、JWT、ユーザーID、S3 object keyを出力しない。
Job ID、エラー分類、AWS request IDは運用確認に必要な非機密情報として記録できる。

## 実装方針

`services/api/src/shared/job-lifecycle.ts`の`FinalizeInput`へ任意の`expectedStatuses`を追加する。
指定された場合は、Job更新の条件式へ`status IN (...)`を加える。
Dispatcherは`expectedStatuses: ["RESERVED"]`を渡し、Step FunctionsとReaperは従来どおり指定しない。

`services/api/src/job-dispatcher.ts`では、Step Functions開始処理と開始後のJobs更新を別の失敗段階として扱う。
`StateMachineDoesNotExist`、`InvalidArn`、`InvalidExecutionInput`、`InvalidName`、`ValidationException`だけを、実行が作成されていない確定的エラーとして許可リストで分類する。
`StateMachineDeleting`と`ExecutionLimitExceeded`は回復可能性があるため再試行側へ分類する。
スロットリング、5xx、SDK通信エラー、未知の例外は開始状態が不明または回復可能として再試行する。

恒久エラーでは`finalizeJob`を`FAILED`、`DISPATCH_FAILED`、固定した利用者向けメッセージで呼び出す。
終端化に成功したレコードは処理済みとして返し、`DispatchAnomaly`へ`failureKind=terminalized`として記録する。
終端化トランザクションが失敗した場合は同じメトリクスへ`failureKind=finalize`を付け、`batchItemFailures`へ含める。

開始状態が不明なエラーと開始後のDynamoDB更新エラーは`DispatchAnomaly`へ`failureKind=retryable`を付け、`batchItemFailures`へ含める。
Lambdaの標準`Errors`メトリクスだけへ依存せず、`DispatchAnomaly`とDispatcher Lambdaの`Errors`を一つのAlarmで監視する。

`services/api/src/shared/metrics.ts`は任意名のメトリクスを受け取らず、`DispatchAnomaly`と`ReaperAnomaly`だけを受け取る型付き関数へ狭める。
Job終端化はカスタムメトリクスを発行せず、Job IDと終端状態を構造化ログへ記録する。
Dispatcherは確定的な起動拒否、再試行対象、終端化失敗のすべてで`DispatchAnomaly`を1加算し、`failureKind`で分類する。
Reaperは`released + failed`を`ReaperAnomaly`として発行し、内訳と走査件数はログプロパティに残す。

CloudWatch Alarmは4本にする。
`JobSubmitLambdaErrorAlarm`は受付Lambdaの標準`Errors`を監視する。
`WorkflowAbnormalAlarm`はStep Functionsの`ExecutionsFailed`と`ExecutionsTimedOut`をメトリクス数式で合算する。
`DispatcherAnomalyAlarm`は`DispatchAnomaly`とDispatcher Lambdaの標準`Errors`を合算する。
`ReaperAnomalyAlarm`は`ReaperAnomaly`とReaper Lambdaの標準`Errors`を合算する。
4本すべてを既存SNS Topicへ接続する。
Finalize LambdaのエラーはWorkflow失敗に現れるため専用Alarmを削除する。

Flociのローカルイベントでも同じ`dispatchJob`を使う。
既知の恒久エラーを終端化した場合、Dispatcher Lambdaは例外を返さず、Job Submit Lambdaは202を返した後にUIのポーリングで`FAILED`を確認できる契約を維持する。
ローカルレスポンスの`status`はDispatcher実行後にJobsテーブルを再読取して現在値を返す。

日次Jobカウンターは返却しない。
このカウンターは検索成功数ではなく受付済みJob数による費用上限であり、既存設計も終端状態に関係なくUTC日が変わるまで解放しないためである。
利用者の再検索を妨げる同時実行枠だけを即時解放する。

## マイルストーン

最初のマイルストーンでは、共通Finalizeへ遷移元条件を追加し、Dispatcherの恒久エラー、曖昧なエラー、開始後エラーを単体テストで区別する。
この段階ではSQSを残してよいが、既知失敗が即時に`FAILED`へ終端化され、曖昧な失敗が解放されないことをテストで証明する。

次のマイルストーンでは、SQS Queue、Event Source Mappingの失敗先、DLQ AlarmをCDKから削除する。
Dispatcher用のカスタムメトリクスAlarmと最小IAM権限を追加し、CDKテストとcdk-nagで構成を検証する。

最後のマイルストーンでは、Floci結合試験、設計書、Graphviz図、draw.io構成図を新しい失敗経路へ合わせる。
`mise run check`と`mise run e2e-local`を実行し、既知失敗の即時解放、二重解放防止、Reaper回帰を確認する。

監視簡素化の追加マイルストーンでは、カスタムメトリクスを2種類、Alarmを4本へ集約し、SNS TopicとAlarm Actionが残ることをCDKテストで証明する。
DispatcherとReaperの単体テストではメトリクス名、値、分類プロパティを確認する。
最後に`mise run check`を実行し、CDK synthとcdk-nagを含む品質ゲートを通す。

## 具体的な変更ファイル

`services/api/src/shared/job-lifecycle.ts`で、終端化トランザクションの許可状態条件を追加する。
`services/api/src/job-dispatcher.ts`で、エラー分類、即時終端化、EMFメトリクスを実装する。
`services/api/src/job-submit.ts`で、Floci同期Dispatcher後のJob状態を再読取する。
`services/api/test/job-lifecycle.test.ts`と`services/api/test/job-dispatcher.test.ts`へ競合、冪等性、エラー分類のテストを追加する。
必要に応じて`services/api/test/guardrails.test.ts`へログとエラー内容の安全性を追加する。

`infra/cdk/lib/platform-stack.ts`でSQSとDLQ Alarmを削除し、Dispatcher IAMとカスタムメトリクスAlarmを更新する。
`infra/cdk/test/platform-stack.test.ts`でSQSが存在しないこと、Event Source Mappingに失敗先がないこと、Dispatcher AlarmがEMFメトリクスを監視することを検証する。

`README.md`、`docs/DESIGN.md`、`docs/02_concurrency_and_tiers.md`、`docs/03_async_workflow.md`、`docs/04_api_specification.md`、`docs/05_data_model.md`を更新する。
`docs/diagrams/source/sequence-job.drawio`と表示用SVGへDispatcher失敗経路を反映する。
`docs/diagrams/source/imgflow-architecture.drawio`からSQSを削除し、DispatcherからDynamoDBへの即時終端化経路とReaperの安全網を示す。

## データ移行・互換性

既存のJobsテーブルとConcurrencyテーブルの属性は変更しない。
既存Job statusの`FAILED`を使用し、新しいstatusは追加しない。
エラー詳細には既存属性`errorCode`と`errorMessage`を使用する。

デプロイ時にCloudFormationがSQS QueueとDLQ Alarmを削除する。
Queue内の既存メッセージは運用者が再実行しない方針のため移行しない。
削除前のメッセージ数はAWS確認手順で読み取り、存在する場合は障害件数として記録してから削除する。

## テスト計画

Dispatcher単体テストは、成功、`ExecutionAlreadyExists`、MarkRunning先行競合に加え、恒久StartExecution失敗の即時終端化、曖昧なStartExecution失敗の再試行、開始成功後のDynamoDB失敗で終端化しないこと、Finalize失敗の再試行を検証する。

Finalize単体テストは、`expectedStatuses: ["RESERVED"]`がDynamoDB条件式へ入り、指定しない既存経路が従来の`slotState=HELD`条件を維持することを検証する。

CDK単体テストは、AWS環境だけにEvent Source Mappingが存在し、`DestinationConfig`とSQS Queueが存在しないことを検証する。
DispatcherのIAMがJobsとConcurrencyへ限定され、Alarmが`AsyncImageInference/DispatchAnomaly`を監視することを検証する。

Floci結合試験は、既知のDispatcher失敗を注入できる範囲で、Jobが`FAILED`になり同時実行数が0へ戻ることを確認する。
FlociでStep Functionsエラー注入が安定しない場合は、単体テストとローカルLambda直接呼び出しを証拠とし、未実施理由を完了結果へ記録する。

## ローカル確認手順

作業ディレクトリはリポジトリルート`C:\projects\lambda-async-inference-cdk-floci-starter`とする。

まずAPIとCDKの対象テストを実行する。

    mise exec -- bun test services/api/test/job-lifecycle.test.ts services/api/test/job-dispatcher.test.ts
    mise exec -- bun run --filter @async-image-inference/cdk test

次に全品質ゲートを実行する。

    mise run check

Flociへ影響するため、Dockerが利用可能なら次を実行する。

    mise run e2e-local

構成図はスキル付属の検証パイプラインへ通す。

    mise exec -- uv run ./.agents/skills/aws-architecture-diagram/scripts/validate_drawio_bundle.py ./docs/aws-async-image-inference-architecture.drawio

## AWS確認手順

実装完了後、デプロイ前に現在のStack ResourceからSQS Queueを列挙し、Queueが存在する場合だけURLとメッセージ数を取得する。
Logical Resource IDやQueue URLは出力から取得し、推測しない。

    aws cloudformation list-stack-resources --stack-name AsyncImageInference-dev --profile poruru --region ap-northeast-1 --query "StackResourceSummaries[?ResourceType=='AWS::SQS::Queue'].[LogicalResourceId,PhysicalResourceId]" --output table
    aws sqs get-queue-attributes --queue-url <取得したURL> --attribute-names ApproximateNumberOfMessages --profile poruru --region ap-northeast-1

デプロイ後は、CloudFormation Stackが`UPDATE_COMPLETE`であり、SQS QueueとDLQ AlarmがStack Resourceから消えたことを確認する。
DispatcherのEvent Source Mappingに`DestinationConfig`がなく、CloudWatch Alarmが新しいメトリクスを参照することを確認する。
AWSデプロイは利用者の明示指示を受けた工程で実行する。

## リスクと緩和策

最大のリスクは、Step Functionsが開始済みなのにDispatcherがJobをFAILED化して枠を解放する競合である。
恒久エラーの許可リスト、開始後処理との分離、`expectedStatuses: ["RESERVED"]`の条件を重ねて防ぐ。

未知のAWS SDKエラーを恒久エラーとして扱うと誤解放につながる。
未知のエラーはすべて再試行側へ倒し、Reaperを最後の回収手段として残す。

EMFメトリクスのJob IDをDimensionにするとメトリクス数が増える。
Dimensionは`Environment`だけにし、Job IDはログプロパティとして保持する。

FlociはDynamoDB Streamsを作らない。
ローカル専用の同期アダプターで同じDispatcher関数を呼び、単体テストとFloci結合試験の両方で契約を確認する。

## 進捗（Progress）

- [x] 2026-07-25 01:53 JST：必須設計書、PLANS.md、関連実装、既存テスト、未コミット差分を確認した。
- [x] 2026-07-25 01:53 JST：シニアレビューで判明した開始状態の曖昧性を反映し、実装方針を確定した。
- [x] 2026-07-25：共通Finalizeへ遷移元条件を追加し、`RESERVED`限定の終端化を実装した。
- [x] 2026-07-25：Dispatcherの安全な即時終端化と異常メトリクスを実装した。
- [x] 2026-07-25：CDKからSQSとDLQ Alarmを削除し、最小IAMとAlarmを更新した。
- [x] 2026-07-25：Dispatcher、Finalize、CDKの単体テストを追加した。
- [x] 2026-07-25：設計書、Graphviz図、draw.io構成図を更新した。
- [x] 2026-07-25：`mise run check`、`mise run e2e-local`、draw.io検証を完了し、結果を記録した。
- [x] 2026-07-25：現行10 Alarmと最大10カスタムメトリクス、SNS購読実装を棚卸しした。
- [x] 2026-07-25：カスタムメトリクスを2種類へ集約し、Alarmを4本へ削減した。
- [x] 2026-07-25：SNS Topicと全AlarmのSNS Actionを維持し、CDKテストとFloci deployで確認した。
- [x] 2026-07-25：テストと運用文書を更新し、`mise run check`と`mise run e2e-local`を完了した。

## 決定ログ（Decision Log）

- 決定：Dispatcherはすべての例外を即時FAILED化せず、実行が作成されていないと確定する恒久エラーだけを終端化する。
  理由：通信断、タイムアウト、開始後のDynamoDBエラーではStep Functionsが実行中の可能性があり、枠を先に解放すると受付上限と実処理数が乖離する。
  日付と担当：2026-07-25、Codex。

- 決定：即時終端化には既存status`FAILED`とerror code`DISPATCH_FAILED`を使う。
  理由：Jobは受付済みであり、HTTP同期受付の失敗を表す新しいstatusを増やす必要がない。
  日付と担当：2026-07-25、Codex。

- 決定：日次Jobカウンターは返却しない。
  理由：日次上限は成功検索数ではなく受付済みJob数による費用上限であり、既存契約も終端状態で解放しない。
  日付と担当：2026-07-25、Codex。

- 決定：SQS DLQは削除し、運用者による検索再実行を実装しない。
  理由：再検索は利用者の意思で行うべきであり、現在の失敗先メッセージにはJobレコードも含まれない。
  日付と担当：2026-07-25、Codex。

- 初期決定（後続の監視簡素化決定で置換）：Dispatcherの再試行失敗と終端化失敗を一つの専用メトリクスへ集約し、`failureKind`をログプロパティにする。
  理由：部分バッチ失敗をLambda標準`Errors`とは別に検出する必要があった。後続決定では確定的起動拒否も同じ`DispatchAnomaly`へ含めた。
  日付と担当：2026-07-25、Codex。

- 決定：デモ環境のカスタムメトリクスは`DispatchAnomaly`と`ReaperAnomaly`の2種類に限定し、Alarmは4本へ集約する。
  理由：通常の成功件数とWorkflow失敗件数はAWS標準メトリクスで確認でき、`JobsFinalized`などは重複している。`JobsCancelled`と`JobsSubmitFailed`は現在の実装で発行経路もない。
  日付と担当：2026-07-25、Codex。

- 決定：SNS TopicとAlarm Actionは維持する。
  理由：固定費がなく、将来購読先を追加するときにAlarm定義を変更せず通知を有効化できる。
  日付と担当：2026-07-25、Codex。

## 発見事項（Surprises & Discoveries）

- 発見：共通の`finalizeJob`はすでに`services/api/src/shared/job-lifecycle.ts`へ抽出され、Finalize LambdaとReaperが共有している。
  証拠：`services/api/src/finalize-job.ts`と`services/api/src/reaper.ts`が同じ関数をimportしている。

- 発見：Dispatcher Handlerはレコード例外を捕捉して部分バッチ失敗を返すため、既存のLambda`Errors` Alarmだけでは失敗を確実に検出できない。
  証拠：`services/api/src/job-dispatcher.ts`はcatch後にthrowせず`batchItemFailures`を返す。

- 発見：Flociの同期Dispatcher失敗はJob作成トランザクションの後にHTTP 500となり、現在は初期リースまで枠が残る。
  証拠：`services/api/src/job-submit.ts`はトランザクション確定後に`dispatchForLocalFloci`をawaitし、外側catchで500を返す。

- 発見：Dispatcher用Alarmを2本追加すると既存10本から11本になり、開発費用で前提にしていた無料枠想定を越える。
  証拠：CDKの既存AlarmはDLQを含めて10本であり、DLQ削除後に2本追加すると差引11本になる。

- 発見：ローカル環境にGraphvizの`dot`はないが、リポジトリ外の一時ディレクトリへ`@viz-js/viz`を取得すればSVGを再生成できる。
  証拠：`dot`はコマンド未検出となり、`@viz-js/viz` 3.28.0による生成は終了コード0となった。

- 発見：Floci上で同時に送信したHTTP要求は、Lambdaのコールドスタートと5秒のstub推論により処理開始時刻が分散し、バッチ全体の202件数がTier上限を超える場合がある。
  証拠：Standardの初回試験では4件が202となったが、各応答時点の`concurrency.active`は上限3を超えず、再実行は成功した。試験を同時活動数の不変条件で判定するよう修正し、最終試験も成功した。

## 完了結果（Outcomes & Retrospective）

監視簡素化を完了した。
カスタムメトリクスは`DispatchAnomaly`と`ReaperAnomaly`の2種類だけになった。
AlarmはWorkflow異常、Dispatcher異常、Reaper異常、Job受付エラーの4本になり、すべて既存SNS TopicへのActionを持つ。

`mise run check`は終了コード0で、format、lint、TypeScriptとPythonの型検査、Bun 52テスト、CDK 32テスト、Python 24テスト、build、CDK synth、cdk-nagが成功した。
`mise run e2e-local`も終了コード0で、Flociへの4 AlarmとSNS Topicの作成、推論成功、Tier上限、503、二重解放、Reaper回収、日次上限を確認した。

Dispatcherは、Step Functions実行が作成されていないと確定できる起動拒否だけを即時`FAILED`へ終端化し、`RESERVED`かつ`slotState=HELD`のJobに限って同時実行枠を解放するようになった。開始状態が曖昧な失敗と開始後の更新失敗は解放せず再試行し、Reaperを最後の安全網として維持した。

未使用のSQS DLQとAlarmを削除し、Dispatcher異常を`DispatchAnomaly`で監視する構成へ置き換えた。
その後、デモ用途の監視を2種類のカスタムメトリクスと4本のAlarmへ集約した。
SNS Topicと4本すべてのAlarm Actionは維持した。
設計書、Graphviz図、draw.io構成図も実装と同期した。

`mise run check`は終了コード0で、format、lint、TypeScript/Python型検査、Bun 52テスト、CDK 32テスト、Python推論14テスト、Pythonローカル10テスト、build、CDK synth、cdk-nagが成功した。`mise run e2e-local`も終了コード0で、429/503、同時実行枠、二重解放、Reaper、日次上限を確認した。draw.io検証も`VALIDATION PASSED`となった。

FlociではStep Functionsの確定的起動拒否を安定して注入する経路を追加していないため、この分岐は共有Finalizeを実際に呼ぶDispatcher単体テストで検証した。AWSへのデプロイと実環境確認は対象外のままであり、利用者の明示指示を受けて別工程で行う。

## 成果物と記録

実装、単体テスト、CDK、運用文書、Graphviz図、draw.io構成図を更新した。
既存の未追跡ファイル`.agents/skills/aws-architecture-diagram/`と`docs/aws-async-image-inference-architecture.drawio`は利用者の依頼で作成された成果物であり、削除または巻き戻しを行わない。

## インターフェースと依存関係

`services/api/src/shared/job-lifecycle.ts`の最終形では、`FinalizeInput`に次の任意プロパティを持たせる。

    expectedStatuses?: JobStatus[];

`services/api/src/job-dispatcher.ts`は、恒久エラー分類を外部へ公開せず、テスト可能な関数としてmodule内またはnamed exportで定義する。
未知のエラーは再試行側へ分類する。

DispatcherのEMF出力には既存の`emitMetrics`を使う。
新しい外部依存関係は追加しない。

---

変更記録：2026-07-25に初版を作成した。
Dispatcher失敗の即時終端化、SQS削除、Reaperの安全網化を一つの検証可能な変更として定義した。

追補変更記録：2026-07-25にデモ向け監視簡素化を追加した。カスタムメトリクス2種類、Alarm 4本、SNS維持を検証可能な完了条件とした。
