# Photonics P1: numerical CPU/CUDA route and hybrid-transfer experiment

**Status:** software-only prototype with opt-in local execution. All reported measurements are **electronic PyTorch CPU/GPU execution**, never optical device measurements, and do not reproduce the University of Tokyo / NTT 2026 physical deep learning results (DOI [10.1038/s43588-026-01075-w](https://doi.org/10.1038/s43588-026-01075-w)).

## Question

If we someday substitute an optical module for a nonlinear recurrent reservoir stage, what must we account for to make a meaningful **end-to-end** comparison? P1 measures numerical correctness, compute time, GPU memory allocation, and *digital* cross-device transfer overhead on a small, controlled workload. It cannot estimate future optical hardware latency, energy, analog precision or savings.

## Three partition choices and an operator control

The same source CPU-generated synthetic, noisy, two-pulse temporal XOR samples, identical per-seed projection matrices, matched train/test indices, ridge regularization and virtual nodes feed each route.

| Method | Electronic projection | Sine/tanh recurrence | Ridge readout |
| --- | --- | --- | --- |
| `cpu_sine` | CPU | CPU sine | CPU |
| `cpu_tanh` | CPU | CPU tanh | CPU |
| `cuda_sine` | CUDA | CUDA sine | CUDA |
| `cuda_tanh` | CUDA | CUDA tanh | CUDA |
| `hybrid_cuda_cpu_cuda_sine` | CUDA | CPU sine | CUDA |

The hybrid method **does not use any optical hardware**. Its CPU sine stage is a stand-in for an external accelerator so that the GPU→host→GPU overhead becomes visible. The CPU and GPU sine routes evaluate the same mathematical function; the tanh routes are a separate nonlinearity control, not a like-for-like timing speedup.

The digital pipeline is:

1. Generate test data and seeded matrix on CPU (untimed).
2. Move input to CUDA if applicable (timed).
3. Perform deterministic dense linear projection (timed).
4. Move projected activations CUDA→CPU for hybrid only (timed).
5. Apply the R0 ring-style sine/tanh recurrent reservoir with fixed seeded mask and bias (timed).
6. Move hybrid reservoir features CPU→CUDA (timed).
7. Fit a train-only standardized ridge readout and classify held-out data (timed).
8. Verify predictions/confusion/accuracy and CPU feature parity outside measured time.

Projection weights, seed, train split and index metadata are set up outside timing. A short preprocess warm-up reduces some, but not all, startup differences. **Methods run in fixed, non-randomized order**; timing is exploratory and may be biased by cache warming, kernel compilation, contention, device clocks and host overhead. No end-to-end production throughput comparison is asserted.

## Run on a local computer

Install Python 3.10+ and the matching [PyTorch](https://pytorch.org/get-started/locally/) build for your device. This experiment does not need Ollama, and it does not access local network services.

~~~powershell
# From a local clone of -Core369
New-Item -ItemType Directory -Force benchmarks | Out-Null

# Always works with CPU-compatible PyTorch, no CUDA inferred
python scripts/photonics-p1.py --device cpu --samples 256 --nodes 32 --repeats 3 --out benchmarks/photonics-p1-cpu.json

# Uses CUDA only if PyTorch detects it; CPU-only results are clearly labeled
python scripts/photonics-p1.py --device auto --samples 256 --nodes 32 --repeats 3 --out benchmarks/photonics-p1.json

# Fail explicitly if CUDA is requested but unavailable
python scripts/photonics-p1.py --device cuda --samples 256 --nodes 32 --repeats 3 --out benchmarks/photonics-p1-cuda.json
~~~

The `--out` destination is created exclusively (existing reports are not overwritten). Reports in `benchmarks/*.json` are ignored by Git. Review device names and metadata before sharing. The default script writes JSON to stdout unless `--out` is set.

### Interpret metrics

- **Accuracy:** held-out accuracy and confusion matrix on a toy XOR task; not performance on language or vision models.
- **Wall time:** synchronized CPU/CUDA wall-clock time for one digital pipeline including transfer stages, Python overhead and readout fitting; not a device-only kernel latency measurement.
- **Stage timing:** explicit six-stage breakdown (with nulls where transfers do not apply). Timing need not sum exactly to total wall time because control overhead is separate. Some label/index transfers are part of readout stage but are **not** counted in activation-transfer-byte estimates.
- **Activation transfer bytes:** theoretical size of explicit activation movement, not observed PCIe throughput, bus utilization or total transfer traffic.
- **Peak incremental CUDA allocation:** PyTorch allocator peak above the starting allocation, not board-wide VRAM or GPU memory consumption; other processes are not included.
- **Feature drift:** maximum absolute difference between matching CPU and GPU reservoir features *outside timed sections*. Not a guarantee of bit-identical runs or identical classification decisions at a threshold.
- **Aggregate:** arithmetic mean of per-seed accuracies, median of per-seed wall times. Tiny seed counts are not enough for statistical confidence.

No watts/joules or actual optical components are monitored. No per-device physical telemetry is collected. Never report CPU-vs-CUDA digital speed as a photonics advantage.

## Browser-local analysis, strict interpretation

The `Hybrid P1` section of the Φ-Core369 dashboard accepts `phicore369.photonics.p1.v1` JSON only when explicitly chosen. It does not launch Python, use model APIs, download weights, or write local files. A bounded parser checks field schemas, seed order, route/device consistency, expected activation bytes, timing validity, confusion matrices, aggregate figures, no optical hardware claim and no automatic execution privilege. Valid JSON is **not** cryptographic authentication: a malicious author can fabricate an internally consistent report.

P0 retains its separate `phicore369.photonics.r0.v1` importer. Neither parser silently treats the other's report as compatible.

## What comes after P1

1. Independently repeat local CPU/CUDA comparisons with randomized route ordering, warm-up and larger held-out tasks; use confidence intervals for timing and accuracy.
2. Introduce a *physical* photonic adapter only after its input/output coding, timing, signal-to-noise and precision are characterized, with an electrical baseline running exactly the same operation.
3. Measure **end-to-end joules** using defensible external instrumentation, including conversion, transfers, laser, control electronics, idle and cooling costs.
4. Only after results have been reviewed should a future PhiMadaPrime or PhiTriBrain369 extension display or cite them. No automatic execution, model swapping or memory writes.

**GMED means reproducible comparisons, not convenient outcomes.**
