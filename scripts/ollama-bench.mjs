#!/usr/bin/env node
/*
 * ΦCore369 R2A. Local Ollama measurements only.
 * This tool never downloads models, uploads prompts, or executes model output.
 * Requires Node.js 20.19+ / 22+. No npm dependencies.
 */
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { REPORT_SCHEMA } from '../src/measurements.js';

export const PROMPTS = Object.freeze([
  { id: 'explain', text: 'Explain in plain English why model decoding can be memory-bandwidth bound. Use a concise paragraph.' },
  { id: 'reason', text: 'A device has 12 GiB of VRAM and a 5 GiB model weight set. If the attention KV cache uses 4 GiB and runtime overhead is 1 GiB, how much free VRAM remains? Show arithmetic.' },
  { id: 'code', text: 'Write a Python function that returns the median of a nonempty list of numbers. Include one simple example call.' }
]);

const nsToSec = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n / 1e9 : 0;
const hash = text => createHash('sha256').update(text).digest('hex');
const safeInt = (input, name, lo, hi) => {
  const n = Number(input);
  if (!Number.isSafeInteger(n) || n < lo || n > hi) throw new Error(name + ' must be an integer from ' + lo + ' to ' + hi);
  return n;
};

export function parseArgs(argv) {
  const out = { model: '', runs: 6, warmup: 1, numCtx: 4096, numPredict: 128, seed: 369, timeout: 240000, url: 'http://127.0.0.1:11434', output: 'benchmarks/local-baseline.json' };
  const keys = {
    '--model': 'model', '--runs': 'runs', '--warmup': 'warmup', '--num-ctx': 'numCtx',
    '--num-predict': 'numPredict', '--seed': 'seed', '--timeout': 'timeout',
    '--url': 'url', '--out': 'output'
  };
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  for (let i = 0; i < argv.length; i++) {
    const key = keys[argv[i]];
    if (!key) throw new Error('Unknown option: ' + argv[i]);
    if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new Error('Missing value for ' + argv[i]);
    out[key] = argv[++i];
  }
  if (!out.model || typeof out.model !== 'string' || out.model.length > 200) throw new Error('Provide a local model with --model, for example qwen3:4b');
  out.runs = safeInt(out.runs, '--runs', 5, 200);
  out.warmup = safeInt(out.warmup, '--warmup', 0, 10);
  out.numCtx = safeInt(out.numCtx, '--num-ctx', 128, 131072);
  out.numPredict = safeInt(out.numPredict, '--num-predict', 16, 2048);
  out.seed = safeInt(out.seed, '--seed', 0, 2147483647);
  out.timeout = safeInt(out.timeout, '--timeout', 1000, 3600000);
  const url = new URL(out.url);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Ollama URL must be plain HTTP on localhost, 127.0.0.1, or [::1] without credentials or a path');
  }
  out.url = url.origin;
  return out;
}

const HELP = [
  'ΦCore369 • Ollama local benchmark (Rung 2A)',
  '',
  'node scripts/ollama-bench.mjs --model qwen3:4b --runs 6 --out benchmarks/local-baseline.json',
  '',
  '--model        Existing local Ollama model (required)',
  '--runs         Recorded runs (5–200, default 6)',
  '--warmup       Unrecorded warmup runs (0–10, default 1)',
  '--num-ctx      Requested context length (default 4096)',
  '--num-predict  Generation limit (default 128)',
  '--seed         Fixed seed (default 369)',
  '--timeout      Per-request milliseconds (default 240000)',
  '--url          Loopback Ollama endpoint (default http://127.0.0.1:11434)',
  '--out          Local JSON output path',
  '',
  'Requires Ollama already running with the model pulled. Does not store prompt text or generated output.'
].join('\n');

async function fetchJson(url, init = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Ollama metadata request failed: HTTP ' + response.status);
  return response.json();
}

export function deviceInfo() {
  let gpu = null;
  try {
    const raw = execFileSync('nvidia-smi',
      ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader,nounits'],
      { encoding: 'utf8', timeout: 4500, windowsHide: true }).trim().split(/\r?\n/)[0];
    const parts = raw.split(',').map(s => s.trim());
    if (parts.length === 3) gpu = { name: parts[0], totalMiB: Number(parts[1]) || null, driver: parts[2] };
  } catch { /* GPU metadata optional; never block a run */ }
  return {
    os: os.platform() + ' ' + os.release() + ' (' + os.arch() + ')',
    cpu: os.cpus()[0]?.model || 'unknown',
    logicalCpus: os.cpus().length,
    ramGiB: Number((os.totalmem() / 1073741824).toFixed(2)),
    gpu
  };
}

export async function streamGenerate(baseUrl, body, timeoutMs = 240000) {
  const start = performance.now();
  const response = await fetch(baseUrl + '/api/generate', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, stream: true }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok || !response.body) throw new Error('Ollama generation HTTP ' + response.status);
  const decoder = new TextDecoder();
  let buffer = '';
  let final = null;
  let clientTtftMs = null;
  const consume = line => {
    if (!line.trim()) return;
    const msg = JSON.parse(line);
    if (msg.error) throw new Error('Ollama reported an error: ' + String(msg.error).slice(0, 200));
    if (clientTtftMs === null && typeof msg.response === 'string' && msg.response.length > 0) {
      clientTtftMs = performance.now() - start;
    }
    if (msg.done) final = msg;
  };
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    if (buffer.length > 2_000_000) throw new Error('Ollama streamed an excessive unparsed line');
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      consume(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) consume(buffer);
  if (!final) throw new Error('Ollama stream ended without final metrics');
  const generatedTokens = final.eval_count;
  if (!Number.isFinite(generatedTokens) || generatedTokens <= 0 || !(final.eval_duration > 0)) {
    throw new Error('Ollama did not return valid positive decode metrics');
  }
  const promptTokens = final.prompt_eval_count ?? 0;
  const promptCachedTokens = final.prompt_eval_cached_count ?? 0;
  const promptUncachedTokens = Math.max(0, promptTokens - promptCachedTokens);
  return {
    promptTokens,
    promptCachedTokens,
    promptUncachedTokens,
    generatedTokens,
    promptSeconds: nsToSec(final.prompt_eval_duration),
    decodeSeconds: nsToSec(final.eval_duration),
    totalSeconds: nsToSec(final.total_duration),
    loadSeconds: nsToSec(final.load_duration),
    promptTokensPerSec: final.prompt_eval_duration > 0 ? promptUncachedTokens * 1e9 / final.prompt_eval_duration : 0,
    decodeTokensPerSec: generatedTokens * 1e9 / final.eval_duration,
    clientTtftMs: clientTtftMs === null ? null : Number(clientTtftMs.toFixed(2)),
    doneReason: typeof final.done_reason === 'string' ? final.done_reason : null
  };
}

export async function collect(config, deps = {}) {
  const getMeta = deps.fetchJson || fetchJson;
  const generate = deps.generate || streamGenerate;
  const device = deps.deviceInfo || deviceInfo;
  const log = deps.log || console.log;
  const [tags, version] = await Promise.all([
    getMeta(config.url + '/api/tags'),
    getMeta(config.url + '/api/version')
  ]);
  const selected = (tags.models || []).find(m => m.name === config.model || m.model === config.model);
  if (!selected || !/^[0-9a-f]{64}$/i.test(selected.digest || '')) {
    throw new Error('Exact local model and digest not found. Run "ollama list" and use its model name.');
  }
  const options = { num_ctx: config.numCtx, num_predict: config.numPredict, seed: config.seed, temperature: 0 };
  const manifest = {
    runId: randomUUID(),
    utc: new Date().toISOString(),
    backend: 'ollama',
    backendVersion: String(version.version || 'unknown'),
    model: config.model,
    modelDigest: selected.digest,
    modelSizeBytes: selected.size ?? null,
    hardware: device(),
    options,
    promptIds: PROMPTS.map(p => p.id),
    promptHashes: PROMPTS.map(p => hash(p.text)),
    repetitions: config.runs,
    warmup: config.warmup,
    note: 'Streaming Ollama API metrics; client TTFT is first visible text after POST, not an engine-side TTFT. Power/VRAM utilization not measured.'
  };
  const runs = [];
  const body = prompt => ({ model: config.model, prompt: prompt.text, options, keep_alive: '10m' });
  for (let i = 0; i < config.warmup; i++) {
    log('Warmup ' + (i + 1) + '/' + config.warmup);
    await generate(config.url, body(PROMPTS[i % PROMPTS.length]), config.timeout);
  }
  for (let i = 0; i < config.runs; i++) {
    const prompt = PROMPTS[i % PROMPTS.length];
    const core = { sequence: i + 1, promptId: prompt.id, promptSha256: hash(prompt.text), startedUtc: new Date().toISOString() };
    log('Measure ' + (i + 1) + '/' + config.runs + ' • ' + prompt.id);
    try {
      runs.push({ ...core, ok: true, ...await generate(config.url, body(prompt), config.timeout) });
    } catch (error) {
      runs.push({ ...core, ok: false, error: error instanceof Error ? error.message.slice(0, 250) : 'unknown error' });
    }
  }
  return { schema: REPORT_SCHEMA, source: 'measured-ollama-local', manifest, runs };
}

export async function main(argv = process.argv.slice(2)) {
  const config = parseArgs(argv);
  if (config.help) { console.log(HELP); return; }
  const report = await collect(config);
  const path = resolve(config.output);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(report, null, 2) + '\n', { encoding: 'utf8' });
  const ok = report.runs.filter(r => r.ok);
  console.log('\nSaved ' + path);
  console.log('Successful: ' + ok.length + '/' + report.runs.length);
  if (ok.length < 5) process.exitCode = 1;
  console.log('Import the JSON into the ΦCore369 Measurement Lab in your browser.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error('Benchmark failed:', error.message); process.exitCode = 1; });
}
