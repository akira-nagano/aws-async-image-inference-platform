import type { RuntimeConfig } from "./config";
import type { Session } from "./auth";

export interface Prediction {
  rank: number;
  productCode: string;
  confidence: number;
  productName?: string;
  brand?: string;
}

export interface JobResponse {
  jobId: string;
  status: string;
  tier?: string;
  modelVersion?: string;
  processingTimeMs?: number;
  predictions?: Prediction[];
  error?: { code: string; message: string };
  concurrency?: { active: number; limit: number; systemActive?: number; systemLimit?: number };
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

async function jsonFetch<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new ApiError(
      response.status,
      typeof body.code === "string" ? body.code : "HTTP_ERROR",
      typeof body.message === "string" ? body.message : `HTTP ${response.status}`,
      typeof body.details === "object" && body.details !== null
        ? (body.details as Record<string, unknown>)
        : undefined,
    );
  }
  return body as T;
}

function apiUrl(config: RuntimeConfig, path: string): string {
  return `${config.apiBaseUrl.replace(/\/$/, "")}${path}`;
}

export function authHeaders(config: RuntimeConfig, session: Session): Record<string, string> {
  return {
    authorization: `Bearer ${session.accessToken}`,
    ...(config.localAuthBypass === true
      ? {
          "x-local-user-id": session.userId,
          "x-local-groups": session.groups.join(","),
        }
      : {}),
  };
}

export async function uploadImage(
  config: RuntimeConfig,
  session: Session,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<string> {
  const data = await jsonFetch<{
    objectKey: string;
    uploadUrl: string;
    uploadFields: Record<string, string>;
  }>(apiUrl(config, "/upload-url"), {
    method: "POST",
    headers: {
      ...authHeaders(config, session),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type,
      sizeBytes: file.size,
    }),
  });

  onProgress?.(10);
  const form = new FormData();
  for (const [name, value] of Object.entries(data.uploadFields)) {
    form.append(name, value);
  }
  form.append("file", file);
  const response = await fetch(data.uploadUrl, {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    throw new ApiError(response.status, "S3_UPLOAD_FAILED", "画像アップロードに失敗しました。");
  }
  onProgress?.(100);
  return data.objectKey;
}

export async function submitJob(
  config: RuntimeConfig,
  session: Session,
  objectKey: string,
  idempotencyKey: string,
): Promise<JobResponse> {
  return jsonFetch<JobResponse>(apiUrl(config, "/jobs"), {
    method: "POST",
    headers: {
      ...authHeaders(config, session),
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify({ objectKey }),
  });
}

export async function getJob(
  config: RuntimeConfig,
  session: Session,
  jobId: string,
): Promise<JobResponse> {
  return jsonFetch<JobResponse>(apiUrl(config, `/jobs/${encodeURIComponent(jobId)}`), {
    headers: authHeaders(config, session),
  });
}

export function isTerminal(status: string): boolean {
  return ["SUCCEEDED", "FAILED", "TIMED_OUT", "CANCELLED", "SUBMIT_FAILED"].includes(status);
}

export function predictionTitle(prediction: Prediction): string {
  return prediction.productName ?? prediction.productCode;
}

export function predictionMetadata(prediction: Prediction): string {
  return [prediction.brand, prediction.productName ? prediction.productCode : undefined]
    .filter((value): value is string => value !== undefined)
    .join(" · ");
}
