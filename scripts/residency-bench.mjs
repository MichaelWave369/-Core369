#!/usr/bin/env node
/*
 * ΦCore369 R2B. Explicitly opted-in cold-vs-preloaded Ollama crossover.
 * This controls ONLY the named local Ollama model via keep_alive and empty
 * prompt preload/unload; the server itself may evict other models.
 * NO model downloads, NO untrusted script execution, NO cloud writes.
 */
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PROMPTS, deviceInfo, streamGenerate, parseArgs as parseBaselineArgs } from './ollama-bench.mjs';
import { RESIDENCY_SCHEMA } from '../src/residency.js';

const digest = s => createHash('sha256').update(s).digest('hex');
const validInt = (value, name, minimum, maximum) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < minimum || n > maximum) {
    throw Error(name + ' must be an integer between ' + minimum + ' and ' + maximum);
  }
  return n;
};

export function parseResidencyArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  const args = {
    model: '', pairs: 6, numCtx: 4096, numPredict: 96, seed: 369,
    timeout: 240000, url: 'http://127.0.0.1:11434',
    output: 'benchmarks/residency-r2b.json', execute: false, allowLoaded: false
  };
  const options = {
    '--model': 'model', '--pairs': 'pairs', '--num-ctx': 'numCtx',
    '--num-predict': 'numPredict', '--seed': 'seed', '--timeout': 'timeout',
    '--url': 'url', '--out': 'output'
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--execute') { args.execute = true; continue; }
    if (argv[i] === '--allow-loaded') { args.allowLoaded = true; continue; }
    const name = options[argv[i]];
    if (!name || i + 1 === argv.length || argv[i + 1].startsWith('--')) throw Error('Unknown or missing option: ' + argv[i]);
    args[name] = argv[++i];
  }
  args.pairs = validInt(args.pairs, '--pairs', 5, 30);
  args.numCtx = validInt(args.numCtx, '--num-ctx', 128, 131072);
  args.numPredict = validInt(args.numPredict, '--num-predict', 16, 2048);
  args.seed = validInt(args.seed, '--seed', 0, 2147483647);
  args.timeout = validInt(args.timeout, '--timeout', 1000, 3600000);
  // Reuse R2A's loopback URL and exact-model validation.
  parseBaselineArgs([
    '--model', args.model,
    '--runs', String(args.pairs),
    '--num-ctx', String(args.numCtx),
    '--num-predict', String(args.numPredict),
    '--seed', String(args.seed),
    '--timeout', String(args.timeout),
    '--url', args.url
  ]);
  args.url = new URL(args.url).origin;
  return args;
}

const HELP = [
  'ΦCore369 • R2B cold-vs-preloaded residency crossover',
  '',
  'Inspect only (default; no model changes):',
  ' node scripts/residency-bench.mjs --model qwen3:4b',
  '',
  'Run with explicit permission to temporarily unload/preload the named model:',
  ' node scripts/residency-bench.mjs --model qwen3:4b --pairs 6 --execute',
  '',
  'Options: --model, --pairs 5..30, --num-ctx, --num-predict, --seed,',
  ' --timeout, --url (loopback only), --out, --execute, --allow-loaded',
  '',
  'Safety: default requires Ollama to have NO loaded models; --allow-loaded',
  ' acknowledges the risk that Ollama may evict or alter running models.',
  ' Any originally resident target will NOT be restored after an experiment.',
  ' Run only when you can safely interrupt that model.'
].join('\n');

async function getJson(url, timeout = 15000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw Error('Ollama GET ' + url.split('/').pop() + ' HTTP ' + response.status);
  return response.json();
}
async function postJson(url, body, timeout = 240000) {
  const response = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(timeout)
  });
  if (!response.ok) throw Error('Ollama POST HTTP ' + response.status);
  const result = await response.json();
  if (result.error) throw Error('Ollama: ' + String(result.error).slice(0, 240));
  return result;
}
const findModel = (ps, model) =>
  (Array.isArray(ps?.models) ? ps.models : []).find(item => item.name === model || item.model === model);
const modelList = ps => Array.isArray(ps?.models) ? ps.models : [];

export async function inspectResidency(config, dependencies = {}) {
  const get = dependencies.getJson || getJson;
  const [tags, version, ps] = await Promise.all([
    get(config.url + '/api/tags'),
    get(config.url + '/api/version'),
    get(config.url + '/api/ps')
  ]);
  const selected = (tags.models || []).find(x => x.name === config.model || x.model === config.model);
  if (!selected || !/^[0-9a-f]{64}$/i.test(selected.digest || '')) {
    throw Error('Model and SHA-256 digest not found. Check "ollama list"; this tool does not pull models.');
  }
  return {
    modelDigest: selected.digest,
    modelBytes: selected.size ?? null,
    version: String(version.version || 'unknown'),
    loadedModels: modelList(ps).map(x => ({ name: x.name || x.model, digest: x.digest || null, sizeVramBytes: x.size_vram ?? null })),
    alreadyResident: !!findModel(ps, config.model)
  };
}

function seedRandom(seed) {
  let state = (seed || 369) >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function conditionOrders(count, seed) {
  const rand = seedRandom(seed);
  return Array.from({ length: count }, () => rand() < 0.5 ? ['cold', 'preloaded'] : ['preloaded', 'cold']);
}

export async function collectResidency(config, deps = {}) {
  if (!config.execute) throw Error('Use --execute to authorize model unload/preload and inference');
  const inspect = deps.inspect || inspectResidency;
  const post = deps.postJson || postJson;
  const get = deps.getJson || getJson;
  const generate = deps.generate || streamGenerate;
  const log = deps.log || console.log;
  const now = deps.now || (() => performance.now());
  const preflight = await inspect(config, deps);
  if (preflight.loadedModels.length && !config.allowLoaded) {
    throw Error('Refusing to change a busy Ollama server. Unload running models first or explicitly use --allow-loaded.');
  }
  const options = { num_ctx: config.numCtx, num_predict: config.numPredict, seed: config.seed, temperature: 0 };
  const manifest = {
    experimentId: randomUUID(),
    utc: new Date().toISOString(),
    backend: 'ollama',
    backendVersion: preflight.version,
    model: config.model,
    modelDigest: preflight.modelDigest,
    modelSizeBytes: preflight.modelBytes,
    hardware: (deps.deviceInfo || deviceInfo)(),
    options,
    pairs: config.pairs,
    orderSeed: config.seed,
    promptHashes: PROMPTS.map(p => digest(p.text)),
    initialLoadedModels: preflight.loadedModels.length,
    initiallyResident: preflight.alreadyResident,
    keepAliveWarm: '10m',
    keepAliveCold: 0,
    limitation: 'Prewarm time and accelerator memory occupation are costs. Only Ollama-managed model residency is controlled. Output quality, energy and RAM peaks are not evaluated.'
  };
  const trials = [];
  const call = async (body) => post(config.url + '/api/generate', { model: config.model, stream: false, ...body }, config.timeout);
  const unload = () => call({ prompt: '', keep_alive: 0 });
  const orders = conditionOrders(config.pairs, config.seed);
  for (let pairIndex = 0; pairIndex < config.pairs; pairIndex++) {
    const prompt = PROMPTS[pairIndex % PROMPTS.length];
    for (const condition of orders[pairIndex]) {
      const core = {
        pair: pairIndex + 1, condition,
        promptId: prompt.id, promptSha256: digest(prompt.text),
        startedUtc: new Date().toISOString()
      };
      const warm = condition === 'preloaded';
      let preloadMs = 0;
      let residentBeforeGeneration = false;
      let sizeVramBytes = null;
      log('Pair ' + core.pair + '/' + config.pairs + ' • ' + condition + ' • ' + prompt.id);
      try {
        // Unload only our explicitly named model before EVERY trial, even when
        // it was left resident from a previous warm trial.
        await unload();
        const cleared = await get(config.url + '/api/ps');
        if (findModel(cleared, config.model)) throw Error('Target still resident after explicit unload; cannot guarantee cold start.');
        if (warm) {
          const started = now();
          await call({ prompt: '', keep_alive: '10m' });
          preloadMs = Math.max(.001, now() - started);
          const ps = await get(config.url + '/api/ps');
          const resident = findModel(ps, config.model);
          if (!resident) throw Error('Preload requested but model is absent from /api/ps');
          residentBeforeGeneration = true;
          if (typeof resident.size_vram === 'number' && Number.isFinite(resident.size_vram) && resident.size_vram >= 0) sizeVramBytes = resident.size_vram;
        }
        const result = await generate(config.url, {
          model: config.model, prompt: prompt.text, options,
          keep_alive: warm ? '10m' : 0
        }, config.timeout);
        if (result.clientTtftMs === null || result.clientTtftMs === undefined) {
          throw Error('No first-text latency reported; trial cannot be compared');
        }
        trials.push({
          ...core, ok: true, ...result,
          preloadMs, residentBeforeGeneration, sizeVramBytes
        });
      } catch (error) {
        trials.push({ ...core, ok: false, error: error instanceof Error ? error.message.slice(0, 450) : 'unknown error' });
      } finally {
        // Do not leave this tool's named model warm. If this fails, stop
        // the experiment; manual recovery may be required.
        await unload().catch(error => {
          throw Error('Cleanup/unload failed; aborting experiment: ' + error.message);
        });
      }
    }
  }
  return { schema: RESIDENCY_SCHEMA, source: 'measured-ollama-residency-local', manifest, trials };
}

export async function main(argv = process.argv.slice(2)) {
  const config = parseResidencyArgs(argv);
  if (config.help) { console.log(HELP); return; }
  const preflight = await inspectResidency(config);
  console.log('Model: ' + config.model + ' | Ollama: ' + preflight.version);
  console.log('Currently resident: ' + (preflight.alreadyResident ? 'yes' : 'no'));
  console.log('Loaded models: ' + preflight.loadedModels.map(x => x.name).join(', ') || '(none)');
  if (!config.execute) {
    console.log('\nDRY RUN. No changes made. Add --execute to perform ' + (config.pairs * 2) + ' trials.');
    console.log('WARNING: execution temporarily unloads and preloads this model, and Ollama may evict other models.');
    return;
  }
  const report = await collectResidency(config);
  await mkdir(dirname(resolve(config.output)), { recursive: true });
  await writeFile(resolve(config.output), JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log('Saved ' + resolve(config.output));
  const count = report.trials.filter(t => t.ok).length;
  console.log('Successful trials: ' + count + '/' + report.trials.length);
  if (count !== report.trials.length) process.exitCode = 1;
  console.log('Import JSON into the R2B residency section of the ΦCore369 web lab.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error('Residency experiment failed: ' + error.message); process.exitCode = 1; });
}
