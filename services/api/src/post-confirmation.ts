import {
  AdminAddUserToGroupCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import type { PostConfirmationTriggerEvent } from "aws-lambda";

const DEFAULT_TIER_GROUP = "tier-basic";

interface CognitoGroupClient {
  send(command: AdminAddUserToGroupCommand): Promise<unknown>;
}

export function createPostConfirmationHandler(client: CognitoGroupClient) {
  return async (event: PostConfirmationTriggerEvent): Promise<PostConfirmationTriggerEvent> => {
    if (event.triggerSource !== "PostConfirmation_ConfirmSignUp") {
      return event;
    }

    await client.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: event.userPoolId,
        Username: event.userName,
        GroupName: DEFAULT_TIER_GROUP,
      }),
    );
    return event;
  };
}

const cognitoClient = new CognitoIdentityProviderClient({});

export const handler = createPostConfirmationHandler(cognitoClient);
