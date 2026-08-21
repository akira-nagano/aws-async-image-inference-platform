#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { AwsSolutionsChecks } from "cdk-nag";
import { PlatformStack } from "../lib/platform-stack";
import { readPlatformConfig } from "../lib/config";
import { stackName } from "../lib/naming";

// Bun currently re-emits Node's `beforeExit` event while CDK auto-synthesis is
// running on Windows. Synthesize explicitly so the CDK app exits deterministically.
const app = new cdk.App({ autoSynth: false });
const config = readPlatformConfig(app);

new PlatformStack(app, stackName(config.environment), {
  config,
  env: config.local
    ? { account: "000000000000", region: "ap-northeast-1" }
    : {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION ?? "ap-northeast-1",
      },
  description: "ImgFlow: asynchronous containerized image processing platform",
});

cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
app.synth();
