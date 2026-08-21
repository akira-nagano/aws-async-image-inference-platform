import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { ulid } from "ulid";
import { z } from "zod";
import { getAuthContext, AuthError } from "./shared/auth.js";
import { ddbClient, s3Client } from "./shared/aws.js";
import { getDailyJobLimits, getEnv } from "./shared/env.js";
import { errorResponse, jsonResponse } from "./shared/responses.js";
import type { JwtEvent } from "./shared/types.js";
import { buildPresignedPostOptions } from "./shared/upload-policy.js";
import { dailyUsageLimits, dailyUsageWindow, uploadUsageScopeKeys } from "./shared/usage-limits.js";
import { ALLOWED_CONTENT_TYPES, safeFileName } from "./shared/validation.js";

const bodySchema = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
});

async function getUploadUsage(tableName: string, scopeKey: string) {
  const response = await ddbClient.send(
    new GetCommand({ TableName: tableName, Key: { scopeKey }, ConsistentRead: true }),
  );
  return {
    count: typeof response.Item?.usageCount === "number" ? response.Item.usageCount : 0,
    reservedBytes:
      typeof response.Item?.reservedBytes === "number" ? response.Item.reservedBytes : 0,
  };
}

export async function handler(event: JwtEvent): Promise<APIGatewayProxyStructuredResultV2> {
  const requestId = event.requestContext.requestId;
  try {
    const auth = getAuthContext(event);
    const env = getEnv();
    const dailyJobLimits = getDailyJobLimits();
    const body = bodySchema.parse(JSON.parse(event.body ?? "{}") as unknown);

    if (!ALLOWED_CONTENT_TYPES.has(body.contentType)) {
      return errorResponse(
        400,
        "UNSUPPORTED_CONTENT_TYPE",
        "JPEGまたはPNGを指定してください。",
        requestId,
      );
    }
    if (body.sizeBytes > env.maxUploadBytes) {
      return errorResponse(
        400,
        "FILE_TOO_LARGE",
        "ファイルサイズが上限を超えています。",
        requestId,
        { maxUploadBytes: env.maxUploadBytes },
      );
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const usageWindow = dailyUsageWindow(now);
    const usageKeys = uploadUsageScopeKeys(auth.userId, usageWindow.date);
    const limits = dailyUsageLimits({
      tier: auth.tier,
      tierJobLimits: dailyJobLimits,
      systemJobLimit: env.systemDailyJobLimit,
      maxUploadBytes: env.maxUploadBytes,
    });
    try {
      await ddbClient.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: env.concurrencyTableName,
                Key: { scopeKey: usageKeys.user },
                UpdateExpression:
                  "SET usageCount = if_not_exists(usageCount, :zero) + :one, reservedBytes = if_not_exists(reservedBytes, :zero) + :bytes, tier = :tier, usageDate = :date, updatedAt = :now, #ttl = :ttl",
                ConditionExpression:
                  "(attribute_not_exists(usageCount) OR usageCount < :countLimit) AND (attribute_not_exists(reservedBytes) OR reservedBytes <= :maxExistingBytes)",
                ExpressionAttributeNames: { "#ttl": "ttl" },
                ExpressionAttributeValues: {
                  ":zero": 0,
                  ":one": 1,
                  ":bytes": body.sizeBytes,
                  ":countLimit": limits.userUploadCountLimit,
                  ":maxExistingBytes": limits.userUploadBytesLimit - body.sizeBytes,
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
                  "SET usageCount = if_not_exists(usageCount, :zero) + :one, reservedBytes = if_not_exists(reservedBytes, :zero) + :bytes, usageDate = :date, updatedAt = :now, #ttl = :ttl",
                ConditionExpression:
                  "(attribute_not_exists(usageCount) OR usageCount < :countLimit) AND (attribute_not_exists(reservedBytes) OR reservedBytes <= :maxExistingBytes)",
                ExpressionAttributeNames: { "#ttl": "ttl" },
                ExpressionAttributeValues: {
                  ":zero": 0,
                  ":one": 1,
                  ":bytes": body.sizeBytes,
                  ":countLimit": limits.systemUploadCountLimit,
                  ":maxExistingBytes": limits.systemUploadBytesLimit - body.sizeBytes,
                  ":date": usageWindow.date,
                  ":now": nowIso,
                  ":ttl": usageWindow.ttl,
                },
              },
            },
          ],
        }),
      );
    } catch (error) {
      const [userUsage, systemUsage] = await Promise.all([
        getUploadUsage(env.concurrencyTableName, usageKeys.user),
        getUploadUsage(env.concurrencyTableName, usageKeys.system),
      ]);
      if (userUsage.count >= limits.userUploadCountLimit) {
        return errorResponse(
          429,
          "DAILY_UPLOAD_URL_LIMIT_EXCEEDED",
          "本日のアップロードURL発行上限に達しています。",
          requestId,
          {
            date: usageWindow.date,
            used: userUsage.count,
            limit: limits.userUploadCountLimit,
          },
        );
      }
      if (userUsage.reservedBytes + body.sizeBytes > limits.userUploadBytesLimit) {
        return errorResponse(
          429,
          "DAILY_UPLOAD_BYTES_LIMIT_EXCEEDED",
          "本日のアップロード予約容量上限に達しています。",
          requestId,
          {
            date: usageWindow.date,
            reservedBytes: userUsage.reservedBytes,
            requestedBytes: body.sizeBytes,
            limitBytes: limits.userUploadBytesLimit,
          },
        );
      }
      if (
        systemUsage.count >= limits.systemUploadCountLimit ||
        systemUsage.reservedBytes + body.sizeBytes > limits.systemUploadBytesLimit
      ) {
        return errorResponse(
          503,
          "DAILY_UPLOAD_CAPACITY_EXHAUSTED",
          "本日のシステムアップロード受付上限に達しています。",
          requestId,
          {
            date: usageWindow.date,
            count: systemUsage.count,
            reservedBytes: systemUsage.reservedBytes,
          },
        );
      }
      throw error;
    }

    const objectKey = `uploads/${auth.userId}/${ulid()}-${safeFileName(body.fileName)}`;
    const upload = await createPresignedPost(
      s3Client,
      buildPresignedPostOptions({
        bucket: env.inputBucketName,
        objectKey,
        contentType: body.contentType,
        owner: auth.userId,
        expires: env.uploadUrlExpiresSeconds,
        maxUploadBytes: env.maxUploadBytes,
      }),
    );

    return jsonResponse(200, {
      objectKey,
      uploadUrl: upload.url,
      uploadFields: upload.fields,
      expiresInSeconds: env.uploadUrlExpiresSeconds,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return errorResponse(error.statusCode, error.code, error.message, requestId);
    }
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return errorResponse(400, "INVALID_REQUEST", "リクエスト形式が正しくありません。", requestId);
    }
    console.error(JSON.stringify({ requestId, event: "upload_url_failed", error: String(error) }));
    return errorResponse(500, "INTERNAL_ERROR", "アップロードURLの発行に失敗しました。", requestId);
  }
}
