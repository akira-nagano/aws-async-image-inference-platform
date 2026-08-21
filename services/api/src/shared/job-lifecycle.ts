import {
  GetCommand,
  TransactWriteCommand,
  UpdateCommand,
  type TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "./aws.js";
import { getEnv } from "./env.js";
import { logJobFinalized } from "./metrics.js";
import type { NativeAttributeValue } from "@aws-sdk/util-dynamodb";
import type { JobRecord, JobStatus, Prediction, TerminalJobStatus } from "./types.js";

export interface FinalizeInput {
  jobId: string;
  status: TerminalJobStatus;
  expectedStatuses?: JobStatus[];
  result?: {
    modelVersion?: string;
    processingTimeMs?: number;
    predictions?: Prediction[];
  };
  error?: {
    code?: string;
    message?: string;
  };
}

export async function getJob(jobId: string): Promise<JobRecord | undefined> {
  const { jobsTableName } = getEnv();
  const response = await ddbClient.send(
    new GetCommand({ TableName: jobsTableName, Key: { jobId }, ConsistentRead: true }),
  );
  return response.Item as JobRecord | undefined;
}

export async function markJobRunning(jobId: string): Promise<JobRecord> {
  const env = getEnv();
  const now = new Date();
  const leaseExpiresAt = Math.floor(now.getTime() / 1000) + env.runningLeaseSeconds;
  const response = await ddbClient.send(
    new UpdateCommand({
      TableName: env.jobsTableName,
      Key: { jobId },
      UpdateExpression:
        "SET #status = :running, startedAt = if_not_exists(startedAt, :now), leaseExpiresAt = :lease, activeKey = :active",
      ConditionExpression:
        "slotState = :held AND (#status = :reserved OR #status = :queued OR #status = :running)",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":running": "RUNNING",
        ":reserved": "RESERVED",
        ":queued": "QUEUED",
        ":held": "HELD",
        ":active": "ACTIVE",
        ":now": now.toISOString(),
        ":lease": leaseExpiresAt,
      },
      ReturnValues: "ALL_NEW",
    }),
  );
  return response.Attributes as JobRecord;
}

export async function finalizeJob(input: FinalizeInput): Promise<{ released: boolean }> {
  const env = getEnv();
  const job = await getJob(input.jobId);
  if (!job) throw new Error(`Job not found: ${input.jobId}`);
  if (job.slotState === "RELEASED") return { released: false };
  if (input.expectedStatuses?.length === 0) {
    throw new TypeError("expectedStatuses must contain at least one status");
  }

  const now = new Date().toISOString();
  const setParts = [
    "#status = :status",
    "slotState = :released",
    "completedAt = :now",
    "#ttl = :ttl",
  ];
  const values: Record<string, NativeAttributeValue> = {
    ":status": input.status,
    ":released": "RELEASED",
    ":held": "HELD",
    ":now": now,
    ":ttl": Math.floor(Date.now() / 1000) + env.jobRetentionDays * 86400,
  };
  const names: Record<string, string> = { "#status": "status", "#ttl": "ttl" };
  const expectedStatusCondition = input.expectedStatuses
    ? ` AND #status IN (${input.expectedStatuses
        .map((status, index) => {
          const key = `:expectedStatus${index}`;
          values[key] = status;
          return key;
        })
        .join(", ")})`
    : "";

  if (input.result?.modelVersion !== undefined) {
    setParts.push("modelVersion = :modelVersion");
    values[":modelVersion"] = input.result.modelVersion;
  }
  if (input.result?.processingTimeMs !== undefined) {
    setParts.push("processingTimeMs = :processingTimeMs");
    values[":processingTimeMs"] = input.result.processingTimeMs;
  }
  if (input.result?.predictions !== undefined) {
    setParts.push("predictions = :predictions");
    values[":predictions"] = input.result.predictions.map((prediction) => {
      const item: Prediction = {
        rank: prediction.rank,
        productCode: prediction.productCode.slice(0, 128),
        confidence: prediction.confidence,
      };
      if (prediction.productName !== undefined) {
        item.productName = prediction.productName.slice(0, 256);
      }
      if (prediction.brand !== undefined) {
        item.brand = prediction.brand.slice(0, 128);
      }
      return item;
    });
  }
  if (input.error?.code !== undefined) {
    setParts.push("errorCode = :errorCode");
    values[":errorCode"] = input.error.code;
  }
  if (input.error?.message !== undefined) {
    setParts.push("errorMessage = :errorMessage");
    values[":errorMessage"] = input.error.message.slice(0, 1000);
  }

  const transact: TransactWriteCommandInput = {
    TransactItems: [
      {
        Update: {
          TableName: env.jobsTableName,
          Key: { jobId: input.jobId },
          UpdateExpression: `SET ${setParts.join(", ")} REMOVE activeKey, leaseExpiresAt`,
          ConditionExpression: `slotState = :held${expectedStatusCondition}`,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        },
      },
      {
        Update: {
          TableName: env.concurrencyTableName,
          Key: { scopeKey: `USER#${job.userId}` },
          UpdateExpression: "SET activeCount = activeCount - :one, updatedAt = :now",
          ConditionExpression: "activeCount > :zero",
          ExpressionAttributeValues: { ":one": 1, ":zero": 0, ":now": now },
        },
      },
      {
        Update: {
          TableName: env.concurrencyTableName,
          Key: { scopeKey: "SYSTEM#INFERENCE" },
          UpdateExpression: "SET activeCount = activeCount - :one, updatedAt = :now",
          ConditionExpression: "activeCount > :zero",
          ExpressionAttributeValues: { ":one": 1, ":zero": 0, ":now": now },
        },
      },
    ],
  };

  try {
    await ddbClient.send(new TransactWriteCommand(transact));
    logJobFinalized(input.status, input.jobId);
    return { released: true };
  } catch (error) {
    const current = await getJob(input.jobId);
    if (current?.slotState === "RELEASED") return { released: false };
    throw error;
  }
}
