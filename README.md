# ΦCore369 | Memory-First Compute Lab

An MIT-licensed, memory-first AI-native compute architecture research project from Phi369 Labs.

**Status: Rung 2C introduces an offline, budget-aware model-residency policy simulator and reproducible replay CLI, alongside the local R2B Ollama crossover and R2A measured baseline.** No custom memory-paging hardware, real-time live scheduler, or demonstrated performance gain is claimed.

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
- **R2D:** measured, multi-model workload capture; isolate a reversible live scheduler behind an explicit opt-in, with accuracy, contention and power gates.
- **R3:** compare memory tiers, coherent links and FPGA prototypes based on R2 evidence.
- **R4:** custom board or accelerator feasibility if performance, price, power, security and accuracy warrant it.

PhiOS is the proposed substrate; PhiRSI may propose experiments but cannot deploy unreviewed changes. JoyVein369, PhiServe and PHB are possible future integration points, not requirements for R1.

People above profit. Ledger above ego. No automatic deployment of unverified firmware or hardware changes.
