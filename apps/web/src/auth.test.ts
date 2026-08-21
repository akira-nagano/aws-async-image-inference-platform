import { describe, expect, it } from "bun:test";
import {
  createManagedLoginUrl,
  createManagedLogoutUrl,
  createLogoutPlan,
  resolveCognitoEndpoint,
  sessionFromTokens,
  shouldAutoStartManagedLogin,
  validateOAuthState,
} from "./auth";
import type { RuntimeConfig } from "./config";

const managedConfig: RuntimeConfig = {
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

function jwt(payload: Record<string, unknown>): string {
  const encoded = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header.${encoded}.signature`;
}

describe("Cognito endpoint resolution", () => {
  it("routes a relative local endpoint through the Vite origin", () => {
    expect(resolveCognitoEndpoint("/_local/cognito", "http://localhost:5173")).toBe(
      "http://localhost:5173/_local/cognito",
    );
  });

  it("keeps an absolute endpoint and omits an unspecified endpoint", () => {
    expect(resolveCognitoEndpoint("https://cognito.example.test", "http://localhost:5173")).toBe(
      "https://cognito.example.test/",
    );
    expect(resolveCognitoEndpoint(undefined, "http://localhost:5173")).toBeUndefined();
  });
});

describe("Cognito managed login", () => {
  it("creates an authorization code URL with PKCE and identity-only scopes", () => {
    const url = new URL(
      createManagedLoginUrl(managedConfig, "state-value", "challenge-value", "ja"),
    );
    expect(url.pathname).toBe("/oauth2/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("client");
    expect(url.searchParams.get("redirect_uri")).toBe("https://distribution.example.test/");
    expect(url.searchParams.get("state")).toBe("state-value");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-value");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("lang")).toBe("ja");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual(["openid", "email", "profile"]);

    const englishUrl = new URL(
      createManagedLoginUrl(managedConfig, "state-value", "challenge-value", "en"),
    );
    expect(englishUrl.searchParams.get("lang")).toBe("en");
  });

  it("creates a managed logout URL with an allowed sign-out destination", () => {
    const url = new URL(createManagedLogoutUrl(managedConfig));
    expect(url.pathname).toBe("/logout");
    expect(url.searchParams.get("client_id")).toBe("client");
    expect(url.searchParams.get("logout_uri")).toBe("https://distribution.example.test/");
  });

  it("creates an API session from managed-login tokens", () => {
    const session = sessionFromTokens({
      accessToken: jwt({
        sub: "cognito-sub",
        username: "basic@example.test",
        "cognito:groups": ["tier-basic"],
        exp: 2_000_000_000,
      }),
      idToken: jwt({ email: "basic@example.test" }),
    });
    expect(session).toMatchObject({
      userId: "cognito-sub",
      username: "basic@example.test",
      groups: ["tier-basic"],
      expiresAt: 2_000_000_000_000,
    });
    expect(session).not.toHaveProperty("refreshToken");
  });

  it("accepts only the verifier associated with the returned OAuth state", () => {
    expect(validateOAuthState("expected", "expected", "verifier")).toBe("verifier");
    expect(() => validateOAuthState("unexpected", "expected", "verifier")).toThrow(
      "state検証に失敗",
    );
    expect(() => validateOAuthState("expected", "expected", null)).toThrow("state検証に失敗");
  });

  it("automatically starts only a fresh managed-login request", () => {
    expect(
      shouldAutoStartManagedLogin(
        managedConfig,
        undefined,
        new URL("https://distribution.example.test/"),
      ),
    ).toBeTrue();
    expect(
      shouldAutoStartManagedLogin(
        { ...managedConfig, authMode: "direct" },
        undefined,
        new URL("https://distribution.example.test/"),
      ),
    ).toBeFalse();
    expect(
      shouldAutoStartManagedLogin(
        managedConfig,
        {
          accessToken: "token",
          expiresAt: 2_000_000_000_000,
          userId: "cognito-sub",
          username: "basic@example.test",
          groups: ["tier-basic"],
        },
        new URL("https://distribution.example.test/"),
      ),
    ).toBeFalse();
  });

  it("does not restart managed login while processing an OAuth response", () => {
    expect(
      shouldAutoStartManagedLogin(
        managedConfig,
        undefined,
        new URL("https://distribution.example.test/?code=code&state=state"),
      ),
    ).toBeFalse();
    expect(
      shouldAutoStartManagedLogin(
        managedConfig,
        undefined,
        new URL("https://distribution.example.test/?error=access_denied"),
      ),
    ).toBeFalse();
  });

  it("keeps the rendered session while redirecting through managed logout", () => {
    expect(createLogoutPlan(managedConfig)).toEqual({
      redirectToManagedLogout: true,
      clearRenderedSession: false,
    });
    expect(createLogoutPlan({ authMode: "direct" })).toEqual({
      redirectToManagedLogout: false,
      clearRenderedSession: true,
    });
  });
});
