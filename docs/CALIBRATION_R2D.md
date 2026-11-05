# ΦCore369 Rung 2D: Measured-input calibration and read-only observation

## Scope

R2D creates a provenance-aware bridge between **R2B cold/warm Ollama residency measurements** and the **R2C offline cache-policy simulator**. It does not deploy a live scheduler, act on other applications' requests, or claim measured performance of LRU/Φ policies.

A separate read-only observer gathers snapshots of Ollama's loaded-model listing. This is *not* a server request log, GPU high-watermark profiler, or inference benchmark.

## What comes from actual measurements?

Each completed, isolated R2B report contributes:

- Exact installed model name and model digest, Ollama engine version and host identity.
- Median cold \`load_duration\` from engine counters, treated as a model-load cost **estimate**.
- Median cold \`total_duration - load_duration\` as a coarse service-cost **proxy**.
- Median reported \`size_vram\` from the warm resident \`/api/ps\` snapshot as a footprint **proxy**, not full GPU memory accounting.

Conditions: at least five successful cold/warm pairs per model, no recorded failures, no models loaded initially, positive reported VRAM residency values, and identical hardware, Ollama version, generation settings and prompt checksums across reports. Reports that fail are rejected. CPU-only or unobserved GPU allocations cannot be safely converted to a VRAM-only profile.

**Important:** per-model \`size_vram\` snapshots cannot guarantee that all memory allocations fit when multiple models run. Weight storage, KV caches, runtime overhead, allocator fragmentation, CPU memory offload, context switching, and concurrency can invalidate an additive residency simulation. No power or output-quality checks are performed.

## What is NOT measured?

**Request arrivals.** The user supplies an explicit versioned arrival sequence. Do not present timestamps/order as observed server traffic.

Example file: \`examples/sample-arrivals.json\`. It uses model names that must correspond exactly to the R2B reports.

~~~json
{
  "schema": "phicore369.arrivals.v1",
  "name": "Chosen sequence",
  "requests": [
    { "atMs": 0, "model": "qwen3:4b" },
    { "atMs": 1500, "model": "gemma3:12b" }
  ]
}
~~~

The policy engine remains R2C's deterministic **single-request-at-a-time hypothetical replay**, with no actual evictions, GPU model loading, data correctness checks or wall-clock queue simulation. The displayed LRU/Φ differences are **estimated loading-time deltas**, not demonstrated acceleration.

## Local commands

Run isolated R2B measurements separately for two installed models. Your running Ollama server must be idle before R2B experimental model loads/unloads. See \`docs/RESIDENCY_R2B.md\`.

~~~powershell
node scripts/residency-bench.mjs --model qwen3:4b --pairs 6 --execute --out benchmarks/qwen3-r2b.json
node scripts/residency-bench.mjs --model gemma3:12b --pairs 6 --execute --out benchmarks/gemma3-r2b.json
~~~

Use only models which fit your GPU comfortably and have positive, plausible \`size_vram\`. Large models may take a long time to load, or cause eviction/offload; stop rather than overriding safety for a benchmark.

Once collected, convert *offline*:

~~~powershell
node scripts/calibrate-residency.mjs --arrivals examples/sample-arrivals.json --report benchmarks/qwen3-r2b.json --report benchmarks/gemma3-r2b.json --budget-gib 12 --out benchmarks/r2d-calibrated.json
~~~

Alternatively, open the React page's **Measured Calibration** panel, select the local R2B reports and arrival JSON, then export a derived R2C workload trace or full provenance report. Files are parsed only in browser memory. No local Ollama browser access or remote upload.

Optional, completely read-only local API observation:

~~~powershell
node scripts/ollama-observe.mjs --samples 6 --interval-ms 2000 --out benchmarks/ollama-observation.json
~~~

This performs only HTTP GET requests to loopback \`/api/version\`, \`/api/tags\` and \`/api/ps\`; it records names, digests, size snapshots, expiry timestamps and host details. It never generates, unloads, preloads or touches prompts. Sampling is bounded and cannot guarantee peak memory usage.

All generated JSON in \`benchmarks/\` remains ignored by Git. Do not publish unreviewed records with identifying hardware/model metadata.

## Acceptance gates for a future real controller

Before *any* policy can control Ollama model residency automatically:

1. Capture or explicitly instrument **real** request arrivals with permission, no prompt or output retention by default.
2. Collect genuine multi-model capacity, latency, interference, and host CPU/GPU telemetry.
3. Implement an allowlist, per-process consent, an isolated test runtime, memory headroom and cancellation.
4. Provide a one-command kill switch plus complete rollback and a dry-run audit trail.
5. Compare live LRU versus Φ with identical workloads, correctness gates and measured power/energy.
6. Deploy only after explicit human review. No automatic production inference modifications.

The research goal is fewer undesirable stalls **without** sacrificing privacy, output quality, stability or energy efficiency.
