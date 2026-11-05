# R2 Measurement Protocol

The R1 simulator remains an analytical tool, not a hardware profiler. R2A supplies an optional local Ollama benchmark collector and an import-only visualizer. It measures engine token timing, **not** energy or GPU memory consumption.

## Real benchmark manifest (future R2)

Each recorded run must identify: UTC timestamp, code SHA, engine/backend revision, OS, CPU, GPU, driver, RAM/VRAM, model identifier and weight checksum, quantization, prompt tokens, generated tokens, context, KV bits, batch/concurrency, seed, cold/warm state, settings and offload placement.

Report per-run time to first token, prompt throughput, decode throughput, latency, peak RAM/VRAM, power/energy where available, errors, output validation and quality changes. Never label missing values as zero.

## Acceptance criteria

1. Tests and production build green.
2. Baseline recorded on exact hardware with full provenance.
3. Same model, prompt distribution, quality target and runtime settings for controlled comparisons.
4. Five or more repetitions per variant with randomized ordering and warmup.
5. Publish all samples, medians, error/quality cases and regressions.
6. Human review before deployment into PhiOS or experimental hardware.

The weight bubble must demonstrate a real speed/energy/capacity tradeoff before it is promoted from research hypothesis into a production feature.

## Implemented R2A collector

From a local clone with Node.js 22 and running Ollama:

~~~sh
node scripts/ollama-bench.mjs --model qwen3:4b --runs 6 --out benchmarks/local-baseline.json
~~~

Substitute an installed local model. Reports go only to the chosen file path. The first run is warmed up, and three fixed prompts are cycled; all six measurement attempts remain in the report even when they fail. Generated responses and prompt plaintext are not saved. The collector only accepts loopback HTTP. The GitHub Pages dashboard reads local JSON via the user's file picker, not through CORS or a web service.

It records actual Ollama token counts and nanosecond timing fields and a separately labeled client-observed first-text latency. The next experiment must add correctness checks, GPU memory and energy telemetry before we claim efficiency improvements. See [the report contract](REPORT_SCHEMA.md).

## Implemented R2B controlled model-residency crossover

See [R2B protocol](RESIDENCY_R2B.md) for the explicit opt-in CLI, sequence, safety preconditions, paired reports, and critical distinctions between *moving* load time and *eliminating* work. No silent unloads, no network/cloud inference, and no reported optimization gain without quality and energy evidence.

## Implemented R2C replay engine

The Weight Bubble policy lab compares transparent memory-residency heuristics using deterministic trace input. It is **not** an inference run. Trace load and inference times are assumed numbers unless explicitly measured and supplied. It does not measure real GPU memory pressure or work with actual KV/activation residency; do not compare its modeled savings directly with R2A measured tokens/second. See [R2C trace and comparison specification](WEIGHT_BUBBLE_R2C.md).

## Implemented R2D measured-input calibration

The R2D converter checks provenance across two or more isolated cold/warm residency reports from R2B, then uses measured median load times and Ollama GPU residency snapshots as parameters for a *derived offline R2C trace*. The user supplies the request arrival sequence explicitly; it is not measured runtime traffic. A read-only observer records timestamped /api/ps snapshots and does not generate or change model state. These tools **do not establish actual scheduler speedups**. See [R2D protocol](CALIBRATION_R2D.md).
