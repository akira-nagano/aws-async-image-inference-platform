import { describe, expect, it } from "bun:test";
import type { Session } from "./auth";
import {
  authHeaders,
  isTerminal,
  predictionMetadata,
  predictionTitle,
  type Prediction,
} from "./api";
import type { RuntimeConfig } from "./config";

const session: Session = {
  accessToken: "access-token",
  expiresAt: Date.now() + 60_000,
  userId: "cognito-sub",
  username: "basic@example.test",
  groups: ["tier-basic"],
};

const config: RuntimeConfig = {
  region: "ap-northeast-1",
  apiBaseUrl: "/api",
  userPoolId: "pool",
  userPoolClientId: "client",
  authMode: "managed-login",
  cognitoManagedLoginBaseUrl:
    "https://inference-dev-123456789012.auth.ap-northeast-1.amazoncognito.com",
  oauthRedirectUri: "https://distribution.example.test/",
  pollIntervalMs: 1000,
  maxUploadBytes: 1024,
};

describe("job status", () => {
  it("identifies terminal statuses", () => {
    expect(isTerminal("SUCCEEDED")).toBe(true);
    expect(isTerminal("FAILED")).toBe(true);
    expect(isTerminal("RUNNING")).toBe(false);
  });
});

describe("authentication headers", () => {
  it("adds Floci bypass headers only for an explicit local config", () => {
    expect(authHeaders({ ...config, localAuthBypass: true }, session)).toEqual({
      authorization: "Bearer access-token",
      "x-local-user-id": "cognito-sub",
      "x-local-groups": "tier-basic",
    });
    expect(authHeaders({ ...config, localAuthBypass: false }, session)).toEqual({
      authorization: "Bearer access-token",
    });
  });
});

describe("prediction display", () => {
  it("shows catalog metadata while keeping the product code visible", () => {
    const prediction: Prediction = {
      rank: 1,
      productCode: "MODEL-001",
      confidence: 0.93,
      productName: "Example product",
      brand: "Example brand",
    };

    expect(predictionTitle(prediction)).toBe("Example product");
    expect(predictionMetadata(prediction)).toBe("Example brand · MODEL-001");
  });

  it("keeps the legacy stub result readable", () => {
    const prediction: Prediction = {
      rank: 1,
      productCode: "DEMO-123",
      confidence: 0.5,
    };

    expect(predictionTitle(prediction)).toBe("DEMO-123");
    expect(predictionMetadata(prediction)).toBe("");
  });
});
