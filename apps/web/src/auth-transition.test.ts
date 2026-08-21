import { describe, expect, it } from "bun:test";
import { authTransitionMessage } from "./auth-transition";
import { translations } from "./i18n";

describe("authentication transition presentation", () => {
  it("keeps automatic login and logout handoffs on the transition screen", () => {
    expect(authTransitionMessage("initializing", translations.ja)).toBe(
      translations.ja.errors.loadingConfig,
    );
    expect(authTransitionMessage("redirecting-to-login", translations.ja)).toBe(
      translations.ja.auth.redirecting,
    );
    expect(authTransitionMessage("logging-out", translations.ja)).toBe(
      translations.ja.auth.loggingOut,
    );
  });

  it("reveals the authentication fallback only after the transition is ready", () => {
    expect(authTransitionMessage("ready", translations.ja)).toBeUndefined();
  });
});
