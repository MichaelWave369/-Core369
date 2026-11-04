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
