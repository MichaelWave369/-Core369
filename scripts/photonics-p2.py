#!/usr/bin/env python3
"""PhiCore369 Photonics P2: randomized, paired digital CPU/CUDA benchmarks.

This benchmarks electronic PyTorch software ONLY. A sine recurrence is
photonics-inspired, not a measured optical device or the Tokyo paper reproduced.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import math
import platform
import random
import statistics
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    import torch
except ImportError as exc:
    raise SystemExit("Install PyTorch before running the P2 numerical experiment.") from exc

P1_PATH = Path(__file__).with_name("photonics-p1.py")
SPEC = importlib.util.spec_from_file_location("photonics_p1", P1_PATH)
P1 = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(P1)

SCHEMA = "phicore369.photonics.p2.v1"
TASKS = ("temporal_xor", "first_pulse_memory")
PAIRS_CPU = (("cpu_sine", "cpu_tanh"),)
PAIRS_CUDA = (
    ("cpu_sine", "cuda_sine"),
    ("cuda_sine", "hybrid_cuda_cpu_cuda_sine"),
)
BOOTSTRAPS = 1000


def percentile(sorted_values, percentage):
    """Linear interpolation on a sorted sample of bootstrap statistics."""
    if not sorted_values:
        raise ValueError("Cannot compute percentile without data")
    rank = (len(sorted_values) - 1) * percentage
    lower = int(math.floor(rank))
    upper = int(math.ceil(rank))
    return sorted_values[lower] * (upper - rank) + sorted_values[upper] * (rank - lower) if lower != upper else sorted_values[lower]


def paired_delta(values, baseline, candidate, bootstrap_seed):
    """Positive delta means candidate was slower than its paired baseline."""
    differences = [
        run["methods"][candidate]["wall_ms"] -
        run["methods"][baseline]["wall_ms"] for run in values
    ]
    rng = random.Random(bootstrap_seed)
    bootstrapped = sorted(
        statistics.median(rng.choices(differences, k=len(differences)))
        for _ in range(BOOTSTRAPS)
    )
    return {
        "baseline": baseline,
        "candidate": candidate,
        "paired_seed_count": len(differences),
        "median_candidate_minus_baseline_ms": round(statistics.median(differences), 4),
        "exploratory_bootstrap_95pct_median_delta_ms": [
            round(percentile(bootstrapped, .025), 4),
            round(percentile(bootstrapped, .975), 4),
        ],
        "bootstrap_resamples": BOOTSTRAPS,
    }


def data_for_task(task, samples, steps, seed):
    x, xor_y, order = P1.R0.data_for(
        samples, steps, seed, torch.device("cpu"))
    if task == "temporal_xor":
        return x, xor_y, order
    if task == "first_pulse_memory":
        # Distinct, deliberately easier memory task on exactly the same inputs.
        # The first pulse is strong relative to noise; no target values are
        # exposed to the feature transform or readout normalization.
        return x, (x[:, steps // 3] > 0).float(), order
    raise ValueError("Unknown task")


def experiment(samples=256, steps=12, nodes=32, repeats=4, seed=369,
               device="auto", ridge=0.1):
    if not (64 <= samples <= 2048 and 6 <= steps <= 64 and
            4 <= nodes <= 256 and 3 <= repeats <= 12 and
            0 <= seed <= 2**31 - repeats - 1 and
            math.isfinite(ridge) and 1e-8 <= ridge <= 1e4):
        raise ValueError("Invalid bounded P2 configuration")
    if device not in ("auto", "cpu", "cuda"):
        raise ValueError("Unknown device")
    has_cuda = torch.cuda.is_available()
    if device == "cuda" and not has_cuda:
        raise ValueError("CUDA requested but not available")
    use_cuda = has_cuda and device != "cpu"
    methods = tuple(P1.ALL_METHODS if use_cuda else P1.CPU_METHODS)
    pairs = PAIRS_CPU + (PAIRS_CUDA if use_cuda else ())
    tasks = {}
    with torch.no_grad():
        for task_i, task in enumerate(TASKS):
            observations = []
            for i in range(repeats):
                current_seed = seed + i
                x, y, indices = data_for_task(task, samples, steps, current_seed)
                projection = P1.projection_for(steps, current_seed)
                projections = {"cpu": projection}
                if use_cuda:
                    projections["cuda"] = projection.to("cuda")
                cpu_refs = {
                    "sine": P1.compute_features(
                        x, projection, nodes, current_seed, True),
                    "tanh": P1.compute_features(
                        x, projection, nodes, current_seed, False),
                }
                # Warm up every full route, OUTSIDE recorded measurements.
                # More stable than warming only one matrix multiply, though
                # still not equal to a long GPU/CPU thermal stabilization.
                for method in methods:
                    P1.run_method(
                        method, x, y, indices, projections, nodes,
                        current_seed, ridge, cpu_refs[
                            "sine" if method.endswith("sine") else "tanh"])
                order = list(methods)
                random.Random(current_seed + task_i * 1_000_003 + 971).shuffle(order)
                results = {}
                for method in order:
                    results[method] = P1.run_method(
                        method, x, y, indices, projections, nodes,
                        current_seed, ridge, cpu_refs[
                            "sine" if method.endswith("sine") else "tanh"])
                observations.append({
                    "seed": current_seed,
                    "method_execution_order": order,
                    "methods": {method: results[method] for method in methods},
                })
            summaries = {}
            for method in methods:
                items = [ob["methods"][method] for ob in observations]
                summaries[method] = {
                    "mean_held_out_accuracy": round(
                        statistics.mean(item["accuracy"] for item in items), 6),
                    "median_wall_ms": round(
                        statistics.median(item["wall_ms"] for item in items), 4),
                }
            comparisons = [
                paired_delta(observations, baseline, candidate,
                             seed + task_i * 99_991 + pair_i * 3011)
                for pair_i, (baseline, candidate) in enumerate(pairs)
            ]
            tasks[task] = {
                "runs": observations,
                "aggregate": summaries,
                "paired_comparisons": comparisons,
            }
    return {
        "schema": SCHEMA,
        "source": "measured-local-pytorch-digital",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "research_reference": {
            "doi": P1.DOI, "replication_of_paper": False
        },
        "environment": {
            "python": platform.python_version(),
            "pytorch": str(torch.__version__),
            "os": platform.platform(),
            "cpu": platform.processor() or platform.machine() or "unavailable",
            "cpu_threads": torch.get_num_threads(),
            "device": "cuda" if use_cuda else "cpu",
            "cuda_available": has_cuda,
            "gpu_name": torch.cuda.get_device_name(0) if use_cuda else None,
            "cuda_runtime": torch.version.cuda,
        },
        "protocol": {
            "tasks": list(TASKS), "samples": samples, "steps": steps,
            "virtual_nodes": nodes, "repeats_per_task": repeats,
            "initial_seed": seed, "ridge_lambda": ridge,
            "methods": list(methods),
            "train_fraction": .75, "precision": "float32",
            "projection": "seeded_identity_plus_small_gaussian",
            "warmup": "one_complete_full_route_per_method_and_seed",
            "randomization": "fixed_seed_per_task_per_round_shuffle",
            "pairing": "same_task_seed_input_train_test_split",
            "statistics": "paired_seed_median_delta_exploratory_percentile_bootstrap",
            "bootstrap_resamples": BOOTSTRAPS,
        },
        "tasks": tasks,
        "hardware": {
            "actual_optical_device": False,
            "power_measured": False,
            "gpu_memory_metric": "incremental_PyTorch_allocator_peak_not_total_VRAM",
        },
        "limits": [
            "All execution uses electronic CPU/CUDA PyTorch, never optical equipment.",
            "Hybrid device boundary is emulated with GPU-to-host-to-GPU tensors.",
            "Paired bootstrap percentiles describe variability of these few runs, not universal performance.",
            "Timing includes synchronization, Python overhead and fitting; clocks and contention remain uncontrolled.",
            "Fixed seeds, small XOR and easier first-pulse task cannot validate real neural networks.",
            "No power, joules, optical wavelength, photonic accuracy, or silicon-device savings measured.",
            "Randomized timing reduces but cannot eliminate order, warmup and thermal bias.",
            "No automatic model switching, PhiTriBrain writes or ThinkTank permissions.",
        ],
        "interfaces": {"execution_authorized": False,
                       "PhiMadaPrime": "manual_review_only",
                       "PhiTriBrain369": "source_citation_after_independent_review"},
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--samples", type=int, default=256)
    parser.add_argument("--steps", type=int, default=12)
    parser.add_argument("--nodes", type=int, default=32)
    parser.add_argument("--repeats", type=int, default=4)
    parser.add_argument("--seed", type=int, default=369)
    parser.add_argument("--ridge", type=float, default=.1)
    parser.add_argument("--device", choices=("auto", "cpu", "cuda"), default="auto")
    parser.add_argument("--out", type=Path,
                        help="Create a NEW JSON report; never overwrite existing")
    args = parser.parse_args(argv)
    try:
        report = experiment(args.samples, args.steps, args.nodes, args.repeats,
                            args.seed, args.device, args.ridge)
    except (ValueError, RuntimeError) as exc:
        parser.error(str(exc))
    output = json.dumps(report, indent=2, allow_nan=False) + "\n"
    if args.out:
        try:
            with args.out.open("x", encoding="utf-8") as handle:
                handle.write(output)
        except OSError as exc:
            parser.error(f"Cannot write report: {exc}")
        print("Written", args.out)
    else:
        print(output, end="")
    for task, observations in report["tasks"].items():
        print("Task:", task, file=sys.stderr)
        for comparison in observations["paired_comparisons"]:
            print(f"  {comparison['candidate']} minus {comparison['baseline']}: "
                  f"{comparison['median_candidate_minus_baseline_ms']:.3f} ms "
                  f"(exploratory bootstrap interval "
                  f"{comparison['exploratory_bootstrap_95pct_median_delta_ms']})",
                  file=sys.stderr)


if __name__ == "__main__":
    main()
