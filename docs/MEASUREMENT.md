# R2 Measurement Protocol

The R1 UI is an analytical tool, not a hardware profiler.

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
