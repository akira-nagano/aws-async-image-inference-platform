import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { AuthError, getAuthContext } from "./shared/auth.js";
import { ddbClient } from "./shared/aws.js";
import { getEnv, getTierLimits } from "./shared/env.js";
import { errorResponse, jsonResponse } from "./shared/responses.js";
import type { JobRecord, JwtEvent } from "./shared/types.js";

export async function handler(event: JwtEvent): Promise<APIGatewayProxyStructuredResultV2> {
  const requestId = event.requestContext.requestId;
  try {
    const auth = getAuthContext(event);
    const { jobsTableName, concurrencyTableName } = getEnv();
    const jobId = event.pathParameters?.jobId;
    if (!jobId) return errorResponse(400, "JOB_ID_REQUIRED", "Job IDが必要です。", requestId);

    const [jobResponse, counterResponse] = await Promise.all([
      ddbClient.send(new GetCommand({ TableName: jobsTableName, Key: { jobId } })),
      ddbClient.send(
        new GetCommand({
          TableName: concurrencyTableName,
          Key: { scopeKey: `USER#${auth.userId}` },
        }),
      ),
    ]);
    const job = jobResponse.Item as JobRecord | undefined;
    if (!job) return errorResponse(404, "JOB_NOT_FOUND", "Jobが見つかりません。", requestId);
    if (job.userId !== auth.userId) {
      return errorResponse(
        403,
        "JOB_ACCESS_DENIED",
        "このJobを参照する権限がありません。",
        requestId,
      );
    }

    const body: Record<string, unknown> = {
      jobId: job.jobId,
      status: job.status,
      tier: job.tier,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      concurrency: {
        active: counterResponse.Item?.activeCount ?? 0,
        limit: getTierLimits()[auth.tier],
      },
    };
    if (job.status === "SUCCEEDED") {
      body.modelVersion = job.modelVersion;
      body.processingTimeMs = job.processingTimeMs;
      body.predictions = job.predictions;
    }
    if (["FAILED", "TIMED_OUT", "SUBMIT_FAILED", "CANCELLED"].includes(job.status)) {
      body.error = {
        code: job.errorCode ?? "INFERENCE_FAILED",
        message: job.errorMessage ?? "推論処理に失敗しました。",
      };
    }
    return jsonResponse(200, body);
  } catch (error) {
    if (error instanceof AuthError) {
      return errorResponse(error.statusCode, error.code, error.message, requestId);
    }
    console.error(JSON.stringify({ requestId, event: "job_status_failed", error: String(error) }));
    return errorResponse(500, "INTERNAL_ERROR", "Job状態を取得できませんでした。", requestId);
  }
}
