import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { createCapacityContract } from "../lib/capacity";
import { PlatformStack } from "../lib/platform-stack";
import { resourceDisplayName, stackName, SYSTEM_ID, SYSTEM_SLUG } from "../lib/naming";
import { readPlatformConfig, type PlatformConfig } from "../lib/config";

interface CdkPackage {
  scripts: Record<string, string>;
}

const cdkPackage = JSON.parse(
  readFileSync(resolve(__dirname, "../../package.json"), "utf-8"),
) as CdkPackage;

const config: PlatformConfig = {
  environment: "local",
  local: true,
  localAuthBypass: false,
  includeEdgeInLocal: false,
  tierLimits: {
    "tier-basic": 1,
    "tier-standard": 3,
    "tier-premium": 10,
  },
  capacity: createCapacityContract({
    mode: "reserved",
    systemConcurrencyLimit: 30,
  }),
  dailyUsage: {
    tierJobLimits: {
      "tier-basic": 10,
      "tier-standard": 30,
      "tier-premium": 100,
    },
    systemJobLimit: 100,
  },
  inferenceMemoryMb: 10240,
  inferenceTimeoutSeconds: 900,
  inferenceModelProfile: "stub",
  stubInferenceDelayMs: 100,
  inputRetentionDays: 1,
  jobRetentionDays: 30,
  maxUploadBytes: 5 * 1024 * 1024,
  apiThrottleRate: 50,
  apiThrottleBurst: 100,
  uploadAllowedOrigin: "http://localhost:5173",
};

function template(overrides: Partial<PlatformConfig> = {}): Template {
  const app = new cdk.App({ autoSynth: false });
  const stack = new PlatformStack(app, "TestStack", {
    config: { ...config, ...overrides },
    env: { account: "000000000000", region: "ap-northeast-1" },
  });
  return Template.fromStack(stack);
}

const defaultTemplate = template();
const nonLocalTemplate = template({
  environment: "dev",
  local: false,
  uploadAllowedOrigin: "https://*.cloudfront.net",
});
const prodTemplate = template({
  environment: "prod",
  local: false,
  uploadAllowedOrigin: "https://*.cloudfront.net",
});
const localBypassTemplate = template({ localAuthBypass: true });

describe("ImgFlow naming", () => {
  it("builds stack and display names from one contract", () => {
    assert.equal(SYSTEM_ID, "ImgFlow");
    assert.equal(SYSTEM_SLUG, "imgflow");
    assert.equal(stackName("dev"), "ImgFlow-dev");
    assert.equal(resourceDisplayName("local", "api"), "imgflow-local-api");
  });
});

describe("PlatformStack", () => {
  it("creates three Cognito tier groups", () => {
    defaultTemplate.resourceCountIs("AWS::Cognito::UserPoolGroup", 3);
  });

  it("uses managed login only in AWS environments", () => {
    defaultTemplate.resourceCountIs("AWS::Cognito::UserPoolDomain", 0);
    defaultTemplate.resourceCountIs("AWS::Cognito::ManagedLoginBranding", 0);
    defaultTemplate.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      ExplicitAuthFlows: Match.arrayWith(["ALLOW_USER_PASSWORD_AUTH", "ALLOW_USER_SRP_AUTH"]),
    });

    nonLocalTemplate.hasResourceProperties("AWS::Cognito::UserPool", {
      UserPoolName: "imgflow-dev-users",
      AdminCreateUserConfig: {
        AllowAdminCreateUserOnly: false,
      },
      AutoVerifiedAttributes: ["email"],
      Schema: Match.arrayWith([
        Match.objectLike({
          Name: "email",
          Mutable: true,
          Required: true,
        }),
      ]),
      LambdaConfig: {
        PostConfirmation: Match.anyValue(),
      },
      UserPoolTier: "ESSENTIALS",
    });
    nonLocalTemplate.hasResourceProperties("AWS::Cognito::UserPoolDomain", {
      Domain: Match.stringLikeRegexp("^imgflow-dev-"),
      ManagedLoginVersion: 2,
    });
    nonLocalTemplate.hasResourceProperties("AWS::Cognito::ManagedLoginBranding", {
      ClientId: Match.anyValue(),
      UserPoolId: Match.anyValue(),
      UseCognitoProvidedValues: true,
    });
    nonLocalTemplate.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      ClientName: "imgflow-dev-web",
      AllowedOAuthFlows: ["code"],
      AllowedOAuthFlowsUserPoolClient: true,
      AllowedOAuthScopes: Match.arrayWith(["openid", "email", "profile"]),
      CallbackURLs: Match.anyValue(),
      LogoutURLs: Match.anyValue(),
      SupportedIdentityProviders: ["COGNITO"],
    });
  });

  it("keeps local registration closed and assigns AWS self-signups to tier-basic", () => {
    const localUserPoolIds = Object.keys(defaultTemplate.findResources("AWS::Cognito::UserPool"));
    const awsUserPoolIds = Object.keys(nonLocalTemplate.findResources("AWS::Cognito::UserPool"));
    assert.equal(localUserPoolIds.length, 1);
    assert.equal(awsUserPoolIds.length, 1);
    assert.ok(localUserPoolIds[0]?.startsWith("UserPool"));
    assert.ok(!localUserPoolIds[0]?.startsWith("UserPoolV2"));
    assert.ok(awsUserPoolIds[0]?.startsWith("UserPoolV2"));

    defaultTemplate.hasResourceProperties("AWS::Cognito::UserPool", {
      AdminCreateUserConfig: {
        AllowAdminCreateUserOnly: true,
      },
      LambdaConfig: Match.absent(),
    });

    nonLocalTemplate.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: "cognito-idp:AdminAddUserToGroup",
            Effect: "Allow",
            Resource: {
              "Fn::GetAtt": [Match.stringLikeRegexp("^UserPool"), "Arn"],
            },
          }),
        ]),
      },
    });
    nonLocalTemplate.hasResourceProperties("AWS::Lambda::Permission", {
      Action: "lambda:InvokeFunction",
      Principal: "cognito-idp.amazonaws.com",
    });
  });

  it("allows only Japan through the AWS CloudFront distribution", () => {
    nonLocalTemplate.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: {
        Comment: "imgflow-dev-web distribution",
        Restrictions: {
          GeoRestriction: {
            Locations: ["JP"],
            RestrictionType: "whitelist",
          },
        },
        CustomErrorResponses: Match.arrayWith([
          Match.objectLike({
            ErrorCode: 404,
            ResponseCode: 200,
            ResponsePagePath: "/index.html",
          }),
        ]),
      },
    });
    const distributions = JSON.stringify(
      nonLocalTemplate.findResources("AWS::CloudFront::Distribution"),
    );
    assert.doesNotMatch(distributions, /"ErrorCode":403/);
    nonLocalTemplate.hasResourceProperties("AWS::CloudFront::ResponseHeadersPolicy", {
      ResponseHeadersPolicyConfig: {
        Name: "imgflow-dev-security-headers",
        SecurityHeadersConfig: {
          ContentSecurityPolicy: Match.objectLike({
            ContentSecurityPolicy: Match.stringLikeRegexp("frame-ancestors 'none'"),
          }),
          ContentTypeOptions: { Override: true },
          FrameOptions: Match.objectLike({ FrameOption: "DENY" }),
          StrictTransportSecurity: Match.objectLike({
            AccessControlMaxAgeSec: 31536000,
          }),
        },
      },
    });
  });

  it("creates jobs and concurrency tables", () => {
    defaultTemplate.resourceCountIs("AWS::DynamoDB::Table", 2);
    defaultTemplate.hasResourceProperties("AWS::DynamoDB::Table", {
      GlobalSecondaryIndexes: Match.arrayWith([Match.objectLike({ IndexName: "ActiveJobsIndex" })]),
      StreamSpecification: { StreamViewType: "NEW_IMAGE" },
    });
    nonLocalTemplate.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      BatchSize: 10,
      BisectBatchOnFunctionError: true,
      FunctionResponseTypes: ["ReportBatchItemFailures"],
      MaximumRetryAttempts: 5,
      DestinationConfig: Match.absent(),
    });
    nonLocalTemplate.resourceCountIs("AWS::SQS::Queue", 0);
    defaultTemplate.resourceCountIs("AWS::Lambda::EventSourceMapping", 0);
    defaultTemplate.hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: Match.objectLike({
          LOCAL_DISPATCHER_FUNCTION_NAME: Match.anyValue(),
        }),
      },
    });
  });

  it("uses a Standard Step Functions state machine", () => {
    defaultTemplate.hasResourceProperties("AWS::StepFunctions::StateMachine", {
      StateMachineType: "STANDARD",
      LoggingConfiguration: Match.objectLike({
        IncludeExecutionData: false,
        Level: "ALL",
      }),
    });
    const workflow = JSON.stringify(
      defaultTemplate.findResources("AWS::StepFunctions::StateMachine"),
    );
    assert.match(workflow, /InferenceTimedOut/);
    assert.match(workflow, /InferenceFailed/);
    assert.match(workflow, /Sandbox\.Timedout/);
    assert.match(workflow, /TimeoutSeconds\\":930/);
    assert.match(workflow, /Lambda\.TooManyRequestsException/);
    assert.match(workflow, /Lambda\.ServiceException/);
    const stateMachineResource = Object.values(
      defaultTemplate.findResources("AWS::StepFunctions::StateMachine"),
    )[0] as {
      Properties: {
        DefinitionString: {
          "Fn::Join": [string, unknown[]];
        };
      };
    };
    const definitionParts = stateMachineResource.Properties.DefinitionString["Fn::Join"][1];
    const definition = JSON.parse(
      definitionParts.map((part) => (typeof part === "string" ? part : "lambda-arn")).join(""),
    ) as {
      States: {
        RunInference: {
          Retry: Array<{ ErrorEquals: string[] }>;
        };
      };
    };
    assert.deepEqual(definition.States.RunInference.Retry, [
      {
        ErrorEquals: [
          "Lambda.TooManyRequestsException",
          "Lambda.ServiceException",
          "Lambda.AWSLambdaException",
          "Lambda.SdkClientException",
        ],
        IntervalSeconds: 2,
        MaxAttempts: 3,
        BackoffRate: 2,
      },
    ]);
  });

  it("creates an image-backed Lambda with the configured limits", () => {
    defaultTemplate.hasResourceProperties("AWS::Lambda::Function", {
      PackageType: "Image",
      MemorySize: 10240,
      Timeout: 900,
      ReservedConcurrentExecutions: 30,
      Environment: {
        Variables: Match.objectLike({
          MODEL_PROFILE: "stub",
        }),
      },
    });
  });

  it("selects the catalog profile only when explicitly configured", () => {
    template({ inferenceModelProfile: "catalog" }).hasResourceProperties("AWS::Lambda::Function", {
      PackageType: "Image",
      Environment: {
        Variables: Match.objectLike({
          MODEL_PROFILE: "catalog",
          CATALOG_INDEX_PATH: "/opt/model/catalog-index.json",
          DINO_MODEL_PATH: "/opt/model/dinov2-small",
        }),
      },
    });
  });

  it("can omit reserved concurrency for reduced new-account quotas", () => {
    template({
      capacity: createCapacityContract({
        mode: "shared",
        systemConcurrencyLimit: 4,
      }),
    }).hasResourceProperties("AWS::Lambda::Function", {
      PackageType: "Image",
      ReservedConcurrentExecutions: Match.absent(),
    });
  });

  it("uses native log groups instead of log-retention custom resources", () => {
    defaultTemplate.resourceCountIs("Custom::LogRetention", 0);
  });

  it("uses the Floci Cognito issuer only in local mode", () => {
    defaultTemplate.hasResourceProperties("AWS::ApiGatewayV2::Authorizer", {
      JwtConfiguration: {
        Issuer: {
          "Fn::Join": ["", Match.arrayWith([Match.stringLikeRegexp("^http://localhost:4566/$")])],
        },
      },
    });
    nonLocalTemplate.hasResourceProperties("AWS::ApiGatewayV2::Authorizer", {
      JwtConfiguration: {
        Issuer: {
          "Fn::Join": ["", Match.arrayWith([Match.stringLikeRegexp("^https://cognito-idp\\.")])],
        },
      },
    });
  });

  it("limits the explicit authentication bypass to the local template", () => {
    localBypassTemplate.resourceCountIs("AWS::ApiGatewayV2::Authorizer", 0);
    localBypassTemplate.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      AuthorizationType: "NONE",
    });
    localBypassTemplate.hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: Match.objectLike({
          ALLOW_LOCAL_AUTH_BYPASS: "true",
        }),
      },
    });
  });

  it("creates four consolidated alarms, keeps SNS actions, and uses two custom metrics", () => {
    defaultTemplate.resourceCountIs("AWS::CloudWatch::Alarm", 4);
    defaultTemplate.resourceCountIs("AWS::SNS::Topic", 1);

    const alarms = Object.values(defaultTemplate.findResources("AWS::CloudWatch::Alarm")) as {
      Properties?: { AlarmActions?: unknown[] };
    }[];
    for (const alarm of alarms) {
      assert.equal(alarm.Properties?.AlarmActions?.length, 1);
    }
    const alarmNames = alarms
      .map((alarm) => (alarm.Properties as { AlarmName?: string } | undefined)?.AlarmName)
      .sort();
    assert.deepEqual(alarmNames, [
      "imgflow-local-dispatcher-anomaly",
      "imgflow-local-job-submit-errors",
      "imgflow-local-reaper-anomaly",
      "imgflow-local-workflow-abnormal",
    ]);
    const serializedAlarms = JSON.stringify(alarms);
    assert.match(serializedAlarms, /DispatchAnomaly/);
    assert.match(serializedAlarms, /ReaperAnomaly/);
    assert.doesNotMatch(
      serializedAlarms,
      /DispatchFailure|ReaperReleased|ReaperFailed|JobsTimedOut/,
    );

    nonLocalTemplate.hasResourceProperties("AWS::CloudWatch::Dashboard", {
      DashboardName: "imgflow-dev-operations",
    });
    const dashboards = JSON.stringify(nonLocalTemplate.findResources("AWS::CloudWatch::Dashboard"));
    assert.match(dashboards, /DispatchAnomaly/);
    assert.match(dashboards, /ReaperAnomaly/);
  });

  it("uses the generic system tag", () => {
    defaultTemplate.hasResourceProperties("AWS::DynamoDB::Table", {
      Tags: Match.arrayWith([{ Key: "System", Value: "ImgFlow" }]),
    });
  });

  it("uses consistent human-facing resource names without fixing replacement-sensitive physical names", () => {
    defaultTemplate.hasResourceProperties("AWS::ApiGatewayV2::Api", {
      Name: "imgflow-local-api",
    });
    defaultTemplate.hasResourceProperties("AWS::Cognito::UserPool", {
      UserPoolName: "imgflow-local-users",
    });
    defaultTemplate.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      ClientName: "imgflow-local-web",
    });

    const generatedNameContracts = [
      ["AWS::S3::Bucket", "BucketName"],
      ["AWS::DynamoDB::Table", "TableName"],
      ["AWS::Lambda::Function", "FunctionName"],
      ["AWS::IAM::Role", "RoleName"],
      ["AWS::Logs::LogGroup", "LogGroupName"],
      ["AWS::StepFunctions::StateMachine", "StateMachineName"],
      ["AWS::SNS::Topic", "TopicName"],
      ["AWS::Events::Rule", "Name"],
    ] as const;
    for (const [resourceType, propertyName] of generatedNameContracts) {
      const resources = Object.values(defaultTemplate.findResources(resourceType)) as Array<{
        Properties?: Record<string, unknown>;
      }>;
      assert.ok(resources.length > 0, `expected at least one ${resourceType}`);
      for (const resource of resources) {
        assert.equal(
          resource.Properties?.[propertyName],
          undefined,
          `${resourceType}.${propertyName} must remain CloudFormation-generated`,
        );
      }
    }
  });

  it("blocks public access on S3 buckets", () => {
    defaultTemplate.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it("retains only production access logs and auto-deletes other bucket contents", () => {
    type BucketResource = {
      DeletionPolicy?: string;
      UpdateReplacePolicy?: string;
    };
    type AutoDeleteResource = {
      Properties?: { BucketName?: { Ref?: string } };
    };

    const prodBuckets = prodTemplate.findResources("AWS::S3::Bucket") as Record<
      string,
      BucketResource
    >;
    const bucketId = (prefix: string): string => {
      const matches = Object.keys(prodBuckets).filter((logicalId) => logicalId.startsWith(prefix));
      assert.equal(matches.length, 1, `expected one ${prefix} bucket, got ${matches.length}`);
      return matches[0]!;
    };
    const accessLogsBucketId = bucketId("AccessLogsBucket");
    const frontendBucketId = bucketId("FrontendBucket");
    const inputBucketId = bucketId("InputBucket");

    assert.deepEqual(
      {
        deletion: prodBuckets[accessLogsBucketId]?.DeletionPolicy,
        replacement: prodBuckets[accessLogsBucketId]?.UpdateReplacePolicy,
      },
      { deletion: "Retain", replacement: "Retain" },
    );
    for (const logicalId of [frontendBucketId, inputBucketId]) {
      assert.deepEqual(
        {
          deletion: prodBuckets[logicalId]?.DeletionPolicy,
          replacement: prodBuckets[logicalId]?.UpdateReplacePolicy,
        },
        { deletion: "Delete", replacement: "Delete" },
      );
    }

    defaultTemplate.resourceCountIs("Custom::S3AutoDeleteObjects", 3);
    nonLocalTemplate.resourceCountIs("Custom::S3AutoDeleteObjects", 3);
    prodTemplate.resourceCountIs("Custom::S3AutoDeleteObjects", 2);
    const prodAutoDeleteResources = Object.values(
      prodTemplate.findResources("Custom::S3AutoDeleteObjects"),
    ) as AutoDeleteResource[];
    assert.deepEqual(
      new Set(prodAutoDeleteResources.map((resource) => resource.Properties?.BucketName?.Ref)),
      new Set([frontendBucketId, inputBucketId]),
    );
  });

  it("enforces POST upload CORS and API throttling", () => {
    defaultTemplate.hasResourceProperties("AWS::S3::Bucket", {
      CorsConfiguration: {
        CorsRules: Match.arrayWith([
          Match.objectLike({
            AllowedMethods: ["POST"],
            AllowedOrigins: ["http://localhost:5173"],
          }),
        ]),
      },
    });
    defaultTemplate.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
      AccessLogSettings: Match.objectLike({ DestinationArn: Match.anyValue() }),
      DefaultRouteSettings: {
        ThrottlingBurstLimit: 100,
        ThrottlingRateLimit: 50,
      },
    });
  });

  it("does not grant broad DynamoDB or S3 actions to Lambda roles", () => {
    const policies = JSON.stringify(defaultTemplate.findResources("AWS::IAM::Policy"));
    assert.doesNotMatch(policies, /dynamodb:\*/);
    assert.doesNotMatch(policies, /s3:\*/);
    assert.doesNotMatch(policies, /dynamodb:Scan/);
    assert.doesNotMatch(policies, /s3:ListBucket/);
  });
});

describe("PlatformConfig", () => {
  it("derives inference capacity from the selected mode and admission limit", () => {
    const shared = readPlatformConfig(
      new cdk.App({
        autoSynth: false,
        context: {
          capacityMode: "shared",
          systemConcurrencyLimit: 4,
        },
      }),
    );
    assert.equal(shared.capacity.inferenceReservedConcurrency, 0);
    assert.equal(shared.capacity.requiredUnreservedConcurrency, 10);
    assert.equal(shared.inferenceMemoryMb, 3008);
    assert.equal(shared.inferenceModelProfile, "stub");

    const reserved = readPlatformConfig(
      new cdk.App({
        autoSynth: false,
        context: {
          capacityMode: "reserved",
          systemConcurrencyLimit: 5,
          tierLimits: {
            "tier-basic": 1,
            "tier-standard": 3,
            "tier-premium": 5,
          },
        },
      }),
    );
    assert.equal(reserved.capacity.inferenceReservedConcurrency, 5);
    assert.equal(reserved.capacity.systemConcurrencyLimit, 5);
  });

  it("rejects the removed independent reservation setting and invalid modes", () => {
    assert.throws(
      () =>
        readPlatformConfig(
          new cdk.App({
            autoSynth: false,
            context: {
              inferenceReservedConcurrency: 4,
            },
          }),
        ),
      /no longer configurable/,
    );
    assert.throws(
      () =>
        readPlatformConfig(
          new cdk.App({
            autoSynth: false,
            context: { capacityMode: "automatic" },
          }),
        ),
      /capacityMode/,
    );
    assert.throws(
      () =>
        readPlatformConfig(
          new cdk.App({
            autoSynth: false,
            context: { controlPlaneConcurrencyHeadroom: 1 },
          }),
        ),
      /architecture-derived/,
    );
  });

  it("rejects unreachable or unordered tier limits", () => {
    assert.throws(
      () =>
        readPlatformConfig(
          new cdk.App({
            autoSynth: false,
            context: {
              systemConcurrencyLimit: 4,
              tierLimits: {
                "tier-basic": 1,
                "tier-standard": 3,
                "tier-premium": 10,
              },
            },
          }),
        ),
      /must not exceed systemConcurrencyLimit/,
    );
    assert.throws(
      () =>
        readPlatformConfig(
          new cdk.App({
            autoSynth: false,
            context: {
              systemConcurrencyLimit: 4,
              tierLimits: {
                "tier-basic": 2,
                "tier-standard": 1,
                "tier-premium": 4,
              },
            },
          }),
        ),
      /must be ordered/,
    );
    assert.throws(
      () =>
        readPlatformConfig(
          new cdk.App({
            autoSynth: false,
            context: {
              dailyJobLimits: {
                "tier-basic": 10,
                "tier-standard": 30,
                "tier-premium": 101,
              },
              systemDailyJobLimit: 100,
            },
          }),
        ),
      /must not exceed systemDailyJobLimit/,
    );
  });

  it("rejects an unsupported inference model profile", () => {
    assert.throws(
      () =>
        readPlatformConfig(
          new cdk.App({
            autoSynth: false,
            context: { inferenceModelProfile: "generated-model-number" },
          }),
        ),
      /inferenceModelProfile/,
    );
  });

  it("accepts a valid Cognito domain prefix and rejects invalid or reserved values", () => {
    const valid = readPlatformConfig(
      new cdk.App({
        autoSynth: false,
        context: { cognitoDomainPrefix: "inference-dev-123456789012" },
      }),
    );
    assert.equal(valid.cognitoDomainPrefix, "inference-dev-123456789012");

    for (const invalid of ["Uppercase", "-leading", "trailing-", "contains-aws-name"]) {
      assert.throws(
        () =>
          readPlatformConfig(
            new cdk.App({
              autoSynth: false,
              context: { cognitoDomainPrefix: invalid },
            }),
          ),
        /cognitoDomainPrefix/,
      );
    }
  });
});

describe("CDK deployment entry points", () => {
  it("runs capacity preflight before AWS dev deploy and selects explicit model profiles", () => {
    assert.match(
      cdkPackage.scripts["deploy:dev"] ?? "",
      /^bun run preflight:dev && .*inferenceModelProfile=catalog(?:\s|$)/,
    );
    assert.match(
      cdkPackage.scripts["deploy:dev"] ?? "",
      /-c inferenceModelProfile=catalog(?:\s|$)/,
    );
    assert.match(cdkPackage.scripts["deploy:local"] ?? "", /-c inferenceModelProfile=stub(?:\s|$)/);
    assert.match(cdkPackage.scripts.nag ?? "", /-c inferenceModelProfile=stub(?:\s|$)/);
  });
});
