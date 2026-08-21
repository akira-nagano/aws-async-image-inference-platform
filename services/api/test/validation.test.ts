import { describe, expect, it } from "bun:test";
import {
  assertOwnedObjectKey,
  deterministicJobId,
  safeFileName,
} from "../src/shared/validation.js";

describe("validation", () => {
  it("normalizes file names", () => {
    expect(safeFileName("../../推論 image.jpg")).toBe("___image.jpg");
  });

  it("accepts owned object key", () => {
    expect(() => assertOwnedObjectKey("uploads/user-1/a.jpg", "user-1")).not.toThrow();
  });

  it("rejects another user key", () => {
    expect(() => assertOwnedObjectKey("uploads/user-2/a.jpg", "user-1")).toThrow();
  });

  it("generates deterministic user-scoped job ids", () => {
    expect(deterministicJobId("u1", "key")).toBe(deterministicJobId("u1", "key"));
    expect(deterministicJobId("u1", "key")).not.toBe(deterministicJobId("u2", "key"));
  });
});
