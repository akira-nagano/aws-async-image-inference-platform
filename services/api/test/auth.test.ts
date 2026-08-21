import { describe, expect, it } from "bun:test";
import { getAuthContext, parseGroups, resolveTier } from "../src/shared/auth.js";
import type { JwtEvent } from "../src/shared/types.js";

process.env.INPUT_BUCKET_NAME = "input";
process.env.JOBS_TABLE_NAME = "jobs";
process.env.CONCURRENCY_TABLE_NAME = "concurrency";
process.env.ALLOW_LOCAL_AUTH_BYPASS = "false";

function eventWithClaims(claims: Record<string, string>): JwtEvent {
  return {
    version: "2.0",
    routeKey: "POST /api/jobs",
    rawPath: "/api/jobs",
    rawQueryString: "",
    headers: {},
    requestContext: {
      accountId: "000000000000",
      apiId: "api",
      domainName: "example.test",
      domainPrefix: "api",
      http: {
        method: "POST",
        path: "/api/jobs",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "test",
      },
      requestId: "request-1",
      routeKey: "POST /api/jobs",
      stage: "$default",
      time: "01/Jan/2026:00:00:00 +0000",
      timeEpoch: 0,
      authorizer: {
        principalId: "user-1",
        integrationLatency: 0,
        jwt: { claims, scopes: [] },
      },
    },
    isBase64Encoded: false,
  };
}

describe("group parsing and tier resolution", () => {
  it("parses JSON array", () => {
    expect(parseGroups('["tier-standard","administrator"]')).toEqual([
      "tier-standard",
      "administrator",
    ]);
  });

  it("resolves a single tier", () => {
    expect(resolveTier(["administrator", "tier-premium"])).toBe("tier-premium");
  });

  it("rejects no tier", () => {
    expect(() => resolveTier(["administrator"])).toThrow(/Tier/);
  });

  it("rejects multiple tiers", () => {
    expect(() => resolveTier(["tier-basic", "tier-standard"])).toThrow(/複数/);
  });

  it("accepts a verified Cognito access token", () => {
    const auth = getAuthContext(
      eventWithClaims({
        sub: "user-1",
        token_use: "access",
        "cognito:groups": '["tier-basic"]',
      }),
    );
    expect(auth).toEqual({
      userId: "user-1",
      groups: ["tier-basic"],
      tier: "tier-basic",
    });
  });

  it("rejects an ID token even when it contains user and group claims", () => {
    expect(() =>
      getAuthContext(
        eventWithClaims({
          sub: "user-1",
          token_use: "id",
          "cognito:groups": '["tier-basic"]',
        }),
      ),
    ).toThrow(/アクセストークン/);
  });
});
