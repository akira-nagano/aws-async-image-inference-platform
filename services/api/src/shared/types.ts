import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";

export type JwtEvent = APIGatewayProxyEventV2WithJWTAuthorizer;

export const TIER_NAMES = ["tier-basic", "tier-standard", "tier-premium"] as const;

export type TierName = (typeof TIER_NAMES)[number];

export type JobStatus =
  | "RESERVED"
  | "QUEUED"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "TIMED_OUT"
  | "CANCELLED"
  | "SUBMIT_FAILED";
export type TerminalJobStatus = Exclude<JobStatus, "RESERVED" | "QUEUED" | "RUNNING">;

export type SlotState = "HELD" | "RELEASED";

export interface AuthContext {
  userId: string;
  groups: string[];
  tier: TierName;
}

export interface Prediction {
  rank: number;
  productCode: string;
  confidence: number;
  productName?: string;
  brand?: string;
}

export interface JobRecord {
  jobId: string;
  userId: string;
  tier: TierName;
  tierLimit: number;
  status: JobStatus;
  slotState: SlotState;
  objectKey: string;
  idempotencyKeyHash: string;
  createdAt: string;
  activeKey?: "ACTIVE";
  leaseExpiresAt?: number;
  executionArn?: string;
  queuedAt?: string;
  startedAt?: string;
  completedAt?: string;
  modelVersion?: string;
  processingTimeMs?: number;
  predictions?: Prediction[];
  errorCode?: string;
  errorMessage?: string;
  ttl?: number;
}

export interface TierLimits {
  "tier-basic": number;
  "tier-standard": number;
  "tier-premium": number;
}
