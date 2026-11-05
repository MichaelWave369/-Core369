# ΦCore369 Architecture R1

## Fundamental constraint

No software can eliminate finite memory capacity, bandwidth, energy or thermal limits. The research opportunity is workload-aware placement, compression, scheduling, and eventually differentiated accelerator memory/fabric architectures.

## Planes

1. **Intelligence:** workload definitions, model weights, context, agent and evaluation requirements.
2. **Weight bubble (research):** adaptive caching, paging and scheduling. R1 contains an analytical model only; no real scheduler.
3. **Compute:** independent prefill/decode profiling, heterogeneous CPU/GPU/accelerator stages.
4. **Memory:** accelerator RAM, host RAM and optional storage with explicit capacity and transfer costs.
5. **Fabric:** host-device link measurement; coherent and optical links are future hypotheses.
6. **PhiOS substrate:** isolation, telemetry, hardware interfaces, safe update mechanisms.

## R1 equations and units

All GiB use 2^30 bytes. All bandwidth inputs are GiB/second.

- Weight GiB = parameters × weight bits / 8 × metadata factor / 2^30.
- KV GiB = tokens × layers × KV heads × head dimension × 2 (K and V) × KV bits / 8 × sessions / 2^30.
- Working set GiB = weights + KV + reserved memory.
- Resident weights = min(total weights, max(0, device capacity - KV - reserve)).
- Offloaded weights = total weights - resident weights.
- Arithmetic ceiling = utilization × low-precision compute FLOP/s / (2 × active parameters).
- Accelerator bandwidth ceiling = utilization × memory GiB/s / (model weights GiB + KV GiB per session).
- Offload interconnect ceiling = utilization × link GiB/s / offloaded weight GiB, or unbounded when none is offloaded.
- Estimated decode ceiling = min of those three if KV cache and reserve fit in accelerator memory.

These are intentionally simplified, optimistic ceilings for a single decode stream, **not realistic tok/s estimates**. They omit kernel launch and routing overhead, actual sparsity execution, dequantization cost, prefill, activation allocations, transfer overlap, CPU memory bandwidth, batching efficiencies, paging, driver overhead and quantization quality effects.

Sparse/MoE compute reduces active FLOPs but does not eliminate model storage.

## Design constraints

- Always compare an optimization to a tuned baseline on identical workloads and hardware.
- Report both quality and speed, including regressions.
- Allow opt-out of experimental caching and preserve explicit failure modes.
- No silent system or firmware changes from autonomous components.
- Treat a future PHB embodiment design as occupant-influenced within safety and engineering requirements, not as evidence of machine consciousness.

## R2C Weight-Bubble policy simulator (implemented)

R2C adds a pure deterministic policy evaluator under a weights-only GiB budget. It never invokes Ollama, edits model weights or touches the device. All three policies replay the same ordered requests. No-cache always incurs assumed loading. LRU evicts the least recently accessed model. Φ maintains decayed historical usage for each model, scoring resident models as `(0.25 + Σ exp(-ln(2) × (now - priorAccess)/halfLife)) × loadMs / sizeGiB` and evicting the lowest score until the new model fits. It cannot use future events.

This is a heuristic, not an optimal algorithm. It may be worse than LRU on changing workloads. Oversized models bypass residency without evicting existing models. The simulator enforces capacity after every request, and TTL is applied only at request boundaries. See [R2C protocol](WEIGHT_BUBBLE_R2C.md).
