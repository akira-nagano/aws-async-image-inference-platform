import type { Messages } from "./i18n";

export type AuthTransition = "initializing" | "redirecting-to-login" | "logging-out" | "ready";

export function authTransitionMessage(
  transition: AuthTransition,
  messages: Messages,
): string | undefined {
  if (transition === "initializing") return messages.errors.loadingConfig;
  if (transition === "redirecting-to-login") return messages.auth.redirecting;
  if (transition === "logging-out") return messages.auth.loggingOut;
  return undefined;
}
