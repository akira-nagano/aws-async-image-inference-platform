import { describe, expect, it } from "bun:test";
import { resolveLocale } from "./i18n";

describe("locale resolution", () => {
  it("prefers a saved supported locale", () => {
    expect(resolveLocale("en", ["ja-JP"])).toBe("en");
    expect(resolveLocale("ja", ["en-US"])).toBe("ja");
  });

  it("uses Japanese only when a browser language starts with ja", () => {
    expect(resolveLocale(null, ["fr-FR", "ja-JP"])).toBe("ja");
    expect(resolveLocale(null, ["en-US"])).toBe("en");
  });

  it("ignores an unsupported saved value", () => {
    expect(resolveLocale("fr", ["ja"])).toBe("ja");
  });
});
