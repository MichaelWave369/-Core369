# Φ Companion R0 | Can we reproduce the assistant *experience*?

## Purpose

This is an **independent local-assistant research sidecar** under ΦCore369, not a claim to replicate GPT-6 or any proprietary implementation. It decomposes three factors experimentally:

1. **Bare:** the same underlying local model with only a minimal helpfulness instruction.
2. **Profile:** the same model with an editable, explicit assistant persona and calibration rules.
3. **Memory:** the profile plus a few user-approved, locally stored, query-matched notes.

Each mode uses the same model, sampling temperature (`0`), and seed (`369`) to reduce some sources of variation. A fixed seed is not a guarantee of identical generation across backends or hardware. Conversational context can still differ; `/mode` resets the history for this reason. The `/compare` command does *not* append any comparison to history.

## Prerequisites

- Node.js 22+ and an installed local Ollama server (`http://127.0.0.1:11434`).
- A model listed by `ollama list`, for example `qwen3:4b` if installed. Using a larger model may exceed available VRAM or use CPU offload.
- No remote API key, cloud service, training data, GPU driver changes, or privileged setup are required.

~~~bash
npm install
ollama list
npm run assistant:chat -- --model=qwen3:4b
~~~

Inside the chat:

~~~text
/compare Explain the difference between RAM and VRAM in two sentences.
/mode memory
/remember My development environment runs Windows and I prefer local-first projects.
/memories
How would you set up a local coding assistant for my Windows machine?
/forget THE_ID_FROM_MEMORIES
/reset
/exit
~~~

The chat does not include file access, shell execution, internet browsing, system prompt extraction, or autonomous tooling. It does not automatically memorize or upload chat logs. `/remember` is the **only write path** for memory; the note remains local under `~/.phi369/assistant-memory.json` (Windows: the user's home directory). `/forget` removes one specific local note. Do not paste secrets or sensitive details into memory.

## Fixed evaluation

~~~bash
npm run assistant:eval -- --model=qwen3:4b
~~~

Nine sequential local requests (three task prompts × three modes). The JSON report is written to `benchmarks/assistant-r0.json`, ignored by Git. It records only fixed, synthetic eval prompts and responses. The supplied suite has no personal memories, so its `memory` branch should function like `profile`; this **cannot** evaluate memory usefulness. Use `/compare` with a known, explicitly saved note for a qualitative memory experiment.

The built-in checks assess only literal formatting, basic arithmetic, and a minimal tool-access disclaimer. Passing is **not evidence of GPT-6 parity, reasoning equivalence, consciousness, or comprehensive safety**. To make meaningful claims later, use a larger held-out task set with blinded human ratings, accuracy checks, model digest, latency, GPU telemetry, power, and reproducible run order.

## Threat boundaries

- The adapter rejects remote base URLs, credentials in URLs, non-HTTP schemes, and arbitrary URL paths. Local Ollama is contacted only at `/api/chat` on a loopback address.
- Memory is explicit, bounded, plain JSON, and kept outside the repo, with owner-only permissions where supported. An existing file is never silently reset if corrupt.
- Saved notes are treated as **lower-trust input**, not authority. Prompt injection is not solved by these measures; do not add unreviewed remote content or tools to this proof of concept.
- The assistant does not execute generated code or autonomously modify repositories.
- For further development, a future *separate*, permissioned tool layer could expose read-only workspace retrieval, then require explicit approval for any write or shell action.

## Where to take this next

1. **Capability eval:** create a controlled suite that compares candidate models on grounded coding, debugging, explanation, and uncertainty, not just friendly tone.
2. **Retrieval and provenance:** file/issue retrieval with citations, user-approved memory updates, project-level boundaries, and injection-resistant display.
3. **Tool permissions:** read-only-by-default GitHub and local file adapters, no credentials in model context, preview + approval for writes.
4. **Local fine-tune experiment:** only after the above shows failures that prompting and retrieval cannot fix; compare base vs LoRA on held-out tests.
5. **PhiOS/PhiRSI integration:** expose explicit permissioned interfaces; keep experiments auditable and reversible.

**Research rule:** measure real functionality, not personality impressions. Ledger above ego.
