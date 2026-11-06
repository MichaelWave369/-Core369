/* P2 strictly local/import-only numerical research report.
 * Internally reuses P1's per-route numerical accounting validator.
 * Validation detects inconsistent data, NOT malicious fabrication/authenticity.
 */
import {validateHybridReport, HYBRID_CPU_METHODS, HYBRID_CUDA_METHODS} from './photonics-hybrid.js';

export const PHOTONICS_P2_SCHEMA = 'phicore369.photonics.p2.v1';
export const PHOTONICS_P2_MAX_BYTES = 262144;
export const PHOTONICS_P2_TASKS = Object.freeze(['temporal_xor', 'first_pulse_memory']);
export const PHOTONICS_P2_BOOTSTRAPS = 1000;
const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const integer = x => Number.isSafeInteger(x);
const finite = x => typeof x === 'number' && Number.isFinite(x);
const exact = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const assert = (predicate,msg) => { if (!predicate) throw new Error('Invalid P2 report: ' + msg); };
const median = values => {
  const a = [...values].sort((x,y)=>x-y), n=a.length;
  return n % 2 ? a[Math.floor(n/2)] : (a[n/2-1]+a[n/2])/2;
};
const methodsFor = report =>
  [...HYBRID_CPU_METHODS, ...(report.environment.device === 'cuda' ? HYBRID_CUDA_METHODS : [])];
const pairsFor = report => [
  ['cpu_sine','cpu_tanh'],
  ...(report.environment.device === 'cuda'
    ? [['cpu_sine','cuda_sine'],['cuda_sine','hybrid_cuda_cpu_cuda_sine']] : [])
];

function validateP1RouteMetrics(report, run, methodList) {
  const p = report.protocol;
  const aggregate = {};
  for(const method of methodList) {
    const m = run.methods[method];
    aggregate[method] = {
      mean_held_out_accuracy: m.accuracy,
      median_wall_ms: m.wall_ms,
      median_peak_incremental_cuda_allocated_bytes:
        method.startsWith('cuda_') || method.startsWith('hybrid_')
          ? m.peak_incremental_cuda_allocated_bytes : null
    };
  }
  const p1 = {
    schema: 'phicore369.photonics.p1.v1',
    source: report.source,
    created_at: report.created_at,
    research_reference: report.research_reference,
    environment: report.environment,
    hardware: report.hardware,
    interfaces: report.interfaces,
    // The P1 checker validates operator shapes and timing, not task labels.
    // Actual P2 tasks are validated separately below.
    limits: ['All steps are electronic CPU or CUDA numerical simulation.'],
    protocol: {
      task: 'synthetic_noisy_two_pulse_temporal_xor',
      precision: p.precision,
      projection: p.projection,
      samples: p.samples, steps: p.steps,
      virtual_nodes: p.virtual_nodes,
      repeats: 1, initial_seed: run.seed,
      ridge_lambda: p.ridge_lambda,
      method_order: methodList, train_fraction: .75
    },
    runs: [{seed: run.seed, methods: run.methods}],
    aggregate
  };
  validateHybridReport(p1);
}

export function validatePhotonicsP2(report) {
  assert(isObject(report) && report.schema === PHOTONICS_P2_SCHEMA,
    'schema must be P2');
  assert(report.source === 'measured-local-pytorch-digital', 'not a local digital report');
  assert(typeof report.created_at === 'string' && !Number.isNaN(Date.parse(report.created_at)),
    'timestamp invalid');
  assert(isObject(report.research_reference) &&
    report.research_reference.replication_of_paper === false,
    'paper replication claim');
  assert(isObject(report.hardware) && report.hardware.actual_optical_device === false &&
    report.hardware.power_measured === false, 'invalid hardware claim');
  assert(isObject(report.interfaces) && report.interfaces.execution_authorized === false,
    'cannot authorize execution');
  assert(Array.isArray(report.limits) && report.limits.some(s =>
    typeof s === 'string' && s.includes('never optical equipment')),
  'missing scientific limitation');
  const env = report.environment, p = report.protocol;
  assert(isObject(env) && ['cpu','cuda'].includes(env.device) &&
    typeof env.pytorch === 'string' &&
    typeof env.cuda_available === 'boolean' &&
    (env.device !== 'cuda' || env.cuda_available), 'device metadata invalid');
  assert(isObject(p) && exact(p.tasks, PHOTONICS_P2_TASKS) &&
    p.precision === 'float32' &&
    p.projection === 'seeded_identity_plus_small_gaussian' &&
    p.train_fraction === .75 &&
    p.randomization === 'fixed_seed_per_task_per_round_shuffle' &&
    p.pairing === 'same_task_seed_input_train_test_split' &&
    p.warmup === 'one_complete_full_route_per_method_and_seed' &&
    p.bootstrap_resamples === PHOTONICS_P2_BOOTSTRAPS, 'invalid protocol');
  assert(integer(p.samples) && p.samples >= 64 && p.samples <= 2048 &&
    integer(p.steps) && p.steps >= 6 && p.steps <= 64 &&
    integer(p.virtual_nodes) && p.virtual_nodes >= 4 && p.virtual_nodes <= 256 &&
    integer(p.repeats_per_task) && p.repeats_per_task >= 3 && p.repeats_per_task <= 12 &&
    integer(p.initial_seed) && p.initial_seed >= 0 &&
    p.initial_seed <= 2**31 - p.repeats_per_task - 1 &&
    finite(p.ridge_lambda) && p.ridge_lambda >= 1e-8 && p.ridge_lambda <= 1e4,
  'experiment bounds mismatch');
  const methods = methodsFor(report);
  assert(exact(p.methods,methods), 'inconsistent CPU/CUDA methods');
  assert(isObject(report.tasks) && exact(Object.keys(report.tasks),PHOTONICS_P2_TASKS),
    'missing or unexpected task');
  for(const task of PHOTONICS_P2_TASKS) {
    const value = report.tasks[task];
    assert(isObject(value) && Array.isArray(value.runs) &&
      value.runs.length === p.repeats_per_task &&
      isObject(value.aggregate) && Array.isArray(value.paired_comparisons),
    'incomplete task results');
    for(const [index, run] of value.runs.entries()) {
      assert(isObject(run) && run.seed === p.initial_seed + index &&
        Array.isArray(run.method_execution_order) &&
        run.method_execution_order.length === methods.length &&
        exact([...run.method_execution_order].sort(), [...methods].sort()),
      'invalid paired seed or randomized method order');
      assert(isObject(run.methods) && exact(Object.keys(run.methods),methods),
        'method records missing');
      validateP1RouteMetrics(report,run,methods);
    }
    assert(exact(Object.keys(value.aggregate),methods), 'unexpected method aggregate');
    for (const method of methods) {
      const group = value.runs.map(r=>r.methods[method]);
      const actualMean = group.reduce((sum,r)=>sum+r.accuracy,0)/group.length;
      const actualMedian = median(group.map(r=>r.wall_ms));
      const claimed = value.aggregate[method];
      assert(isObject(claimed) && finite(claimed.mean_held_out_accuracy) &&
        Math.abs(claimed.mean_held_out_accuracy-actualMean) <= .000002 &&
        finite(claimed.median_wall_ms) &&
        Math.abs(claimed.median_wall_ms-actualMedian) <= .0002,
      'aggregate does not match paired raw data');
    }
    const pairs = pairsFor(report);
    assert(value.paired_comparisons.length === pairs.length,
      'missing method comparisons');
    for(const [i, [baseline,candidate]] of pairs.entries()) {
      const item = value.paired_comparisons[i];
      const deltas = value.runs.map(r=>
        r.methods[candidate].wall_ms-r.methods[baseline].wall_ms);
      assert(isObject(item) && item.baseline === baseline &&
        item.candidate === candidate && item.paired_seed_count === p.repeats_per_task &&
        item.bootstrap_resamples === PHOTONICS_P2_BOOTSTRAPS &&
        finite(item.median_candidate_minus_baseline_ms) &&
        Math.abs(item.median_candidate_minus_baseline_ms-median(deltas)) <= .0002,
      'incorrect paired comparison');
      const ci = item.exploratory_bootstrap_95pct_median_delta_ms;
      assert(Array.isArray(ci) && ci.length === 2 &&
        ci.every(finite) && ci[0] <= ci[1] &&
        ci[0] >= Math.min(...deltas)-.0002 &&
        ci[1] <= Math.max(...deltas)+.0002,
      'implausible or malformed exploratory interval');
    }
  }
  return report;
}

export function parsePhotonicsP2(raw) {
  assert(typeof raw === 'string' &&
    new TextEncoder().encode(raw).byteLength <= PHOTONICS_P2_MAX_BYTES,
  'report missing or above 256 KiB');
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error('Invalid P2 report: malformed JSON'); }
  return validatePhotonicsP2(parsed);
}
