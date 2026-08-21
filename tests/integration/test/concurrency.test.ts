import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

const api = process.env.TEST_API_BASE_URL?.replace(/\/$/, "");
const token = process.env.TEST_ACCESS_TOKEN;
const enabled = Boolean(api && token);
const localUserId = process.env.TEST_LOCAL_USER_ID;
const localGroups = process.env.TEST_LOCAL_GROUPS;
const sampleImage = readFileSync(join(import.meta.dir, "../../../examples/sample-image.png"));

interface UploadResponse {
  objectKey: string;
  uploadUrl: string;
  uploadFields: Record<string, string>;
}

interface JobResponse {
  jobId: string;
  status: string;
  concurrency?: {
    active: number;
    limit: number;
  };
}

async function apiRequest(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${api}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(localUserId ? { "x-local-user-id": localUserId } : {}),
      ...(localGroups ? { "x-local-groups": localGroups } : {}),
      ...(init.headers ?? {}),
    },
  });
}

async function createUploadedObject(index: number): Promise<string> {
  const body = sampleImage;
  const uploadResponse = await apiRequest("/api/upload-url", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fileName: `integration-${index}.png`,
      contentType: "image/png",
      sizeBytes: body.byteLength,
    }),
  });
  expect(uploadResponse.status).toBe(200);
  const upload = (await uploadResponse.json()) as UploadResponse;
  const form = new FormData();
  for (const [name, value] of Object.entries(upload.uploadFields)) form.append(name, value);
  form.append("file", new File([body], `integration-${index}.png`, { type: "image/png" }));
  const post = await fetch(upload.uploadUrl, {
    method: "POST",
    body: form,
  });
  expect(post.ok).toBe(true);
  return upload.objectKey;
}

async function submit(objectKey: string): Promise<Response> {
  return apiRequest("/api/jobs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
    },
    body: JSON.stringify({ objectKey }),
  });
}

const describeIntegration = enabled ? describe : describe.skip;

describeIntegration("tier concurrency integration", () => {
  it("never reports active jobs beyond the configured tier limit", async () => {
    const submissionCount = Number(process.env.TEST_SUBMISSION_COUNT ?? "2");
    const keys = await Promise.all(
      Array.from({ length: submissionCount }, (_, index) => createUploadedObject(index)),
    );
    const responses = await Promise.all(keys.map(submit));
    const accepted = responses.filter((response) => response.status === 202);
    const rejected = responses.filter((response) => response.status === 429);

    const expectedLimit = Number(process.env.TEST_EXPECTED_TIER_LIMIT ?? "1");
    // Floci can spread nominally parallel requests across container cold starts.
    // A completed job may therefore release a slot before a later request reaches
    // the transaction, so total 202 responses are not a concurrency measurement.
    expect(accepted.length).toBeGreaterThanOrEqual(expectedLimit);
    expect(rejected.length).toBeGreaterThan(0);
    expect(accepted.length + rejected.length).toBe(submissionCount);

    const acceptedJobs = await Promise.all(
      accepted.map((response) => response.json() as Promise<JobResponse>),
    );
    for (const job of acceptedJobs) {
      expect(job.concurrency?.limit).toBe(expectedLimit);
      expect(job.concurrency?.active).toBeLessThanOrEqual(expectedLimit);
    }
    await Promise.all(
      acceptedJobs.map(async ({ jobId }) => {
        for (let attempt = 0; attempt < 120; attempt += 1) {
          const response = await apiRequest(`/api/jobs/${jobId}`, { method: "GET" });
          expect(response.status).toBe(200);
          const job = (await response.json()) as JobResponse;
          if (["SUCCEEDED", "FAILED", "TIMED_OUT", "SUBMIT_FAILED"].includes(job.status)) {
            expect(job.status).toBe("SUCCEEDED");
            return;
          }
          await Bun.sleep(250);
        }
        throw new Error(`Job ${jobId} did not complete`);
      }),
    );
    const completedJobs = await Promise.all(
      acceptedJobs.map(async ({ jobId }) => {
        const response = await apiRequest(`/api/jobs/${jobId}`, { method: "GET" });
        expect(response.status).toBe(200);
        return response.json() as Promise<JobResponse>;
      }),
    );
    for (const job of completedJobs) {
      expect(job.status).toBe("SUCCEEDED");
      expect(job.concurrency?.active).toBe(0);
    }
  }, 120_000);
});
