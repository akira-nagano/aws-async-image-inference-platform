#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from urllib.parse import urlparse


def load_outputs(path: Path) -> dict[str, str]:
    raw_outputs: object = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(raw_outputs, dict):
        outputs: dict[str, str] = {}
        for key, value in raw_outputs.items():
            if not isinstance(key, str) or not isinstance(value, str):
                raise TypeError("CDK output keys and values must be strings")
            outputs[key] = value
        return outputs

    if isinstance(raw_outputs, list):
        outputs = {}
        for item in raw_outputs:
            if not isinstance(item, dict):
                raise TypeError("CloudFormation outputs must be JSON objects")
            key = item.get("OutputKey")
            value = item.get("OutputValue")
            if not isinstance(key, str) or not isinstance(value, str):
                raise TypeError(
                    "CloudFormation outputs require string OutputKey and OutputValue"
                )
            outputs[key] = value
        return outputs

    raise TypeError("CDK outputs must be a JSON object or CloudFormation outputs array")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate the web runtime config from CDK outputs")
    parser.add_argument("--outputs", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--aws-endpoint")
    parser.add_argument("--cognito-endpoint")
    parser.add_argument("--local-auth-bypass", action="store_true")
    parser.add_argument("--poll-interval-ms", type=int, default=2000)
    args = parser.parse_args()

    if args.local_auth_bypass and (not args.aws_endpoint or not args.cognito_endpoint):
        parser.error("--local-auth-bypass requires --aws-endpoint and --cognito-endpoint")

    outputs = load_outputs(args.outputs)
    api_endpoint = str(outputs["HttpApiEndpoint"]).rstrip("/")
    distribution = outputs.get("DistributionDomainName")
    managed_login_base_url = outputs.get("CognitoManagedLoginBaseUrl")
    oauth_redirect_uri = outputs.get("CognitoManagedLoginCallbackUrl")
    if distribution:
        api_base_url = "/api"
    elif args.aws_endpoint:
        api_id = (urlparse(api_endpoint).hostname or "").split(".", maxsplit=1)[0]
        if not api_id:
            raise ValueError(f"Unable to determine API ID from {api_endpoint}")
        local_endpoint = args.aws_endpoint.rstrip("/")
        api_base_url = f"{local_endpoint}/execute-api/{api_id}/$default/api"
    else:
        api_base_url = f"{api_endpoint}/api"
    if args.local_auth_bypass:
        auth_mode = "direct"
    elif managed_login_base_url and oauth_redirect_uri:
        auth_mode = "managed-login"
    elif managed_login_base_url or oauth_redirect_uri or distribution:
        raise ValueError(
            "AWS web config requires CognitoManagedLoginBaseUrl and "
            "CognitoManagedLoginCallbackUrl"
        )
    else:
        auth_mode = "direct"
    config: dict[str, object] = {
        "region": "ap-northeast-1",
        "apiBaseUrl": api_base_url,
        "userPoolId": outputs["UserPoolId"],
        "userPoolClientId": outputs["UserPoolClientId"],
        "authMode": auth_mode,
        "localAuthBypass": args.local_auth_bypass,
        "pollIntervalMs": args.poll_interval_ms,
        "maxUploadBytes": int(outputs["MaxUploadBytes"]),
    }
    if auth_mode == "managed-login":
        config["cognitoManagedLoginBaseUrl"] = managed_login_base_url
        config["oauthRedirectUri"] = oauth_redirect_uri
    if args.cognito_endpoint:
        config["cognitoEndpoint"] = args.cognito_endpoint

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
