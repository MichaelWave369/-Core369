# ΦCore369 Rung 2B: Ollama model-residency crossover

## What is real

Ollama exposes model preload/unload through an empty \`/api/generate\` prompt and \`keep_alive\`. Its \`/api/ps\` endpoint lists running models and their reported VRAM residency. R2B *actually calls those APIs on your local machine*, using an optional CLI with explicit execution consent.

This is an **application-level residency policy prototype**. It is not custom weight paging, a GPU kernel rewrite, a hardware scheduler, or a demonstrably more efficient inference engine.

## Safety and commands

Use Node.js 22 and a running local Ollama with an installed model.

~~~sh
# Read-only preflight (no unloading or inference)
node scripts/residency-bench.mjs --model qwen3:4b

# Confirm the server is idle, then opt in:
node scripts/residency-bench.mjs --model qwen3:4b --pairs 6 --execute --out benchmarks/residency-r2b.json
~~~

Use \`ollama list\` to find a real local model. The program intentionally refuses to run if any models are loaded initially, unless \`--allow-loaded\` is given. **Do not use \`--allow-loaded\` during other people's active Ollama sessions.** It may interrupt the selected model and trigger Ollama's automatic eviction behavior, even though this tool sends explicit unload commands only for the selected model. Original residency state is not restored.

The program refuses non-loopback network endpoints. It never downloads model weights, never stores generated text or prompt content, and never uploads reports. The JSON is ignored by git by default.

## Exact experiment

1. Verify selected model and immutable digest via \`/api/tags\`; log host and Ollama version.
2. Pick the same fixed prompt for both conditions in a pair. Assign order deterministically using a seeded pseudorandom sequence.
3. Before **every** condition, explicitly unload the named model and confirm absence in \`/api/ps\`.
4. **Cold:** send a normal streamed generation request with \`keep_alive: 0\`. Collect Ollama \`load_duration\`, \`total_duration\`, \`eval_duration\`, \`eval_count\`, and client-observed first-text latency.
5. **Preloaded:** send empty-prompt preload with \`keep_alive: "10m"\`; record wall-clock preloading cost, then verify \`/api/ps\` residency and reported \`size_vram\`. Send the *same* generation with \`keep_alive: "10m"\` and collect timings.
6. Unload the named model in a \`finally\` block. If cleanup fails, stop the experiment and inspect Ollama manually.
7. Repeat for at least five pairs. Record every failed attempt. Import the report into the browser lab and inspect per-pair variation, preloading cost, model loading cost, and first-text responsiveness.

**Important:** cold unload before every trial does **not** flush operating-system page caches. Thus "cold" means "not resident according to Ollama", not first boot from physical storage. Multiple model versions or background sessions can invalidate causal interpretation.

## Interpretation

Preloading can reduce response latency at the moment a user arrives by paying model loading cost earlier. That is not a free compute speedup: the preloading stage consumes time, RAM/VRAM, energy, and may reduce memory available to other models. The dashboard shows "request plus preloading" and request-only medians to expose this tradeoff.

R2B does **not** measure energy, model output correctness, VRAM peaks, CPU usage, OS page cache, server queueing, confidence intervals, or net throughput improvements over other runtimes. \`size_vram\` is an Ollama snapshot, not a high-watermark measurement. Generated text is discarded, so output-quality equivalence cannot be proven. The approach is an exploratory control experiment, not conclusive evidence of an optimization.

## Report contract

Schema: \`phicore369.residency.v1\`. Source: \`measured-ollama-residency-local\`.

Manifest: experiment UUID, UTC timestamp, engine/version, model/digest, hardware, options, pair count, prompt SHA-256 values, original loaded count, seeded condition order. Trials: pair, condition, prompt ID/hash, success or failure, engine timings, first-text latency, preload time, residency confirmation and reported VRAM bytes.

The frontend parses bounded JSON locally without a cloud backend. Invalid or fabricated metadata cannot be authenticated by a webpage; treat imported measurements as user-supplied evidence.

## Rung 2C proposal

With repeatable baseline measurements, build a workload-aware model residency controller using an explicit memory budget, predictable admission/eviction, and a trace-driven simulator before testing it on live Ollama. A production weight-bubble needs quality and energy gates, not just shorter median request time.

Official API references:
- https://docs.ollama.com/faq
- https://docs.ollama.com/api/generate
- https://docs.ollama.com/api/ps
