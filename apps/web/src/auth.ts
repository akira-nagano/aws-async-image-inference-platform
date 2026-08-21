import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import type { RuntimeConfig } from "./config";
import type { Locale } from "./i18n";

export interface Session {
  accessToken: string;
  idToken?: string;
  expiresAt: number;
  userId: string;
  username: string;
  groups: string[];
}

export interface TokenSet {
  accessToken: string;
  idToken?: string;
  expiresIn?: number;
}

interface OAuthTokenResponse {
  access_token?: string;
  id_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

const OAUTH_STATE_KEY = "imgflow-oauth-state";
const OAUTH_VERIFIER_KEY = "imgflow-oauth-verifier";
const MANAGED_LOGIN_SCOPES = ["openid", "email", "profile"].join(" ");
const OAUTH_RESPONSE_PARAMETERS = ["code", "state", "error", "error_description"];

function decodePayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) throw new Error("JWT形式が正しくありません。");
  const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return JSON.parse(atob(padded)) as Record<string, unknown>;
}

function stringClaim(payload: Record<string, unknown>, name: string): string | undefined {
  const value = payload[name];
  return typeof value === "string" ? value : undefined;
}

function managedLoginSettings(config: RuntimeConfig): {
  baseUrl: string;
  redirectUri: string;
} {
  if (
    config.authMode !== "managed-login" ||
    !config.cognitoManagedLoginBaseUrl ||
    !config.oauthRedirectUri
  ) {
    throw new Error("Cognitoマネージドログイン設定が不足しています。");
  }
  return {
    baseUrl: config.cognitoManagedLoginBaseUrl.replace(/\/$/, ""),
    redirectUri: config.oauthRedirectUri,
  };
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomUrlSafeValue(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

export function createManagedLoginUrl(
  config: RuntimeConfig,
  state: string,
  codeChallenge: string,
  locale: Locale,
): string {
  const { baseUrl, redirectUri } = managedLoginSettings(config);
  const url = new URL(`${baseUrl}/oauth2/authorize`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: config.userPoolClientId,
    redirect_uri: redirectUri,
    scope: MANAGED_LOGIN_SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    lang: locale,
  }).toString();
  return url.toString();
}

export function createManagedLogoutUrl(config: RuntimeConfig): string {
  const { baseUrl, redirectUri } = managedLoginSettings(config);
  const url = new URL(`${baseUrl}/logout`);
  url.search = new URLSearchParams({
    client_id: config.userPoolClientId,
    logout_uri: redirectUri,
  }).toString();
  return url.toString();
}

export function sessionFromTokens(tokens: TokenSet, usernameFallback?: string): Session {
  const accessPayload = decodePayload(tokens.accessToken);
  const idPayload = tokens.idToken ? decodePayload(tokens.idToken) : {};
  const rawGroups = accessPayload["cognito:groups"];
  const groups = Array.isArray(rawGroups)
    ? rawGroups.filter((value): value is string => typeof value === "string")
    : [];
  const userId = stringClaim(accessPayload, "sub");
  if (!userId) throw new Error("アクセストークンにsubがありません。");
  const username =
    stringClaim(accessPayload, "username") ??
    stringClaim(accessPayload, "cognito:username") ??
    stringClaim(idPayload, "email") ??
    stringClaim(idPayload, "cognito:username") ??
    usernameFallback ??
    userId;
  const expiration = accessPayload.exp;
  const expiresAt =
    typeof expiration === "number"
      ? expiration * 1000
      : Date.now() + (tokens.expiresIn ?? 3600) * 1000;
  return {
    accessToken: tokens.accessToken,
    ...(tokens.idToken ? { idToken: tokens.idToken } : {}),
    expiresAt,
    userId,
    username,
    groups,
  };
}

export function validateOAuthState(
  returnedState: string | null,
  expectedState: string | null,
  verifier: string | null,
): string {
  if (!returnedState || !expectedState || returnedState !== expectedState || !verifier) {
    throw new Error("Cognitoログインのstate検証に失敗しました。");
  }
  return verifier;
}

export function resolveCognitoEndpoint(
  endpoint: string | null | undefined,
  origin: string,
): string | undefined {
  return endpoint ? new URL(endpoint, origin).toString() : undefined;
}

export async function signIn(
  config: RuntimeConfig,
  username: string,
  password: string,
): Promise<Session> {
  const endpoint = resolveCognitoEndpoint(config.cognitoEndpoint, window.location.origin);
  const client = new CognitoIdentityProviderClient({
    region: config.region,
    ...(endpoint ? { endpoint } : {}),
  });
  const response = await client.send(
    new InitiateAuthCommand({
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: config.userPoolClientId,
      AuthParameters: { USERNAME: username, PASSWORD: password },
    }),
  );
  const accessToken = response.AuthenticationResult?.AccessToken;
  if (!accessToken) throw new Error("アクセストークンを取得できませんでした。");
  return sessionFromTokens(
    {
      accessToken,
      ...(response.AuthenticationResult?.IdToken
        ? { idToken: response.AuthenticationResult.IdToken }
        : {}),
      expiresIn: response.AuthenticationResult?.ExpiresIn ?? 3600,
    },
    username,
  );
}

export function shouldAutoStartManagedLogin(
  config: RuntimeConfig,
  session: Session | undefined,
  currentUrl: URL,
): boolean {
  return (
    config.authMode === "managed-login" &&
    !session &&
    !OAUTH_RESPONSE_PARAMETERS.some((name) => currentUrl.searchParams.has(name))
  );
}

export async function startManagedLogin(config: RuntimeConfig, locale: Locale): Promise<void> {
  const state = randomUrlSafeValue();
  const verifier = randomUrlSafeValue();
  const challenge = await pkceChallenge(verifier);
  sessionStorage.setItem(OAUTH_STATE_KEY, state);
  sessionStorage.setItem(OAUTH_VERIFIER_KEY, verifier);
  window.location.assign(createManagedLoginUrl(config, state, challenge, locale));
}

function clearOAuthRequest(): void {
  sessionStorage.removeItem(OAUTH_STATE_KEY);
  sessionStorage.removeItem(OAUTH_VERIFIER_KEY);
}

function removeOAuthParameters(url: URL): void {
  for (const name of ["code", "state", "error", "error_description"]) {
    url.searchParams.delete(name);
  }
  const query = url.searchParams.toString();
  window.history.replaceState({}, "", `${url.pathname}${query ? `?${query}` : ""}${url.hash}`);
}

export async function completeManagedLogin(config: RuntimeConfig): Promise<Session | undefined> {
  if (config.authMode !== "managed-login") return undefined;
  const currentUrl = new URL(window.location.href);
  const error = currentUrl.searchParams.get("error");
  const code = currentUrl.searchParams.get("code");
  if (!error && !code) return undefined;
  if (error) {
    const description = currentUrl.searchParams.get("error_description");
    clearOAuthRequest();
    removeOAuthParameters(currentUrl);
    throw new Error(description || `Cognitoログインに失敗しました: ${error}`);
  }
  if (!code) return undefined;

  const returnedState = currentUrl.searchParams.get("state");
  const expectedState = sessionStorage.getItem(OAUTH_STATE_KEY);
  let verifier: string;
  try {
    verifier = validateOAuthState(
      returnedState,
      expectedState,
      sessionStorage.getItem(OAUTH_VERIFIER_KEY),
    );
  } catch (validationError) {
    clearOAuthRequest();
    removeOAuthParameters(currentUrl);
    throw validationError;
  }

  const { baseUrl, redirectUri } = managedLoginSettings(config);
  try {
    const response = await fetch(`${baseUrl}/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: config.userPoolClientId,
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }),
    });
    const payload = (await response.json()) as OAuthTokenResponse;
    if (!response.ok || !payload.access_token) {
      throw new Error(
        payload.error_description || payload.error || "Cognito token交換に失敗しました。",
      );
    }
    return sessionFromTokens({
      accessToken: payload.access_token,
      ...(payload.id_token ? { idToken: payload.id_token } : {}),
      ...(typeof payload.expires_in === "number" ? { expiresIn: payload.expires_in } : {}),
    });
  } finally {
    clearOAuthRequest();
    removeOAuthParameters(currentUrl);
  }
}

export function startManagedLogout(config: RuntimeConfig): void {
  window.location.assign(createManagedLogoutUrl(config));
}

export interface LogoutPlan {
  redirectToManagedLogout: boolean;
  clearRenderedSession: boolean;
}

export function createLogoutPlan(config: Pick<RuntimeConfig, "authMode">): LogoutPlan {
  const redirectToManagedLogout = config.authMode === "managed-login";
  return {
    redirectToManagedLogout,
    clearRenderedSession: !redirectToManagedLogout,
  };
}

const STORAGE_KEY = "imgflow-session";

export function saveSession(session: Session): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function loadSession(): Session | undefined {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return undefined;
  try {
    const session = JSON.parse(raw) as Partial<Session>;
    if (
      typeof session.accessToken !== "string" ||
      typeof session.expiresAt !== "number" ||
      typeof session.userId !== "string" ||
      typeof session.username !== "string" ||
      !Array.isArray(session.groups) ||
      session.groups.some((group) => typeof group !== "string") ||
      session.expiresAt <= Date.now()
    ) {
      sessionStorage.removeItem(STORAGE_KEY);
      return undefined;
    }
    return session as Session;
  } catch {
    sessionStorage.removeItem(STORAGE_KEY);
    return undefined;
  }
}

export function clearSession(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}
