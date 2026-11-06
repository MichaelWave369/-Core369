# Photonics P3: local two-session repeatability gate

**Status: digital CPU/CUDA evidence-comparison utility.** P3 does **not** run optical hardware or claim optical speedups, energy savings, model equivalence, or a replication of the 2026 University of Tokyo/NTT publication.

P0 tested a toy sine recurrence. P1 measured digital CPU/CUDA/hybrid partitions. P2 introduced multiple temporal tasks and randomized route order. **P3 compares two separate P2 reports** that were generated using the same workload and software environment, to see whether results remain reasonably stable when repeated.

## First reproducible local runs on Windows

Update or clone the repository, then use Python and the PyTorch build already installed on your PC. The following is a suggested *local* test, not a benchmark that ChatGPT or GitHub Actions can execute on your own RTX GPU.

~~~powershell
git pull
New-Item -ItemType Directory -Force benchmarks | Out-Null

# Check what your locally installed PyTorch can use.
python -c "import torch; print(torch.__version__); print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU-only')"

# Two genuinely separate executions on the SAME machine and settings.
python scripts/photonics-p2.py --device cuda --samples 256 --nodes 32 --repeats 6 --seed 369 --out benchmarks/p2-rtx-a.json
python scripts/photonics-p2.py --device cuda --samples 256 --nodes 32 --repeats 6 --seed 369 --out benchmarks/p2-rtx-b.json

# CLI comparison prints a JSON analysis; does not write files.
node scripts/compare-photonics-p3.mjs benchmarks/p2-rtx-a.json benchmarks/p2-rtx-b.json
~~~

If CUDA is unavailable, use `--device cpu` on **both** runs and label the result CPU-only. You cannot compare a CUDA run and CPU-only report as a valid P3 repeatability pair, because the method set and metadata differ. If a report filename already exists, P2 refuses to overwrite it; choose new names rather than deleting evidence inadvertently. The P2 runner remains entirely local and does not download models or communicate with Ollama.

## Graphical import

Open Φ-Core369's **Repeatability P3** section in the browser after the feature is deployed. Manually select P2 report A and report B. The browser reads each file locally; it never uploads it to GitHub, connects to your PC's inference servers, or starts a computation job. It shows differences in per-task median digital wall times and the largest per-seed classification accuracy shift.

The P3 comparator checks:

1. Both files satisfy the complete P2 schema and per-route accounting checks.
2. Same CPU/OS details, thread count, PyTorch/Python version, GPU name, CUDA runtime and selected device. P2 now includes `environment.os`, `cpu`, and `cpu_threads`. Regenerate older P2 reports to supply this metadata.
3. Identical experiment protocol and synthetic seeds, so differences are within a controlled configuration rather than apples-versus-oranges task changes.
4. Distinct report timestamps and nonidentical raw results. These are **sanity filters**, not evidence of independent authenticated sessions.
5. Diagnostic warnings if absolute median wall-time drift exceeds **25%**, or if any paired seed's classification accuracy changes by more than **2 percentage points**. These are fixed investigation thresholds, not scientific significance levels.
6. Paired method speed-difference signs across sessions. A direction change is not automatically a failure, but is reason to investigate.

**Important:** P3's "exploratory two sessions" status is fixed, even when the numbers agree. Matching environment text is not cryptographically signed. The comparison can't detect a fabricated, internally consistent report or prove that runs came from your particular GPU.

## Measurement cautions

- All algorithms run as electronic PyTorch operations. The CPU portion of the hybrid route merely stands in for hypothetical future optical hardware.
- P2 timings include synchronization, Python scheduling, device movement, model fitting, and startup artifacts. They are unsuitable for claims about photonic kernel latency or theoretical light-speed advantage.
- Machine/GPU contention, temperature, power limits, clock changes, CUDA context, CPU thread placement, dataset simplicity, and independence of trials remain uncontrolled.
- No external watts or joules are collected. PyTorch allocator statistics are not total board memory.
- Two runs with the **same seeds** are a deliberate repeatability check, not proof that the method generalizes to new datasets or random seeds.
- The comparison produces no autonomous actions, no PhiTriBrain memory writes, and no ThinkTank approvals. Sharing or endorsing findings requires explicit independent human review.
- Reports contain CPU/GPU, OS and software metadata. Review locally before publishing.

## CI and next research step

CI runs P0/P1/P2/P3 unit tests on a CPU-only hosted runner, generates two new small CPU P2 reports, validates both with their JavaScript parser, then executes the P3 comparison CLI. That checks software plumbing; it does **not** provide local GPU timing evidence.

After your first independent RTX 5070 measurements, a possible P4 would calibrate true transfer bandwidth and external-device assumptions, with an explicit physical interface and rigorous energy accounting. There is no promised photonic improvement at P4.

**Evidence before celebration. The celebration is still allowed.**
