import type { TerminalJobStatus } from "./types.js";

export type AnomalyMetricName = "DispatchAnomaly" | "ReaperAnomaly";

export function emitAnomalyMetric(
  name: AnomalyMetricName,
  value: number,
  properties: Record<string, unknown> = {},
): void {
  const environment = process.env.ENVIRONMENT_NAME ?? "unknown";
  console.log(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: "ImgFlow",
            Dimensions: [["Environment"]],
            Metrics: [{ Name: name, Unit: "Count" }],
          },
        ],
      },
      Environment: environment,
      [name]: value,
      ...properties,
    }),
  );
}

export function logJobFinalized(status: TerminalJobStatus, jobId: string): void {
  console.info(JSON.stringify({ event: "job_finalized", jobId, status }));
}
