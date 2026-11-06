# ΦCore369 | Memory-First Compute Lab

An MIT-licensed, memory-first AI-native compute architecture research project from Phi369 Labs.

**Status: Rung 2E contains consented Ollama shadow sessions; Photonics P0 and P1 add separate software-only numerical research labs.** The simulator uses actual submitted request timing and prior R2D model profiles but does NOT apply its scheduling decisions. No automatic eviction or measured policy speedup is claimed.

## Thesis

Design the system around the movement of model weights and context rather than assuming graphics hardware is the only architecture possible. First quantify limits, then build prototypes justified by reproducible evidence.

## Run it

Node.js 20.19+ or Node.js 22+ recommended.

~~~sh
npm install
npm test
npm run dev
~~~

Run npm run build to generate production assets. The GitHub Actions workflow tests PRs and builds/publishes the main branch.

## Φ Companion R0: optional local assistant sidecar

An independent, offline-first research experiment lets you compare the **same Ollama model** in bare, profile, and user-approved-memory configurations. It is not a GPT-6 clone, does not grant shell access, and does not change this project's model-residency experiments.

~~~sh
# Requires an installed, running local Ollama model; change the name if needed
npm run assistant:chat -- --model=qwen3:4b
# /compare What makes a good network troubleshooting plan?
npm run assistant:eval -- --model=qwen3:4b
~~~

Memory is opt-in via `/remember`, stored outside the repo on your own machine; `/forget` removes a note. The small synthetic evaluation is *not* proof of general intelligence, model parity, or system safety. See [Φ Companion research protocol](docs/ASSISTANT_R0.md) for safeguards, limitations, and the next measurable experiments.

## R2A: Measure real Ollama runs locally

Start Ollama with a model already installed, verify its exact name using `ollama list`, then run in the cloned repository:

~~~sh
node scripts/ollama-bench.mjs --model qwen3:4b --runs 6 --out benchmarks/local-baseline.json
~~~

Change `qwen3:4b` to a model you actually have. The runner talks **only to the local Ollama HTTP API**, warms up once by default, streams six generations from three fixed workloads, and stores model digest, device metadata, token timings, and any failed runs. It does not save generated text or prompt text.

Open the React page, scroll to **Measurement Engine**, and import your local JSON. Optionally run the command again with a second output file and import both for a controlled repeat check. No browser-to-localhost requests, cloud upload, or inference on GitHub Actions are required.

See [measurement reporting schema](docs/REPORT_SCHEMA.md). **This is measured inference, not measured success of a weight-bubble scheduler.** Reported percentage differences from repeated runs are not proof of an optimization.


Live GitHub Pages address **after enabling Pages and deploying main**:
https://michaelwave369.github.io/-Core369/

## R2B: Model-residency crossover (local, opt-in)

Ollama supports preloading, unloading, and inspecting currently loaded models. This tool compares explicitly unloaded (cold) and preloaded runs of the same model and prompt, with deterministic randomized pairing and preloading cost recorded separately.

~~~sh
# Read-only inspection; no changes to Ollama
node scripts/residency-bench.mjs --model qwen3:4b

# Intentionally unload and preload the selected model; only do this on idle Ollama
node scripts/residency-bench.mjs --model qwen3:4b --pairs 6 --execute
~~~

Replace the model name with a locally installed model. Running with `--execute` temporarily unloads the selected model and may cause Ollama itself to evict other models when memory is constrained. By default the tool refuses to proceed if any models are already resident. If you need to override this safety precondition, read the [R2B protocol](docs/RESIDENCY_R2B.md) before using `--allow-loaded`.

Import `benchmarks/residency-r2b.json` into the **Residency Crossover Lab** on the webpage. The browser neither connects to Ollama nor uploads the file. Metrics include paired first-text latency, Ollama load time and preloading overhead, along with careful interpretation: preloading shifts latency, and does not necessarily reduce total work or memory demand.

## R2C: Φ Weight Bubble scheduler research

The new **Weight Bubble** section of the React page replays the same synthetic or user-imported workload through three policies:

- **No caching:** each request pays the assumed loading cost.
- **LRU:** evict the model used least recently.
- **Φ:** evict the model with the lowest *decayed historical reuse × reload cost / size* score.

Each policy honors an explicit *weights-only* resident memory budget, records every eviction, applies optional idle expiry at request boundaries, bypasses non-fitting oversized models, and exposes **when Φ loses to LRU**. Replaying is entirely offline; it does **not** call Ollama or alter active models.

~~~sh
# Offline, synthetic preset; no GPU or running Ollama required
node scripts/weightbubble-replay.mjs --preset bursts --budget-gib 12

# Replay an imported local trace with the same deterministic engine
node scripts/weightbubble-replay.mjs --trace examples/sample-workload.json --budget-gib 12 --out benchmarks/custom-r2c.json
~~~

The first command produces `benchmarks/r2c-replay.json`. The second expects a local versioned workload file that you create; see [R2C trace format and methodology](docs/WEIGHT_BUBBLE_R2C.md).

**Important:** model weights, loading times and inference times supplied by a sample trace are illustrative, NOT measured RTX 5070 or Ollama results. A positive modeled delta is not a real throughput win. Actual KV/activation memory, concurrency, OS caches, power and output quality are not included.

## R2D: Calibrate simulator inputs using local Ollama evidence

This rung connects completed, isolated **R2B** cold/warm experiment reports from **two or more different models** to the **R2C offline replay engine**. It extracts medians of observed model-loading time, service-time proxy and `/api/ps` GPU residency for each model, checks report compatibility and derives a trace from an explicit *user-provided* arrival sequence.

~~~powershell
# Optional read-only local residency snapshots; never unloads or generates
node scripts/ollama-observe.mjs --samples 6 --interval-ms 2000

# Once you have two compatible R2B reports from separate models:
node scripts/calibrate-residency.mjs --arrivals examples/sample-arrivals.json --report benchmarks/qwen3-r2b.json --report benchmarks/gemma3-r2b.json --budget-gib 12 --out benchmarks/r2d-calibrated.json
~~~

Those named R2B files are example output destinations, **not included data**. Capture each separately using `scripts/residency-bench.mjs` on an idle local Ollama instance, with the same settings. The names in the arrival JSON must match those models. See [R2D protocol and science limitations](docs/CALIBRATION_R2D.md).

A new **Measured Calibration** section of the React app accepts the R2B JSON files and an arrival sequence via local file pickers, previews the derived profiles and simulation outcome, and exports either a workload JSON or full provenance report. Neither this browser panel nor the conversion CLI contacts Ollama or changes residency.

**Important:** The R2B reports provide model-level empirical *inputs*, **not actual multi-model scheduler performance**. The arrival order is chosen, not observed; `size_vram` is a snapshot, not guaranteed memory occupancy; actual quality, concurrent KV memory, energy, and interference remain unmeasured.

## R2E: Foreground local shadow sessions (consent required)

R2E lets you **manually send prompts** through a local terminal client, switch between allowlisted R2D-calibrated Ollama models, and collect actual per-request timing and arrival data. No background interception. The offline shadow scheduler analyzes your observed requests but never sends model preloads, unloads, or evictions.

First create benchmarks/r2d-calibrated.json from at least two compatible R2B reports using R2D. Then:

~~~powershell
# Preview local calibration and selected model only. ZERO Ollama requests.
node scripts/shadow-session.mjs --profiles benchmarks/r2d-calibrated.json --model qwen3:4b

# Explicitly opt in to a foreground prompt session.
node scripts/shadow-session.mjs --profiles benchmarks/r2d-calibrated.json --model qwen3:4b --execute --max-requests 20
~~~

Inside the session, type plain prompts to generate text; use /model NAME to change models, /status for read-only Ollama residency, and /quit to save the JSON report. Generated text is displayed but never saved, and the report contains no prompt text. Only model/timing/hardware metadata is retained, so review it before sharing.

Open the new **Shadow Mode** React section and import benchmarks/r2e-shadow-session.json to compare actual Ollama metrics with **counterfactual** no-cache/LRU/Φ replay costs. A modeled delta is not a measured speedup. The website does not connect to your local Ollama. See [R2E safety and interpretation](docs/SHADOW_R2E.md).

## Photonics P0: software-only sine-delay experiment

Following the November 5, 2026 University of Tokyo/NTT paper, this optional **PyTorch numerical simulator** compares a sine-delay virtual reservoir with an electronic tanh reservoir and a raw-input linear control on identical synthetic temporal-XOR samples. It is **not optical hardware**, a paper reproduction, or proof of optical speed, energy or general intelligence advantages.

~~~sh
# Install PyTorch separately for your platform; CPU works, CUDA is optional.
python scripts/photonics-r0.py --device cpu --repeats 3
# After creating a local benchmarks/ directory:
python scripts/photonics-r0.py --device auto --out benchmarks/photonics-r0.json
~~~

The **Photonics experiment bay** accepts the resulting JSON manually in your browser and checks the data/simulation trust boundaries. No benchmark output is shipped as a preclaimed result. No automatic links, agents, GPUs, fibers, or power meters are controlled.

See [Photonics R0 protocol](docs/PHOTONICS_R0.md) and [the peer-reviewed publication](https://doi.org/10.1038/s43588-026-01075-w).

## Photonics P1: CPU / CUDA / hybrid digital compute

P1 adds an **opt-in, local PyTorch benchmark** for the same sine-delay reservoir on CPU, GPU (when CUDA exists), and a GPU → CPU → GPU partition that models the overhead of crossing hardware boundaries. A tanh control is also included. **The middle CPU stage is not actual optical equipment.** Results are synchronized digital times, toy-task accuracy, feature parity and PyTorch allocator statistics, never measured optical speed or energy savings.

~~~powershell
New-Item -ItemType Directory -Force benchmarks | Out-Null
python scripts/photonics-p1.py --device auto --out benchmarks/photonics-p1.json
~~~

The **Hybrid P1** webpage section can import this JSON manually and validate its numerical-only provenance. On CPU-only systems, the tool omits CUDA methods explicitly instead of manufacturing GPU results. The existing Photonics P0 experiment stays independently versioned.

See [P1 protocol and limits](docs/PHOTONICS_P1.md).

## Photonics P2: controlled digital validation

P2 adds **paired, seeded digital CPU/CUDA trials** on two temporal tasks with a full-route warm-up, randomized method order and exploratory bootstrap timing intervals. It retains the existing P0 and P1 experiments. All results are measured **PyTorch numerical performance**, not optical hardware acceleration or energy data.

~~~powershell
New-Item -ItemType Directory -Force benchmarks | Out-Null
python scripts/photonics-p2.py --device auto --repeats 4 --out benchmarks/photonics-p2.json
~~~

The **Validation P2** webpage section reads local, explicitly selected report JSON. CUDA partitions appear only when PyTorch actually detects CUDA. No automatic PhiMadaPrime/ThinkTank data actions or hardware intervention are included. See [P2 protocol and statistics](docs/PHOTONICS_P2.md).

## R1 features

- Responsive React architecture diagram and real-time scenario lab.
- Presets for illustrative 8B, 32B, 70B dense and hypothetical 120B sparse models.
- Adjustable quantization, context, concurrent KV sessions, VRAM, memory bandwidth, interconnect, compute and efficiency.
- Weight and KV capacity calculations, offload diagnostics, theoretical arithmetic/memory/link ceilings, context sweep.
- KV compression thought experiment with explicit quality caveats.
- Deterministic tests and GitHub Pages CI.

Displayed tokens/second values are simplified **analytical ceilings**, not measured throughput. Model configurations and accelerator numbers are illustrative, not verified hardware profiles.

Read [architecture](docs/ARCHITECTURE.md) and [measurement protocol](docs/MEASUREMENT.md).

## Roadmap

- **R1:** analytical simulator, reproducible formulas, tested interactive site.
- **R2A (current):** local Ollama adapter, measured baseline records, repeat comparisons, and reporting safeguards.
- **R2B (current):** opt-in Ollama model residency / preload crossover, paired latency and preloading cost; still no model weight placement control.
- **R2C (current):** offline budgeted scheduler comparison, synthetic and imported traces, eviction ledger, CLI, adversarial tests.
- **R2D (current):** read-only model residency observation, compatibility-gated R2B-to-R2C input calibration, provenance-aware offline replay.
- **R2E (current):** operator-consented foreground Ollama prompts, observed arrival and timing metadata, shadow LRU/Φ replay, strict no-automatic-eviction boundary.
- **R2F:** plan and independently verify a dry-run-first live controller against isolated Ollama instances with allowlists, kill switches, trace audit, memory headroom and correctness/power gates.
- **R3:** compare memory tiers, coherent links and FPGA prototypes based on R2 evidence.
- **R4:** custom board or accelerator feasibility if performance, price, power, security and accuracy warrant it.

PhiOS is the proposed substrate; PhiRSI may propose experiments but cannot deploy unreviewed changes. JoyVein369, PhiServe and PHB are possible future integration points, not requirements for R1.

People above profit. Ledger above ego. No automatic deployment of unverified firmware or hardware changes.
