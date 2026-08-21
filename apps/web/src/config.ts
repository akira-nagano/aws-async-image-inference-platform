export type AuthMode = "direct" | "managed-login";

export interface RuntimeConfig {
  region: string;
  apiBaseUrl: string;
  userPoolId: string;
  userPoolClientId: string;
  authMode: AuthMode;
  cognitoManagedLoginBaseUrl?: string;
  oauthRedirectUri?: string;
  cognitoEndpoint?: string | null;
  localAuthBypass?: boolean;
  pollIntervalMs: number;
  maxUploadBytes: number;
}

let cached: RuntimeConfig | undefined;

export async function loadConfig(): Promise<RuntimeConfig> {
  if (cached) return cached;
  const response = await fetch("/config.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("config.jsonを読み込めませんでした。");
  }
  cached = (await response.json()) as RuntimeConfig;
  return cached;
}
