#!/usr/bin/env python3
"""PhiCore369 P4: explicit, local-only, paired numerical evidence capture.

No GPU or model work without --execute. No network, prompts, Ollama, git writes,
optical hardware, external power meters, or automatic uploads. Uses P2/P3 as-is.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = "phicore369.photonics.p4.capture.v1"
REPO_ROOT = Path(__file__).resolve().parents[1]
CAPTURE_ROOT = REPO_ROOT / "benchmarks" / "captures"
NAMES = {"run_a": "p2-a.json", "run_b": "p2-b.json",
         "comparison": "p3-comparison.json"}
LABEL = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")


def utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def digest(path: Path) -> dict:
    data = path.read_bytes()
    return {"file": path.name, "sha256": hashlib.sha256(data).hexdigest(),
            "bytes": len(data)}


def assert_args(args) -> None:
    if args.verify is not None:
        if args.execute or args.session is not None:
            raise ValueError("--verify cannot be combined with --execute or --session")
        return
    if args.session is None or not LABEL.fullmatch(args.session):
        raise ValueError("An explicit --session slug of 1-64 letters, digits, _ or - is required")
    if not (64 <= args.samples <= 2048 and 6 <= args.steps <= 64
            and 4 <= args.nodes <= 256 and 3 <= args.repeats <= 12
            and 0 <= args.seed <= 2**31 - args.repeats - 1
            and math.isfinite(args.ridge) and 1e-8 <= args.ridge <= 1e4):
        raise ValueError("Experiment settings exceed the bounded P2 protocol")
    if args.device not in ("cpu", "cuda"):
        raise ValueError("Choose an explicit --device cpu or cuda (no automatic fallback)")


def check_tools(device: str | None = None) -> str:
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Node.js was not found on PATH; install Node.js 22+")
    if device is not None:
        check = subprocess.run([
            sys.executable, "-c",
            "import json,torch; print(json.dumps({"
            "'torch':str(torch.__version__),'cuda':torch.cuda.is_available(),"
            "'gpu':torch.cuda.get_device_name(0) if torch.cuda.is_available() else None"
            "}))"
        ], capture_output=True, text=True, timeout=60, check=True)
        env = json.loads(check.stdout)
        if device == "cuda" and not env["cuda"]:
            raise RuntimeError("CUDA explicitly requested, but local PyTorch has no CUDA access")
        print("Local PyTorch:", env["torch"], "| CUDA:", env["cuda"],
              "| GPU:", env["gpu"] or "(none)")
    return node


def compare(node: str, a: Path, b: Path) -> dict:
    command = [node, str(REPO_ROOT / "scripts" / "compare-photonics-p3.mjs"),
               str(a), str(b)]
    result = subprocess.run(command, cwd=REPO_ROOT, check=True,
                            capture_output=True, text=True, timeout=90)
    value = json.loads(result.stdout)
    if (value.get("schema") != "phicore369.photonics.p3.comparison.v1"
            or value.get("session_count") != 2
            or value.get("optical_hardware_measured") is not False
            or value.get("measured_energy") is not False
            or value.get("interfaces", {}).get("execution_authorized") is not False):
        raise RuntimeError("P3 output violates P4 scientific and execution boundaries")
    return value


def verify_bundle(folder: Path, node: str | None = None) -> dict:
    directory = folder.resolve(strict=True)
    if not directory.is_dir():
        raise ValueError("Bundle path must be an existing directory")
    manifest_path = directory / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if (manifest.get("schema") != SCHEMA
            or manifest.get("source") != "operator_requested_local_digital"
            or manifest.get("execution_authorized") is not False
            or manifest.get("actual_optical_hardware") is not False
            or manifest.get("measured_energy") is not False
            or not isinstance(manifest.get("artifacts"), dict)
            or set(manifest["artifacts"]) != set(NAMES)):
        raise ValueError("Invalid P4 manifest or science trust boundary")
    for role, filename in NAMES.items():
        saved = manifest["artifacts"][role]
        path = directory / filename
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 262144:
            raise ValueError(f"Unsafe, missing or oversized {filename}")
        actual = digest(path)
        if saved != actual:
            raise ValueError(f"Artifact hash/byte mismatch: {filename}")
    node = node or check_tools()
    regenerated = compare(node, directory / NAMES["run_a"],
                          directory / NAMES["run_b"])
    stored = json.loads((directory / NAMES["comparison"]).read_text(encoding="utf-8"))
    if stored != regenerated:
        raise ValueError("Saved P3 comparison differs from recalculated P2 evidence")
    return manifest


def capture(args, node: str) -> Path:
    root = CAPTURE_ROOT
    root.mkdir(parents=True, exist_ok=True)
    directory = root / args.session
    # Exclusive directory creation; an interrupted session remains visible.
    directory.mkdir(exist_ok=False)
    started = utc()
    opts = {
        "samples": args.samples, "steps": args.steps,
        "nodes": args.nodes, "repeats": args.repeats,
        "seed": args.seed, "ridge": args.ridge, "device": args.device
    }
    for role in ("run_a", "run_b"):
        dest = directory / NAMES[role]
        cmd = [sys.executable, str(REPO_ROOT / "scripts" / "photonics-p2.py"),
               "--samples", str(args.samples), "--steps", str(args.steps),
               "--nodes", str(args.nodes), "--repeats", str(args.repeats),
               "--seed", str(args.seed), "--ridge", str(args.ridge),
               "--device", args.device, "--out", str(dest)]
        print(f"Running {role} in foreground ({args.device}, {args.repeats} paired seeds)...",
              flush=True)
        subprocess.run(cmd, cwd=REPO_ROOT, check=True, timeout=args.timeout_seconds)
        if not dest.is_file() or dest.stat().st_size > 262144:
            raise RuntimeError("P2 did not produce a valid-sized JSON report")
    result = compare(node, directory / NAMES["run_a"],
                     directory / NAMES["run_b"])
    with (directory / NAMES["comparison"]).open("x", encoding="utf-8") as f:
        json.dump(result, f, indent=2, allow_nan=False)
        f.write("\n")
    manifest = {
        "schema": SCHEMA,
        "source": "operator_requested_local_digital",
        "started_at": started, "completed_at": utc(),
        "python_executable": sys.executable,
        "requested_device": args.device,
        "settings": opts,
        "artifacts": {
            role: digest(directory / name) for role, name in NAMES.items()
        },
        "execution_authorized": False,
        "actual_optical_hardware": False,
        "measured_energy": False,
        "attestation": "sha256_content_integrity_only_not_a_signature_or_identity_proof",
        "limits": [
            "No actual optical hardware or watt/joule measurements.",
            "Two local runs are not enough to prove scientific reproducibility.",
            "SHA-256 checks accidental modification, not malicious edits or provenance.",
            "PyTorch CUDA results are digital GPU data, not photonic acceleration.",
            "Human review is required before cross-project research claims."
        ]
    }
    with (directory / "manifest.json").open("x", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, allow_nan=False)
        f.write("\n")
    verify_bundle(directory, node)
    return directory


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--session", help="Unique local session name; never overwritten")
    parser.add_argument("--device", choices=("cpu", "cuda"), default="cuda")
    parser.add_argument("--samples", type=int, default=256)
    parser.add_argument("--steps", type=int, default=12)
    parser.add_argument("--nodes", type=int, default=32)
    parser.add_argument("--repeats", type=int, default=6)
    parser.add_argument("--seed", type=int, default=369)
    parser.add_argument("--ridge", type=float, default=.1)
    parser.add_argument("--timeout-seconds", type=int, default=900)
    parser.add_argument("--execute", action="store_true",
                        help="Explicit consent to run two foreground numerical benchmarks")
    parser.add_argument("--verify", type=Path, help="Recheck existing bundle; never execute P2")
    args = parser.parse_args(argv)
    try:
        assert_args(args)
        if args.verify:
            result = verify_bundle(args.verify)
            print("Verified P4 content hashes and recomputed P3 digital comparison.")
            print("Device requested:", result["requested_device"])
            return 0
        if not 30 <= args.timeout_seconds <= 3600:
            raise ValueError("--timeout-seconds must be 30..3600")
        if not args.execute:
            print("DRY RUN: no computation, files, CUDA, or Ollama access.")
            print("Would create:", CAPTURE_ROOT / args.session)
            print("Would run P2 twice and compare P3; requested device:", args.device)
            print("Explicitly add --execute to perform local digital benchmark capture.")
            return 0
        node = check_tools(args.device)
        output = capture(args, node)
        print("P4 capture verified:", output)
        print("Import p2-a.json and p2-b.json in the P3 local browser panel.")
        print("CAUTION: content hashes are NOT signed physical GPU attestations.")
        return 0
    except (ValueError, RuntimeError, OSError, subprocess.SubprocessError,
            json.JSONDecodeError) as exc:
        parser.exit(2, f"P4 capture stopped: {exc}\n")


if __name__ == "__main__":
    raise SystemExit(main())
