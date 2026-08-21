import type { Context } from "aws-lambda";
import { QueryCommand, type QueryCommandInput } from "@aws-sdk/lib-dynamodb";
import { ddbClient } from "./shared/aws.js";
import { getEnv } from "./shared/env.js";
import { finalizeJob } from "./shared/job-lifecycle.js";
import { emitAnomalyMetric } from "./shared/metrics.js";
import type { JobRecord } from "./shared/types.js";

export interface ReaperResult {
  scanned: number;
  released: number;
  failed: number;
  hasMore: boolean;
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

export async function handler(_event: unknown, context?: Context): Promise<ReaperResult> {
  const env = getEnv();
  const now = Math.floor(Date.now() / 1000);
  let exclusiveStartKey: QueryCommandInput["ExclusiveStartKey"];
  let scanned = 0;
  let released = 0;
  let failed = 0;
  let hasMore = false;

  do {
    const remainingCapacity = env.reaperMaxJobs - scanned;
    if (remainingCapacity <= 0 || (context && context.getRemainingTimeInMillis() < 5_000)) {
      hasMore = true;
      break;
    }

    const response = await ddbClient.send(
      new QueryCommand({
        TableName: env.jobsTableName,
        IndexName: env.activeJobsIndexName,
        KeyConditionExpression: "activeKey = :active AND leaseExpiresAt < :now",
        ExpressionAttributeValues: { ":active": "ACTIVE", ":now": now },
        ExclusiveStartKey: exclusiveStartKey,
        Limit: Math.min(env.reaperPageSize, remainingCapacity),
      }),
    );
    const jobs = (response.Items ?? []) as JobRecord[];
    scanned += jobs.length;

    for (const group of chunks(jobs, env.reaperConcurrency)) {
      const results = await Promise.allSettled(
        group.map((job) =>
          finalizeJob({
            jobId: job.jobId,
            status: "TIMED_OUT",
            error: { code: "JOB_LEASE_EXPIRED", message: "推論処理がタイムアウトしました。" },
          }),
        ),
      );
      results.forEach((result, index) => {
        const job = group[index]!;
        if (result.status === "fulfilled") {
          if (result.value.released) released += 1;
          return;
        }
        failed += 1;
        console.error(
          JSON.stringify({
            event: "reaper_finalize_failed",
            jobId: job.jobId,
            error: String(result.reason),
          }),
        );
      });
    }

    exclusiveStartKey = response.LastEvaluatedKey;
    hasMore = Boolean(exclusiveStartKey);
  } while (exclusiveStartKey);

  emitAnomalyMetric("ReaperAnomaly", released + failed, {
    event: "reaper_completed",
    scanned,
    released,
    failed,
    hasMore,
  });
  return { scanned, released, failed, hasMore };
}
