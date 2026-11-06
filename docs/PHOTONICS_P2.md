# Photonics P2: controlled digital validation (not optical hardware)

**Status: reproducible local PyTorch numerical experiment.** This rung expands P1 with a second temporal task, full-pipeline warm-up per route, deterministic randomized order of timed routes, and per-seed paired timing differences with exploratory bootstrap intervals. The software still runs entirely on electronics. This work does **not** reproduce or measure the University of Tokyo/NTT physical optical architecture (DOI: [10.1038/s43588-026-01075-w](https://doi.org/10.1038/s43588-026-01075-w)).

## Research question

Which advantages or limitations of sine-delay **numerical reservoir models** appear consistently across controlled tasks and hardware partition routes, once execution-order bias and observed variability are considered? P2 deliberately cannot establish real photonic acceleration or energy savings.

## Protocol

- **Temporal XOR:** synthetic two-pulse noise task inherited from R0/P1. Predict XOR of two distant binary pulses.
- **First-pulse memory:** same generated inputs and split, but classify the sign of the earlier pulse. This is deliberately easier and should reveal task dependence.
- **Paired trials:** each method within a task/seed sees the same input arrays, labels, shuffled train/test indices, fixed projection and ridge penalty. Each task uses multiple independently seeded splits, with three or more repetitions required.
- **Complete route warm-up:** run each CPU/CUDA/hybrid route once per task and seed *without reporting its time*. Then shuffle the route order using a known seed before recording results.
- **Methods:** CPU sine and CPU tanh always; CUDA sine, CUDA tanh, and CUDA→CPU→CUDA sine only if a CUDA PyTorch backend is available and selected. The hybrid middle CPU recurrence is merely an **emulated external device boundary**.
- **Per-method metrics:** held-out confusion/accuracy, wall-clock time, explicit stage times, CPU feature drift, theoretical activation bytes, incremental PyTorch GPU allocations. `P1.run_method` performs synchronized timing. All are electronic runtime measurements.
- **Pair comparisons:** `cpu_tanh – cpu_sine`; and when GPU exists, `cuda_sine – cpu_sine`, `hybrid_cuda_cpu_cuda_sine – cuda_sine`. Each difference is computed within the *same task and seed*. Positive milliseconds means candidate slower.
- **Uncertainty:** median of the paired differences plus an exploratory percentile interval from 1,000 seeded bootstrap resamples of the few paired rounds. The interval measures sampling variability under strong, imperfect assumptions. It is **not** an independent optical-performance or causality confidence guarantee.

A feature-accuracy comparison across different nonlinearities is informative, but not a matched-kernel performance contest. Method ordering is randomized, but temperature, CPU thread schedules, background load, kernel caches, power management, and PCIe events can still skew timing. Multiple seeds alone do not establish independent hardware experiments.

## Run locally

Requires Python 3.10+ and PyTorch. No internet, Ollama, model downloads, cloud service or PhiMadaPrime authorization is used by the runner.

~~~powershell
# From -Core369 root, after installing a local CPU/CUDA PyTorch build
New-Item -ItemType Directory -Force benchmarks | Out-Null

# CPU control (works with CPU-only torch)
python scripts/photonics-p2.py --device cpu --samples 256 --nodes 32 --repeats 4 --out benchmarks/photonics-p2-cpu.json

# CUDA if detected, else CPU. --device cuda explicitly fails if unavailable.
python scripts/photonics-p2.py --device auto --samples 256 --nodes 32 --repeats 4 --out benchmarks/photonics-p2-auto.json
~~~

Existing report destinations cannot be overwritten. `benchmarks/*.json` are ignored by Git. The generated JSON can be explicitly selected in the P2 section of the app. All browser validation is local, read-only, and capped at 256 KiB.

## Validation and interpretation

- Report schema is `phicore369.photonics.p2.v1`, deliberately independent of P0 and P1 schemas.
- JavaScript parser reuses P1's per-route accounting checks, then cross-checks task IDs, paired seeds, each randomized method permutation, aggregate accuracies and medians, paired differences and plausible interval bounds. Malformed or unsupported reports fail closed.
- `source = measured-local-pytorch-digital`. Valid structure does not prove authenticity; fake data could still be supplied. Do not treat checksums or JSON labels as device attestations.
- No actual photonic optical chip, optical interferometer, 200 m fiber loop, laser control, wavelength, photonic inference, or physical energy measurements exist in P2.
- No absolute or relative **energy efficiency** claim is possible without external joule metering. CPU/GPU wall times are not an estimate of optical performance.
- Report contains device metadata, seeds and timing; inspect before sharing. No prompts or user documents are collected.
- P2 does not send commands to Ollama, merge PRs, modify PhiTriBrain data, or authorize ThinkTank or bot execution.

## Next falsifiable questions

Once local results from an actual GPU are available, rerun on a less trivial temporal dataset and evaluate randomization and warm-up sensitivity. A future **physical** optical adapter would require measured conversion overhead, I/O bandwidth, precision/noise drift, optical electricity use (including lasers and DAC/ADC), and external power instrumentation, followed by matched end-to-end hardware comparisons.

The point is to discover where a hybrid *might* help, not to declare that photonics already won.
