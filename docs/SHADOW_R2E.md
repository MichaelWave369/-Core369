# ΦCore369 Rung 2E: consented local sessions + non-invasive policy shadowing

## What this rung does

R2E adds a foreground, explicitly started, local-only Ollama prompt client and a dashboard that contrasts actual user-entered inference requests (token counts, engine load times, client-observed first-text latency, order) against LRU and Φ policy replays. These **counterfactual policy estimates** use profile data from prior R2D isolated-model calibration.

**This is not a live scheduler.** It never automatically preloads, unloads or evicts models, intercepts other Ollama clients, sets keep_alive or changes system state beyond the prompts voluntarily sent by the operator. No measured Φ speedup is claimed.

## Requirements

Use Node 22+ and local Ollama with at least two already installed models. First create R2D calibrated profiles from two completed and compatible isolated R2B reports. See CALIBRATION_R2D.md. The R2D profile file is expected at benchmarks/r2d-calibrated.json.

The foreground client refuses to send prompts unless the installed model digests, Ollama version and host identity (OS, CPU, GPU name) match the calibration. No model downloads, unsafe override or auto repair.

Without --execute the tool only checks the local JSON file and never contacts Ollama.

## Preview, then opt into interactive inference

~~~powershell
# Read-only setup validation, no Ollama request
node scripts/shadow-session.mjs --profiles benchmarks/r2d-calibrated.json --model qwen3:4b

# Explicitly opt in to foreground prompts
node scripts/shadow-session.mjs --profiles benchmarks/r2d-calibrated.json --model qwen3:4b --execute --budget-gib 12 --max-requests 20
~~~

Inside the session, type a prompt normally, or use:

- /model gemma3:12b: switch only to an installed and calibrated allowlisted model
- /status: read-only GET of Ollama /api/ps loaded model list
- /help: print supported commands
- /quit: stop and save metadata to benchmarks/r2e-shadow-session.json

Each manually submitted prompt triggers one streamed POST to loopback /api/generate with calibrated options. No keep_alive override, scheduled activity or interception. The normal Ollama runtime controls loading and eviction, not Φ. Existing sessions in unrelated applications are NOT monitored, even though resource contention from them may affect measurements.

## Privacy and persistence

The report contains session UUID, timestamps, machine and engine metadata, model identifiers/digests, derived R2D profiles and request records with model name, arrival offset, success/failure, engine timings, output-token count and client-observed first-text time.

The program never saves prompt text, model output, prompt hashes, conversational history, tokens of output or credentials in that report. It displays generated text only in the local terminal. Ollama and any terminal recording tools external to this project have their own data practices. Do not enter sensitive secrets; hardware and model metadata may be identifying.

Files under benchmarks/ are gitignored. The public React dashboard accepts files explicitly selected in the browser and does not call the local Ollama endpoint or upload to a service.

## Shadow replay interpretation

The simulator uses actual foreground submission timestamps and successfully completed model choices. Profile sizes and cold-load times are derived from earlier isolated R2B measurements. The replay estimates LRU and Φ reload cost under an assumed budget.

**The actual Ollama requests were served by Ollama's existing policy, not by LRU or Φ.** A lower simulated reload cost is not an observed acceleration, quality improvement or energy saving.

Failed requests remain recorded but are omitted from policy replay, since R2C models successfully served requests. This introduces a selection effect. Other limits: single sequential client, unknown GPU contention and KV/activation allocations, timing drift, context effects, output correctness, model placement, throughput, energy and operating-system cache conditions. No causal A/B outcome is established.

A changed budget slider changes only hypothetical replay and cannot control physical VRAM.

## R2F safety gates for actual scheduling

1. A separate disposable Ollama instance or isolated test host.
2. Strict named-model allowlist, default dry-run, consent, memory headroom and timeouts.
3. Auditable actions, explicit rollback and kill switch.
4. Matched real workload A/B experiments, model correctness, energy and memory telemetry.
5. Stop rules for instability or interference.
6. Human review before enabling ANY automated model eviction.

R2E is evidence collection and shadow decision support, not autonomous control.
