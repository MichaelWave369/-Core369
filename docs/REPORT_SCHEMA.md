# ΦCore369 Measurement Report v1

Schema identifier: phicore369.measurement.v1

This is a local Ollama benchmark report, **not evidence of a new accelerator or weight-bubble optimization**.

## Provenance

- source: measured-ollama-local
- manifest.runId, utc: identifier and timestamp for the session
- manifest.backend, backendVersion: engine and reported version
- manifest.model, modelDigest, modelSizeBytes: name and local model identity from /api/tags
- manifest.hardware: OS, CPU, RAM and optional Nvidia GPU/driver metadata
- manifest.options: num_ctx, num_predict, seed and temperature requested by client
- manifest.promptIds, promptHashes: fixed prompt IDs and SHA-256 digests, not plaintext
- manifest.repetitions, warmup: successful or failed sample count intent, unrecorded warmups

## Per-run metrics

- sequence and promptId (one of fixed prompt IDs)
- promptSha256 and startedUtc
- ok and error on failure (error is a short diagnostic)
- generatedTokens, promptTokens
- promptSeconds and decodeSeconds from Ollama nanosecond counters
- promptTokensPerSec and decodeTokensPerSec derived from Ollama counters
- totalSeconds and loadSeconds from Ollama
- clientTtftMs: elapsed wall time between POST and the first stream chunk with visible generated text
- doneReason

Client-observed time to first token includes network loopback, queuing and prefill. It is NOT Ollama internal time-to-first-token. Prompt token throughput is not well-defined for a fully cached prompt; zero prompt duration yields a zero/unknown-safe value, not infinite speed.

## What is not collected

Output content, prompt plaintext, energy draw, accelerator VRAM peaks, GPU utilization, correctness scores, accuracy or genuine hardware memory-transfer activity. Treat these as **unknown**, not zero.

The benchmark tool contacts only a loopback Ollama URL; it never downloads models or uploads data. The GitHub Pages visualization loads report JSON into browser memory without making network requests. Do not commit unreviewed reports if your host metadata is sensitive.

## Controlled repeat comparison

Two imported reports may be compared only when the digest, engine version, hardware, options, prompt IDs, prompt hashes, repeat balance and a minimum of five successful runs match.

An observed percentage difference between two repeated runs of identical settings is **sampling variation**, not proof of improved architecture. Inference optimizations require explicit experimental controls, output quality checks, telemetry, and repeated results.
