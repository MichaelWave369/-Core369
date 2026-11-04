# ΦCore369 | Memory-First Compute Lab

An MIT-licensed, memory-first AI-native compute architecture research project from Phi369 Labs.

**Status: Rung 2A adds an Ollama measurement collector and local-only report visualization alongside the Rung 1 simulator.** No manufactured chip, working weight-bubble scheduler, measured accelerator benchmark, or demonstrated speedup is claimed.

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
- **R2B:** isolate one weight-bubble cache or scheduling experiment; add output-quality verification and repeatable matched baselines. llama.cpp support may follow.
- **R3:** compare memory tiers, coherent links and FPGA prototypes based on R2 evidence.
- **R4:** custom board or accelerator feasibility if performance, price, power, security and accuracy warrant it.

PhiOS is the proposed substrate; PhiRSI may propose experiments but cannot deploy unreviewed changes. JoyVein369, PhiServe and PHB are possible future integration points, not requirements for R1.

People above profit. Ledger above ego. No automatic deployment of unverified firmware or hardware changes.
