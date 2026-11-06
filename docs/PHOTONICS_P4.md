# Photonics P4: one-command, local evidence capture

**Purpose:** Help the operator capture two real, separate **electronic PyTorch CPU/CUDA numerical** P2 runs, evaluate them with the existing P3 repeatability gate, and preserve their raw JSON and SHA-256 content hashes in a local bundle. This is a software usability/audit improvement, **not** an optical-hardware integration, paper replication, physical GPU benchmark performed by CI, or demonstration of energy/compute efficiency.

## Explicit dry run before any device work

Use Python 3.10+ with your own PyTorch build and Node.js 22+ installed. This program is deliberately **opt-in**. The default invocation prints what it would do, without creating a directory or importing PyTorch.

~~~powershell
# From a current checkout of the repository
python scripts/photonics-p4.py --session rtx369-first --device cuda

# Only this second command starts two foreground P2 runs on the selected device:
python scripts/photonics-p4.py --session rtx369-first --device cuda --execute
~~~

On a machine without CUDA, select `--device cpu` **explicitly**. The runner refuses accidental CUDA-to-CPU fallback. A unique session name is required and cannot contain path separators. A matching existing session directory is never overwritten, including after an interrupted run. Use a new name such as `rtx369-second` for another capture.

Optional flags: `--samples 256 --steps 12 --nodes 32 --repeats 6 --seed 369 --ridge 0.1 --timeout-seconds 900`. Valid ranges match the P2 experiment, and each P2 run is bounded by the timeout. Only explicitly selected CPU/CUDA digital workloads execute.

## Local bundle format

The command creates `benchmarks/captures/rtx369-first/` with four files:

| File | Purpose |
| --- | --- |
| `p2-a.json` | First independent P2 numerical run, including two tasks and per-seed readings |
| `p2-b.json` | Second P2 run using the **same** seeds and settings |
| `p3-comparison.json` | Read-only P3 repeatability comparison of A and B |
| `manifest.json` | UTC timestamps, requested device/settings, local Python path, SHA-256 and file byte lengths |

These files remain **local**, and the directory is ignored by Git. Review before sharing; device names, OS, PyTorch and CPU metadata can be identifying. There are **no prompts, responses, model weights or credentials** in the intentionally synthetic P2 task.

To verify the existing bundle's contents and recalculate the P3 comparison:

~~~powershell
python scripts/photonics-p4.py --verify benchmarks/captures/rtx369-first
~~~

Verification reads the manifest, hashes each artifact, and reruns only the **P3 comparison**, not the P2 benchmark. It can spot inadvertent file changes and inconsistent saved comparison output. An attacker can edit files and recompute all hashes, so this is **not a signature, an attested GPU identity, or proof of independent experimental execution**.

After the site deploys, open Φ-Core369's **Repeatability P3** panel and manually load the bundle's `p2-a.json` and `p2-b.json`. P4 does not add any browser-to-localhost connection or automatic upload.

## Safety and experimental integrity

- Without `--execute`, no files or GPU/CPU test workloads are created.
- `--execute` checks the installed PyTorch backend and Node availability before creating the session folder.
- No Ollama, PhiMadaPrime, PhiTriBrain, cloud upload, agent execution, git merge, scheduler control, or external networking is performed by the P4 script.
- Each P2 run and P3 comparison is a foreground subprocess. A failure stops processing and leaves an **incomplete local directory visible** for investigation. Never silently delete partial evidence. Do not interpret an incomplete bundle as a valid experiment.
- Both runs are on the same machine/settings, sequentially; temperature, clock drift, other applications and scheduling remain potential confounders.
- P2 and P3 already label findings as exploratory digital simulations. P4 cannot turn those into optical-hardware or watt/joule evidence.
- Avoid publishing local device metadata or performance figures without reviewing methodology and uncertainty.

## CI

The GitHub workflow uses `--device cpu --execute` against a tiny dataset and verifies the generated bundle on a hosted CPU runner. It **does not use your RTX 5070**, inspect your local files, or establish any real-world photonic device performance.

## Next experiment

The useful next move is to *collect real local RTX digital evidence* and review P3 warnings. Future physical photonic comparisons would require calibrated I/O conversion, transfer timing, validated analog accuracy, measured watts/joules, and a truly comparable electrical baseline. None is implemented here.

The distinction matters: **a repeatable digital benchmark is useful evidence for software research, not proof of faster photons.**
