export type CapacityMode = "shared" | "reserved";

export interface CapacityContract {
  mode: CapacityMode;
  systemConcurrencyLimit: number;
  controlPlaneConcurrencyHeadroom: number;
  inferenceReservedConcurrency: number;
  requiredUnreservedConcurrency: number;
}

export interface LambdaAccountCapacity {
  concurrentExecutions: number;
  unreservedConcurrentExecutions: number;
  currentInferenceReservedConcurrency: number;
}

export interface CapacityCheckResult {
  projectedUnreservedConcurrency: number;
  requiredUnreservedConcurrency: number;
}

export const AWS_MINIMUM_UNRESERVED_CONCURRENCY = 10;
export const CONTROL_PLANE_CONCURRENCY_HEADROOM = 6;

function positiveInt(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function nonNegativeInt(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

export function createCapacityContract(input: {
  mode: CapacityMode;
  systemConcurrencyLimit: number;
}): CapacityContract {
  const systemConcurrencyLimit = positiveInt(
    input.systemConcurrencyLimit,
    "systemConcurrencyLimit",
  );
  const controlPlaneConcurrencyHeadroom = CONTROL_PLANE_CONCURRENCY_HEADROOM;
  const inferenceReservedConcurrency = input.mode === "reserved" ? systemConcurrencyLimit : 0;
  const requiredUnreservedConcurrency =
    input.mode === "shared"
      ? systemConcurrencyLimit + controlPlaneConcurrencyHeadroom
      : Math.max(controlPlaneConcurrencyHeadroom, AWS_MINIMUM_UNRESERVED_CONCURRENCY);

  return {
    mode: input.mode,
    systemConcurrencyLimit,
    controlPlaneConcurrencyHeadroom,
    inferenceReservedConcurrency,
    requiredUnreservedConcurrency,
  };
}

export function assertCapacityFitsAccount(
  contract: CapacityContract,
  account: LambdaAccountCapacity,
): CapacityCheckResult {
  const concurrentExecutions = positiveInt(account.concurrentExecutions, "ConcurrentExecutions");
  const unreservedConcurrentExecutions = nonNegativeInt(
    account.unreservedConcurrentExecutions,
    "UnreservedConcurrentExecutions",
  );
  const currentInferenceReservedConcurrency = nonNegativeInt(
    account.currentInferenceReservedConcurrency,
    "currentInferenceReservedConcurrency",
  );
  if (unreservedConcurrentExecutions > concurrentExecutions) {
    throw new Error("UnreservedConcurrentExecutions must not exceed ConcurrentExecutions");
  }
  if (unreservedConcurrentExecutions + currentInferenceReservedConcurrency > concurrentExecutions) {
    throw new Error(
      "Current inference reservation and unreserved concurrency must not exceed ConcurrentExecutions",
    );
  }

  const projectedUnreservedConcurrency =
    unreservedConcurrentExecutions +
    currentInferenceReservedConcurrency -
    contract.inferenceReservedConcurrency;
  if (projectedUnreservedConcurrency < contract.requiredUnreservedConcurrency) {
    throw new Error(
      [
        `Lambda capacity contract cannot be satisfied in ${contract.mode} mode.`,
        `Projected unreserved concurrency is ${projectedUnreservedConcurrency},`,
        `but ${contract.requiredUnreservedConcurrency} is required`,
        `(admission=${contract.systemConcurrencyLimit},`,
        `control-plane-headroom=${contract.controlPlaneConcurrencyHeadroom},`,
        `desired-inference-reserved=${contract.inferenceReservedConcurrency},`,
        `current-inference-reserved=${currentInferenceReservedConcurrency},`,
        `account-quota=${concurrentExecutions}).`,
      ].join(" "),
    );
  }

  return {
    projectedUnreservedConcurrency,
    requiredUnreservedConcurrency: contract.requiredUnreservedConcurrency,
  };
}
