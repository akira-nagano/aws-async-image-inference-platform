import type { LambdaAccountCapacity } from "./capacity";

interface LambdaAccountSettingsDocument {
  AccountLimit?: {
    ConcurrentExecutions?: unknown;
    UnreservedConcurrentExecutions?: unknown;
  };
}

function requiredNonNegativeNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`AWS Lambda account settings are missing a valid ${name}`);
  }
  return value;
}

export function parseLambdaAccountCapacity(
  document: unknown,
  currentInferenceReservedConcurrency: number,
): LambdaAccountCapacity {
  if (typeof document !== "object" || document === null) {
    throw new Error("AWS Lambda account settings must be a JSON object");
  }
  const settings = document as LambdaAccountSettingsDocument;
  return {
    concurrentExecutions: requiredNonNegativeNumber(
      settings.AccountLimit?.ConcurrentExecutions,
      "AccountLimit.ConcurrentExecutions",
    ),
    unreservedConcurrentExecutions: requiredNonNegativeNumber(
      settings.AccountLimit?.UnreservedConcurrentExecutions,
      "AccountLimit.UnreservedConcurrentExecutions",
    ),
    currentInferenceReservedConcurrency: requiredNonNegativeNumber(
      currentInferenceReservedConcurrency,
      "currentInferenceReservedConcurrency",
    ),
  };
}
