import type { DynamoDBBatchResponse, DynamoDBRecord, DynamoDBStreamEvent } from "aws-lambda";
import type { AttributeValue } from "@aws-sdk/client-dynamodb";
import { StartExecutionCommand } from "@aws-sdk/client-sfn";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { ddbClient, sfnClient } from "./shared/aws.js";
import { getEnv } from "./shared/env.js";
import { finalizeJob } from "./shared/job-lifecycle.js";
import { emitAnomalyMetric } from "./shared/metrics.js";
import type { JobRecord } from "./shared/types.js";

interface LocalDispatchEvent {
  localJob: JobRecord;
}

const DEFINITIVE_START_FAILURES = new Set([
  "InvalidArn",
  "InvalidExecutionInput",
  "InvalidName",
  "StateMachineDoesNotExist",
  "ValidationException",
]);

class DispatchFinalizeError extends Error {
  readonly causeName: string;

  constructor(causeName: string) {
    super("Failed to finalize a permanently undispatched job");
    this.name = "DispatchFinalizeError";
    this.causeName = causeName;
  }
}

function executionArnFor(stateMachineArn: string, executionName: string): string {
  return `${stateMachineArn.replace(":stateMachine:", ":execution:")}:${executionName}`;
}

function errorName(error: unknown): string {
  if (typeof error === "object" && error !== null && "name" in error) {
    return String(error.name);
  }
  return "UnknownError";
}

function isNamedError(error: unknown, name: string): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === name;
}

function isConditionalCheckFailed(error: unknown): boolean {
  return isNamedError(error, "ConditionalCheckFailedException");
}

function jobFromRecord(record: DynamoDBRecord): JobRecord | undefined {
  const image = record.dynamodb?.NewImage;
  if (!image) return undefined;
  return unmarshall(image as Record<string, AttributeValue>) as JobRecord;
}

async function terminalizeDefinitiveStartFailure(job: JobRecord, causeName: string): Promise<void> {
  try {
    await finalizeJob({
      jobId: job.jobId,
      status: "FAILED",
      expectedStatuses: ["RESERVED"],
      error: {
        code: "DISPATCH_FAILED",
        message: "推論ワークフローを開始できませんでした。",
      },
    });
    emitAnomalyMetric("DispatchAnomaly", 1, {
      event: "dispatch_anomaly",
      failureKind: "terminalized",
      jobId: job.jobId,
      causeName,
    });
  } catch (error) {
    emitAnomalyMetric("DispatchAnomaly", 1, {
      event: "dispatch_failure",
      failureKind: "finalize",
      jobId: job.jobId,
      causeName,
      finalizeErrorName: errorName(error),
    });
    throw new DispatchFinalizeError(causeName);
  }
}

export async function dispatchJob(job: JobRecord): Promise<void> {
  if (job.status !== "RESERVED" || job.slotState !== "HELD") return;

  const env = getEnv();
  if (!env.stateMachineArn) {
    await terminalizeDefinitiveStartFailure(job, "StateMachineArnNotConfigured");
    return;
  }
  const executionArn = executionArnFor(env.stateMachineArn, job.jobId);
  try {
    const execution = await sfnClient.send(
      new StartExecutionCommand({
        stateMachineArn: env.stateMachineArn,
        name: job.jobId,
        input: JSON.stringify({
          jobId: job.jobId,
          userId: job.userId,
          tier: job.tier,
          objectKey: job.objectKey,
        }),
      }),
    );
    if (!execution.executionArn) throw new Error("StartExecution returned no ARN");
  } catch (error) {
    if (isNamedError(error, "ExecutionAlreadyExists")) {
      // A deterministic execution name makes a duplicate stream delivery idempotent.
    } else if (DEFINITIVE_START_FAILURES.has(errorName(error))) {
      await terminalizeDefinitiveStartFailure(job, errorName(error));
      return;
    } else {
      // Timeouts, network errors, 5xx responses, and transient service limits are
      // ambiguous or recoverable. Retrying is safer than releasing a potentially
      // running execution's slot.
      throw error;
    }
  }

  const now = new Date().toISOString();
  try {
    await ddbClient.send(
      new UpdateCommand({
        TableName: env.jobsTableName,
        Key: { jobId: job.jobId },
        UpdateExpression:
          "SET #status = :queued, queuedAt = if_not_exists(queuedAt, :now), executionArn = if_not_exists(executionArn, :executionArn)",
        ConditionExpression: "slotState = :held AND #status = :reserved",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":queued": "QUEUED",
          ":reserved": "RESERVED",
          ":held": "HELD",
          ":now": now,
          ":executionArn": executionArn,
        },
      }),
    );
  } catch (error) {
    if (!isConditionalCheckFailed(error)) throw error;

    // MarkRunning can win the race after StartExecution. Preserve the execution ARN
    // without moving an already-running or terminal Job back to QUEUED.
    await ddbClient.send(
      new UpdateCommand({
        TableName: env.jobsTableName,
        Key: { jobId: job.jobId },
        UpdateExpression: "SET executionArn = if_not_exists(executionArn, :executionArn)",
        ConditionExpression: "attribute_exists(jobId)",
        ExpressionAttributeValues: { ":executionArn": executionArn },
      }),
    );
  }
}

function isLocalDispatchEvent(
  event: DynamoDBStreamEvent | LocalDispatchEvent,
): event is LocalDispatchEvent {
  return "localJob" in event;
}

export async function handler(
  event: DynamoDBStreamEvent | LocalDispatchEvent,
): Promise<DynamoDBBatchResponse> {
  if (isLocalDispatchEvent(event)) {
    try {
      await dispatchJob(event.localJob);
    } catch (error) {
      if (!(error instanceof DispatchFinalizeError)) {
        emitAnomalyMetric("DispatchAnomaly", 1, {
          event: "dispatch_failure",
          failureKind: "retryable",
          jobId: event.localJob.jobId,
          errorName: errorName(error),
        });
      }
      throw error;
    }
    return { batchItemFailures: [] };
  }

  const batchItemFailures: DynamoDBBatchResponse["batchItemFailures"] = [];
  for (const record of event.Records) {
    let job: JobRecord | undefined;
    try {
      job = jobFromRecord(record);
      if (job) await dispatchJob(job);
    } catch (error) {
      if (!(error instanceof DispatchFinalizeError)) {
        emitAnomalyMetric("DispatchAnomaly", 1, {
          event: "dispatch_failure",
          failureKind: "retryable",
          jobId: job?.jobId,
          errorName: errorName(error),
        });
      }
      console.error(
        JSON.stringify({
          event: "job_dispatch_failed",
          eventId: record.eventID,
          jobId: job?.jobId,
          errorName: errorName(error),
          causeName: error instanceof DispatchFinalizeError ? error.causeName : undefined,
        }),
      );
      if (record.eventID) batchItemFailures.push({ itemIdentifier: record.eventID });
    }
  }
  return { batchItemFailures };
}
