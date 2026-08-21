import { finalizeJob, type FinalizeInput } from "./shared/job-lifecycle.js";

export async function handler(event: FinalizeInput) {
  const outcome = await finalizeJob(event);
  console.log(
    JSON.stringify({
      event: "job_finalized",
      jobId: event.jobId,
      status: event.status,
      released: outcome.released,
    }),
  );
  return outcome;
}
