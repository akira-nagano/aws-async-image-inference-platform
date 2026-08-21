export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png"] as const;

export type ImageValidationError = "unsupportedType" | "fileTooLarge";

export function validateImageFile(
  file: Pick<File, "size" | "type">,
  maxUploadBytes: number,
): ImageValidationError | undefined {
  if (!ACCEPTED_IMAGE_TYPES.some((contentType) => contentType === file.type)) {
    return "unsupportedType";
  }
  if (file.size > maxUploadBytes) return "fileTooLarge";
  return undefined;
}

export function formatFileSize(bytes: number, locale: string): string {
  const mebibytes = bytes / 1024 / 1024;
  return `${new Intl.NumberFormat(locale, {
    maximumFractionDigits: mebibytes >= 10 ? 1 : 2,
    minimumFractionDigits: mebibytes >= 0.01 ? 0 : 2,
  }).format(mebibytes)} MB`;
}
