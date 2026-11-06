#!/usr/bin/env python3
"""PhiCore369 Photonics P1: digital CPU/GPU/hybrid partition benchmark.

All reservoir computations use ordinary PyTorch tensors. "Photonics-inspired"
means only a sine nonlinear delay recurrence, NOT light or optical hardware.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import math
import platform
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

try:
    import torch
except ImportError as exc:
    raise SystemExit("Install PyTorch for this local digital experiment.") from exc

R0_PATH = Path(__file__).with_name("photonics-r0.py")
SPEC = importlib.util.spec_from_file_location("photonics_r0", R0_PATH)
R0 = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(R0)

SCHEMA = "phicore369.photonics.p1.v1"
CPU_METHODS = ("cpu_sine", "cpu_tanh")
CUDA_METHODS = ("cuda_sine", "cuda_tanh", "hybrid_cuda_cpu_cuda_sine")
ALL_METHODS = CPU_METHODS + CUDA_METHODS
DOI = "10.1038/s43588-026-01075-w"


def sync_cuda() -> None:
    if torch.cuda.is_available():
        torch.cuda.synchronize()


def timed(call):
    sync_cuda()
    start = time.perf_counter()
    value = call()
    sync_cuda()
    return value, (time.perf_counter() - start) * 1000.0


def projection_for(steps: int, seed: int) -> torch.Tensor:
    generator = torch.Generator(device="cpu").manual_seed(seed + 2048)
    return torch.eye(steps, dtype=torch.float32) + (
        0.05 * torch.randn((steps, steps), generator=generator, dtype=torch.float32)
    )


def method_plan(method: str):
    if method not in ALL_METHODS:
        raise ValueError("Unsupported partition method")
    if method in CPU_METHODS:
        return ("cpu", "cpu", "cpu", method.endswith("sine"))
    if method == "hybrid_cuda_cpu_cuda_sine":
        return ("cuda", "cpu", "cuda", True)
    return ("cuda", "cuda", "cuda", method.endswith("sine"))


def compute_features(x: torch.Tensor, projection: torch.Tensor, nodes: int,
                     seed: int, sine: bool) -> torch.Tensor:
    transformed = x @ projection
    return R0.reservoir(transformed, nodes, seed,
                        "photonic_inspired_sine" if sine else "electronic_tanh")


def run_method(method, x, y, order, projections, nodes, seed, ridge, reference):
    preprocess_device, reservoir_device, readout_device, sine = method_plan(method)
    is_hybrid = method == "hybrid_cuda_cpu_cuda_sine"
    uses_cuda = preprocess_device == "cuda" or readout_device == "cuda"
    if uses_cuda and not torch.cuda.is_available():
        raise ValueError("CUDA method requested without CUDA available")

    # Static parameters are placed before timing. Same projection matrix/seed
    # for every partition and both nonlinearities.
    projection = projections[preprocess_device]
    warm_x = x[:min(8, len(x))].to(preprocess_device)
    _ = warm_x @ projection
    sync_cuda()
    if uses_cuda:
        torch.cuda.reset_peak_memory_stats()
        baseline_gpu_bytes = torch.cuda.memory_allocated()
    else:
        baseline_gpu_bytes = None

    train_count = (len(x) * 3) // 4
    order_for_readout = order.to(readout_device)  # Index metadata, outside timing.
    stage = {}
    sync_cuda()
    start = time.perf_counter()

    if preprocess_device == "cpu":
        prepared = x
        stage["input_transfer_ms"] = None
    else:
        prepared, stage["input_transfer_ms"] = timed(lambda: x.to("cuda"))

    transformed, stage["preprocess_ms"] = timed(lambda: prepared @ projection)

    if is_hybrid:
        reservoir_input, stage["interstage_to_cpu_ms"] = timed(lambda: transformed.to("cpu"))
    else:
        reservoir_input = transformed
        stage["interstage_to_cpu_ms"] = None

    name = "photonic_inspired_sine" if sine else "electronic_tanh"
    features, stage["reservoir_ms"] = timed(
        lambda: R0.reservoir(reservoir_input, nodes, seed, name)
    )

    if is_hybrid:
        readout_features, stage["interstage_to_cuda_ms"] = timed(
            lambda: features.to("cuda")
        )
    else:
        readout_features = features
        stage["interstage_to_cuda_ms"] = None

    predictions, stage["ridge_readout_ms"] = timed(
        lambda: R0.ridge_predictions(
            readout_features[order_for_readout[:train_count]],
            readout_features[order_for_readout[train_count:]],
            y.to(readout_device)[order_for_readout[:train_count]],
            ridge,
        )
    )
    sync_cuda()
    wall_ms = (time.perf_counter() - start) * 1000.0

    predicted = (predictions.to("cpu") >= 0.5).to(torch.int64)
    actual = y[order[train_count:]].to(torch.int64)
    confusion = [
        [int(((actual == i) & (predicted == j)).sum().item()) for j in range(2)]
        for i in range(2)
    ]
    accuracy = (confusion[0][0] + confusion[1][1]) / len(actual)

    # Feature comparison happens AFTER the timed region. Both variants use
    # the same projection and nonlinear recurrence on the same source data.
    max_drift = float(torch.max(
        torch.abs(features.detach().to("cpu") - reference)
    ).item()) if uses_cuda else None

    transfer_bytes = (
        (x.numel() * x.element_size()) if preprocess_device == "cuda" else 0
    ) + (
        transformed.numel() * transformed.element_size()
        + features.numel() * features.element_size() if is_hybrid else 0
    )
    peak_delta = max(0, torch.cuda.max_memory_allocated() - baseline_gpu_bytes) \
        if uses_cuda else None

    return {
        "accuracy": round(accuracy, 6),
        "confusion_actual_rows_predicted_columns": confusion,
        "held_out_samples": len(actual),
        "feature_dimensions": nodes * 2,
        "route": [preprocess_device, reservoir_device, readout_device],
        "nonlinearity": "sine" if sine else "tanh",
        "stage_ms": {key: None if val is None else round(val, 4)
                     for key, val in stage.items()},
        "wall_ms": round(wall_ms, 4),
        "transfer_bytes": transfer_bytes,
        "peak_incremental_cuda_allocated_bytes": peak_delta,
        "max_abs_feature_drift_from_cpu": (
            None if max_drift is None else round(max_drift, 7)
        ),
    }


def experiment(samples=256, steps=12, nodes=32, repeats=3, seed=369,
               device="auto", ridge=0.1):
    if not (64 <= samples <= 2048 and 6 <= steps <= 64 and
            4 <= nodes <= 256 and 1 <= repeats <= 10 and
            0 <= seed <= 2**31 - repeats - 1 and math.isfinite(ridge) and
            1e-8 <= ridge <= 1e4):
        raise ValueError("Invalid bounded photonics P1 experiment configuration")
    if device not in ("auto", "cpu", "cuda"):
        raise ValueError("Use --device auto, cpu or cuda")
    available = torch.cuda.is_available()
    if device == "cuda" and not available:
        raise ValueError("CUDA was requested but PyTorch CUDA is unavailable")
    gpu_enabled = available and device != "cpu"
    methods = ALL_METHODS if gpu_enabled else CPU_METHODS
    runs = []

    with torch.no_grad():
        for i in range(repeats):
            current_seed = seed + i
            x, y, order = R0.data_for(samples, steps, current_seed,
                                      torch.device("cpu"))
            projection = projection_for(steps, current_seed)
            projections = {"cpu": projection}
            if gpu_enabled:
                projections["cuda"] = projection.to("cuda")
            # Reference feature parity is an untimed check, not part of the
            # reported pipeline latency.
            cpu_reference_sine = compute_features(
                x, projection, nodes, current_seed, True)
            cpu_reference_tanh = compute_features(
                x, projection, nodes, current_seed, False)
            results = {}
            for method in methods:
                is_sine = method.endswith("sine")
                reference = cpu_reference_sine if is_sine else cpu_reference_tanh
                results[method] = run_method(
                    method, x, y, order, projections,
                    nodes, current_seed, ridge, reference)
            runs.append({"seed": current_seed, "methods": results})

    aggregate = {}
    for method in methods:
        items = [r["methods"][method] for r in runs]
        accuracies = [item["accuracy"] for item in items]
        aggregate[method] = {
            "mean_held_out_accuracy": round(statistics.mean(accuracies), 6),
            "median_wall_ms": round(statistics.median(
                item["wall_ms"] for item in items), 4),
            "median_peak_incremental_cuda_allocated_bytes": (
                int(statistics.median(
                    item["peak_incremental_cuda_allocated_bytes"] for item in items))
                if method in CUDA_METHODS else None),
        }
    return {
        "schema": SCHEMA,
        "source": "measured-local-pytorch-digital",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "research_reference": {"doi": DOI, "replication_of_paper": False},
        "environment": {
            "python": platform.python_version(),
            "pytorch": str(torch.__version__),
            "device": "cuda" if gpu_enabled else "cpu",
            "cuda_available": available,
            "gpu_name": torch.cuda.get_device_name(0) if gpu_enabled else None,
            "cuda_runtime": torch.version.cuda,
        },
        "protocol": {
            "task": "synthetic_noisy_two_pulse_temporal_xor",
            "samples": samples, "steps": steps, "virtual_nodes": nodes,
            "repeats": repeats, "initial_seed": seed,
            "ridge_lambda": ridge,
            "method_order": list(methods),
            "train_fraction": 0.75,
            "projection": "seeded_identity_plus_small_gaussian",
            "feature_reference": "cpu_matching_nonlinearity_excluded_from_timing",
            "warmup": "single_short_preprocess_before_each_method",
            "precision": "float32",
            "methodology": "sequential_non_randomized_method_order",
        },
        "runs": runs,
        "aggregate": aggregate,
        "hardware": {
            "actual_optical_device": False,
            "power_measured": False,
            "gpu_memory_metric": "incremental_PyTorch_allocator_peak_not_total_VRAM",
        },
        "limits": [
            "All steps are electronic CPU or CUDA numerical simulation.",
            "The sine reservoir is not calibrated to any optical device.",
            "The hybrid CUDA-CPU-CUDA path is an emulated device boundary.",
            "CPU/GPU timing includes synchronization and Python dispatch.",
            "Sequential method ordering, clocks and contention affect timing.",
            "No wattage, energy, hardware optical latency or light-speed claim.",
            "No automatic PhiTriBrain, PhiBots or ThinkTank execution.",
            "Small XOR accuracy cannot predict general model performance.",
            "Projection/readout weights are prepared before the timed pipeline.",
        ],
        "interfaces": {"execution_authorized": False,
                       "PhiMadaPrime": "manual_review_only",
                       "PhiTriBrain369": "reviewed_source_claim_only"},
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--samples", type=int, default=256)
    parser.add_argument("--steps", type=int, default=12)
    parser.add_argument("--nodes", type=int, default=32)
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--seed", type=int, default=369)
    parser.add_argument("--ridge", type=float, default=0.1)
    parser.add_argument("--device", choices=("auto", "cpu", "cuda"), default="auto")
    parser.add_argument("--out", type=Path, help="Write NEW report only, never overwrite")
    args = parser.parse_args(argv)
    try:
        report = experiment(args.samples, args.steps, args.nodes,
                            args.repeats, args.seed, args.device, args.ridge)
    except (ValueError, RuntimeError) as err:
        parser.error(str(err))
    encoded = json.dumps(report, indent=2, allow_nan=False) + "\n"
    if args.out is None:
        print(encoded, end="")
    else:
        try:
            with args.out.open("x", encoding="utf-8") as handle:
                handle.write(encoded)
        except OSError as exc:
            parser.error(f"Cannot create output: {exc}")
        print("Written", args.out)
    for method, stats in report["aggregate"].items():
        print(f"{method}: accuracy={stats['mean_held_out_accuracy']:.3f} "
              f"median digital wall={stats['median_wall_ms']:.2f} ms",
              file=sys.stderr)


if __name__ == "__main__":
    main()
