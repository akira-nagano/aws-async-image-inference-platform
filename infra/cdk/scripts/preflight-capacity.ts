import * as cdk from "aws-cdk-lib";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { parseLambdaAccountCapacity } from "../lib/aws-account-settings";
import { parseAwsCliJson } from "../lib/aws-cli-output";
import { assertCapacityFitsAccount } from "../lib/capacity";
import { readPlatformConfig } from "../lib/config";

interface CdkConfiguration {
  context?: Record<string, unknown>;
}

interface StackResourceSummary {
  LogicalResourceId?: string;
  PhysicalResourceId?: string;
  ResourceType?: string;
}

interface StackResourcesDocument {
  StackResourceSummaries?: StackResourceSummary[];
}

interface FunctionConcurrencyDocument {
  ReservedConcurrentExecutions?: number;
}

interface FunctionConfigurationDocument {
  Environment?: {
    Variables?: Record<string, string>;
  };
  MemorySize?: number;
  Timeout?: number;
}

interface StackDescriptionDocument {
  Stacks?: Array<{
    StackStatus?: string;
  }>;
}

const cdkRoot = join(__dirname, "..");
const stackName = process.env.STACK_NAME ?? "ImgFlow-dev";
const region = process.env.CDK_DEFAULT_REGION ?? process.env.AWS_REGION ?? "ap-northeast-1";
const systemAwsCli = join(
  process.env.ProgramFiles ?? "C:\\Program Files",
  "Amazon",
  "AWSCLIV2",
  "aws.exe",
);
const awsCli =
  process.env.AWS_CLI ??
  (process.platform === "win32" && existsSync(systemAwsCli) ? systemAwsCli : "aws");

function awsJson(
  args: string[],
  allowMissing = false,
  allowEmptyObject = false,
): unknown | undefined {
  const result = spawnSync(
    awsCli,
    [...args, "--region", region, "--output", "json", "--no-cli-pager"],
    {
      cwd: cdkRoot,
      env: process.env,
      encoding: "utf8",
      windowsHide: true,
    },
  );
  if (result.status !== 0) {
    const error = `${result.stderr ?? ""}${result.stdout ?? ""}`.trim();
    if (allowMissing && /(does not exist|ResourceNotFoundException)/i.test(error)) {
      return undefined;
    }
    throw new Error(`AWS CLI failed: ${args.join(" ")}\n${error}`);
  }
  return parseAwsCliJson(result.stdout, args.join(" "), allowEmptyObject);
}

function stackLambdaFunctionName(logicalIdPrefix: string, required = false): string | undefined {
  const raw = awsJson(
    ["cloudformation", "list-stack-resources", "--stack-name", stackName],
    !required,
  ) as StackResourcesDocument | undefined;
  const candidates = (raw?.StackResourceSummaries ?? []).filter(
    (resource) =>
      resource.ResourceType === "AWS::Lambda::Function" &&
      resource.LogicalResourceId?.startsWith(logicalIdPrefix) &&
      resource.PhysicalResourceId,
  );
  if (candidates.length > 1) {
    throw new Error(
      `Multiple ${logicalIdPrefix} Lambda functions were found in stack ${stackName}`,
    );
  }
  const functionName = candidates[0]?.PhysicalResourceId;
  if (required && !functionName) {
    throw new Error(`${logicalIdPrefix} Lambda was not found in stack ${stackName}`);
  }
  return functionName;
}

function currentInferenceReservedConcurrency(): number {
  const functionName = stackLambdaFunctionName("InferenceFunction");
  if (!functionName) return 0;
  const raw = awsJson(
    ["lambda", "get-function-concurrency", "--function-name", functionName],
    true,
    true,
  ) as FunctionConcurrencyDocument | undefined;
  const value = raw?.ReservedConcurrentExecutions ?? 0;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("AWS returned an invalid ReservedConcurrentExecutions value");
  }
  return value;
}

function functionConfiguration(logicalIdPrefix: string): FunctionConfigurationDocument {
  const functionName = stackLambdaFunctionName(logicalIdPrefix, true);
  return awsJson([
    "lambda",
    "get-function-configuration",
    "--function-name",
    functionName!,
  ]) as FunctionConfigurationDocument;
}

function functionEnvironment(logicalIdPrefix: string): Record<string, string> {
  return functionConfiguration(logicalIdPrefix).Environment?.Variables ?? {};
}

const cdkConfiguration = JSON.parse(
  readFileSync(join(cdkRoot, "cdk.json"), "utf8"),
) as CdkConfiguration;
const app = new cdk.App({
  autoSynth: false,
  context: {
    ...cdkConfiguration.context,
    environment: "dev",
  },
});
const config = readPlatformConfig(app);
const currentReservedConcurrency = currentInferenceReservedConcurrency();
const accountSettings = awsJson(["lambda", "get-account-settings"]);
const accountCapacity = parseLambdaAccountCapacity(accountSettings, currentReservedConcurrency);
const result = assertCapacityFitsAccount(config.capacity, accountCapacity);

console.log(
  [
    "Lambda capacity preflight passed:",
    `mode=${config.capacity.mode}`,
    `admission=${config.capacity.systemConcurrencyLimit}`,
    `control-plane-headroom=${config.capacity.controlPlaneConcurrencyHeadroom}`,
    `desired-inference-reserved=${config.capacity.inferenceReservedConcurrency}`,
    `projected-unreserved=${result.projectedUnreservedConcurrency}`,
    `required-unreserved=${result.requiredUnreservedConcurrency}`,
  ].join(" "),
);

if (process.argv.includes("--post-deploy")) {
  const stack = awsJson([
    "cloudformation",
    "describe-stacks",
    "--stack-name",
    stackName,
  ]) as StackDescriptionDocument;
  const stackStatus = stack.Stacks?.[0]?.StackStatus;
  if (stackStatus !== "CREATE_COMPLETE" && stackStatus !== "UPDATE_COMPLETE") {
    throw new Error(`Stack ${stackName} is not complete: ${stackStatus ?? "missing status"}`);
  }

  if (currentReservedConcurrency !== config.capacity.inferenceReservedConcurrency) {
    throw new Error(
      `Deployed inference reserved concurrency is ${currentReservedConcurrency}; expected ${config.capacity.inferenceReservedConcurrency}`,
    );
  }

  const inferenceConfiguration = functionConfiguration("InferenceFunction");
  const inferenceEnvironment = inferenceConfiguration.Environment?.Variables ?? {};
  if (inferenceEnvironment.MODEL_PROFILE !== "catalog") {
    throw new Error(
      `Inference MODEL_PROFILE is ${inferenceEnvironment.MODEL_PROFILE ?? "missing"}; expected catalog`,
    );
  }
  if (inferenceConfiguration.MemorySize !== config.inferenceMemoryMb) {
    throw new Error(
      `Deployed inference memory is ${inferenceConfiguration.MemorySize ?? "missing"}; expected ${config.inferenceMemoryMb}`,
    );
  }
  if (inferenceConfiguration.Timeout !== config.inferenceTimeoutSeconds) {
    throw new Error(
      `Deployed inference timeout is ${inferenceConfiguration.Timeout ?? "missing"}; expected ${config.inferenceTimeoutSeconds}`,
    );
  }
  const jobSubmitEnvironment = functionEnvironment("JobSubmitFunction");
  if (jobSubmitEnvironment.TIER_LIMITS_JSON !== JSON.stringify(config.tierLimits)) {
    throw new Error("Deployed JobSubmit TIER_LIMITS_JSON does not match the tier contract");
  }
  if (
    jobSubmitEnvironment.SYSTEM_CONCURRENCY_LIMIT !== String(config.capacity.systemConcurrencyLimit)
  ) {
    throw new Error(
      "Deployed JobSubmit SYSTEM_CONCURRENCY_LIMIT does not match the capacity contract",
    );
  }
  if (jobSubmitEnvironment.SYSTEM_DAILY_JOB_LIMIT !== String(config.dailyUsage.systemJobLimit)) {
    throw new Error(
      "Deployed JobSubmit SYSTEM_DAILY_JOB_LIMIT does not match the daily usage contract",
    );
  }
  if (
    jobSubmitEnvironment.DAILY_JOB_LIMITS_JSON !== JSON.stringify(config.dailyUsage.tierJobLimits)
  ) {
    throw new Error(
      "Deployed JobSubmit DAILY_JOB_LIMITS_JSON does not match the daily usage contract",
    );
  }
  if (jobSubmitEnvironment.MAX_UPLOAD_BYTES !== String(config.maxUploadBytes)) {
    throw new Error("Deployed JobSubmit MAX_UPLOAD_BYTES does not match the upload contract");
  }
  console.log(
    [
      "Post-deploy verification passed:",
      `stack=${stackStatus}`,
      "model=catalog",
      `admission=${config.capacity.systemConcurrencyLimit}`,
      `reserved=${config.capacity.inferenceReservedConcurrency}`,
      `memory=${config.inferenceMemoryMb}`,
      `timeout=${config.inferenceTimeoutSeconds}`,
    ].join(" "),
  );
}
