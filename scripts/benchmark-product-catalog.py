from __future__ import annotations

import argparse
import ctypes
import json
import os
import statistics
import sys
import time
from pathlib import Path
from typing import Any, cast

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
INFERENCE_ROOT = REPOSITORY_ROOT / "services" / "inference"
sys.path.insert(0, str(INFERENCE_ROOT))

from app.catalog_index import load_catalog_index  # noqa: E402
from app.catalog_model import CatalogRetrievalModelAdapter  # noqa: E402
from app.dinov2_encoder import Dinov2Encoder  # noqa: E402


class ProcessMemoryCounters(ctypes.Structure):
    _fields_ = [
        ("cb", ctypes.c_ulong),
        ("PageFaultCount", ctypes.c_ulong),
        ("PeakWorkingSetSize", ctypes.c_size_t),
        ("WorkingSetSize", ctypes.c_size_t),
        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
        ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
        ("PagefileUsage", ctypes.c_size_t),
        ("PeakPagefileUsage", ctypes.c_size_t),
    ]


def windows_memory_bytes() -> tuple[int, int]:
    counters = ProcessMemoryCounters()
    counters.cb = ctypes.sizeof(counters)
    kernel32 = cast(Any, ctypes.windll.kernel32)  # type: ignore[attr-defined]
    psapi = cast(Any, ctypes.windll.psapi)  # type: ignore[attr-defined]
    kernel32.GetCurrentProcess.restype = ctypes.c_void_p
    psapi.GetProcessMemoryInfo.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(ProcessMemoryCounters),
        ctypes.c_ulong,
    ]
    psapi.GetProcessMemoryInfo.restype = ctypes.c_int
    process = kernel32.GetCurrentProcess()
    if not psapi.GetProcessMemoryInfo(process, ctypes.byref(counters), counters.cb):
        raise OSError("GetProcessMemoryInfo failed")
    return counters.WorkingSetSize, counters.PeakWorkingSetSize


def linux_memory_bytes() -> tuple[int, int]:
    values: dict[str, int] = {}
    for line in Path("/proc/self/status").read_text(encoding="utf-8").splitlines():
        if line.startswith(("VmRSS:", "VmHWM:")):
            name, value, unit = line.split()
            if unit != "kB":
                raise ValueError(f"Unexpected memory unit: {unit}")
            values[name.rstrip(":")] = int(value) * 1024
    return values["VmRSS"], values["VmHWM"]


def process_memory_bytes() -> tuple[int, int]:
    if os.name == "nt":
        return windows_memory_bytes()
    return linux_memory_bytes()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Measure DINOv2 catalog load time, warm inference time, and process RSS."
    )
    parser.add_argument("image", type=Path)
    parser.add_argument(
        "--model-directory",
        type=Path,
        default=INFERENCE_ROOT / "model-runtime" / "dinov2-small",
    )
    parser.add_argument(
        "--catalog-index",
        type=Path,
        default=INFERENCE_ROOT / "model-runtime" / "catalog-index.json",
    )
    parser.add_argument("--iterations", type=int, default=10)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.iterations <= 0:
        raise ValueError("iterations must be positive")
    image_path: Path = args.image.resolve()
    if not image_path.is_file():
        raise FileNotFoundError(f"Image not found: {image_path}")

    initialization_started = time.perf_counter()
    catalog = load_catalog_index(args.catalog_index.resolve())
    encoder = Dinov2Encoder(args.model_directory.resolve())
    adapter = CatalogRetrievalModelAdapter(encoder, catalog)
    initialization_seconds = time.perf_counter() - initialization_started

    image_bytes = image_path.read_bytes()
    durations_ms: list[float] = []
    first_predictions: list[dict[str, object]] | None = None
    for _ in range(args.iterations):
        started = time.perf_counter()
        predictions = adapter.predict(image_bytes)
        durations_ms.append((time.perf_counter() - started) * 1000)
        if first_predictions is None:
            first_predictions = [prediction.to_api() for prediction in predictions]

    current_rss, peak_rss = process_memory_bytes()
    result = {
        "modelVersion": adapter.version,
        "image": image_path.name,
        "iterations": args.iterations,
        "initializationSeconds": round(initialization_seconds, 3),
        "inferenceMs": {
            "first": round(durations_ms[0], 3),
            "median": round(statistics.median(durations_ms), 3),
            "maximum": round(max(durations_ms), 3),
        },
        "memoryMiB": {
            "currentRss": round(current_rss / 1024 / 1024, 1),
            "peakRss": round(peak_rss / 1024 / 1024, 1),
        },
        "predictions": first_predictions,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
