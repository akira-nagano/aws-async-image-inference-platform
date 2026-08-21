import { describe, expect, it } from "bun:test";
import { formatFileSize, validateImageFile } from "./image-selection";

describe("image selection", () => {
  it("accepts JPEG and PNG files at the byte limit", () => {
    expect(validateImageFile({ type: "image/jpeg", size: 5 }, 5)).toBeUndefined();
    expect(validateImageFile({ type: "image/png", size: 5 }, 5)).toBeUndefined();
  });

  it("rejects other formats and oversized files", () => {
    expect(validateImageFile({ type: "image/webp", size: 1 }, 5)).toBe("unsupportedType");
    expect(validateImageFile({ type: "image/jpeg", size: 6 }, 5)).toBe("fileTooLarge");
  });

  it("formats the selected file size for the active locale", () => {
    expect(formatFileSize(1024 * 1024, "en-US")).toBe("1 MB");
  });
});
