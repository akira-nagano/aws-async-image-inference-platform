from __future__ import annotations

import json
import pathlib
import subprocess
import sys


ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "generate-web-config.py"


def run_generator(
    tmp_path: pathlib.Path,
    *,
    local: bool,
    cloudformation_format: bool = False,
) -> dict[str, object]:
    outputs_path = tmp_path / "outputs.json"
    config_path = tmp_path / "config.json"
    outputs: dict[str, str] = {
        "HttpApiEndpoint": "https://api-id.execute-api.ap-northeast-1.amazonaws.com",
        "UserPoolId": "pool-id",
        "UserPoolClientId": "client-id",
        "MaxUploadBytes": "8388608",
    }
    if not local:
        outputs["DistributionDomainName"] = "distribution.example.test"
        outputs["CognitoManagedLoginBaseUrl"] = (
            "https://inference-dev-123456789012.auth.ap-northeast-1.amazoncognito.com"
        )
        outputs["CognitoManagedLoginCallbackUrl"] = "https://distribution.example.test/"
    serialized_outputs: object = outputs
    if cloudformation_format:
        serialized_outputs = [
            {"OutputKey": key, "OutputValue": value} for key, value in outputs.items()
        ]
    outputs_path.write_text(json.dumps(serialized_outputs), encoding="utf-8")

    command = [
        sys.executable,
        str(SCRIPT),
        "--outputs",
        str(outputs_path),
        "--output",
        str(config_path),
    ]
    if local:
        command.extend(
            [
                "--aws-endpoint",
                "http://localhost:4566",
                "--cognito-endpoint",
                "/_local/cognito",
                "--local-auth-bypass",
            ]
        )
    subprocess.run(command, cwd=ROOT, check=True)
    parsed = json.loads(config_path.read_text(encoding="utf-8"))
    if not isinstance(parsed, dict):
        raise TypeError("Generated config must be a JSON object")
    return {str(key): value for key, value in parsed.items()}


def test_local_config_separates_api_and_browser_cognito_endpoints(
    tmp_path: pathlib.Path,
) -> None:
    config = run_generator(tmp_path, local=True)
    assert config["apiBaseUrl"] == (
        "http://localhost:4566/execute-api/api-id/$default/api"
    )
    assert config["cognitoEndpoint"] == "/_local/cognito"
    assert config["authMode"] == "direct"
    assert config["localAuthBypass"] is True
    assert config["maxUploadBytes"] == 8388608


def test_deployed_config_uses_cloudfront_without_a_cognito_override(
    tmp_path: pathlib.Path,
) -> None:
    config = run_generator(tmp_path, local=False)
    assert config["apiBaseUrl"] == "/api"
    assert config["authMode"] == "managed-login"
    assert config["cognitoManagedLoginBaseUrl"] == (
        "https://inference-dev-123456789012.auth.ap-northeast-1.amazoncognito.com"
    )
    assert config["oauthRedirectUri"] == "https://distribution.example.test/"
    assert "cognitoEndpoint" not in config
    assert config["localAuthBypass"] is False
    assert config["maxUploadBytes"] == 8388608


def test_deployed_config_accepts_cloudformation_outputs_array(
    tmp_path: pathlib.Path,
) -> None:
    config = run_generator(tmp_path, local=False, cloudformation_format=True)
    assert config["apiBaseUrl"] == "/api"
    assert config["authMode"] == "managed-login"
    assert "cognitoEndpoint" not in config
    assert config["localAuthBypass"] is False
