# 参考資料（公式）

設計・実装時は、以下の一次資料を基準にする。

## OpenAI Codex

- Codexでの`AGENTS.md`利用: https://developers.openai.com/codex/guides/agents-md/
- 長時間タスクのExecution Plans: https://developers.openai.com/codex/guides/agentic-workflows/
- Codexのプロンプト・作業分割: https://developers.openai.com/codex/guides/prompting/
- Codex CLI: https://developers.openai.com/codex/cli/

## Floci

- Flociサービス対応一覧: https://floci.io/floci/services/
- Lambda: https://floci.io/floci/services/lambda/
- ECR: https://floci.io/floci/services/ecr/
- API Gateway: https://floci.io/floci/services/api-gateway/
- Cognito: https://floci.io/floci/services/cognito/
- Step Functions: https://floci.io/floci/services/step-functions/
- Quick Start: https://floci.io/floci/getting-started/quick-start/
- Floci UI: https://github.com/floci-io/floci-ui
- Floci UI release 0.2.0: https://github.com/floci-io/floci-ui/releases/tag/0.2.0

Flociは本番AWSの完全な代替ではない。管理プレーン、IAM評価、CloudFront配信、実Lambda性能、サービス統合の差異はAWS開発環境で確認する。

## AWS

- Lambdaコンテナイメージ: https://docs.aws.amazon.com/lambda/latest/dg/images-create.html
- Lambdaクォータ: https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html
- API Gateway HTTP API JWT Authorizer: https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html
- S3 POST Policy: https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-HTTPPOSTConstructPolicy.html
- S3 POST Policy Conditions: https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-HTTPPOSTConstructPolicy.html#sigv4-ConditionMatching
- Cognito User Pool Groups: https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-user-groups.html
- Cognitoマネージドログイン: https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-managed-login.html
- Cognito User Poolドメイン: https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-assign-domain.html
- Cognito prefix domain: https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-assign-domain-prefix.html
- Cognito login endpoint: https://docs.aws.amazon.com/cognito/latest/developerguide/login-endpoint.html
- Cognito logout endpoint: https://docs.aws.amazon.com/cognito/latest/developerguide/logout-endpoint.html
- Cognito Authorization Code GrantとPKCE: https://docs.aws.amazon.com/cognito/latest/developerguide/using-pkce-in-authorization-code.html
- Cognito User Pool自己登録: https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools.html
- Cognito User Pool属性: https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-attributes.html
- Cognito User Pool更新時の変更不可設定: https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pool-updating.html
- Cognito Post Confirmation Lambda: https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-post-confirmation.html
- CDK ManagedLoginVersion: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cognito.ManagedLoginVersion.html
- CDK CfnManagedLoginBranding: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cognito.CfnManagedLoginBranding.html
- DynamoDBトランザクション: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transactions.html
- Step Functions Standard / Express: https://docs.aws.amazon.com/step-functions/latest/dg/choosing-workflow-type.html
- Step Functions Lambda統合: https://docs.aws.amazon.com/step-functions/latest/dg/connect-lambda.html
- CDK DockerImageFunction: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda.DockerImageFunction.html
- CloudFront OAC付きS3オリジン: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cloudfront_origins.S3BucketOrigin.html
- CloudFront地理的制限: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/georestrictions.html
- CloudFrontカスタムエラーページ: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/creating-custom-error-pages.html

### 料金

- AWS Lambda: https://aws.amazon.com/lambda/pricing/
- AWS Step Functions: https://aws.amazon.com/step-functions/pricing/
- Amazon CloudWatch: https://aws.amazon.com/cloudwatch/pricing/
- Amazon Cognito: https://aws.amazon.com/cognito/pricing/
- Amazon ECR: https://aws.amazon.com/ecr/pricing/
- Amazon DynamoDB: https://aws.amazon.com/dynamodb/pricing/
- DynamoDB Streamsのコスト最適化: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/CostOptimization_StreamsUsage.html
- Amazon S3: https://aws.amazon.com/s3/pricing/
- Amazon API Gateway: https://aws.amazon.com/api-gateway/pricing/
- Amazon CloudFront: https://aws.amazon.com/cloudfront/pricing/

## Bun

- AWS LambdaへのBunアプリ配備: https://bun.com/docs/guides/deployment/aws-lambda

このガイドはBunをLambda runtimeとしてコンテナ配備する場合に使う。
現在のCDKアプリ実行方式とNode.js/Python Lambda構成を直接置き換える資料ではない。

## 実装参考記事

- FlociとAWS CDKによるローカル開発: https://zenn.dev/mashharuki/articles/aws_floci-cdk
- Bun、mise、TypeScriptネイティブコンパイラー、OxcによるCDK開発: https://zenn.dev/gemcook/articles/9bac451d782e18

Flociの記事からは環境差分のContext化、ローカル実行URL、smoke testの構成を採用した。
ただし、このリポジトリはDockerImageFunctionを使うため、ECRを省く独自bootstrapは採用しない。
TypeScriptの記事は公開時点のpreview/RC情報を含むため、正式版TypeScript 7.0.2の仕様へ読み替える。
