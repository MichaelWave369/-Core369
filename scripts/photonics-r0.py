#!/usr/bin/env python3
"""PhiCore369 Photonics R0: numerical, photonic-inspired reservoir experiment.

This is NOT optical hardware and NOT a replication of Zhang et al. (2026).
It approximates a single-map delay recurrence with a sine nonlinearity,
compared to a tanh recurrence and a linear input readout on identical toy data.
"""
from __future__ import annotations

import argparse
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
    raise SystemExit("PyTorch is required: python -m pip install torch") from exc

SCHEMA = "phicore369.photonics.r0.v1"
METHODS = ("linear_input", "electronic_tanh", "photonic_inspired_sine")
DOI = "10.1038/s43588-026-01075-w"


def device_for(selection: str) -> torch.device:
    if selection == "cuda" and not torch.cuda.is_available():
        raise ValueError("CUDA requested but PyTorch CUDA is unavailable")
    return torch.device("cuda" if selection == "auto" and torch.cuda.is_available()
                        else "cpu" if selection == "auto" else selection)


def sync(device: torch.device) -> None:
    if device.type == "cuda":
        torch.cuda.synchronize(device)


def data_for(samples: int, steps: int, seed: int, device: torch.device):
    """Balanced two-pulse XOR, measured only on held-out synthetic examples."""
    rng = torch.Generator(device="cpu").manual_seed(seed)
    bits = torch.randint(0, 2, (samples, 2), generator=rng)
    x = 0.12 * torch.randn((samples, steps), generator=rng)
    first, second = steps // 3, (2 * steps) // 3
    x[:, first] += 2.0 * bits[:, 0].float() - 1.0
    x[:, second] += 2.0 * bits[:, 1].float() - 1.0
    y = torch.logical_xor(bits[:, 0].bool(), bits[:, 1].bool()).float()
    order = torch.randperm(samples, generator=rng)
    return x.to(device), y.to(device), order.to(device)


def reservoir(x: torch.Tensor, nodes: int, seed: int, method: str,
              feedback: float = 0.83) -> torch.Tensor:
    """Virtual delay nodes; all propagation is digital tensor arithmetic."""
    device = x.device
    g = torch.Generator(device="cpu").manual_seed(seed + 1000)
    mask = (1.5 * torch.randn(nodes, generator=g)).to(device)
    bias = (0.6 * torch.randn(nodes, generator=g)).to(device)
    state = torch.zeros((x.shape[0], nodes), dtype=x.dtype, device=device)
    power = torch.zeros_like(state)
    for t in range(x.shape[1]):
        phase = feedback * torch.roll(state, shifts=1, dims=1)
        phase = phase + x[:, t:t + 1] * mask + bias
        state = torch.sin(phase) if method == "photonic_inspired_sine" else torch.tanh(phase)
        power = power + state.square()
    return torch.cat((state, power / x.shape[1]), dim=1)


def ridge_predictions(train: torch.Tensor, test: torch.Tensor,
                      targets: torch.Tensor, regularization: float):
    """Train-only standardization; ridge penalizes weights, not the intercept."""
    mean = train.mean(dim=0)
    scale = train.std(dim=0, unbiased=False).clamp_min(1e-5)
    tr = (train - mean) / scale
    te = (test - mean) / scale
    ones_tr = torch.ones((tr.shape[0], 1), device=tr.device)
    ones_te = torch.ones((te.shape[0], 1), device=te.device)
    design = torch.cat((tr, ones_tr), dim=1)
    penalty = torch.eye(design.shape[1], device=design.device) * regularization
    penalty[-1, -1] = 0.0
    solution = torch.linalg.solve(design.T @ design + penalty, design.T @ targets)
    predictions = torch.cat((te, ones_te), dim=1) @ solution
    return predictions


def evaluate(method: str, x, y, order, nodes: int, seed: int, ridge: float):
    train_count = (len(x) * 3) // 4
    train_idx, test_idx = order[:train_count], order[train_count:]
    sync(x.device)
    t0 = time.perf_counter()
    features = x if method == "linear_input" else reservoir(x, nodes, seed, method)
    sync(x.device)
    feature_ms = (time.perf_counter() - t0) * 1000
    # Fit/solve time includes producing held-out predictions.
    t0 = time.perf_counter()
    scores = ridge_predictions(features[train_idx], features[test_idx],
                               y[train_idx], ridge)
    sync(x.device)
    solve_ms = (time.perf_counter() - t0) * 1000
    actual = y[test_idx].to(torch.int64)
    predicted = (scores >= 0.5).to(torch.int64)
    accuracy = float((predicted == actual).float().mean().item())
    confusion = [[int(((actual == i) & (predicted == j)).sum().item())
                  for j in range(2)] for i in range(2)]
    return {
        "accuracy": round(accuracy, 6),
        "confusion_actual_rows_predicted_columns": confusion,
        "feature_ms": round(feature_ms, 3),
        "readout_fit_and_predict_ms": round(solve_ms, 3),
        "test_samples": int(len(test_idx)),
        "feature_dimensions": int(features.shape[1]),
        "trainable_readout_coefficients": int(features.shape[1] + 1),
    }


def experiment(samples=512, steps=12, nodes=64, repeats=3, seed=369,
               device="auto", ridge=0.1):
    if not (64 <= samples <= 4096 and 6 <= steps <= 64 and
            4 <= nodes <= 512 and 1 <= repeats <= 10 and
            0 <= seed <= 2**31 - repeats - 1 and
            math.isfinite(ridge) and 1e-8 <= ridge <= 1e4):
        raise ValueError("Invalid bounded experiment configuration")
    selected = device_for(device)
    runs = []
    for repeat in range(repeats):
        current_seed = seed + repeat
        x, y, order = data_for(samples, steps, current_seed, selected)
        results = {
            method: evaluate(method, x, y, order, nodes, current_seed, ridge)
            for method in METHODS
        }
        runs.append({"seed": current_seed, "methods": results})
    aggregate = {}
    for method in METHODS:
        accuracies = [run["methods"][method]["accuracy"] for run in runs]
        aggregate[method] = {
            "mean_test_accuracy": round(statistics.mean(accuracies), 6),
            "sample_std_accuracy": round(statistics.stdev(accuracies), 6)
            if len(accuracies) > 1 else None,
        }
    return {
        "schema": SCHEMA,
        "source": "numerical-simulation-pytorch",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "research_reference": {"doi": DOI, "replication_of_paper": False},
        "environment": {
            "python": platform.python_version(),
            "pytorch": torch.__version__,
            "device": str(selected),
            "device_name": torch.cuda.get_device_name(selected) if selected.type == "cuda"
                           else platform.processor() or "CPU (unspecified)",
            "cuda_runtime": torch.version.cuda,
        },
        "protocol": {
            "task": "synthetic_noisy_two_pulse_temporal_xor",
            "data": "generated_only_no_external_inputs",
            "split": "random_75_percent_train_25_percent_test_per_seed",
            "samples": samples,
            "steps": steps,
            "virtual_nodes": nodes,
            "repeats": repeats,
            "initial_seed": seed,
            "ridge_lambda": ridge,
            "methods": list(METHODS),
            "holdout_leakage": "feature normalization and ridge fit use train only",
        },
        "runs": runs,
        "aggregate": aggregate,
        "limits": [
            "No optical hardware or optical energy measurement.",
            "Sine delay recurrence is an analogy, not calibrated fiber/MZM physics.",
            "No state-skipping direct feedback alignment or paper reproduction.",
            "Wall times measure PyTorch simulation only; they are not photonic speedups.",
            "Toy temporal XOR accuracy does not transfer to real AI workloads.",
            "Comparators use the same ridge procedure but have different feature dimensions.",
            "CPU/CUDA clocks, backend, contention and precision affect timing.",
        ],
        "interfaces": {
            "PhiMadaPrime": "manual-read-only-report-review-proposal",
            "PhiTriBrain369": "source-cited-claim-only-after-independent-review",
            "execution_authorized": False,
        },
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--samples", type=int, default=512)
    parser.add_argument("--steps", type=int, default=12)
    parser.add_argument("--nodes", type=int, default=64)
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--seed", type=int, default=369)
    parser.add_argument("--ridge", type=float, default=0.1)
    parser.add_argument("--device", choices=("auto", "cpu", "cuda"), default="auto")
    parser.add_argument("--out", type=Path, help="Write a new JSON report; existing files are never overwritten")
    args = parser.parse_args(argv)
    try:
        report = experiment(args.samples, args.steps, args.nodes, args.repeats,
                            args.seed, args.device, args.ridge)
    except (ValueError, RuntimeError) as exc:
        parser.error(str(exc))
    output = json.dumps(report, indent=2, allow_nan=False) + "\n"
    if args.out:
        try:
            with args.out.open("x", encoding="utf-8") as stream:
                stream.write(output)
        except OSError as exc:
            parser.error(f"cannot create report: {exc}")
        print(f"Written {args.out}")
    else:
        print(output, end="")
    for method, record in report["aggregate"].items():
        print(f"{method}: held-out accuracy {record['mean_test_accuracy']:.3f}",
              file=sys.stderr)


if __name__ == "__main__":
    main()
