import type * as cdk from "aws-cdk-lib";
import { createCapacityContract, type CapacityContract, type CapacityMode } from "./capacity";

export interface TierLimits {
  "tier-basic": number;
  "tier-standard": number;
  "tier-premium": number;
}

export interface DailyUsageConfig {
  tierJobLimits: TierLimits;
  systemJobLimit: number;
}

export type EnvironmentName = "local" | "dev" | "prod";
export type InferenceModelProfile = "stub" | "catalog";

export interface PlatformConfig {
  environment: EnvironmentName;
  local: boolean;
  localAuthBypass: boolean;
  includeEdgeInLocal: boolean;
  tierLimits: TierLimits;
  capacity: CapacityContract;
  dailyUsage: DailyUsageConfig;
  inferenceMemoryMb: number;
  inferenceTimeoutSeconds: number;
  inferenceModelProfile: InferenceModelProfile;
  stubInferenceDelayMs: number;
  inputRetentionDays: number;
  jobRetentionDays: number;
  maxUploadBytes: number;
  apiThrottleRate: number;
  apiThrottleBurst: number;
  uploadAllowedOrigin: string;
  cognitoDomainPrefix?: string;
}

function positiveInt(value: unknown, name: string, fallback: number): number {
  const resolved = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(resolved) || resolved <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return resolved;
}

function environmentName(value: unknown): EnvironmentName {
  const resolved = String(value ?? "dev");
  if (resolved !== "local" && resolved !== "dev" && resolved !== "prod") {
    throw new Error("environment must be one of local, dev, or prod");
  }
  return resolved;
}

function capacityMode(value: unknown): CapacityMode {
  const resolved = String(value ?? "shared");
  if (resolved !== "shared" && resolved !== "reserved") {
    throw new Error("capacityMode must be one of shared or reserved");
  }
  return resolved;
}

function inferenceModelProfile(value: unknown): InferenceModelProfile {
  const resolved = String(value ?? "stub");
  if (resolved !== "stub" && resolved !== "catalog") {
    throw new Error("inferenceModelProfile must be one of stub or catalog");
  }
  return resolved;
}

function cognitoDomainPrefix(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const resolved = String(value);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(resolved)) {
    throw new Error(
      "cognitoDomainPrefix must be 1-63 lowercase letters, numbers, or hyphens and cannot start or end with a hyphen",
    );
  }
  if (/(?:aws|amazon|cognito)/.test(resolved)) {
    throw new Error("cognitoDomainPrefix must not contain aws, amazon, or cognito");
  }
  return resolved;
}

function assertOrderedTierLimits(tierLimits: TierLimits, name: string): void {
  if (
    tierLimits["tier-basic"] > tierLimits["tier-standard"] ||
    tierLimits["tier-standard"] > tierLimits["tier-premium"]
  ) {
    throw new Error(`${name} must be ordered as tier-basic <= tier-standard <= tier-premium`);
  }
}

export function readPlatformConfig(app: cdk.App): PlatformConfig {
  const tierValue = app.node.tryGetContext("tierLimits") as Partial<TierLimits> | undefined;
  const tierLimits: TierLimits = {
    "tier-basic": positiveInt(tierValue?.["tier-basic"], "tier-basic", 1),
    "tier-standard": positiveInt(tierValue?.["tier-standard"], "tier-standard", 3),
    "tier-premium": positiveInt(tierValue?.["tier-premium"], "tier-premium", 4),
  };
  const dailyJobValue = app.node.tryGetContext("dailyJobLimits") as Partial<TierLimits> | undefined;
  const dailyJobLimits: TierLimits = {
    "tier-basic": positiveInt(dailyJobValue?.["tier-basic"], "daily tier-basic", 10),
    "tier-standard": positiveInt(dailyJobValue?.["tier-standard"], "daily tier-standard", 30),
    "tier-premium": positiveInt(dailyJobValue?.["tier-premium"], "daily tier-premium", 100),
  };
  const systemDailyJobLimit = positiveInt(
    app.node.tryGetContext("systemDailyJobLimit"),
    "systemDailyJobLimit",
    100,
  );
  const environment = environmentName(app.node.tryGetContext("environment"));
  const local = String(app.node.tryGetContext("local") ?? "false") === "true";
  const localAuthBypass = String(app.node.tryGetContext("localAuthBypass") ?? "false") === "true";
  const uploadAllowedOrigin = String(
    app.node.tryGetContext("uploadAllowedOrigin") ??
      (local ? "http://localhost:5173" : "https://*.cloudfront.net"),
  );
  if (local !== (environment === "local")) {
    throw new Error("environment=local and local=true must be configured together");
  }
  if (!local && localAuthBypass) {
    throw new Error("localAuthBypass must never be enabled outside local mode");
  }
  if (
    !/^https:\/\/[^/]+$/.test(uploadAllowedOrigin) &&
    !(local && uploadAllowedOrigin === "http://localhost:5173")
  ) {
    throw new Error("uploadAllowedOrigin must be an HTTPS origin without a path");
  }
  if (app.node.tryGetContext("inferenceReservedConcurrency") !== undefined) {
    throw new Error(
      "inferenceReservedConcurrency is no longer configurable; use capacityMode=reserved and systemConcurrencyLimit",
    );
  }
  if (app.node.tryGetContext("controlPlaneConcurrencyHeadroom") !== undefined) {
    throw new Error(
      "controlPlaneConcurrencyHeadroom is architecture-derived and cannot be configured",
    );
  }
  const capacity = createCapacityContract({
    mode: capacityMode(app.node.tryGetContext("capacityMode")),
    systemConcurrencyLimit: positiveInt(
      app.node.tryGetContext("systemConcurrencyLimit"),
      "systemConcurrencyLimit",
      4,
    ),
  });
  assertOrderedTierLimits(tierLimits, "tier limits");
  if (tierLimits["tier-premium"] > capacity.systemConcurrencyLimit) {
    throw new Error("every tier limit must not exceed systemConcurrencyLimit");
  }
  assertOrderedTierLimits(dailyJobLimits, "daily job limits");
  if (dailyJobLimits["tier-premium"] > systemDailyJobLimit) {
    throw new Error("every daily tier job limit must not exceed systemDailyJobLimit");
  }

  return {
    environment,
    local,
    localAuthBypass,
    includeEdgeInLocal: String(app.node.tryGetContext("includeEdgeInLocal") ?? "false") === "true",
    tierLimits,
    capacity,
    dailyUsage: {
      tierJobLimits: dailyJobLimits,
      systemJobLimit: systemDailyJobLimit,
    },
    inferenceMemoryMb: positiveInt(
      app.node.tryGetContext("inferenceMemoryMb"),
      "inferenceMemoryMb",
      3008,
    ),
    inferenceTimeoutSeconds: positiveInt(
      app.node.tryGetContext("inferenceTimeoutSeconds"),
      "inferenceTimeoutSeconds",
      900,
    ),
    inferenceModelProfile: inferenceModelProfile(app.node.tryGetContext("inferenceModelProfile")),
    stubInferenceDelayMs: positiveInt(
      app.node.tryGetContext("stubInferenceDelayMs"),
      "stubInferenceDelayMs",
      5000,
    ),
    inputRetentionDays: positiveInt(
      app.node.tryGetContext("inputRetentionDays"),
      "inputRetentionDays",
      1,
    ),
    jobRetentionDays: positiveInt(
      app.node.tryGetContext("jobRetentionDays"),
      "jobRetentionDays",
      30,
    ),
    maxUploadBytes: positiveInt(
      app.node.tryGetContext("maxUploadBytes"),
      "maxUploadBytes",
      5 * 1024 * 1024,
    ),
    apiThrottleRate: positiveInt(app.node.tryGetContext("apiThrottleRate"), "apiThrottleRate", 50),
    apiThrottleBurst: positiveInt(
      app.node.tryGetContext("apiThrottleBurst"),
      "apiThrottleBurst",
      100,
    ),
    uploadAllowedOrigin,
    cognitoDomainPrefix: cognitoDomainPrefix(app.node.tryGetContext("cognitoDomainPrefix")),
  };
}
