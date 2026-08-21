import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { InvokeCommand } from "@aws-sdk/client-lambda";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { AuthError, getAuthContext } from "./shared/auth.js";
import { ddbClient, lambdaClient, s3Client } from "./shared/aws.js";
import { getDailyJobLimits, getEnv, getTierLimits } from "./shared/env.js";
import { errorResponse, jsonResponse } from "./shared/responses.js";
import type { JobRecord, JwtEvent } from "./shared/types.js";
import { dailyUsageLimits, dailyUsageWindow, jobUsageScopeKeys } from "./shared/usage-limits.js";
import {
  ALLOWED_CONTENT_TYPES,
  assertOwnedObjectKey,
  deterministicJobId,
  hashText,
} from "./shared/validation.js";

const bodySchema = z.object({ objectKey: z.string().min(1).max(1024) });

async function dispatchForLocalFloci(job: JobRecord): Promise<JobRecord> {
  const { jobsTableName, localDispatcherFunctionName } = getEnv();
  if (!localDispatcherFunctionName) return job;

  const response = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: localDispatcherFunctionName,
      InvocationType: "RequestResponse",
      Payload: Buffer.from(JSON.stringify({ localJob: job })),
    }),
  );
  if (response.FunctionError) {
    const payload = response.Payload
      ? Buffer.from(response.Payload).toString("utf8").slice(0, 1000)
      : "";
    throw new Error(`Local dispatcher invocation failed: ${response.FunctionError} ${payload}`);
  }
  const current = await ddbClient.send(
    new GetCommand({ TableName: jobsTableName, Key: { jobId: job.jobId }, ConsistentRead: true }),
  );
  return (current.Item as JobRecord | undefined) ?? job;
}

async function getCount(tableName: string, scopeKey: string): Promise<number> {
  const response = await ddbClient.send(
    new GetCommand({ TableName: tableName, Key: { scopeKey }, ConsistentRead: true }),
  );
  return typeof response.Item?.activeCount === "number" ? response.Item.activeCount : 0;
}

async function getUsageCount(tableName: string, scopeKey: string): Promise<number> {
  const response = await ddbClient.send(
    new GetCommand({ TableName: tableName, Key: { scopeKey }, ConsistentRead: true }),
  );
  return typeof response.Item?.usageCount === "number" ? response.Item.usageCount : 0;
}

export async function handler(event: JwtEvent): Promise<APIGatewayProxyStructuredResultV2> {
  const requestId = event.requestContext.requestId;
  let reservedJobId: string | undefined;
  try {
    const auth = getAuthContext(event);
    const env = getEnv();
    const tierLimits = getTierLimits();
    const dailyJobLimits = getDailyJobLimits();
    const tierLimit = tierLimits[auth.tier];
    const idempotencyKey = event.headers["idempotency-key"];
    if (!idempotencyKey || idempotencyKey.length > 200) {
      return errorResponse(
        400,
        "IDEMPOTENCY_KEY_REQUIRED",
        "Idempotency-Keyが必要です。",
        requestId,
      );
    }

    const body = bodySchema.parse(JSON.parse(event.body ?? "{}") as unknown);
    try {
      assertOwnedObjectKey(body.objectKey, auth.userId);
    } catch {
      return errorResponse(400, "INVALID_OBJECT_KEY", "画像キーが正しくありません。", requestId);
    }

    const jobId = deterministicJobId(auth.userId, idempotencyKey);
    reservedJobId = jobId;
    const existing = await ddbClient.send(
      new GetCommand({ TableName: env.jobsTableName, Key: { jobId }, ConsistentRead: true }),
    );
    if (existing.Item) {
      const existingJob = existing.Item as JobRecord;
      if (existingJob.objectKey !== body.objectKey) {
        return errorResponse(
          409,
          "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_INPUT",
          "同じIdempotency-Keyが別の入力に使用されています。",
          requestId,
        );
      }
      const dispatchedJob = await dispatchForLocalFloci(existingJob);
      return jsonResponse(202, {
        jobId: dispatchedJob.jobId,
        status: dispatchedJob.status,
        tier: dispatchedJob.tier,
        statusUrl: `/api/jobs/${dispatchedJob.jobId}`,
        idempotentReplay: true,
      });
    }

    try {
      const head = await s3Client.send(
        new HeadObjectCommand({ Bucket: env.inputBucketName, Key: body.objectKey }),
      );
      if ((head.ContentLength ?? 0) <= 0 || (head.ContentLength ?? 0) > env.maxUploadBytes) {
        return errorResponse(
          400,
          "INVALID_INPUT_OBJECT_SIZE",
          "アップロード済み画像のサイズが許容範囲外です。",
          requestId,
          { maxUploadBytes: env.maxUploadBytes },
        );
      }
      if (!head.ContentType || !ALLOWED_CONTENT_TYPES.has(head.ContentType)) {
        return errorResponse(
          400,
          "INVALID_INPUT_CONTENT_TYPE",
          "アップロード済みファイルはJPEGまたはPNGではありません。",
          requestId,
        );
      }
      if (head.Metadata?.owner !== auth.userId) {
        return errorResponse(
          403,
          "INPUT_OBJECT_ACCESS_DENIED",
          "画像の所有者が一致しません。",
          requestId,
        );
      }
    } catch (error) {
      console.error(
        JSON.stringify({ requestId, event: "input_head_failed", error: String(error) }),
      );
      return errorResponse(
        404,
        "INPUT_OBJECT_NOT_FOUND",
        "アップロード済み画像が見つかりません。",
        requestId,
      );
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const usageWindow = dailyUsageWindow(now);
    const usageKeys = jobUsageScopeKeys(auth.userId, usageWindow.date);
    const usageLimits = dailyUsageLimits({
      tier: auth.tier,
      tierJobLimits: dailyJobLimits,
      systemJobLimit: env.systemDailyJobLimit,
      maxUploadBytes: env.maxUploadBytes,
    });
    const leaseExpiresAt = Math.floor(now.getTime() / 1000) + env.initialLeaseSeconds;
    const jobRecord: JobRecord = {
      jobId,
      userId: auth.userId,
      tier: auth.tier,
      tierLimit,
      status: "RESERVED",
      slotState: "HELD",
      objectKey: body.objectKey,
      idempotencyKeyHash: hashText(idempotencyKey),
      createdAt: nowIso,
      activeKey: "ACTIVE",
      leaseExpiresAt,
    };
    try {
      await ddbClient.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: env.concurrencyTableName,
                Key: { scopeKey: `USER#${auth.userId}` },
                UpdateExpression:
                  "SET activeCount = if_not_exists(activeCount, :zero) + :one, tier = :tier, updatedAt = :now",
                ConditionExpression: "attribute_not_exists(activeCount) OR activeCount < :limit",
                ExpressionAttributeValues: {
                  ":zero": 0,
                  ":one": 1,
                  ":limit": tierLimit,
                  ":tier": auth.tier,
                  ":now": nowIso,
                },
              },
            },
            {
              Update: {
                TableName: env.concurrencyTableName,
                Key: { scopeKey: "SYSTEM#INFERENCE" },
                UpdateExpression:
                  "SET activeCount = if_not_exists(activeCount, :zero) + :one, updatedAt = :now",
                ConditionExpression: "attribute_not_exists(activeCount) OR activeCount < :limit",
                ExpressionAttributeValues: {
                  ":zero": 0,
                  ":one": 1,
                  ":limit": env.systemConcurrencyLimit,
                  ":now": nowIso,
                },
              },
            },
            {
              Update: {
                TableName: env.concurrencyTableName,
                Key: { scopeKey: usageKeys.user },
                UpdateExpression:
                  "SET usageCount = if_not_exists(usageCount, :zero) + :one, tier = :tier, usageDate = :date, updatedAt = :now, #ttl = :ttl",
                ConditionExpression: "attribute_not_exists(usageCount) OR usageCount < :limit",
                ExpressionAttributeNames: { "#ttl": "ttl" },
                ExpressionAttributeValues: {
                  ":zero": 0,
                  ":one": 1,
                  ":limit": usageLimits.userJobLimit,
                  ":tier": auth.tier,
                  ":date": usageWindow.date,
                  ":now": nowIso,
                  ":ttl": usageWindow.ttl,
                },
              },
            },
            {
              Update: {
                TableName: env.concurrencyTableName,
                Key: { scopeKey: usageKeys.system },
                UpdateExpression:
                  "SET usageCount = if_not_exists(usageCount, :zero) + :one, usageDate = :date, updatedAt = :now, #ttl = :ttl",
                ConditionExpression: "attribute_not_exists(usageCount) OR usageCount < :limit",
                ExpressionAttributeNames: { "#ttl": "ttl" },
                ExpressionAttributeValues: {
                  ":zero": 0,
                  ":one": 1,
                  ":limit": usageLimits.systemJobLimit,
                  ":date": usageWindow.date,
                  ":now": nowIso,
                  ":ttl": usageWindow.ttl,
                },
              },
            },
            {
              Put: {
                TableName: env.jobsTableName,
                Item: jobRecord,
                ConditionExpression: "attribute_not_exists(jobId)",
              },
            },
          ],
        }),
      );
    } catch (error) {
      const replay = await ddbClient.send(
        new GetCommand({ TableName: env.jobsTableName, Key: { jobId }, ConsistentRead: true }),
      );
      if (replay.Item) {
        const replayJob = replay.Item as JobRecord;
        if (replayJob.objectKey === body.objectKey) {
          const dispatchedJob = await dispatchForLocalFloci(replayJob);
          return jsonResponse(202, {
            jobId,
            status: dispatchedJob.status,
            tier: dispatchedJob.tier,
            statusUrl: `/api/jobs/${jobId}`,
            idempotentReplay: true,
          });
        }
      }

      const [userActive, systemActive, userDailyJobs, systemDailyJobs] = await Promise.all([
        getCount(env.concurrencyTableName, `USER#${auth.userId}`),
        getCount(env.concurrencyTableName, "SYSTEM#INFERENCE"),
        getUsageCount(env.concurrencyTableName, usageKeys.user),
        getUsageCount(env.concurrencyTableName, usageKeys.system),
      ]);
      if (userDailyJobs >= usageLimits.userJobLimit) {
        return errorResponse(
          429,
          "DAILY_JOB_LIMIT_EXCEEDED",
          "本日の推論受付上限に達しています。",
          requestId,
          {
            date: usageWindow.date,
            tier: auth.tier,
            used: userDailyJobs,
            limit: usageLimits.userJobLimit,
          },
        );
      }
      if (systemDailyJobs >= usageLimits.systemJobLimit) {
        return errorResponse(
          503,
          "DAILY_INFERENCE_CAPACITY_EXHAUSTED",
          "本日のシステム推論受付上限に達しています。",
          requestId,
          {
            date: usageWindow.date,
            used: systemDailyJobs,
            limit: usageLimits.systemJobLimit,
          },
        );
      }
      if (userActive >= tierLimit) {
        return errorResponse(
          429,
          "TIER_CONCURRENCY_LIMIT_EXCEEDED",
          "同時実行可能な推論数の上限に達しています。",
          requestId,
          { tier: auth.tier, active: userActive, limit: tierLimit },
        );
      }
      if (systemActive >= env.systemConcurrencyLimit) {
        return errorResponse(
          503,
          "INFERENCE_CAPACITY_EXHAUSTED",
          "現在推論処理が混雑しています。時間をおいて再実行してください。",
          requestId,
          { systemActive, systemLimit: env.systemConcurrencyLimit },
        );
      }
      console.error(
        JSON.stringify({ requestId, event: "reservation_conflict", error: String(error) }),
      );
      return errorResponse(
        409,
        "JOB_SUBMISSION_CONFLICT",
        "Job受付が競合しました。再実行してください。",
        requestId,
      );
    }

    const dispatchedJob = await dispatchForLocalFloci(jobRecord);

    const [userActive, systemActive] = await Promise.all([
      getCount(env.concurrencyTableName, `USER#${auth.userId}`),
      getCount(env.concurrencyTableName, "SYSTEM#INFERENCE"),
    ]);
    return jsonResponse(202, {
      jobId,
      status: dispatchedJob.status,
      tier: auth.tier,
      concurrency: {
        active: userActive,
        limit: tierLimit,
        systemActive,
        systemLimit: env.systemConcurrencyLimit,
      },
      statusUrl: `/api/jobs/${jobId}`,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return errorResponse(error.statusCode, error.code, error.message, requestId);
    }
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return errorResponse(400, "INVALID_REQUEST", "リクエスト形式が正しくありません。", requestId);
    }
    console.error(
      JSON.stringify({
        requestId,
        jobId: reservedJobId,
        event: "job_submit_failed",
        error: String(error),
      }),
    );
    return errorResponse(500, "INTERNAL_ERROR", "Job受付に失敗しました。", requestId);
  }
}
