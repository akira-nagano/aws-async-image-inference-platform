import { beforeEach, describe, expect, it, mock } from "bun:test";
import { StartExecutionCommand } from "@aws-sdk/client-sfn";
import { GetCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";
import type { DynamoDBStreamEvent } from "aws-lambda";
import type { JobRecord } from "../src/shared/types.js";

let startError: Error | undefined;
let updateError: Error | undefined;
let finalizeError: Error | undefined;
const sfnSend = mock(async (_command: unknown) => {
  if (startError) throw startError;
  return {
    executionArn: "arn:aws:states:ap-northeast-1:000000000000:execution:machine:job-1",
  };
});
const ddbSend = mock(async (command: unknown) => {
  if (command instanceof GetCommand) return { Item: job };
  if (command instanceof TransactWriteCommand && finalizeError) throw finalizeError;
  if (command instanceof UpdateCommand && updateError) {
    const error = updateError;
    updateError = undefined;
    throw error;
  }
  return {};
});
const emitAnomalyMetric = mock((_metrics: unknown, _properties: unknown) => undefined);

mock.module("../src/shared/aws.js", () => ({
  ddbClient: { send: ddbSend },
  sfnClient: { send: sfnSend },
}));
mock.module("../src/shared/metrics.js", () => ({
  logJobFinalized: mock((_status: unknown, _jobId: unknown) => undefined),
  emitAnomalyMetric,
}));

process.env.INPUT_BUCKET_NAME = "input";
process.env.JOBS_TABLE_NAME = "jobs";
process.env.CONCURRENCY_TABLE_NAME = "concurrency";
process.env.STATE_MACHINE_ARN = "arn:aws:states:ap-northeast-1:000000000000:stateMachine:machine";

const { dispatchJob, handler } = await import("../src/job-dispatcher.js");

const job: JobRecord = {
  jobId: "job-1",
  userId: "user-1",
  tier: "tier-basic",
  tierLimit: 1,
  status: "RESERVED",
  slotState: "HELD",
  objectKey: "uploads/user-1/image.png",
  idempotencyKeyHash: "hash",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function streamEvent(): DynamoDBStreamEvent {
  return {
    Records: [
      {
        eventID: "record-1",
        eventName: "INSERT",
        eventVersion: "1.1",
        eventSource: "aws:dynamodb",
        awsRegion: "ap-northeast-1",
        eventSourceARN: "arn:aws:dynamodb:ap-northeast-1:000000000000:table/jobs/stream/example",
        dynamodb: {
          NewImage: marshall(job),
          StreamViewType: "NEW_AND_OLD_IMAGES",
        },
      },
    ],
  } as unknown as DynamoDBStreamEvent;
}

function finalizationTransaction(): TransactWriteCommand | undefined {
  return ddbSend.mock.calls
    .map(([command]) => command)
    .find((command): command is TransactWriteCommand => command instanceof TransactWriteCommand);
}

describe("job dispatcher", () => {
  beforeEach(() => {
    startError = undefined;
    updateError = undefined;
    finalizeError = undefined;
    sfnSend.mockClear();
    ddbSend.mockClear();
    emitAnomalyMetric.mockClear();
  });

  it("starts a deterministic execution and moves the reservation to QUEUED", async () => {
    await dispatchJob(job);

    expect(sfnSend).toHaveBeenCalledTimes(1);
    expect(ddbSend).toHaveBeenCalledTimes(1);
    const start = sfnSend.mock.calls[0]?.[0];
    const update = ddbSend.mock.calls[0]?.[0];
    expect(start).toBeInstanceOf(StartExecutionCommand);
    expect(update).toBeInstanceOf(UpdateCommand);
    if (!(start instanceof StartExecutionCommand) || !(update instanceof UpdateCommand)) {
      throw new TypeError("Expected Step Functions and DynamoDB commands");
    }
    expect(start.input.name).toBe("job-1");
    expect(JSON.parse(start.input.input ?? "{}")).toEqual({
      jobId: "job-1",
      userId: "user-1",
      tier: "tier-basic",
      objectKey: "uploads/user-1/image.png",
    });
    expect(update.input.ConditionExpression).toBe("slotState = :held AND #status = :reserved");
  });

  it("accepts the local Floci dispatch adapter event", async () => {
    await expect(handler({ localJob: job })).resolves.toEqual({ batchItemFailures: [] });
    expect(sfnSend).toHaveBeenCalledTimes(1);
    expect(ddbSend).toHaveBeenCalledTimes(1);
  });

  it("treats an existing deterministic execution as an idempotent retry", async () => {
    startError = Object.assign(new Error("already exists"), {
      name: "ExecutionAlreadyExists",
    });

    await expect(dispatchJob(job)).resolves.toBeUndefined();
    expect(ddbSend).toHaveBeenCalledTimes(1);
    expect(finalizationTransaction()).toBeUndefined();
  });

  it("terminalizes a deterministic StartExecution rejection and releases only RESERVED", async () => {
    startError = Object.assign(new Error("missing state machine"), {
      name: "StateMachineDoesNotExist",
    });

    await expect(dispatchJob(job)).resolves.toBeUndefined();

    const transaction = finalizationTransaction();
    expect(transaction).toBeInstanceOf(TransactWriteCommand);
    expect(transaction?.input.TransactItems?.[0]?.Update?.ConditionExpression).toBe(
      "slotState = :held AND #status IN (:expectedStatus0)",
    );
    expect(transaction?.input.TransactItems?.[0]?.Update?.ExpressionAttributeValues).toMatchObject({
      ":status": "FAILED",
      ":expectedStatus0": "RESERVED",
      ":errorCode": "DISPATCH_FAILED",
      ":errorMessage": "推論ワークフローを開始できませんでした。",
    });
    expect(emitAnomalyMetric).toHaveBeenCalledWith(
      "DispatchAnomaly",
      1,
      expect.objectContaining({
        failureKind: "terminalized",
        jobId: "job-1",
        causeName: "StateMachineDoesNotExist",
      }),
    );
  });

  it("retries transient StartExecution failures without releasing the slot", async () => {
    startError = Object.assign(new Error("execution limit"), {
      name: "ExecutionLimitExceeded",
    });

    await expect(dispatchJob(job)).rejects.toHaveProperty("name", "ExecutionLimitExceeded");
    expect(finalizationTransaction()).toBeUndefined();
  });

  it("does not release the slot when the post-start QUEUED update fails", async () => {
    updateError = Object.assign(new Error("DynamoDB unavailable"), {
      name: "InternalServerError",
    });

    await expect(dispatchJob(job)).rejects.toHaveProperty("name", "InternalServerError");
    expect(sfnSend).toHaveBeenCalledTimes(1);
    expect(finalizationTransaction()).toBeUndefined();
  });

  it("returns a partial batch failure and emits a custom metric for retryable failures", async () => {
    startError = Object.assign(new Error("network timeout"), { name: "TimeoutError" });

    await expect(handler(streamEvent())).resolves.toEqual({
      batchItemFailures: [{ itemIdentifier: "record-1" }],
    });
    expect(finalizationTransaction()).toBeUndefined();
    expect(emitAnomalyMetric).toHaveBeenCalledWith(
      "DispatchAnomaly",
      1,
      expect.objectContaining({
        failureKind: "retryable",
        jobId: "job-1",
        errorName: "TimeoutError",
      }),
    );
  });

  it("retries when permanent-failure finalization itself fails", async () => {
    startError = Object.assign(new Error("missing state machine"), {
      name: "StateMachineDoesNotExist",
    });
    finalizeError = Object.assign(new Error("transaction failed"), {
      name: "TransactionCanceledException",
    });

    await expect(handler(streamEvent())).resolves.toEqual({
      batchItemFailures: [{ itemIdentifier: "record-1" }],
    });
    expect(emitAnomalyMetric).toHaveBeenCalledWith(
      "DispatchAnomaly",
      1,
      expect.objectContaining({
        failureKind: "finalize",
        jobId: "job-1",
        causeName: "StateMachineDoesNotExist",
        finalizeErrorName: "TransactionCanceledException",
      }),
    );
    expect(emitAnomalyMetric).toHaveBeenCalledTimes(1);
  });

  it("does not regress a job that reached RUNNING before the QUEUED update", async () => {
    updateError = Object.assign(new Error("condition failed"), {
      name: "ConditionalCheckFailedException",
    });

    await dispatchJob(job);

    expect(ddbSend).toHaveBeenCalledTimes(2);
    const fallback = ddbSend.mock.calls[1]?.[0];
    expect(fallback).toBeInstanceOf(UpdateCommand);
    if (!(fallback instanceof UpdateCommand)) {
      throw new TypeError("Expected a DynamoDB update");
    }
    expect(fallback.input.UpdateExpression).not.toContain("#status");
    expect(fallback.input.UpdateExpression).toContain("executionArn");
  });
});
