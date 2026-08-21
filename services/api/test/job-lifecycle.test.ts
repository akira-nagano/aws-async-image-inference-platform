import { describe, expect, it, mock } from "bun:test";
import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";

const job = {
  jobId: "job-1",
  userId: "user-1",
  tier: "tier-basic",
  status: "RUNNING",
  slotState: "HELD",
};
let sendCount = 0;
const send = mock(async (_command: unknown) => {
  sendCount += 1;
  return sendCount === 1 ? { Item: job } : {};
});

mock.module("../src/shared/aws.js", () => ({
  ddbClient: { send },
}));

process.env.INPUT_BUCKET_NAME = "input";
process.env.JOBS_TABLE_NAME = "jobs";
process.env.CONCURRENCY_TABLE_NAME = "concurrency";

const { finalizeJob } = await import("../src/shared/job-lifecycle.js");

describe("job finalization", () => {
  it("escapes the reserved DynamoDB ttl attribute and releases the slot atomically", async () => {
    sendCount = 0;
    send.mockClear();

    await expect(
      finalizeJob({
        jobId: job.jobId,
        status: "SUCCEEDED",
        result: {
          predictions: [
            {
              rank: 1,
              productCode: "MODEL-001",
              confidence: 0.93,
              productName: "Example product",
              brand: "Example brand",
            },
          ],
        },
      }),
    ).resolves.toEqual({ released: true });

    expect(send).toHaveBeenCalledTimes(2);
    const command = send.mock.calls[1]?.[0];
    expect(command).toBeInstanceOf(TransactWriteCommand);
    if (!(command instanceof TransactWriteCommand)) {
      throw new TypeError("Expected a TransactWriteCommand");
    }
    const transaction = command.input.TransactItems;
    const jobUpdate = transaction?.[0]?.Update;
    expect(jobUpdate?.UpdateExpression).toContain("#ttl = :ttl");
    expect(jobUpdate?.ExpressionAttributeNames?.["#ttl"]).toBe("ttl");
    expect(jobUpdate?.ConditionExpression).toBe("slotState = :held");
    expect(jobUpdate?.ExpressionAttributeValues?.[":predictions"]).toEqual([
      {
        rank: 1,
        productCode: "MODEL-001",
        confidence: 0.93,
        productName: "Example product",
        brand: "Example brand",
      },
    ]);
    expect(transaction).toHaveLength(3);
  });

  it("restricts dispatcher finalization to the expected non-terminal status", async () => {
    sendCount = 0;
    send.mockClear();

    await finalizeJob({
      jobId: job.jobId,
      status: "FAILED",
      expectedStatuses: ["RESERVED"],
      error: { code: "DISPATCH_FAILED" },
    });

    const command = send.mock.calls[1]?.[0];
    expect(command).toBeInstanceOf(TransactWriteCommand);
    if (!(command instanceof TransactWriteCommand)) {
      throw new TypeError("Expected a TransactWriteCommand");
    }
    const jobUpdate = command.input.TransactItems?.[0]?.Update;
    expect(jobUpdate?.ConditionExpression).toBe(
      "slotState = :held AND #status IN (:expectedStatus0)",
    );
    expect(jobUpdate?.ExpressionAttributeNames?.["#status"]).toBe("status");
    expect(jobUpdate?.ExpressionAttributeValues?.[":expectedStatus0"]).toBe("RESERVED");
  });
});
