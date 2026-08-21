import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

interface CloudFormationOutput {
  OutputKey?: string;
  OutputValue?: string;
}

const root = join(import.meta.dir, "..");
const stackName = process.env.STACK_NAME ?? "ImgFlow-dev";
const systemAwsCli = join(
  process.env.ProgramFiles ?? "C:\\Program Files",
  "Amazon",
  "AWSCLIV2",
  "aws.exe",
);
const awsCli =
  process.env.AWS_CLI ??
  (process.platform === "win32" && existsSync(systemAwsCli) ? systemAwsCli : "aws");
const outputsFile = join(tmpdir(), `imgflow-outputs-${crypto.randomUUID()}.json`);

async function run(command: string[], capture = false): Promise<string> {
  const processHandle = Bun.spawn(command, {
    cwd: root,
    env: process.env,
    stdout: capture ? "pipe" : "inherit",
    stderr: "inherit",
  });
  const outputPromise = capture ? new Response(processHandle.stdout).text() : Promise.resolve("");
  const [exitCode, output] = await Promise.all([processHandle.exited, outputPromise]);
  if (exitCode !== 0) {
    throw new Error(`Command failed with exit code ${exitCode}: ${command[0]}`);
  }
  return output;
}

function outputValue(outputs: CloudFormationOutput[], key: string): string {
  const value = outputs.find((output) => output.OutputKey === key)?.OutputValue;
  if (!value) throw new Error(`CloudFormation output is missing: ${key}`);
  return value;
}

async function aws(args: string[], capture = false): Promise<string> {
  return run([awsCli, ...args, "--no-cli-pager"], capture);
}

try {
  const outputsJson = await aws(
    [
      "cloudformation",
      "describe-stacks",
      "--stack-name",
      stackName,
      "--query",
      "Stacks[0].Outputs",
      "--output",
      "json",
    ],
    true,
  );
  const outputs = JSON.parse(outputsJson) as CloudFormationOutput[];
  await Bun.write(outputsFile, outputsJson);

  await run([
    "python",
    join(root, "scripts", "generate-web-config.py"),
    "--outputs",
    outputsFile,
    "--output",
    join(root, "apps", "web", "public", "config.json"),
  ]);
  await run([process.execPath, "run", "--filter", "@imgflow/web", "build"]);

  const bucket = outputValue(outputs, "FrontendBucketName");
  const distribution = outputValue(outputs, "DistributionId");
  await aws(["s3", "sync", join(root, "apps", "web", "dist"), `s3://${bucket}/`, "--delete"]);
  await aws(
    ["cloudfront", "create-invalidation", "--distribution-id", distribution, "--paths", "/*"],
    true,
  );
  console.log(`Web deployment completed: s3://${bucket}/`);
} finally {
  await rm(outputsFile, { force: true });
}
