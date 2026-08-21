import type { TierLimits, TierName } from "./types.js";

export interface DailyUsageWindow {
  date: string;
  ttl: number;
}

export interface DailyUsageLimits {
  userJobLimit: number;
  systemJobLimit: number;
  userUploadCountLimit: number;
  systemUploadCountLimit: number;
  userUploadBytesLimit: number;
  systemUploadBytesLimit: number;
}

export function dailyUsageWindow(now: Date): DailyUsageWindow {
  const date = now.toISOString().slice(0, 10);
  const retentionBoundary = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 8);
  return {
    date,
    ttl: Math.floor(retentionBoundary / 1000),
  };
}

export function dailyUsageLimits(input: {
  tier: TierName;
  tierJobLimits: TierLimits;
  systemJobLimit: number;
  maxUploadBytes: number;
}): DailyUsageLimits {
  const userJobLimit = input.tierJobLimits[input.tier];
  return {
    userJobLimit,
    systemJobLimit: input.systemJobLimit,
    userUploadCountLimit: userJobLimit * 2,
    systemUploadCountLimit: input.systemJobLimit * 2,
    userUploadBytesLimit: userJobLimit * input.maxUploadBytes,
    systemUploadBytesLimit: input.systemJobLimit * input.maxUploadBytes,
  };
}

export function jobUsageScopeKeys(userId: string, date: string) {
  return {
    user: `USAGE#JOB#USER#${userId}#${date}`,
    system: `USAGE#JOB#SYSTEM#${date}`,
  };
}

export function uploadUsageScopeKeys(userId: string, date: string) {
  return {
    user: `USAGE#UPLOAD#USER#${userId}#${date}`,
    system: `USAGE#UPLOAD#SYSTEM#${date}`,
  };
}
