import { beforeEach, describe, expect, it, mock } from "bun:test";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";

let queryCount = 0;
const ddbSend = mock(async (command: unknown) => {
  if (!(command instanceof QueryCommand)) {
    throw new TypeError("Expected a QueryCommand");
  }
  queryCount += 1;
  if (queryCount === 1) {
    return {
      Items: [{ jobId: "job-1" }, { jobId: "job-2" }],
      LastEvaluatedKey: { jobId: "job-2" },
    };
  }
  return { Items: [{ jobId: "job-3" }] };
});
const finalizeJob = mock(async ({ jobId }: { jobId: string }) => ({
  released: jobId !== "job-2",
}));
const emitAnomalyMetric = mock(() => undefined);

mock.module("../src/shared/aws.js", () => ({
  ddbClient: { send: ddbSend },
}));
mock.module("../src/shared/job-lifecycle.js", () => ({ finalizeJob }));
mock.module("../src/shared/metrics.js", () => ({ emitAnomalyMetric }));

process.env.INPUT_BUCKET_NAME = "input";
process.env.JOBS_TABLE_NAME = "jobs";
process.env.CONCURRENCY_TABLE_NAME = "concurrency";
process.env.REAPER_PAGE_SIZE = "2";
process.env.REAPER_MAX_JOBS = "10";
process.env.REAPER_CONCURRENCY = "2";

const { handler } = await import("../src/reaper.js");

describe("expired-job reaper", () => {
  beforeEach(() => {
    queryCount = 0;
    ddbSend.mockClear();
    finalizeJob.mockClear();
    emitAnomalyMetric.mockClear();
  });

  it("paginates the active-jobs index and finalizes jobs in bounded groups", async () => {
    const result = await handler(undefined, {
      getRemainingTimeInMillis: () => 60_000,
    } as never);

    expect(result).toEqual({
      scanned: 3,
      released: 2,
      failed: 0,
      hasMore: false,
    });
    expect(ddbSend).toHaveBeenCalledTimes(2);
    expect(finalizeJob).toHaveBeenCalledTimes(3);
    const secondQuery = ddbSend.mock.calls[1]?.[0];
    expect(secondQuery).toBeInstanceOf(QueryCommand);
    if (!(secondQuery instanceof QueryCommand)) {
      throw new TypeError("Expected a QueryCommand");
    }
    expect(secondQuery.input.ExclusiveStartKey).toEqual({ jobId: "job-2" });
    expect(emitAnomalyMetric).toHaveBeenCalledWith(
      "ReaperAnomaly",
      2,
      expect.objectContaining({
        scanned: 3,
        released: 2,
        failed: 0,
        hasMore: false,
      }),
    );
  });
});
