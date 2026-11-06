# Photonics R0: numerical delay-loop reservoir, not optical hardware

**Status: prototype research lane.** PhiCore369 Rung P0 adds a local PyTorch toy benchmark and a browser-local, read-only results importer. **It is not a reproduction of a published optical neural network and makes no claims about energy savings or optical speedup.**

## Motivation and scientific boundary

Zhang et al. (University of Tokyo/NTT, 2026) studied a single-map physical deep learning architecture, optical dynamics, and **state-skipping direct feedback alignment**. See [the paper](https://doi.org/10.1038/s43588-026-01075-w) and [University of Tokyo's announcement](https://www.u-tokyo.ac.jp/focus/en/press/z0508_00471.html).

This R0 toy model borrows only a high-level idea: nonlinear, recurrent delay dynamics can create useful features. Its sine activation is *inspired by* the Mach–Zehnder-modulator-style nonlinearity described in the research, but uses an uncalibrated feedback gain and generic input mask. It does **not** simulate actual fiber dispersion, absorption, waveguide interference, laser phase noise, input/output conversion, or a measured 200 m loop. It does **not** implement state-skipping training.

We deliberately keep this separate from R2A–R2D memory/residency measurements and from the model-inference roofline. Never combine different baselines into a numerical claim of comparable watts, speed, or intelligence.

## Run locally (optional PyTorch dependency)

From a clone with Python 3.10+ and [PyTorch](https://pytorch.org/get-started/locally/) installed for your specific CPU/CUDA runtime:

~~~sh
python scripts/photonics-r0.py --device cpu --repeats 3
mkdir -p benchmarks
python scripts/photonics-r0.py --device auto --repeats 3 --out benchmarks/photonics-r0.json
~~~

Windows PowerShell: `New-Item -Type Directory -Force benchmarks`; then run the Python command. The output is created exclusively with mode `x`: existing reports are **never** overwritten. The `benchmarks/` directory remains gitignored. If your PyTorch installation supports the RTX 5070, `--device auto` uses CUDA; `--device cuda` fails if CUDA is unavailable.

For one quick sanity check:

~~~sh
python scripts/photonics-r0.py --device cpu --samples 128 --nodes 16 --repeats 1
~~~

Do not run CPU and CUDA timing comparisons as power-efficiency claims. Numerical runtime includes software operations, kernel dispatch, system load, and readout fitting. It is not photonic throughput.

## Controlled toy experiment

- **Task:** noisy synthetic 2-pulse temporal XOR, with an independent 75/25 train/test split per seed. No real user data.
- **Methods:** raw flattened input with a ridge readout; an electronic-style tanh virtual delay reservoir plus ridge; a sine virtual delay reservoir plus ridge.
- **Reservoir:** fixed seeded input mask and bias. A ring-buffer-style shifted previous state is fed into each update. No gradients through reservoir; only the ridge readout is fitted. The sine and tanh reservoirs use the same number of virtual nodes, feedback factor, seeds, and regularization.
- **Metrics:** held-out accuracy with a 2x2 confusion matrix, measured *digital simulation* feature-generation time, readout fitting/prediction time, seeds, device metadata, mean accuracy, and sample standard deviation across seeds.
- **Limit:** the raw-input baseline has fewer features than the reservoirs. The two reservoir variants share feature dimensionality but differ in nonlinearity. This is not a compute-equalized speed study. The XOR benchmark is intentionally narrow.

Neither the report parser nor the web UI will display fake default numbers. Open the app's **Photonics experiment bay** and import the JSON manually. It stays in the browser's memory: no requests to Ollama, hardware, PhiMadaPrime, GitHub or cloud APIs.

## Output contract

A valid file has `schema: "phicore369.photonics.r0.v1"` and `source: "numerical-simulation-pytorch"`. It includes:

- `research_reference.replication_of_paper: false`
- `environment` (PyTorch, Python, CPU/CUDA, device name)
- `protocol` (task, method order, sample count, virtual nodes, seed, ridge lambda)
- `runs[].methods` (accuracy, confusion, timings, fit coefficients)
- `aggregate` (mean and standard deviation accuracy by method)
- `limits` and `interfaces.execution_authorized: false`

The browser validator checks schema, source, bounded sizes, method set, holdout size, confusion-matrix/accuracy agreement, aggregate means and the permission boundary. A valid JSON report still **does not prove authenticity**. A modified report with internally consistent numbers could pass. Hardware attestations, verified signed data, actual power probes and experimental calibration are future research.

## Integration boundaries

**PhiTriBrain369:** A researcher may explicitly ingest or cite a reviewed report as a source. A synthetic result is *WITNESS of an experimental claim*, not an established physical law. Never claim automatic memory ingestion, alter the R4a export format, or convert unreviewed findings into STEWARD authorizations.

**PhiMadaPrime ThinkTank:** This R0 delivers a local JSON import into Φ-Core369. A future, separately reviewed ThinkTank integration may import this versioned schema using explicit user action and a strict parser. Do not treat the report as a bot instruction or automatic job approval.

**Φ-Core369 next experiment:** Re-run with fixed matched sample sizes/seeds on CPU/CUDA, record repeated wall times and uncertainty, add a predeclared non-XOR task, and only then consider hardware-backed optical readouts and energy metering. The point is *falsifiability*, not guaranteed victory over conventional hardware.
