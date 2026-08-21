# HTTP API仕様

ベースパスは `/api` とする。すべてJSON。画像本体のアップロードだけS3署名付きURLを使用する。

## 共通ヘッダー

```http
Authorization: Bearer <access-token>
Content-Type: application/json
```

## エラーフォーマット

```json
{
  "code": "ERROR_CODE",
  "message": "利用者向けメッセージ",
  "requestId": "...",
  "details": {}
}
```

Lambdaが返すエラーはこの形式を使い、`requestId`と`details`は値がある場合だけ含める。
JWT AuthorizerがLambda呼び出し前に拒否した401はAPI Gatewayが生成するため、この形式ではなくGateway標準の応答になる。

## POST /api/upload-url

### Request

```json
{
  "fileName": "input.jpg",
  "contentType": "image/jpeg",
  "sizeBytes": 2456789
}
```

### 200 Response

```json
{
  "objectKey": "uploads/<sub>/<id>-input.jpg",
  "uploadUrl": "https://...",
  "uploadFields": {
    "key": "uploads/<sub>/<id>-input.jpg",
    "policy": "...",
    "x-amz-algorithm": "AWS4-HMAC-SHA256",
    "x-amz-credential": "...",
    "x-amz-date": "...",
    "x-amz-signature": "...",
    "Content-Type": "image/jpeg",
    "x-amz-meta-owner": "<sub>"
  },
  "expiresInSeconds": 900
}
```

クライアントは`uploadFields`を変更せず`multipart/form-data`へ追加し、最後に画像を`file`フィールドとして`uploadUrl`へPOSTする。
POST Policyは`content-length-range`で1 byte以上、CDK設定の`maxUploadBytes`以下を強制する。
`x-amz-meta-owner`は署名対象であり、Job受付時のS3所有者確認に使う。
AWS devの`maxUploadBytes`は5MiBである。
URL発行前に、UTC日単位のユーザー別とシステム別の発行件数・申告バイト量を既存DynamoDBへ原子的に予約する。
未使用URLの枠は当日中に返却しない。

### 主なエラー

- 400 `UNSUPPORTED_CONTENT_TYPE`
- 400 `FILE_TOO_LARGE`
- 429 `DAILY_UPLOAD_URL_LIMIT_EXCEEDED`
- 429 `DAILY_UPLOAD_BYTES_LIMIT_EXCEEDED`
- 503 `DAILY_UPLOAD_CAPACITY_EXHAUSTED`
- 401 未認証
- 403 Tier設定不正

## POST /api/jobs

### Headers

```http
Idempotency-Key: <UUID等>
```

### Request

```json
{
  "objectKey": "uploads/<sub>/<id>-input.jpg"
}
```

### 202 Response

```json
{
  "jobId": "...",
  "status": "RESERVED",
  "tier": "tier-standard",
  "concurrency": {
    "active": 2,
    "limit": 3,
    "systemActive": 4,
    "systemLimit": 4
  },
  "statusUrl": "/api/jobs/<jobId>"
}
```

`status`はレスポンス生成時点のスナップショットである。
AWSの新規受付は通常`RESERVED`を返すが、Idempotency-Keyの再送やFlociローカルの同期Dispatcherアダプターでは`QUEUED`、`RUNNING`、終端statusを返す場合がある。
クライアントは202のstatusだけで完了を判断せず、`statusUrl`を終端状態までポーリングする。

### 429 Response

```json
{
  "code": "TIER_CONCURRENCY_LIMIT_EXCEEDED",
  "message": "同時実行可能な推論数の上限に達しています。",
  "details": {
    "tier": "tier-standard",
    "active": 3,
    "limit": 3
  }
}
```

日次Job上限に達した場合も429を返す。

```json
{
  "code": "DAILY_JOB_LIMIT_EXCEEDED",
  "message": "本日の推論受付上限に達しています。",
  "details": {
    "date": "2026-07-24",
    "tier": "tier-basic",
    "used": 10,
    "limit": 10
  }
}
```

### 503 Response

```json
{
  "code": "INFERENCE_CAPACITY_EXHAUSTED",
  "message": "現在推論処理が混雑しています。時間をおいて再実行してください。",
  "details": {
    "systemActive": 4,
    "systemLimit": 4
  }
}
```

システム全体の日次Job上限に達した場合は503 `DAILY_INFERENCE_CAPACITY_EXHAUSTED`を返す。

### その他

- 400 `INVALID_OBJECT_KEY`
- 400 `INVALID_INPUT_OBJECT_SIZE`
- 400 `INVALID_INPUT_CONTENT_TYPE`
- 429 `DAILY_JOB_LIMIT_EXCEEDED`
- 503 `DAILY_INFERENCE_CAPACITY_EXHAUSTED`
- 403 `INPUT_OBJECT_ACCESS_DENIED`
- 404 `INPUT_OBJECT_NOT_FOUND`
- 409 `IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_INPUT`
- 409 `JOB_SUBMISSION_CONFLICT`

## GET /api/jobs/{jobId}

すべての200レスポンスは`jobId`、`status`、`tier`、`createdAt`、ユーザーの`concurrency`を返す。
`startedAt`と`completedAt`は、対応する状態遷移が完了している場合だけ返す。
現在の処理が生成するstatusは`RESERVED`、`QUEUED`、`RUNNING`、`SUCCEEDED`、`FAILED`、`TIMED_OUT`である。
`CANCELLED`と`SUBMIT_FAILED`は互換性のため型に残した予約済みstatusであり、現在のAPIとWorkflowは生成しない。

### 200 処理中

```json
{
  "jobId": "...",
  "status": "RUNNING",
  "tier": "tier-standard",
  "createdAt": "2026-07-23T10:00:00Z",
  "startedAt": "2026-07-23T10:00:04Z",
  "concurrency": {
    "active": 1,
    "limit": 3
  }
}
```

### 200 完了

```json
{
  "jobId": "...",
  "status": "SUCCEEDED",
  "tier": "tier-standard",
  "createdAt": "2026-07-23T10:00:00Z",
  "startedAt": "2026-07-23T10:00:04Z",
  "modelVersion": "model-001",
  "processingTimeMs": 8300,
  "predictions": [
    {
      "rank": 1,
      "productCode": "ABC-001",
      "productName": "Example product",
      "brand": "Example brand",
      "confidence": 0.91
    },
    {
      "rank": 2,
      "productCode": "ABC-002",
      "productName": "Another product",
      "confidence": 0.76
    }
  ],
  "completedAt": "2026-07-23T10:00:48Z",
  "concurrency": {
    "active": 0,
    "limit": 3
  }
}
```

`productName`と`brand`は任意である。
`productCode`は登録済みカタログの型番またはSKUであり、推論時に生成しない。
`confidence`は0から1の検索類似度であり、正解確率として校正された値ではない。
一致候補がしきい値未満の場合は、`status=SUCCEEDED`かつ空の`predictions`を返す。

### 200 失敗

```json
{
  "jobId": "...",
  "status": "FAILED",
  "tier": "tier-standard",
  "createdAt": "2026-07-23T10:00:00Z",
  "startedAt": "2026-07-23T10:00:04Z",
  "completedAt": "2026-07-23T10:00:48Z",
  "concurrency": {
    "active": 0,
    "limit": 3
  },
  "error": {
    "code": "INFERENCE_FAILED",
    "message": "推論処理に失敗しました。"
  }
}
```

Workflowが作成されていないと確定するDispatcher起動拒否では、同じHTTP 200で次のエラーを返す。

```json
{
  "jobId": "...",
  "status": "FAILED",
  "tier": "tier-standard",
  "createdAt": "2026-07-23T10:00:00Z",
  "completedAt": "2026-07-23T10:00:05Z",
  "concurrency": {
    "active": 0,
    "limit": 3
  },
  "error": {
    "code": "DISPATCH_FAILED",
    "message": "推論ワークフローを開始できませんでした。"
  }
}
```

- 他ユーザーのJobは403。
- 存在しないJobは404。

## 将来候補: GET /api/me（未実装）

現在のCDKはこのルートを作成していない。
次のJSONは、履歴画面などで利用者情報を独立取得する必要が生じた場合の応答案である。

```json
{
  "userId": "<sub>",
  "tier": "tier-standard",
  "concurrency": {
    "active": 2,
    "limit": 3
  }
}
```
