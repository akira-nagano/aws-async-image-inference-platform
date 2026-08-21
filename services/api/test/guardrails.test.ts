import { beforeEach, describe, expect, it, mock } from "bun:test";
import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { JwtEvent } from "../src/shared/types.js";

const transactions: TransactWriteCommand[] = [];
const ddbSend = mock(async (command: unknown) => {
  if (command instanceof TransactWriteCommand) {
    transactions.push(command);
    return {};
  }
  if (command instanceof GetCommand) {
    return {};
  }
  throw new Error(`Unexpected DynamoDB command: ${String(command)}`);
});
const s3Send = mock(async () => ({
  ContentLength: 1024,
  ContentType: "image/png",
  Metadata: { owner: "user-1" },
}));
const createPresignedPost = mock(async () => ({
  url: "https://bucket.s3.ap-northeast-1.amazonaws.com/",
  fields: { key: "value" },
}));

mock.module("../src/shared/aws.js", () => ({
  ddbClient: { send: ddbSend },
  lambdaClient: { send: mock(async () => ({})) },
  s3Client: { send: s3Send },
  sfnClient: { send: mock(async () => ({})) },
}));
mock.module("@aws-sdk/s3-presigned-post", () => ({ createPresignedPost }));

process.env.INPUT_BUCKET_NAME = "input";
process.env.JOBS_TABLE_NAME = "jobs";
process.env.CONCURRENCY_TABLE_NAME = "concurrency";
process.env.TIER_LIMITS_JSON = JSON.stringify({
  "tier-basic": 1,
  "tier-standard": 3,
  "tier-premium": 4,
});
process.env.DAILY_JOB_LIMITS_JSON = JSON.stringify({
  "tier-basic": 10,
  "tier-standard": 30,
  "tier-premium": 100,
});
process.env.SYSTEM_CONCURRENCY_LIMIT = "4";
process.env.SYSTEM_DAILY_JOB_LIMIT = "100";
process.env.MAX_UPLOAD_BYTES = String(5 * 1024 * 1024);
process.env.ALLOW_LOCAL_AUTH_BYPASS = "false";

const { handler: submitJob } = await import("../src/job-submit.js");
const { handler: issueUploadUrl } = await import("../src/upload-url.js");

function event(path: string, body: Record<string, unknown>): JwtEvent {
  return {
    version: "2.0",
    routeKey: `POST ${path}`,
    rawPath: path,
    rawQueryString: "",
    headers: {
      "content-type": "application/json",
      "idempotency-key": "request-key",
    },
    requestContext: {
      accountId: "000000000000",
      apiId: "api",
      domainName: "example.test",
      domainPrefix: "api",
      http: {
        method: "POST",
        path,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "test",
      },
      requestId: "request-1",
      routeKey: `POST ${path}`,
      stage: "$default",
      time: "24/Jul/2026:00:00:00 +0000",
      timeEpoch: 0,
      authorizer: {
        principalId: "user-1",
        integrationLatency: 0,
        jwt: {
          claims: {
            sub: "user-1",
            token_use: "access",
            "cognito:groups": '["tier-basic"]',
          },
          scopes: [],
        },
      },
    },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  };
}

beforeEach(() => {
  transactions.length = 0;
  ddbSend.mockClear();
  s3Send.mockClear();
  createPresignedPost.mockClear();
});

describe("cost guardrail transactions", () => {
  it("reserves concurrency and daily job usage in the job creation transaction", async () => {
    const response = await submitJob(event("/api/jobs", { objectKey: "uploads/user-1/input.png" }));
    expect(response.statusCode).toBe(202);
    expect(transactions).toHaveLength(1);
    const items = transactions[0]!.input.TransactItems ?? [];
    expect(items).toHaveLength(5);
    const keys = items
      .map((item) => item.Update?.Key?.scopeKey)
      .filter((key): key is string => typeof key === "string");
    expect(keys).toContain("USER#user-1");
    expect(keys).toContain("SYSTEM#INFERENCE");
    expect(keys.some((key) => key.startsWith("USAGE#JOB#USER#user-1#"))).toBe(true);
    expect(keys.some((key) => key.startsWith("USAGE#JOB#SYSTEM#"))).toBe(true);
    expect(items[4]?.Put?.ConditionExpression).toBe("attribute_not_exists(jobId)");
  });

  it("reserves per-user and system upload budgets before issuing a URL", async () => {
    const response = await issueUploadUrl(
      event("/api/upload-url", {
        fileName: "input.png",
        contentType: "image/png",
        sizeBytes: 1024,
      }),
    );
    expect(response.statusCode).toBe(200);
    expect(transactions).toHaveLength(1);
    const items = transactions[0]!.input.TransactItems ?? [];
    expect(items).toHaveLength(2);
    const keys = items.map((item) => item.Update?.Key?.scopeKey);
    expect(keys.some((key) => String(key).startsWith("USAGE#UPLOAD#USER#user-1#"))).toBe(true);
    expect(keys.some((key) => String(key).startsWith("USAGE#UPLOAD#SYSTEM#"))).toBe(true);
    for (const item of items) {
      expect(item.Update?.UpdateExpression).toContain("reservedBytes");
      expect(item.Update?.ConditionExpression).toContain("maxExistingBytes");
    }
    expect(createPresignedPost).toHaveBeenCalledTimes(1);
  });
});
