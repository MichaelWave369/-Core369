/*
 * ΦCore369 R2D: convert independently measured R2B local Ollama residency
 * experiments into an OFFLINE R2C simulation input. No live controller.
 *
 * These derived quantities are proxy estimates, not actual benchmark outcomes
 * from running a scheduler. Replays remain simulations with explicit provenance.
 */
import { validateResidencyReport, summarizeResidency } from './residency.js';
import { validateWorkload, TRACE_SCHEMA } from './weightbubble.js';
import { median } from './measurements.js';

export const ARRIVALS_SCHEMA = 'phicore369.arrivals.v1';
export const CALIBRATION_SCHEMA = 'phicore369.calibration.v1';
const GiB = 1024 ** 3;
const isFiniteNumber = n => typeof n === 'number' && Number.isFinite(n);
const maxModels = 30;
const maxRequests = 5000;
const safeModelId = name => name.replace(/[^a-zA-Z0-9_.:-]/g,'-').slice(0,64);

export function validateArrivals(input) {
  const fail = msg => { throw Error('Invalid arrival sequence: '+msg); };
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.schema !== ARRIVALS_SCHEMA) fail('schema');
  if (typeof input.name !== 'string' || input.name.length < 1 || input.name.length > 120) fail('name');
  if (!Array.isArray(input.requests) || !input.requests.length || input.requests.length > maxRequests) fail('requests length');
  let previous = -1;
  for (const [index, request] of input.requests.entries()) {
    if (!request || !Number.isSafeInteger(request.atMs) || request.atMs < 0 || request.atMs > 2592000000 ||
        request.atMs < previous) fail('timestamp at '+index);
    if (typeof request.model !== 'string' || !request.model || request.model.length > 256) fail('model at '+index);
    previous = request.atMs;
  }
  return input;
}

function sameJson(a,b) { return JSON.stringify(a) === JSON.stringify(b); }

export function calibrateResidencyReports(arrivals, reports, options={}) {
  validateArrivals(arrivals);
  if (!Array.isArray(reports) || reports.length < 2 || reports.length > maxModels) {
    throw Error('Calibration requires 2–30 distinct R2B reports, one per model');
  }
  const byModel = new Map();
  const usedIds = new Set();
  let first = null;
  const models = [];
  const sourceReports = [];
  for (const original of reports) {
    const report = validateResidencyReport(original);
    const m = report.manifest;
    if (byModel.has(m.model)) throw Error('Duplicate report for model '+m.model);
    if (m.initialLoadedModels !== 0 || m.initiallyResident) {
      throw Error('Calibration requires isolated R2B sessions with no models initially loaded ('+m.model+')');
    }
    const stats = summarizeResidency(report);
    if (!stats.enoughPairs || stats.pairedCount < 5) throw Error('Not enough successful cold/warm pairs for '+m.model);
    if (first) {
      if (!sameJson(first.hardware,m.hardware)) throw Error('Hardware mismatch across R2B reports');
      if (first.backendVersion !== m.backendVersion) throw Error('Ollama version mismatch across reports');
      if (!sameJson(first.options,m.options)) throw Error('Generation settings mismatch across reports');
      if (!sameJson(first.promptHashes,m.promptHashes)) throw Error('Prompt set mismatch across reports');
    } else first = m;
    const residentBytes = report.trials.filter(t=>t.ok && t.condition==='preloaded')
      .map(t=>t.sizeVramBytes).filter(n=>isFiniteNumber(n)&&n>0);
    if (residentBytes.length < 5) throw Error('Missing positive GPU VRAM residency observations for '+m.model+
      '; CPU-only/offloaded or unknown footprints cannot calibrate the GPU-only R2C budget safely');
    const sizeGiB = median(residentBytes)/GiB;
    const cold = report.trials.filter(t=>t.ok && t.condition==='cold');
    const loadMs = median(cold.map(t=>t.loadSeconds*1000));
    const inferMs = median(cold.map(t=>Math.max(0,(t.totalSeconds-t.loadSeconds)*1000)));
    if (!isFiniteNumber(sizeGiB) || sizeGiB<0.01 || sizeGiB>2048) throw Error('Measured residency outside model bounds: '+m.model);
    if (!isFiniteNumber(loadMs) || loadMs<1 || loadMs>3600000) throw Error('Measured reload time outside model bounds: '+m.model);
    if (!isFiniteNumber(inferMs) || inferMs<0 || inferMs>3600000) throw Error('Measured inference estimate outside model bounds: '+m.model);
    const id=safeModelId(m.model);
    if (!id || usedIds.has(id)) throw Error('Invalid or colliding model IDs after normalization. Rename conflicting model tags.');
    usedIds.add(id);
    byModel.set(m.model,id);
    models.push({id,sizeGiB,loadMs,inferMs});
    sourceReports.push({
      model:m.model,id,modelDigest:m.modelDigest,backendVersion:m.backendVersion,
      runId:m.experimentId||null,utc:m.utc||null,pairs:stats.pairedCount,
      sizeSource:'median of successful /api/ps size_vram snapshots',
      loadSource:'median successful cold Ollama load_duration',
      inferenceSource:'median cold total_duration minus load_duration, nonnegative'
    });
  }
  const requestNames = new Set(arrivals.requests.map(r=>r.model));
  for (const model of requestNames) if (!byModel.has(model)) throw Error('No calibrated R2B report for requested model '+model);
  // Only requested models become part of the scenario.
  const filtered = models.filter(m=>requestNames.has(sourceReports.find(x=>x.id===m.id)?.model));
  const trace = validateWorkload({
    schema:TRACE_SCHEMA,
    name:arrivals.name,
    description:'R2D calibrated from local R2B reports. Arrivals are user-provided, NOT observed service requests. Memory uses /api/ps VRAM snapshots and excludes KV/overhead guarantees.',
    models:filtered,
    requests:arrivals.requests.map(r=>({atMs:r.atMs,model:byModel.get(r.model)}))
  });
  return {
    schema:CALIBRATION_SCHEMA,
    source:'derived-r2b-calibration',
    arrivalsSource:'user-supplied-sequence',
    trace,
    manifest:{
      hardware:first.hardware,
      backend:'ollama',
      backendVersion:first.backendVersion,
      generationOptions:first.options,
      promptHashes:first.promptHashes,
      sourceReports,
      memoryBasis:'observed per-model GPU VRAM snapshots; NOT an additive or complete memory allocation guarantee',
      timeBasis:'medians of prior isolated R2B runs; NOT concurrent multi-model observed timings'
    },
    caveats:[
      'Request arrival times and ordering are user-supplied, not observed runtime requests.',
      'Ollama size_vram is a per-model snapshot; it may omit allocator fragmentation, concurrent KV/context, active requests, dynamic overhead and CPU offload.',
      'Single-model cold/warm timings are not multi-model or live eviction measurements.',
      'Cross-report hardware, Ollama version, generation options and prompt hashes must match.',
      'Replaying this derived trace remains a simulation, not measured scheduler speedup, energy savings, or correctness.'
    ]
  };
}

export function calibrationSummary(calibration) {
  if (!calibration || calibration.schema!==CALIBRATION_SCHEMA) throw Error('Not an R2D calibration');
  return {
    sources:calibration.manifest.sourceReports.length,
    models:calibration.trace.models.length,
    requests:calibration.trace.requests.length,
    capacityGiB:calibration.trace.models.reduce((sum,m)=>sum+m.sizeGiB,0)
  };
}
