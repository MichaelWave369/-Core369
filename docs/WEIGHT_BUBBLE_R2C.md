# Rung 2C: Φ Weight Bubble policy laboratory

## Scope and boundaries

This rung builds a **deterministic, offline discrete-event simulator** for application-level model residency under an explicit compressed-weights-only memory budget. It compares no cache, LRU, and a proposed Φ reuse/reload-cost policy on identical workload traces.

- It **does not** call Ollama or GPUs, preload weights, change running models, alter hardware scheduling or make real-world speedup claims.
- The model assumes requests are independent and sequential. Each request incurs an assumed base inference cost, plus the model's assumed reload cost on a miss.
- Timestamped arrivals do not shift while work is serviced. Thus this is *not* a queueing simulation, and total modeled "work" is not necessarily wall-clock elapsed time.
- No KV cache, activations, runtime reserve, host paging, real PCIe transfers, quantization error, power consumption, thermals, output correctness, batching or model concurrency is simulated.
- The "cache hit" means model weights are modeled as resident, not that response content or a prompt prefix was cached.

## Workload JSON v1

Example:

~~~json
{
  "schema": "phicore369.workload.v1",
  "name": "my-local-test",
  "description": "Illustrative sequence, not measured hardware",
  "models": [
    { "id": "small", "sizeGiB": 4.2, "loadMs": 800, "inferMs": 250 },
    { "id": "large", "sizeGiB": 8.1, "loadMs": 2200, "inferMs": 460 }
  ],
  "requests": [
    { "atMs": 0, "model": "small" },
    { "atMs": 1500, "model": "large" },
    { "atMs": 3000, "model": "small" }
  ]
}
~~~

Sizes are GiB, times are milliseconds. The values here are illustrative. For measured experiments, collect actual Ollama model digest, load time distribution, and observed serving time separately, then create a trace with clearly documented assumptions. This schema intentionally contains **no prompt text, outputs, credentials, paths to private model weights, or personal identifiers**.

Maximum 60 model IDs and 5000 requests. Each model must have unique ID, sizeGiB from 0.01 to 2048, loadMs from 1 to 3,600,000 and inferMs from 0 to 3,600,000. Requests must have nondecreasing integer atMs (0 to 30 days), valid model IDs and ordered timestamps. The parser rejects invalid/nonfinite data and JSON files over 750KB in the web UI.

## Run the same replay in the CLI

Requires Node 22+, no Ollama and no GPU:

~~~sh
node scripts/weightbubble-replay.mjs --preset bursts --budget-gib 12
node scripts/weightbubble-replay.mjs --preset round-robin --budget-gib 8 --ttl-ms 30000
node scripts/weightbubble-replay.mjs --trace examples/sample-workload.json --budget-gib 12 --out benchmarks/custom-r2c.json
~~~

User-created trace files should not be committed if they contain sensitive host workload characteristics. The CLI never contacts a network service and only writes the explicitly chosen JSON file. Browser trace imports and exported replay reports likewise remain local.

## Cache policies

- **No caching:** no model is retained; each request incurs its declared loadMs + inferMs. A useful control, not a production setting.
- **LRU:** retain weights after misses if size fits. When capacity is needed, evict resident models with the oldest last access.
- **Φ:** rank each resident model by a predicted future value based only on observations available **before** the current request:

  \`score(m,t) = (0.25 + Σ exp(-ln(2) × (t - lastObservedAccess)/halfLifeMs)) × loadMs(m)/sizeGiB(m)\`

  Evict the lowest score first, with oldest access time then model ID for deterministic tie-breaking. The 0.25 is an explicit, currently untuned cold-history prior. This heuristic deliberately weights costly-to-reload / high-reuse models more than cheap-to-reload ones. It can be inferior to LRU when the future changes.

Every request is admitted if model size fits under the configured resident budget; there is no predictive bypass/admission gate yet. A model too large for budget incurs reload cost but is not cached and does not evict smaller resident models. When enabled, idle TTL expires models at the *next* request boundary. No background clocks or maintenance jobs run.

## Fields and measurements

Each replay contains per-request model, time, action (hit, load, no-cache, oversized bypass), loading cost, inference assumption, resident memory and list of evictions with reason.

Aggregate statistics:
- modeled memory hit ratio and misses
- capacity evictions and TTL expirations
- oversized, nonretained accesses
- total assumed reload and inference time, and their sum
- peak resident GiB, and arithmetic mean of resident GiB sampled after each request

Mean sampled residency is **not** time-weighted memory use. TTL is not applied between requests, so the trace does not model idle memory release continuously. There is no energy computation.

## Scientific acceptance rules

- All three policies must consume the same exact workload, identical budget and TTL settings.
- No policy can exceed the modeled resident weight capacity, including momentarily during an event.
- Φ may only use past observations; no future-peeking optimization.
- Unit tests include both advantageous and disadvantageous Φ examples. Never tune solely to make the demo succeed.
- The simulator does not prove that real memory residency is the same as estimated weight sizes or that measured Ollama load times are stable.
- Real production experiments require multi-model request traces, actual resident size telemetry including runtime overhead and KV, correctness checks, power data and consent for model unload/eviction before a live controller.

## Proposed Rung 2D

A read-only multi-model workload capture adapter and a trace schema that can attach *measured* sizes and load time distributions, preserving provenance and making uncertainty explicit. Next, a reversible local policy controller, off by default, with a fixed memory budget, idle-only execution, an allowlist of models, audit logging and a kill switch. Run controlled A/B tests against LRU, not just the example trace.

Remember: data movement optimizations must earn the right to change a real device.
