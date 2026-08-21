#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="${MODEL_MANIFEST:-$ROOT/services/inference/model-runtime/manifest.json}"
MODEL_DIR="${MODEL_DIR:-$ROOT/services/inference/model-runtime}"
MODEL_S3_URI="${MODEL_S3_URI:-}"

if [[ -z "$MODEL_S3_URI" ]]; then
  echo "MODEL_S3_URI is required, for example s3://bucket/path/model.onnx" >&2
  exit 2
fi

mkdir -p "$MODEL_DIR"
FILE_NAME="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["fileName"])' "$MANIFEST")"
aws s3 cp "$MODEL_S3_URI" "$MODEL_DIR/$FILE_NAME"
python3 "$ROOT/scripts/validate-model.py" --manifest "$MANIFEST" --model-dir "$MODEL_DIR"
