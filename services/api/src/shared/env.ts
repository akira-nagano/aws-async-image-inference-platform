import { z } from "zod";
import type { TierLimits } from "./types.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function positiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

const tierLimitsSchema = z.object({
  "tier-basic": z.number().int().positive(),
  "tier-standard": z.number().int().positive(),
  "tier-premium": z.number().int().positive(),
});

export function getTierLimits(): TierLimits {
  const parsed = JSON.parse(required("TIER_LIMITS_JSON")) as unknown;
  return tierLimitsSchema.parse(parsed);
}

export function getDailyJobLimits(): TierLimits {
  const parsed = JSON.parse(required("DAILY_JOB_LIMITS_JSON")) as unknown;
  return tierLimitsSchema.parse(parsed);
}

export function getEnv() {
  return {
    environmentName: process.env.ENVIRONMENT_NAME ?? "unknown",
    inputBucketName: required("INPUT_BUCKET_NAME"),
    jobsTableName: required("JOBS_TABLE_NAME"),
    concurrencyTableName: required("CONCURRENCY_TABLE_NAME"),
    stateMachineArn: process.env.STATE_MACHINE_ARN,
    localDispatcherFunctionName: process.env.LOCAL_DISPATCHER_FUNCTION_NAME,
    activeJobsIndexName: process.env.ACTIVE_JOBS_INDEX_NAME ?? "ActiveJobsIndex",
    systemConcurrencyLimit: positiveInteger("SYSTEM_CONCURRENCY_LIMIT", 4),
    systemDailyJobLimit: positiveInteger("SYSTEM_DAILY_JOB_LIMIT", 100),
    uploadUrlExpiresSeconds: positiveInteger("UPLOAD_URL_EXPIRES_SECONDS", 900),
    maxUploadBytes: positiveInteger("MAX_UPLOAD_BYTES", 5 * 1024 * 1024),
    initialLeaseSeconds: positiveInteger("INITIAL_LEASE_SECONDS", 300),
    runningLeaseSeconds: positiveInteger("RUNNING_LEASE_SECONDS", 1200),
    jobRetentionDays: positiveInteger("JOB_RETENTION_DAYS", 30),
    reaperPageSize: positiveInteger("REAPER_PAGE_SIZE", 50),
    reaperMaxJobs: positiveInteger("REAPER_MAX_JOBS", 200),
    reaperConcurrency: positiveInteger("REAPER_CONCURRENCY", 10),
    localAuthBypass: process.env.ALLOW_LOCAL_AUTH_BYPASS === "true",
  };
}
