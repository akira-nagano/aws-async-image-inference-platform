import { markJobRunning } from "./shared/job-lifecycle.js";

export interface MarkRunningEvent {
  jobId: string;
}

export async function handler(event: MarkRunningEvent) {
  const job = await markJobRunning(event.jobId);
  console.log(JSON.stringify({ event: "job_running", jobId: job.jobId }));
  return { jobId: job.jobId, status: job.status };
}
