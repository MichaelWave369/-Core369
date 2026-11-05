/*
 * ΦCore369 R2E: analyze user-consented local Ollama session metadata.
 * No model controller. The shadow policy NEVER changes real residency.
 * R2D profiles contain measured *inputs*, replay still assumes independent loads.
 */
import { CALIBRATION_SCHEMA } from './calibration.js';
import { TRACE_SCHEMA, validateWorkload, comparePolicies, validateReplayOptions } from './weightbubble.js';
import { median } from './measurements.js';

export const SHADOW_SCHEMA = 'phicore369.shadow-session.v1';
export const SHADOW_SOURCE = 'consented-foreground-ollama';
const MAX_RECORDS = 120;
const finite = n => typeof n === 'number' && Number.isFinite(n);
const nonneg = n => finite(n) && n >= 0;
const h64 = /^[a-f0-9]{64}$/i;

export function validateCalibrationForShadow(calibration) {
  const fail = s => { throw Error('Invalid R2D profile: ' + s); };
  if (!calibration || typeof calibration !== 'object' || calibration.schema !== CALIBRATION_SCHEMA ||
    calibration.source !== 'derived-r2b-calibration') fail('schema/source');
  const m = calibration.manifest;
  if (!m || m.backend !== 'ollama' || typeof m.backendVersion !== 'string' || !m.backendVersion ||
    !m.hardware || typeof m.hardware.cpu !== 'string' || typeof m.hardware.os !== 'string' ||
    !m.generationOptions || !Number.isSafeInteger(m.generationOptions.num_ctx) ||
    !Number.isSafeInteger(m.generationOptions.num_predict) ||
    m.generationOptions.num_ctx < 128 || m.generationOptions.num_ctx > 131072 ||
    m.generationOptions.num_predict < 16 || m.generationOptions.num_predict > 2048 ||
    m.generationOptions.temperature !== 0 || !Number.isSafeInteger(m.generationOptions.seed) ||
    m.generationOptions.seed < 0 || m.generationOptions.seed > 2147483647) fail('manifest metadata');
  if (!Array.isArray(m.sourceReports) || m.sourceReports.length < 2 || m.sourceReports.length > 30) fail('model report count');
  const trace = validateWorkload(calibration.trace);
  const ids = new Set();
  const names = new Set();
  const profiles = m.sourceReports.map(source => {
    if (!source || typeof source.model !== 'string' || source.model.length > 256 || !source.model ||
        typeof source.id !== 'string' || !h64.test(source.modelDigest || '')) fail('model provenance');
    if (ids.has(source.id) || names.has(source.model)) fail('duplicate models');
    ids.add(source.id); names.add(source.model);
    const model = trace.models.find(item => item.id === source.id);
    if (!model) return null; // Calibrations may have unused source reports.
    return {
      model: source.model, id: source.id, digest: source.modelDigest,
      sizeGiB: model.sizeGiB, loadMs: model.loadMs, inferMs: model.inferMs
    };
  }).filter(Boolean);
  if (!profiles.length) fail('no usable profiles');
  if (trace.models.length !== profiles.length) fail('model profile mismatch');
  const modelIds = new Set(trace.models.map(x => x.id));
  if (modelIds.size !== profiles.length || [...modelIds].some(x => !ids.has(x))) fail('unknown model ID');
  return {
    hardware: m.hardware,
    backendVersion: m.backendVersion,
    options: m.generationOptions,
    profiles
  };
}

export function validateShadowReport(report) {
  const fail = s => { throw Error('Invalid R2E shadow report: ' + s); };
  if (!report || typeof report !== 'object' || report.schema !== SHADOW_SCHEMA ||
      report.source !== SHADOW_SOURCE) fail('schema/source');
  const manifest = report.manifest;
  if (!manifest || typeof manifest.sessionId !== 'string' || !manifest.sessionId ||
      manifest.mode !== 'foreground-operator-consented' || typeof manifest.startedUtc !== 'string' ||
      !Number.isFinite(Date.parse(manifest.startedUtc)) ||
      !manifest.hardware || typeof manifest.hardware.cpu !== 'string' ||
      typeof manifest.backendVersion !== 'string') fail('manifest');
  if (!Array.isArray(report.profiles) || !report.profiles.length || report.profiles.length > 30) fail('profiles');
  const ids = new Set(), modelNames = new Set();
  for (const m of report.profiles) {
    if (!m || !/^[\w.:-]{1,64}$/.test(m.id || '') ||
        typeof m.model !== 'string' || !m.model ||
        !h64.test(m.digest || '') || ids.has(m.id) || modelNames.has(m.model) ||
        !finite(m.sizeGiB) || m.sizeGiB < .01 || m.sizeGiB > 2048 ||
        !finite(m.loadMs) || m.loadMs < 1 || m.loadMs > 3600000 ||
        !nonneg(m.inferMs)) fail('model identity or metric');
    ids.add(m.id);modelNames.add(m.model);
  }
  const settings = validateReplayOptions(manifest.replayOptions);
  if (!Array.isArray(report.records) || report.records.length > MAX_RECORDS) fail('records length');
  let prev=-1;
  for (const [i,r] of report.records.entries()) {
    if (!r || r.sequence !== i+1 || !Number.isSafeInteger(r.atMs) ||
      r.atMs<prev || r.atMs>2592000000 || !modelNames.has(r.model) ||
      typeof r.ok !== 'boolean' || 'prompt' in r || 'response' in r ||
      'messages' in r || 'text' in r) fail('record fields');
    prev=r.atMs;
    if (r.ok) {
      if (!nonneg(r.totalSeconds) || !nonneg(r.loadSeconds) || !nonneg(r.generatedTokens) ||
        !nonneg(r.decodeTokensPerSec) || !nonneg(r.clientTtftMs) ||
        r.generatedTokens <= 0) fail('successful record timings');
    } else if (typeof r.error !== 'string' || r.error.length > 240) fail('error metadata');
  }
  return report;
}

export function shadowComparison(report, override={}) {
  validateShadowReport(report);
  const successful = report.records.filter(r => r.ok);
  const profiles = report.profiles;
  const byName = new Map(profiles.map(p => [p.model, p]));
  const trace = {
    schema: TRACE_SCHEMA,
    name: 'Observed operator session • offline shadow replay',
    description: 'Actual request times and model choices from an explicitly started local session. Load and footprint estimates come from R2D isolated reports. No scheduling policy was applied live.',
    models: profiles.map(p => ({id:p.id, sizeGiB:p.sizeGiB,loadMs:p.loadMs,inferMs:p.inferMs})),
    requests: successful.map(r => ({atMs:r.atMs,model:byName.get(r.model).id}))
  };
  const opts = validateReplayOptions({...report.manifest.replayOptions,...override});
  const simulated = successful.length ? comparePolicies(validateWorkload(trace), opts) : null;
  return {
    succeeded:successful.length,
    failures:report.records.length-successful.length,
    real:{
      totalRequests:report.records.length,
      generatedTokens:successful.reduce((n,r)=>n+r.generatedTokens,0),
      medianClientFirstTextMs:median(successful.map(r=>r.clientTtftMs)),
      medianOllamaLoadMs:median(successful.map(r=>r.loadSeconds*1000)),
      medianRequestSeconds:median(successful.map(r=>r.totalSeconds)),
      medianDecodeTokensPerSec:median(successful.map(r=>r.decodeTokensPerSec)),
      // Counts actual Ollama engine load_duration occurrences; no claim of a cache hit.
      engineLoadObservedCount:successful.filter(r=>r.loadSeconds>.05).length
    },
    trace:successful.length?trace:null,
    shadow:simulated,
    disclaimer:'Actual Ollama timings were recorded under Ollama’s existing residency decisions. LRU/Φ were never executed. Their predicted loads and deltas are an offline counterfactual, not measured speedups.'
  };
}

export function createShadowReport(profile, metadata) {
  const parsed = validateCalibrationForShadow(profile);
  if (!metadata || typeof metadata.sessionId !== 'string' || !metadata.sessionId) throw Error('sessionId required');
  const settings=validateReplayOptions(metadata.replayOptions);
  return {
    schema:SHADOW_SCHEMA, source:SHADOW_SOURCE,
    manifest:{
      sessionId:metadata.sessionId,
      mode:'foreground-operator-consented',
      startedUtc:metadata.startedUtc,
      hardware:parsed.hardware,
      backendVersion:parsed.backendVersion,
      generationOptions:parsed.options,
      replayOptions:settings,
      source:'R2D isolated-model calibration + observed foreground session',
      textRetention:'never saves prompts or model responses',
      residencyControl:'none; Ollama default policies only',
      caveat:'This session observes user-directed requests. It is not a system-wide request recorder or a live Φ scheduler.'
    },
    profiles:parsed.profiles,
    records:[]
  };
}

export function appendShadowRecord(report, input) {
  validateShadowReport(report);
  const allowed=new Set(report.profiles.map(p=>p.model));
  if (!allowed.has(input.model)) throw Error('Model is not in this session allowlist');
  if (report.records.length>=MAX_RECORDS) throw Error('Session record limit reached');
  const record={
    sequence:report.records.length+1,
    atMs:input.atMs,
    model:input.model,
    ok:input.ok
  };
  if (input.ok) Object.assign(record, {
    generatedTokens:input.generatedTokens,
    totalSeconds:input.totalSeconds,
    loadSeconds:input.loadSeconds,
    decodeTokensPerSec:input.decodeTokensPerSec,
    clientTtftMs:input.clientTtftMs
  });
  else record.error=String(input.error||'unknown generation failure').slice(0,240);
  const next={...report,records:[...report.records,record]};
  validateShadowReport(next);
  return next;
}
