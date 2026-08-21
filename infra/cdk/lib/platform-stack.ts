import { existsSync } from "node:fs";
import * as path from "node:path";
import {
  CfnOutput,
  Duration,
  Fn,
  RemovalPolicy,
  Size,
  Stack,
  Tags,
  type StackProps,
} from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as authorizers from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sns from "aws-cdk-lib/aws-sns";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import { NagSuppressions } from "cdk-nag";
import type { Construct } from "constructs";
import type { PlatformConfig } from "./config";
import { resourceDisplayName, SYSTEM_ID } from "./naming";

export interface PlatformStackProps extends StackProps {
  config: PlatformConfig;
}

function findRepositoryRoot(startPath: string): string {
  let current = path.resolve(startPath);
  for (;;) {
    if (existsSync(path.join(current, "bun.lock"))) return current;
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`Unable to locate repository root from ${startPath}`);
    }
    current = parent;
  }
}

export class PlatformStack extends Stack {
  constructor(scope: Construct, id: string, props: PlatformStackProps) {
    super(scope, id, props);
    const { config } = props;
    if (config.local !== (config.environment === "local")) {
      throw new Error("environment=local and local=true must be configured together");
    }
    if (!config.local && config.localAuthBypass) {
      throw new Error("localAuthBypass must never be enabled outside local mode");
    }
    const repoRoot = findRepositoryRoot(__dirname);
    const removalPolicy =
      config.environment === "prod" ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    Tags.of(this).add("System", SYSTEM_ID);
    Tags.of(this).add("Environment", config.environment);
    Tags.of(this).add("ManagedBy", "CDK");
    Tags.of(this).add("DataClassification", "Internal");

    const accessLogsBucket = new s3.Bucket(this, "AccessLogsBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
      lifecycleRules: [{ expiration: Duration.days(90) }],
      removalPolicy,
      autoDeleteObjects: config.environment !== "prod",
    });
    NagSuppressions.addResourceSuppressions(
      accessLogsBucket,
      [
        {
          id: "AwsSolutions-S1",
          reason:
            "This bucket is the centralized server-access-log destination; recursive access logging would create an unbounded log-delivery loop.",
        },
      ],
      true,
    );

    const frontendBucket = new s3.Bucket(this, "FrontendBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      serverAccessLogsBucket: accessLogsBucket,
      serverAccessLogsPrefix: "s3/frontend/",
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const inputBucket = new s3.Bucket(this, "InputBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      serverAccessLogsBucket: accessLogsBucket,
      serverAccessLogsPrefix: "s3/input/",
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.POST],
          allowedOrigins: [config.uploadAllowedOrigin],
          allowedHeaders: ["*"],
          exposedHeaders: ["etag"],
          maxAge: 900,
        },
      ],
      lifecycleRules: [
        {
          id: "DeleteTemporaryInputs",
          prefix: "uploads/",
          expiration: Duration.days(config.inputRetentionDays),
        },
      ],
    });

    const jobsTable = new dynamodb.Table(this, "JobsTable", {
      partitionKey: { name: "jobId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: !config.local,
      },
      timeToLiveAttribute: "ttl",
      stream: dynamodb.StreamViewType.NEW_IMAGE,
      removalPolicy,
    });
    jobsTable.addGlobalSecondaryIndex({
      indexName: "ActiveJobsIndex",
      partitionKey: { name: "activeKey", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "leaseExpiresAt", type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const concurrencyTable = new dynamodb.Table(this, "ConcurrencyTable", {
      partitionKey: { name: "scopeKey", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: !config.local,
      },
      timeToLiveAttribute: "ttl",
      removalPolicy,
    });
    if (config.local) {
      for (const table of [jobsTable, concurrencyTable]) {
        NagSuppressions.addResourceSuppressions(table, [
          {
            id: "AwsSolutions-DDB3",
            reason:
              "PITR is enabled for every AWS environment; the local-only Floci stack is disposable and does not emulate backup recovery.",
          },
        ]);
      }
    }

    const userPool = new cognito.UserPool(this, config.local ? "UserPool" : "UserPoolV2", {
      userPoolName: resourceDisplayName(config.environment, "users"),
      selfSignUpEnabled: !config.local,
      autoVerify: config.local ? undefined : { email: true },
      signInAliases: { email: true, username: true },
      ...(config.local
        ? {}
        : {
            featurePlan: cognito.FeaturePlan.ESSENTIALS,
            standardAttributes: {
              email: {
                required: true,
                mutable: true,
              },
            },
          }),
      passwordPolicy: {
        minLength: 12,
        requireDigits: true,
        requireLowercase: true,
        requireUppercase: true,
        requireSymbols: true,
      },
      removalPolicy,
    });
    NagSuppressions.addResourceSuppressions(userPool, [
      {
        id: "AwsSolutions-COG8",
        reason:
          "Cognito Plus is a cost-bearing deployment choice and is not required by this reusable starter; production adopters must evaluate it with their threat model.",
      },
      {
        id: "AwsSolutions-COG2",
        reason:
          "MFA enrollment and recovery UX is intentionally outside this generic demo; the short-lived access-token contract remains enforced.",
      },
    ]);
    for (const groupName of Object.keys(config.tierLimits)) {
      new cognito.CfnUserPoolGroup(this, `Group-${groupName}`, {
        userPoolId: userPool.userPoolId,
        groupName,
        description: `Inference concurrency tier: ${groupName}`,
      });
    }

    const commonEnvironment = {
      INPUT_BUCKET_NAME: inputBucket.bucketName,
      JOBS_TABLE_NAME: jobsTable.tableName,
      CONCURRENCY_TABLE_NAME: concurrencyTable.tableName,
      ACTIVE_JOBS_INDEX_NAME: "ActiveJobsIndex",
      TIER_LIMITS_JSON: JSON.stringify(config.tierLimits),
      SYSTEM_CONCURRENCY_LIMIT: String(config.capacity.systemConcurrencyLimit),
      DAILY_JOB_LIMITS_JSON: JSON.stringify(config.dailyUsage.tierJobLimits),
      SYSTEM_DAILY_JOB_LIMIT: String(config.dailyUsage.systemJobLimit),
      MAX_UPLOAD_BYTES: String(config.maxUploadBytes),
      JOB_RETENTION_DAYS: String(config.jobRetentionDays),
      INITIAL_LEASE_SECONDS: "300",
      RUNNING_LEASE_SECONDS: String(config.inferenceTimeoutSeconds + 300),
      ALLOW_LOCAL_AUTH_BYPASS: String(config.local && config.localAuthBypass),
      ENVIRONMENT_NAME: config.environment,
    };

    const functionLogGroup = (logicalId: string) =>
      new logs.LogGroup(this, `${logicalId}LogGroup`, {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy,
      });

    const functionRole = (logicalId: string, logGroup: logs.ILogGroup) => {
      const role = new iam.Role(this, `${logicalId}Role`, {
        assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      });
      role.addToPolicy(
        new iam.PolicyStatement({
          actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
          resources: [`${logGroup.logGroupArn}:*`],
        }),
      );
      NagSuppressions.addResourceSuppressions(
        role,
        [
          {
            id: "AwsSolutions-IAM5",
            reason:
              "A Lambda creates runtime-selected log streams below its dedicated, pre-created log group; the wildcard is restricted to that log group.",
            appliesTo: [
              {
                regex: "/^Resource::<.*LogGroup.*\\.Arn>:\\*$/g",
              },
            ],
          },
        ],
        true,
      );
      return role;
    };

    const nodeFunction = (
      logicalId: string,
      entryFile: string,
      environment: Record<string, string> = commonEnvironment,
      timeout = Duration.seconds(30),
    ) => {
      const logGroup = functionLogGroup(logicalId);
      return new lambdaNodejs.NodejsFunction(this, logicalId, {
        entry: path.join(repoRoot, "services/api/src", entryFile),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_24_X,
        timeout,
        memorySize: 512,
        logGroup,
        role: functionRole(logicalId, logGroup),
        environment,
        bundling: {
          minify: false,
          sourceMap: true,
          target: "node22",
          format: lambdaNodejs.OutputFormat.CJS,
          externalModules: [],
        },
      });
    };

    const uploadUrlFunction = nodeFunction("UploadUrlFunction", "upload-url.ts");
    const jobStatusFunction = nodeFunction("JobStatusFunction", "job-status.ts");
    const markRunningFunction = nodeFunction("MarkRunningFunction", "mark-running.ts");
    const finalizeJobFunction = nodeFunction("FinalizeJobFunction", "finalize-job.ts");
    if (!config.local) {
      const postConfirmationFunction = nodeFunction(
        "PostConfirmationFunction",
        "post-confirmation.ts",
        {},
        Duration.seconds(10),
      );
      const postConfirmationPolicy = new iam.Policy(this, "PostConfirmationGroupPolicy", {
        statements: [
          new iam.PolicyStatement({
            actions: ["cognito-idp:AdminAddUserToGroup"],
            resources: [userPool.userPoolArn],
          }),
        ],
      });
      postConfirmationPolicy.attachToRole(postConfirmationFunction.role!);
      userPool.addTrigger(cognito.UserPoolOperation.POST_CONFIRMATION, postConfirmationFunction);
    }
    const reaperFunction = nodeFunction(
      "ReaperFunction",
      "reaper.ts",
      {
        ...commonEnvironment,
        REAPER_PAGE_SIZE: "50",
        REAPER_MAX_JOBS: "500",
        REAPER_CONCURRENCY: "10",
      },
      Duration.seconds(60),
    );

    const inferenceLogGroup = functionLogGroup("InferenceFunction");
    const inferenceFunction = new lambda.DockerImageFunction(this, "InferenceFunction", {
      code: lambda.DockerImageCode.fromImageAsset(path.join(repoRoot, "services/inference"), {
        buildArgs: {
          MODEL_PROFILE: config.inferenceModelProfile,
        },
      }),
      architecture: lambda.Architecture.X86_64,
      memorySize: config.inferenceMemoryMb,
      timeout: Duration.seconds(config.inferenceTimeoutSeconds),
      ephemeralStorageSize: Size.gibibytes(10),
      ...(config.capacity.inferenceReservedConcurrency > 0
        ? { reservedConcurrentExecutions: config.capacity.inferenceReservedConcurrency }
        : {}),
      logGroup: inferenceLogGroup,
      role: functionRole("InferenceFunction", inferenceLogGroup),
      environment: {
        INPUT_BUCKET_NAME: inputBucket.bucketName,
        MODEL_PROFILE: config.inferenceModelProfile,
        CATALOG_INDEX_PATH: "/opt/model/catalog-index.json",
        DINO_MODEL_PATH: "/opt/model/dinov2-small",
        STUB_INFERENCE_DELAY_MS: String(config.stubInferenceDelayMs),
        ENVIRONMENT_NAME: config.environment,
      },
    });

    const addPolicy = (target: lambda.IFunction, actions: string[], resources: string[]): void => {
      target.addToRolePolicy(new iam.PolicyStatement({ actions, resources }));
    };
    const jobsIndexArn = `${jobsTable.tableArn}/index/ActiveJobsIndex`;
    const uploadObjectsArn = `${inputBucket.bucketArn}/uploads/*`;

    addPolicy(uploadUrlFunction, ["s3:PutObject"], [uploadObjectsArn]);
    addPolicy(
      uploadUrlFunction,
      ["dynamodb:GetItem", "dynamodb:UpdateItem"],
      [concurrencyTable.tableArn],
    );
    addPolicy(inferenceFunction, ["s3:GetObject"], [uploadObjectsArn]);
    addPolicy(
      jobStatusFunction,
      ["dynamodb:GetItem"],
      [jobsTable.tableArn, concurrencyTable.tableArn],
    );
    addPolicy(markRunningFunction, ["dynamodb:UpdateItem"], [jobsTable.tableArn]);
    for (const target of [finalizeJobFunction, reaperFunction]) {
      addPolicy(
        target,
        ["dynamodb:GetItem", "dynamodb:UpdateItem"],
        [jobsTable.tableArn, concurrencyTable.tableArn],
      );
    }
    addPolicy(reaperFunction, ["dynamodb:Query"], [jobsIndexArn]);
    for (const target of [uploadUrlFunction, inferenceFunction]) {
      NagSuppressions.addResourceSuppressions(
        target.role!,
        [
          {
            id: "AwsSolutions-IAM5",
            reason:
              "Object keys are generated per user and job at runtime; access is constrained to the uploads/ prefix of one bucket.",
            appliesTo: [
              {
                regex: "/^Resource::<InputBucket.*\\.Arn>\\/uploads\\/\\*$/g",
              },
            ],
          },
        ],
        true,
      );
    }

    const workflowLogGroup = new logs.LogGroup(this, "WorkflowLogGroup", {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy,
    });

    const markRunningTask = new tasks.LambdaInvoke(this, "MarkRunning", {
      lambdaFunction: markRunningFunction,
      payload: sfn.TaskInput.fromObject({ jobId: sfn.JsonPath.stringAt("$.jobId") }),
      payloadResponseOnly: true,
      resultPath: "$.markRunning",
      retryOnServiceExceptions: true,
    });
    markRunningTask.addRetry({
      errors: ["States.ALL"],
      interval: Duration.seconds(2),
      maxAttempts: 4,
      backoffRate: 2,
    });
    const inferenceTask = new tasks.LambdaInvoke(this, "RunInference", {
      lambdaFunction: inferenceFunction,
      payload: sfn.TaskInput.fromObject({
        jobId: sfn.JsonPath.stringAt("$.jobId"),
        userId: sfn.JsonPath.stringAt("$.userId"),
        objectKey: sfn.JsonPath.stringAt("$.objectKey"),
      }),
      payloadResponseOnly: true,
      resultPath: "$.inferenceResult",
      taskTimeout: sfn.Timeout.duration(Duration.seconds(config.inferenceTimeoutSeconds + 30)),
      retryOnServiceExceptions: false,
    });
    inferenceTask.addRetry({
      errors: [
        "Lambda.TooManyRequestsException",
        "Lambda.ServiceException",
        "Lambda.AWSLambdaException",
        "Lambda.SdkClientException",
      ],
      interval: Duration.seconds(2),
      maxAttempts: 3,
      backoffRate: 2,
    });
    const finalizeSuccess = new tasks.LambdaInvoke(this, "FinalizeSuccess", {
      lambdaFunction: finalizeJobFunction,
      payload: sfn.TaskInput.fromObject({
        jobId: sfn.JsonPath.stringAt("$.jobId"),
        status: "SUCCEEDED",
        result: sfn.JsonPath.objectAt("$.inferenceResult"),
      }),
      payloadResponseOnly: true,
    });
    const finalizeTimeout = new tasks.LambdaInvoke(this, "FinalizeTimeout", {
      lambdaFunction: finalizeJobFunction,
      payload: sfn.TaskInput.fromObject({
        jobId: sfn.JsonPath.stringAt("$.jobId"),
        status: "TIMED_OUT",
        error: {
          code: "INFERENCE_TIMEOUT",
          message: "推論処理がタイムアウトしました。",
        },
      }),
      payloadResponseOnly: true,
    });
    const finalizeFailure = new tasks.LambdaInvoke(this, "FinalizeFailure", {
      lambdaFunction: finalizeJobFunction,
      payload: sfn.TaskInput.fromObject({
        jobId: sfn.JsonPath.stringAt("$.jobId"),
        status: "FAILED",
        error: {
          code: "INFERENCE_FAILED",
          message: "推論処理に失敗しました。",
          detail: sfn.JsonPath.objectAt("$.error"),
        },
      }),
      payloadResponseOnly: true,
    });

    for (const finalizeTask of [finalizeSuccess, finalizeTimeout, finalizeFailure]) {
      finalizeTask.addRetry({
        errors: ["States.ALL"],
        interval: Duration.seconds(2),
        maxAttempts: 4,
        backoffRate: 2,
      });
    }

    const timedOut = new sfn.Fail(this, "InferenceTimedOut", {
      error: "InferenceTimedOut",
      cause: "The inference Lambda reached its configured timeout.",
    });
    const failed = new sfn.Fail(this, "InferenceFailed", {
      error: "InferenceFailed",
      cause: "The inference workflow failed after finalizing the job.",
    });
    finalizeTimeout.next(timedOut);
    finalizeFailure.next(failed);

    inferenceTask.addCatch(finalizeTimeout, {
      errors: ["Sandbox.Timedout", "Lambda.Unknown", "States.Timeout"],
      resultPath: "$.error",
    });
    inferenceTask.addCatch(finalizeFailure, {
      errors: ["States.ALL"],
      resultPath: "$.error",
    });
    markRunningTask.addCatch(finalizeFailure, {
      errors: ["States.ALL"],
      resultPath: "$.error",
    });

    const definition = markRunningTask.next(inferenceTask.next(finalizeSuccess));
    const stateMachine = new sfn.StateMachine(this, "InferenceStateMachine", {
      stateMachineType: sfn.StateMachineType.STANDARD,
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: Duration.hours(1),
      logs: {
        destination: workflowLogGroup,
        level: sfn.LogLevel.ALL,
        includeExecutionData: false,
      },
      tracingEnabled: true,
    });
    NagSuppressions.addResourceSuppressions(
      stateMachine,
      [
        {
          id: "AwsSolutions-IAM5",
          reason:
            "Step Functions log delivery and X-Ray control-plane APIs require Resource '*'; Lambda invoke wildcards are CDK-generated qualified-ARN variants of the three dedicated workflow functions.",
          appliesTo: [
            "Resource::*",
            {
              regex:
                "/^Resource::<(MarkRunningFunction|InferenceFunction|FinalizeJobFunction).*\\.Arn>:\\*$/g",
            },
          ],
        },
      ],
      true,
    );

    const jobDispatcherFunction = nodeFunction("JobDispatcherFunction", "job-dispatcher.ts", {
      ...commonEnvironment,
      STATE_MACHINE_ARN: stateMachine.stateMachineArn,
    });
    stateMachine.grantStartExecution(jobDispatcherFunction);
    addPolicy(
      jobDispatcherFunction,
      ["dynamodb:GetItem", "dynamodb:UpdateItem"],
      [jobsTable.tableArn],
    );
    addPolicy(jobDispatcherFunction, ["dynamodb:UpdateItem"], [concurrencyTable.tableArn]);
    if (!config.local) {
      jobDispatcherFunction.addEventSource(
        new lambdaEventSources.DynamoEventSource(jobsTable, {
          startingPosition: lambda.StartingPosition.LATEST,
          batchSize: 10,
          bisectBatchOnError: true,
          retryAttempts: 5,
          reportBatchItemFailures: true,
        }),
      );
      NagSuppressions.addResourceSuppressions(
        jobDispatcherFunction.role!,
        [
          {
            id: "AwsSolutions-IAM5",
            reason:
              "dynamodb:ListStreams has no resource-level authorization and therefore requires Resource '*'; record reads remain scoped to this table stream.",
            appliesTo: ["Resource::*"],
          },
        ],
        true,
      );
    }

    const jobSubmitFunction = nodeFunction(
      "JobSubmitFunction",
      "job-submit.ts",
      config.local
        ? {
            ...commonEnvironment,
            LOCAL_DISPATCHER_FUNCTION_NAME: jobDispatcherFunction.functionName,
          }
        : commonEnvironment,
    );
    addPolicy(jobSubmitFunction, ["s3:GetObject"], [uploadObjectsArn]);
    addPolicy(
      jobSubmitFunction,
      ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"],
      [jobsTable.tableArn, concurrencyTable.tableArn],
    );
    if (config.local) {
      addPolicy(jobSubmitFunction, ["lambda:InvokeFunction"], [jobDispatcherFunction.functionArn]);
    }
    NagSuppressions.addResourceSuppressions(
      jobSubmitFunction.role!,
      [
        {
          id: "AwsSolutions-IAM5",
          reason:
            "The submitter validates runtime-selected objects under the uploads/ prefix of one bucket before reserving a job.",
          appliesTo: [
            {
              regex: "/^Resource::<InputBucket.*\\.Arn>\\/uploads\\/\\*$/g",
            },
          ],
        },
      ],
      true,
    );

    const httpApi = new apigwv2.HttpApi(this, "HttpApi", {
      apiName: resourceDisplayName(config.environment, "api"),
      ...(config.local
        ? {
            corsPreflight: {
              allowHeaders: [
                "authorization",
                "content-type",
                "idempotency-key",
                "x-local-user-id",
                "x-local-groups",
              ],
              allowMethods: [
                apigwv2.CorsHttpMethod.GET,
                apigwv2.CorsHttpMethod.POST,
                apigwv2.CorsHttpMethod.OPTIONS,
              ],
              allowOrigins: ["http://localhost:5173"],
              maxAge: Duration.hours(1),
            },
          }
        : {}),
    });
    const defaultStage = httpApi.defaultStage?.node.defaultChild as apigwv2.CfnStage | undefined;
    if (!defaultStage) {
      throw new Error("HTTP API default stage was not created");
    }
    defaultStage.defaultRouteSettings = {
      throttlingRateLimit: config.apiThrottleRate,
      throttlingBurstLimit: config.apiThrottleBurst,
    };
    const apiAccessLogGroup = new logs.LogGroup(this, "ApiAccessLogGroup", {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy,
    });
    defaultStage.accessLogSettings = {
      destinationArn: apiAccessLogGroup.logGroupArn,
      format: JSON.stringify({
        requestId: "$context.requestId",
        routeKey: "$context.routeKey",
        status: "$context.status",
        responseLength: "$context.responseLength",
        integrationError: "$context.integrationErrorMessage",
      }),
    };

    let distributionDomainName = "";
    if (!config.local || config.includeEdgeInLocal) {
      const apiDomain = Fn.select(2, Fn.split("/", httpApi.apiEndpoint));
      const responseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(
        this,
        "SecurityResponseHeadersPolicy",
        {
          responseHeadersPolicyName: resourceDisplayName(config.environment, "security-headers"),
          securityHeadersBehavior: {
            contentSecurityPolicy: {
              contentSecurityPolicy:
                "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: blob:; script-src 'self'; style-src 'self'; connect-src 'self' https://*.amazonaws.com https://*.amazoncognito.com",
              override: true,
            },
            contentTypeOptions: { override: true },
            frameOptions: {
              frameOption: cloudfront.HeadersFrameOption.DENY,
              override: true,
            },
            referrerPolicy: {
              referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
              override: true,
            },
            strictTransportSecurity: {
              accessControlMaxAge: Duration.days(365),
              includeSubdomains: true,
              preload: true,
              override: true,
            },
          },
          customHeadersBehavior: {
            customHeaders: [
              {
                header: "Permissions-Policy",
                value: "camera=(), microphone=(), geolocation=()",
                override: true,
              },
            ],
          },
        },
      );
      const distribution = new cloudfront.Distribution(this, "Distribution", {
        comment: `${resourceDisplayName(config.environment, "web")} distribution`,
        defaultRootObject: "index.html",
        ...(config.local ? {} : { geoRestriction: cloudfront.GeoRestriction.allowlist("JP") }),
        enableLogging: true,
        logBucket: accessLogsBucket,
        logFilePrefix: "cloudfront/",
        defaultBehavior: {
          origin: origins.S3BucketOrigin.withOriginAccessControl(frontendBucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          responseHeadersPolicy,
        },
        additionalBehaviors: {
          "/api/*": {
            origin: new origins.HttpOrigin(apiDomain),
            viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
            allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
            cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
            originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
            responseHeadersPolicy,
          },
        },
        errorResponses: [
          {
            httpStatus: 404,
            responseHttpStatus: 200,
            responsePagePath: "/index.html",
            ttl: Duration.seconds(0),
          },
        ],
      });
      NagSuppressions.addResourceSuppressions(distribution, [
        {
          id: "AwsSolutions-CFR4",
          reason:
            "The starter uses the CloudFront-provided domain and certificate; CloudFront does not allow a custom minimum protocol policy without a user-owned domain and ACM certificate.",
        },
        {
          id: "AwsSolutions-CFR2",
          reason:
            "A WAF web ACL is intentionally a deployment-specific, cost-bearing control; API throttling and Cognito authorization are enabled by this starter.",
        },
      ]);
      distributionDomainName = distribution.distributionDomainName;
      new CfnOutput(this, "DistributionId", { value: distribution.distributionId });
      new CfnOutput(this, "DistributionDomainName", { value: distributionDomainName });
    }

    const managedLoginCallbackUrl = distributionDomainName
      ? `https://${distributionDomainName}/`
      : "";
    const userPoolClient = userPool.addClient("WebClient", {
      userPoolClientName: resourceDisplayName(config.environment, "web"),
      generateSecret: false,
      authFlows: config.local ? { userPassword: true, userSrp: true } : { userSrp: true },
      ...(!config.local
        ? {
            oAuth: {
              flows: { authorizationCodeGrant: true },
              callbackUrls: [managedLoginCallbackUrl],
              logoutUrls: [managedLoginCallbackUrl],
              defaultRedirectUri: managedLoginCallbackUrl,
              scopes: [
                cognito.OAuthScope.OPENID,
                cognito.OAuthScope.EMAIL,
                cognito.OAuthScope.PROFILE,
              ],
            },
            supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
          }
        : {}),
      accessTokenValidity: Duration.minutes(30),
      idTokenValidity: Duration.minutes(30),
      refreshTokenValidity: Duration.days(30),
      preventUserExistenceErrors: true,
    });

    let managedLoginBaseUrl = "";
    if (!config.local) {
      const domainPrefix =
        config.cognitoDomainPrefix ?? `imgflow-${config.environment}-${this.account}`;
      const userPoolDomain = userPool.addDomain("ManagedLoginDomain", {
        cognitoDomain: { domainPrefix },
        managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
      });
      userPoolDomain.applyRemovalPolicy(removalPolicy);
      const branding = new cognito.CfnManagedLoginBranding(this, "ManagedLoginBranding", {
        userPoolId: userPool.userPoolId,
        clientId: userPoolClient.userPoolClientId,
        useCognitoProvidedValues: true,
      });
      branding.addResourceDependency(userPoolDomain.node.defaultChild as cognito.CfnUserPoolDomain);
      managedLoginBaseUrl = userPoolDomain.baseUrl();
    }

    const jwtIssuer = config.local
      ? `http://localhost:4566/${userPool.userPoolId}`
      : `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`;
    const jwtAuthorizer = new authorizers.HttpJwtAuthorizer("CognitoJwtAuthorizer", jwtIssuer, {
      jwtAudience: [userPoolClient.userPoolClientId],
    });
    const routeAuthorizer = config.local && config.localAuthBypass ? undefined : jwtAuthorizer;
    const routeAuthorization = routeAuthorizer
      ? {
          authorizer: routeAuthorizer,
        }
      : {};

    const uploadRoutes = httpApi.addRoutes({
      path: "/api/upload-url",
      methods: [apigwv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration(
        "UploadUrlIntegration",
        uploadUrlFunction,
      ),
      ...routeAuthorization,
    });
    const submitRoutes = httpApi.addRoutes({
      path: "/api/jobs",
      methods: [apigwv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration(
        "JobSubmitIntegration",
        jobSubmitFunction,
      ),
      ...routeAuthorization,
    });
    const statusRoutes = httpApi.addRoutes({
      path: "/api/jobs/{jobId}",
      methods: [apigwv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration(
        "JobStatusIntegration",
        jobStatusFunction,
      ),
      ...routeAuthorization,
    });
    if (config.local && config.localAuthBypass) {
      for (const route of [...uploadRoutes, ...submitRoutes, ...statusRoutes]) {
        NagSuppressions.addResourceSuppressions(route, [
          {
            id: "AwsSolutions-APIG4",
            reason:
              "Only the local Floci stack uses the explicit header-based test adapter because Floci does not propagate JWT claims; non-local configurations reject this bypass.",
          },
        ]);
      }
    }

    new events.Rule(this, "ReaperSchedule", {
      schedule: events.Schedule.rate(Duration.minutes(5)),
      targets: [new targets.LambdaFunction(reaperFunction)],
    });

    const alarmTopic = new sns.Topic(this, "AlarmTopic", {
      enforceSSL: true,
      masterKey: kms.Alias.fromAliasName(this, "AlarmTopicKey", "alias/aws/sns"),
    });
    const alarmPeriod = Duration.minutes(5);
    const workflowFailedMetric = stateMachine.metricFailed({ period: alarmPeriod });
    const workflowTimedOutMetric = stateMachine.metricTimedOut({ period: alarmPeriod });
    const workflowAbnormalAlarm = new cloudwatch.Alarm(this, "WorkflowAbnormalAlarm", {
      alarmName: resourceDisplayName(config.environment, "workflow-abnormal"),
      metric: new cloudwatch.MathExpression({
        expression: "failed + timedOut",
        usingMetrics: {
          failed: workflowFailedMetric,
          timedOut: workflowTimedOutMetric,
        },
        period: alarmPeriod,
        label: "Workflow abnormal executions",
      }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    const dispatchAnomalyMetric = new cloudwatch.Metric({
      namespace: SYSTEM_ID,
      metricName: "DispatchAnomaly",
      dimensionsMap: { Environment: config.environment },
      statistic: "Sum",
      period: alarmPeriod,
    });
    const dispatcherLambdaErrorMetric = jobDispatcherFunction.metricErrors({
      period: alarmPeriod,
    });
    const dispatcherAnomalyAlarm = new cloudwatch.Alarm(this, "DispatcherAnomalyAlarm", {
      alarmName: resourceDisplayName(config.environment, "dispatcher-anomaly"),
      metric: new cloudwatch.MathExpression({
        expression: "anomaly + lambdaErrors",
        usingMetrics: {
          anomaly: dispatchAnomalyMetric,
          lambdaErrors: dispatcherLambdaErrorMetric,
        },
        period: alarmPeriod,
        label: "Dispatcher anomalies",
      }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    const reaperAnomalyMetric = new cloudwatch.Metric({
      namespace: SYSTEM_ID,
      metricName: "ReaperAnomaly",
      dimensionsMap: { Environment: config.environment },
      statistic: "Sum",
      period: alarmPeriod,
    });
    const reaperLambdaErrorMetric = reaperFunction.metricErrors({ period: alarmPeriod });
    const reaperAnomalyAlarm = new cloudwatch.Alarm(this, "ReaperAnomalyAlarm", {
      alarmName: resourceDisplayName(config.environment, "reaper-anomaly"),
      metric: new cloudwatch.MathExpression({
        expression: "anomaly + lambdaErrors",
        usingMetrics: {
          anomaly: reaperAnomalyMetric,
          lambdaErrors: reaperLambdaErrorMetric,
        },
        period: alarmPeriod,
        label: "Reaper anomalies",
      }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    const jobSubmitLambdaErrorAlarm = new cloudwatch.Alarm(this, "JobSubmitLambdaErrorAlarm", {
      alarmName: resourceDisplayName(config.environment, "job-submit-errors"),
      metric: jobSubmitFunction.metricErrors({ period: alarmPeriod }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    for (const alarm of [
      workflowAbnormalAlarm,
      dispatcherAnomalyAlarm,
      reaperAnomalyAlarm,
      jobSubmitLambdaErrorAlarm,
    ]) {
      alarm.addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));
    }
    if (!config.local) {
      const dashboard = new cloudwatch.Dashboard(this, "OperationsDashboard", {
        dashboardName: resourceDisplayName(config.environment, "operations"),
      });
      dashboard.addWidgets(
        new cloudwatch.GraphWidget({
          title: "Workflow executions",
          left: [
            stateMachine.metricStarted(),
            stateMachine.metricSucceeded(),
            stateMachine.metricFailed(),
          ],
        }),
        new cloudwatch.GraphWidget({
          title: "Inference Lambda",
          left: [inferenceFunction.metricInvocations(), inferenceFunction.metricErrors()],
          right: [inferenceFunction.metricDuration()],
        }),
        new cloudwatch.GraphWidget({
          title: "Job submit Lambda",
          left: [jobSubmitFunction.metricInvocations(), jobSubmitFunction.metricErrors()],
          right: [jobSubmitFunction.metricDuration()],
        }),
        new cloudwatch.GraphWidget({
          title: "Dispatcher and Reaper anomalies",
          left: [dispatchAnomalyMetric, reaperAnomalyMetric],
          right: [dispatcherLambdaErrorMetric, reaperLambdaErrorMetric],
        }),
      );
    }
    new CfnOutput(this, "FrontendBucketName", { value: frontendBucket.bucketName });
    new CfnOutput(this, "InputBucketName", { value: inputBucket.bucketName });
    new CfnOutput(this, "JobsTableName", { value: jobsTable.tableName });
    new CfnOutput(this, "ConcurrencyTableName", { value: concurrencyTable.tableName });
    new CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", { value: userPoolClient.userPoolClientId });
    if (managedLoginBaseUrl) {
      new CfnOutput(this, "CognitoManagedLoginBaseUrl", { value: managedLoginBaseUrl });
      new CfnOutput(this, "CognitoManagedLoginCallbackUrl", {
        value: managedLoginCallbackUrl,
      });
    }
    new CfnOutput(this, "HttpApiEndpoint", { value: httpApi.apiEndpoint });
    new CfnOutput(this, "StateMachineArn", { value: stateMachine.stateMachineArn });
    new CfnOutput(this, "AlarmTopicArn", { value: alarmTopic.topicArn });
    new CfnOutput(this, "MaxUploadBytes", { value: String(config.maxUploadBytes) });
    new CfnOutput(this, "RuntimeConfigHint", {
      value: JSON.stringify({
        region: this.region,
        apiBaseUrl: distributionDomainName ? "/api" : `${httpApi.apiEndpoint}/api`,
        userPoolId: userPool.userPoolId,
        userPoolClientId: userPoolClient.userPoolClientId,
        authMode: config.local ? "direct" : "managed-login",
        ...(managedLoginBaseUrl
          ? {
              cognitoManagedLoginBaseUrl: managedLoginBaseUrl,
              oauthRedirectUri: managedLoginCallbackUrl,
            }
          : {}),
        maxUploadBytes: config.maxUploadBytes,
      }),
    });
  }
}
