import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseLambdaAccountCapacity } from "../lib/aws-account-settings";
import { parseAwsCliJson } from "../lib/aws-cli-output";
import { assertCapacityFitsAccount, createCapacityContract } from "../lib/capacity";

describe("capacity contract", () => {
  it("derives shared and reserved Lambda capacity from one admission limit", () => {
    const shared = createCapacityContract({
      mode: "shared",
      systemConcurrencyLimit: 4,
    });
    assert.deepEqual(shared, {
      mode: "shared",
      systemConcurrencyLimit: 4,
      controlPlaneConcurrencyHeadroom: 6,
      inferenceReservedConcurrency: 0,
      requiredUnreservedConcurrency: 10,
    });

    const reserved = createCapacityContract({
      mode: "reserved",
      systemConcurrencyLimit: 4,
    });
    assert.deepEqual(reserved, {
      mode: "reserved",
      systemConcurrencyLimit: 4,
      controlPlaneConcurrencyHeadroom: 6,
      inferenceReservedConcurrency: 4,
      requiredUnreservedConcurrency: 10,
    });
  });

  it("accepts a shared-capacity boundary and rejects an undersized account", () => {
    const contract = createCapacityContract({
      mode: "shared",
      systemConcurrencyLimit: 4,
    });
    assert.deepEqual(
      assertCapacityFitsAccount(contract, {
        concurrentExecutions: 10,
        unreservedConcurrentExecutions: 10,
        currentInferenceReservedConcurrency: 0,
      }),
      {
        projectedUnreservedConcurrency: 10,
        requiredUnreservedConcurrency: 10,
      },
    );
    assert.throws(
      () =>
        assertCapacityFitsAccount(contract, {
          concurrentExecutions: 10,
          unreservedConcurrentExecutions: 9,
          currentInferenceReservedConcurrency: 0,
        }),
      /Projected unreserved concurrency is 9.*but 10 is required/,
    );
  });

  it("rejects a reservation that violates AWS's minimum unreserved pool", () => {
    const contract = createCapacityContract({
      mode: "reserved",
      systemConcurrencyLimit: 4,
    });
    assert.throws(
      () =>
        assertCapacityFitsAccount(contract, {
          concurrentExecutions: 10,
          unreservedConcurrentExecutions: 10,
          currentInferenceReservedConcurrency: 0,
        }),
      /Projected unreserved concurrency is 6.*but 10 is required/,
    );
    assert.doesNotThrow(() =>
      assertCapacityFitsAccount(contract, {
        concurrentExecutions: 14,
        unreservedConcurrentExecutions: 14,
        currentInferenceReservedConcurrency: 0,
      }),
    );
  });

  it("accounts for the inference function's current reservation during a mode change", () => {
    const shared = createCapacityContract({
      mode: "shared",
      systemConcurrencyLimit: 4,
    });
    assert.deepEqual(
      assertCapacityFitsAccount(shared, {
        concurrentExecutions: 10,
        unreservedConcurrentExecutions: 6,
        currentInferenceReservedConcurrency: 4,
      }),
      {
        projectedUnreservedConcurrency: 10,
        requiredUnreservedConcurrency: 10,
      },
    );
  });

  it("rejects an internally inconsistent account snapshot", () => {
    const shared = createCapacityContract({
      mode: "shared",
      systemConcurrencyLimit: 4,
    });
    assert.throws(
      () =>
        assertCapacityFitsAccount(shared, {
          concurrentExecutions: 10,
          unreservedConcurrentExecutions: 10,
          currentInferenceReservedConcurrency: 4,
        }),
      /must not exceed ConcurrentExecutions/,
    );
  });
});

describe("Lambda account settings parser", () => {
  it("extracts the account quota and current inference reservation", () => {
    assert.deepEqual(
      parseLambdaAccountCapacity(
        {
          AccountLimit: {
            ConcurrentExecutions: 10,
            UnreservedConcurrentExecutions: 10,
          },
        },
        0,
      ),
      {
        concurrentExecutions: 10,
        unreservedConcurrentExecutions: 10,
        currentInferenceReservedConcurrency: 0,
      },
    );
  });

  it("rejects missing or malformed quota fields", () => {
    assert.throws(
      () => parseLambdaAccountCapacity({ AccountLimit: {} }, 0),
      /ConcurrentExecutions/,
    );
    assert.throws(
      () =>
        parseLambdaAccountCapacity(
          {
            AccountLimit: {
              ConcurrentExecutions: 10,
              UnreservedConcurrentExecutions: "10",
            },
          },
          0,
        ),
      /UnreservedConcurrentExecutions/,
    );
  });
});

describe("AWS CLI JSON parser", () => {
  it("accepts the empty success response returned for an unreserved Lambda function", () => {
    assert.deepEqual(parseAwsCliJson("", "lambda get-function-concurrency", true), {});
  });

  it("rejects an empty response when the AWS operation must return a document", () => {
    assert.throws(
      () => parseAwsCliJson("", "lambda get-account-settings"),
      /AWS CLI returned invalid JSON/,
    );
  });
});
