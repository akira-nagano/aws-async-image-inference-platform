import { AdminAddUserToGroupCommand } from "@aws-sdk/client-cognito-identity-provider";
import { describe, expect, it, mock } from "bun:test";
import type { PostConfirmationTriggerEvent } from "aws-lambda";
import { createPostConfirmationHandler } from "../src/post-confirmation.js";

function event(triggerSource: PostConfirmationTriggerEvent["triggerSource"]) {
  return {
    version: "1",
    region: "ap-northeast-1",
    userPoolId: "ap-northeast-1_pool",
    userName: "user-123",
    callerContext: {
      awsSdkVersion: "3",
      clientId: "client-id",
    },
    triggerSource,
    request: {
      userAttributes: {
        sub: "user-123",
        email: "user@example.com",
      },
    },
    response: {},
  } satisfies PostConfirmationTriggerEvent;
}

describe("post confirmation", () => {
  it("assigns a newly confirmed self-service user to tier-basic", async () => {
    const send = mock(async (_command: AdminAddUserToGroupCommand) => ({}));
    const handler = createPostConfirmationHandler({ send });
    const input = event("PostConfirmation_ConfirmSignUp");

    await expect(handler(input)).resolves.toBe(input);
    expect(send).toHaveBeenCalledTimes(1);

    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(AdminAddUserToGroupCommand);
    expect(command?.input).toEqual({
      UserPoolId: "ap-northeast-1_pool",
      Username: "user-123",
      GroupName: "tier-basic",
    });
  });

  it("does not change groups after password recovery confirmation", async () => {
    const send = mock(async (_command: AdminAddUserToGroupCommand) => ({}));
    const handler = createPostConfirmationHandler({ send });
    const input = event("PostConfirmation_ConfirmForgotPassword");

    await expect(handler(input)).resolves.toBe(input);
    expect(send).not.toHaveBeenCalled();
  });
});
