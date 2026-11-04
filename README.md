# ΦCore369 | Memory-First Compute Lab

An MIT-licensed, memory-first AI-native compute architecture research project from Phi369 Labs.

**Status: Rung 1 analytical model and interactive React lab.** No manufactured chip, working weight-bubble scheduler, measured accelerator benchmark, or demonstrated speedup is claimed.

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
- **R2:** optional adapters to local Ollama/llama.cpp, collect real baselines, investigate software weight-bubble caching and scheduling with matched tests.
- **R3:** compare memory tiers, coherent links and FPGA prototypes based on R2 evidence.
- **R4:** custom board or accelerator feasibility if performance, price, power, security and accuracy warrant it.

PhiOS is the proposed substrate; PhiRSI may propose experiments but cannot deploy unreviewed changes. JoyVein369, PhiServe and PHB are possible future integration points, not requirements for R1.

People above profit. Ledger above ego. No automatic deployment of unverified firmware or hardware changes.
