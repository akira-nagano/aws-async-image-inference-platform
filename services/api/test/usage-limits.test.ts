import { describe, expect, it } from "bun:test";
import {
  dailyUsageLimits,
  dailyUsageWindow,
  jobUsageScopeKeys,
  uploadUsageScopeKeys,
} from "../src/shared/usage-limits.js";

const tierJobLimits = {
  "tier-basic": 10,
  "tier-standard": 30,
  "tier-premium": 100,
} as const;

describe("daily usage contract", () => {
  it("derives upload count and byte budgets from job and file-size limits", () => {
    expect(
      dailyUsageLimits({
        tier: "tier-basic",
        tierJobLimits,
        systemJobLimit: 100,
        maxUploadBytes: 5 * 1024 * 1024,
      }),
    ).toEqual({
      userJobLimit: 10,
      systemJobLimit: 100,
      userUploadCountLimit: 20,
      systemUploadCountLimit: 200,
      userUploadBytesLimit: 50 * 1024 * 1024,
      systemUploadBytesLimit: 500 * 1024 * 1024,
    });
  });

  it("uses UTC dates and keeps expired counters briefly for diagnostics", () => {
    const window = dailyUsageWindow(new Date("2026-07-24T23:59:59.000Z"));
    expect(window.date).toBe("2026-07-24");
    expect(window.ttl).toBe(Math.floor(Date.parse("2026-08-01T00:00:00.000Z") / 1000));
  });

  it("uses separate per-user and system keys for jobs and uploads", () => {
    expect(jobUsageScopeKeys("user-1", "2026-07-24")).toEqual({
      user: "USAGE#JOB#USER#user-1#2026-07-24",
      system: "USAGE#JOB#SYSTEM#2026-07-24",
    });
    expect(uploadUsageScopeKeys("user-1", "2026-07-24")).toEqual({
      user: "USAGE#UPLOAD#USER#user-1#2026-07-24",
      system: "USAGE#UPLOAD#SYSTEM#2026-07-24",
    });
  });
});
