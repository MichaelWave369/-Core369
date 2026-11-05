/*
 * ΦCore369 R2C: deterministic trace replay of *hypothetical* model residency.
 * This is a discrete-event admission/eviction simulator, not an Ollama controller.
 * All times and memory sizes are INPUT ASSUMPTIONS, not hardware measurements.
 */
export const TRACE_SCHEMA = 'phicore369.workload.v1';
export const REPLAY_SCHEMA = 'phicore369.replay.v1';
export const POLICIES = Object.freeze(['none', 'lru', 'phi']);
const MAX_REQUESTS = 5000;
const MAX_MODELS = 60;
const isNumber = n => typeof n === 'number' && Number.isFinite(n);
const goodNumber = (n, lo, hi) => isNumber(n) && n >= lo && n <= hi;

export function validateWorkload(trace) {
  const fail = msg => { throw new Error('Invalid workload: ' + msg); };
  if (!trace || typeof trace !== 'object' || Array.isArray(trace)) fail('root must be an object');
  if (trace.schema !== TRACE_SCHEMA) fail('unsupported schema');
  if (typeof trace.name !== 'string' || trace.name.length < 1 || trace.name.length > 120) fail('name');
  if (!Array.isArray(trace.models) || trace.models.length < 1 || trace.models.length > MAX_MODELS) fail('models length');
  if (!Array.isArray(trace.requests) || trace.requests.length < 1 || trace.requests.length > MAX_REQUESTS) fail('requests length');
  const names = new Set();
  for (const m of trace.models) {
    if (!m || typeof m !== 'object' || typeof m.id !== 'string' || !/^[\w.:-]{1,64}$/.test(m.id)) fail('model ID');
    if (names.has(m.id)) fail('duplicate model ID: ' + m.id);
    names.add(m.id);
    if (!goodNumber(m.sizeGiB, 0.01, 2048)) fail(m.id + ' sizeGiB must be 0.01..2048');
    if (!goodNumber(m.loadMs, 1, 3600000)) fail(m.id + ' loadMs must be 1..3600000');
    if (!goodNumber(m.inferMs, 0, 3600000)) fail(m.id + ' inferMs must be 0..3600000');
  }
  let previous = -1;
  for (const [i, request] of trace.requests.entries()) {
    if (!request || !Number.isSafeInteger(request.atMs) || request.atMs < 0 || request.atMs > 2592000000) fail('request timestamp ' + i);
    if (request.atMs < previous) fail('requests must be ordered by nondecreasing atMs');
    if (!names.has(request.model)) fail('request for unknown model: ' + String(request.model));
    previous = request.atMs;
  }
  return trace;
}

export function validateReplayOptions(options = {}) {
  const budgetGiB = options.budgetGiB ?? 12;
  const ttlMs = options.ttlMs ?? 0;
  const halfLifeMs = options.halfLifeMs ?? 30000;
  if (!goodNumber(budgetGiB, 0.1, 4096)) throw Error('budgetGiB must be 0.1..4096');
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 0 || ttlMs > 2592000000) throw Error('ttlMs must be an integer 0..2592000000');
  if (!Number.isSafeInteger(halfLifeMs) || halfLifeMs < 1000 || halfLifeMs > 2592000000) throw Error('halfLifeMs must be an integer 1000..2592000000');
  return { budgetGiB, ttlMs, halfLifeMs };
}

function victimByPolicy(residents, history, models, policy, atMs, halfLifeMs) {
  const candidates = [...residents.entries()];
  if (policy === 'lru') {
    candidates.sort((a,b) => a[1].lastAt - b[1].lastAt || a[0].localeCompare(b[0]));
    return candidates[0][0];
  }
  // Φ policy scores expected *benefit per GiB of retaining a model*.
  // Online only: exclusively uses accesses observed at or before this event.
  // Retains frequently reused / expensive-to-load models, subject to TTL and budget.
  const log2 = Math.log(2);
  const score = modelId => {
    const m = models.get(modelId);
    const past = history.get(modelId) || [];
    const observedReuse = past.reduce((sum, observedAt) => sum + Math.exp(-log2 * (atMs - observedAt) / halfLifeMs), 0);
    return (0.25 + observedReuse) * m.loadMs / m.sizeGiB;
  };
  candidates.sort((a,b) => score(a[0]) - score(b[0]) ||
    a[1].lastAt - b[1].lastAt || a[0].localeCompare(b[0]));
  return candidates[0][0];
}

export function replayWorkload(trace, policy = 'phi', options = {}) {
  validateWorkload(trace);
  if (!POLICIES.includes(policy)) throw Error('Unknown residency policy: ' + policy);
  const {budgetGiB, ttlMs, halfLifeMs} = validateReplayOptions(options);
  const models = new Map(trace.models.map(m => [m.id, m]));
  const residents = new Map();
  const history = new Map(trace.models.map(m => [m.id, []]));
  const events = [];
  let hits = 0, misses = 0, oversize = 0, evictions = 0, expired = 0;
  let totalLoadMs = 0, totalInferMs = 0, peakResidentGiB = 0, sumSampledGiB = 0;

  const used = () => [...residents.keys()].reduce((total, id) => total + models.get(id).sizeGiB, 0);
  for (let index = 0; index < trace.requests.length; index++) {
    const request = trace.requests[index];
    const model = models.get(request.model);
    const changed = [];
    // TTL enforcement is at request boundaries only, not continuously in idle time.
    if (ttlMs > 0) for (const [id, info] of [...residents.entries()]) {
      if (request.atMs - info.lastAt >= ttlMs) {
        residents.delete(id);
        expired++;
        changed.push({id, reason:'ttl'});
      }
    }

    const hit = policy !== 'none' && residents.has(model.id);
    const isOversize = model.sizeGiB > budgetGiB + 1e-9;
    let action;
    if (hit) {
      hits++;
      action = 'hit';
    } else {
      misses++;
      totalLoadMs += model.loadMs;
      if (policy === 'none') {
        action = 'no-cache';
      } else if (isOversize) {
        oversize++;
        action = 'oversize-bypass';
      } else {
        while (used() + model.sizeGiB > budgetGiB + 1e-9) {
          if (residents.size === 0) throw Error('Internal capacity invariant broken');
          const victim = victimByPolicy(residents, history, models, policy, request.atMs, halfLifeMs);
          residents.delete(victim);
          evictions++;
          changed.push({id:victim, reason:'capacity'});
        }
        action = 'loaded';
      }
    }
    totalInferMs += model.inferMs;
    // Each request becomes known to the policy only *after* admission and eviction decisions.
    history.get(model.id).push(request.atMs);
    if (policy !== 'none' && !isOversize && (hit || action === 'loaded')) {
      residents.set(model.id, {lastAt: request.atMs});
    }
    const usedGiB = used();
    if (usedGiB > budgetGiB + 1e-7) throw Error('Capacity invariant violated');
    peakResidentGiB = Math.max(peakResidentGiB, usedGiB);
    sumSampledGiB += usedGiB;
    events.push({
      index:index + 1, atMs:request.atMs, model:model.id,
      action, hit, loadMs:hit?0:model.loadMs, inferenceMs:model.inferMs,
      modeledRequestMs:model.inferMs + (hit?0:model.loadMs),
      usedGiB, changes:changed, resident:[...residents.keys()]
    });
  }
  return {
    schema:REPLAY_SCHEMA,
    policy,
    scenario:trace.name,
    options:{budgetGiB, ttlMs, halfLifeMs},
    source:'synthetic-or-imported-trace',
    stats:{
      requests:trace.requests.length, hits, misses,
      hitRate:hits / trace.requests.length, oversize, evictions, expired,
      estimatedLoadMs:totalLoadMs,
      estimatedInferenceMs:totalInferMs,
      estimatedTotalMs:totalLoadMs + totalInferMs,
      peakResidentGiB,
      averageSampledResidentGiB:sumSampledGiB / trace.requests.length
    },
    events
  };
}

export function comparePolicies(trace, options = {}) {
  const config = validateReplayOptions(options);
  const runs = Object.fromEntries(POLICIES.map(p => [p, replayWorkload(trace, p, config)]));
  const lru = runs.lru.stats;
  const phi = runs.phi.stats;
  return {
    schema:REPLAY_SCHEMA,
    scenario: trace.name,
    options:config,
    runs,
    phiVsLru:{
      loadMsSaved:lru.estimatedLoadMs - phi.estimatedLoadMs,
      estimatedTimeSavedMs:lru.estimatedTotalMs - phi.estimatedTotalMs,
      hitDifference:phi.hits - lru.hits,
      winner:phi.estimatedLoadMs < lru.estimatedLoadMs ? 'phi'
        :phi.estimatedLoadMs > lru.estimatedLoadMs ? 'lru':'tie'
    },
    caveats:[
      'Simulation only: sizes, inference and load times are trace assumptions, not captured hardware telemetry.',
      'Requests are modeled sequentially with no queueing or concurrency; arrivals are not delayed by service time.',
      'No energy, cache bandwidth, KV cache, OS page cache, precision or response quality is modeled.',
      'TTL expires at the next request boundary, not continuously during idle periods.',
      'No policy is assumed to be universally better; inspect misses, loading costs, and each eviction.'
    ]
  };
}
