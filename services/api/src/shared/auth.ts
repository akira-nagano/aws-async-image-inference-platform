import type { JwtEvent } from "./types.js";
import { TIER_NAMES, type AuthContext, type TierName } from "./types.js";
import { getEnv } from "./env.js";

function parseGroups(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((value): value is string => typeof value === "string");
  }
  if (typeof raw !== "string" || raw.trim() === "") return [];

  const text = raw.trim();
  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((value): value is string => typeof value === "string");
      }
    } catch {
      const inner = text.slice(1, -1).trim();
      if (!inner) return [];
      return inner.split(/[ ,]+/).map((v) => v.replace(/^"|"$/g, ""));
    }
  }
  return text.split(/[ ,]+/).filter(Boolean);
}

export class AuthError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function resolveTier(groups: string[]): TierName {
  const tierGroups = groups.filter((group): group is TierName =>
    (TIER_NAMES as readonly string[]).includes(group),
  );
  if (tierGroups.length === 0) {
    throw new AuthError(403, "TIER_NOT_ASSIGNED", "Tierが設定されていません。");
  }
  if (tierGroups.length > 1) {
    throw new AuthError(
      403,
      "MULTIPLE_TIERS_ASSIGNED",
      "複数のTierが設定されています。管理者へ連絡してください。",
    );
  }
  return tierGroups[0]!;
}

export function getAuthContext(event: JwtEvent): AuthContext {
  const claims = event.requestContext.authorizer?.jwt?.claims;
  let userId = typeof claims?.sub === "string" ? claims.sub : undefined;
  let groups = parseGroups(claims?.["cognito:groups"]);

  const env = getEnv();
  if (!env.localAuthBypass && claims?.token_use !== "access") {
    throw new AuthError(401, "INVALID_TOKEN_USE", "アクセストークンが必要です。");
  }
  if ((!userId || groups.length === 0) && env.localAuthBypass) {
    userId = event.headers["x-local-user-id"] ?? userId;
    groups = parseGroups(event.headers["x-local-groups"] ?? groups);
  }

  if (!userId) {
    throw new AuthError(401, "UNAUTHENTICATED", "認証が必要です。");
  }

  return { userId, groups, tier: resolveTier(groups) };
}

export { parseGroups };
