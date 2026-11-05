/*
 * ΦCore369 R2B: bounded, browser-safe validation of imported local
 * cold-vs-preloaded model residency experiments. Not an optimized inference engine.
 */
import { median } from './measurements.js';

export const RESIDENCY_SCHEMA = 'phicore369.residency.v1';
const validNumber = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const allowed = new Set(['cold', 'preloaded']);

export function validateResidencyReport(r) {
  const fail = message => { throw new Error('Invalid residency report: ' + message); };
  if (!r || typeof r !== 'object' || Array.isArray(r)) fail('root');
  if (r.schema !== RESIDENCY_SCHEMA || r.source !== 'measured-ollama-residency-local') fail('schema/source');
  const m = r.manifest;
  if (!m || m.backend !== 'ollama' || typeof m.model !== 'string' || !m.model || m.model.length > 256) fail('model');
  if (typeof m.modelDigest !== 'string' || !/^[a-f0-9]{64}$/i.test(m.modelDigest)) fail('model digest');
  if (typeof m.backendVersion !== 'string' || !m.backendVersion) fail('Ollama version');
  if (!m.hardware || typeof m.hardware.os !== 'string' || typeof m.hardware.cpu !== 'string') fail('hardware');
  if (!m.options || !Number.isInteger(m.options.num_ctx) || !Number.isInteger(m.options.num_predict)) fail('options');
  if (!Number.isInteger(m.pairs) || m.pairs < 1 || m.pairs > 30) fail('pair count');
  if (!Array.isArray(m.promptHashes) || m.promptHashes.length !== 3 ||
    !m.promptHashes.every(h => typeof h === 'string' && /^[0-9a-f]{64}$/i.test(h))) fail('prompt hashes');
  if (typeof m.initialLoadedModels !== 'number' || m.initialLoadedModels < 0 || m.initialLoadedModels > 1000) fail('preflight');
  if (!Array.isArray(r.trials) || r.trials.length !== m.pairs * 2 || r.trials.length > 60) fail('trial count');
  const seen = new Set();
  for (const t of r.trials) {
    if (!t || !Number.isInteger(t.pair) || t.pair < 1 || t.pair > m.pairs || !allowed.has(t.condition)) fail('condition');
    const key = t.pair + ':' + t.condition;
    if (seen.has(key)) fail('duplicate condition');
    seen.add(key);
    if (typeof t.promptId !== 'string' || !['explain', 'reason', 'code'].includes(t.promptId)) fail('prompt ID');
    if (typeof t.ok !== 'boolean') fail('success status');
    if (t.ok) {
      for (const field of ['totalSeconds', 'loadSeconds', 'decodeTokensPerSec', 'generatedTokens', 'clientTtftMs', 'preloadMs']) {
        if (!validNumber(t[field])) fail(field + ' invalid');
      }
      if (t.generatedTokens <= 0) fail('generated tokens');
      if (t.condition === 'cold' && t.preloadMs !== 0) fail('cold trial cannot preload');
      if (t.condition === 'preloaded' && (!t.residentBeforeGeneration || t.preloadMs <= 0)) fail('preload not confirmed');
      if (t.sizeVramBytes !== null && !validNumber(t.sizeVramBytes)) fail('VRAM metadata');
    } else if (typeof t.error !== 'string' || t.error.length > 500) fail('failure description');
  }
  return r;
}

const stats = trials => ({
  attempted: trials.length,
  successful: trials.filter(t => t.ok).length,
  failures: trials.filter(t => !t.ok).length,
  ttftMedianMs: median(trials.filter(t => t.ok).map(t => t.clientTtftMs)),
  engineLatencyMedianSec: median(trials.filter(t => t.ok).map(t => t.totalSeconds)),
  loadMedianSec: median(trials.filter(t => t.ok).map(t => t.loadSeconds)),
  decodeMedian: median(trials.filter(t => t.ok).map(t => t.decodeTokensPerSec)),
  preloadMedianMs: median(trials.filter(t => t.ok).map(t => t.preloadMs)),
  totalIncludingPreloadMedianSec: median(trials.filter(t => t.ok).map(t => t.totalSeconds + t.preloadMs / 1000)),
  sizeVramMedianGiB: median(trials.filter(t => t.ok && t.sizeVramBytes !== null).map(t => t.sizeVramBytes / 1073741824))
});

export function summarizeResidency(r) {
  validateResidencyReport(r);
  const cold = r.trials.filter(t => t.condition === 'cold');
  const warm = r.trials.filter(t => t.condition === 'preloaded');
  const paired = [];
  for (let pair = 1; pair <= r.manifest.pairs; pair++) {
    const c = cold.find(t => t.pair === pair);
    const w = warm.find(t => t.pair === pair);
    if (c?.ok && w?.ok) paired.push({
      pair, promptId: c.promptId,
      coldTtftMs: c.clientTtftMs, warmTtftMs: w.clientTtftMs,
      ttftSavedMs: c.clientTtftMs - w.clientTtftMs,
      coldEngineSec: c.totalSeconds, warmEngineSec: w.totalSeconds,
      prewarmMs: w.preloadMs,
      coldLoadSec: c.loadSeconds, warmLoadSec: w.loadSeconds
    });
  }
  return {
    cold: stats(cold),
    preloaded: stats(warm),
    paired,
    pairedCount: paired.length,
    ttftSavedMedianMs: median(paired.map(p => p.ttftSavedMs)),
    enoughPairs: paired.length >= 5 && cold.every(t => t.ok) && warm.every(t => t.ok),
    caveat: 'Measures latency relocation via Ollama preloading, not new compute or reduced total work. Cache state, thermal drift, output correctness and energy are unmeasured.'
  };
}
