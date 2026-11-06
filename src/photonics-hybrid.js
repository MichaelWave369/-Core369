/* P1 browser-local numerical benchmark parser: no remote requests or actions.
 * Content consistency checks, not authorship authentication.
 */
export const HYBRID_SCHEMA = 'phicore369.photonics.p1.v1';
export const HYBRID_MAX_BYTES = 262144;
export const HYBRID_CPU_METHODS = Object.freeze(['cpu_sine', 'cpu_tanh']);
export const HYBRID_CUDA_METHODS = Object.freeze([
  'cuda_sine', 'cuda_tanh', 'hybrid_cuda_cpu_cuda_sine'
]);
export const HYBRID_STAGES = Object.freeze([
  'input_transfer_ms', 'preprocess_ms', 'interstage_to_cpu_ms',
  'reservoir_ms', 'interstage_to_cuda_ms', 'ridge_readout_ms'
]);
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const finite = x => typeof x === 'number' && Number.isFinite(x);
const natural = x => Number.isSafeInteger(x) && x >= 0;
const fail = text => { throw new Error('Invalid hybrid P1 report: ' + text); };
const check = (test, message) => { if (!test) fail(message); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const median = values => {
  const v = [...values].sort((a, b) => a - b), n = v.length;
  return n % 2 ? v[Math.floor(n / 2)] : (v[n / 2 - 1] + v[n / 2]) / 2;
};
const routeOf = method => method === 'hybrid_cuda_cpu_cuda_sine'
  ? ['cuda', 'cpu', 'cuda'] : method.startsWith('cuda_')
    ? ['cuda', 'cuda', 'cuda'] : ['cpu', 'cpu', 'cpu'];

export function validateHybridReport(report) {
  check(object(report) && report.schema === HYBRID_SCHEMA, 'unsupported schema');
  check(report.source === 'measured-local-pytorch-digital', 'not a local digital report');
  check(typeof report.created_at === 'string' && !Number.isNaN(Date.parse(report.created_at)),
    'invalid timestamp');
  check(object(report.research_reference) && report.research_reference.replication_of_paper === false,
    'cannot claim paper replication');
  check(object(report.hardware) && report.hardware.actual_optical_device === false &&
    report.hardware.power_measured === false, 'cannot claim hardware or wattage measurement');
  check(object(report.interfaces) && report.interfaces.execution_authorized === false,
    'data does not grant execution permissions');
  check(Array.isArray(report.limits) && report.limits.some(x =>
    typeof x === 'string' && x.includes('All steps are electronic')),
  'science boundary missing');
  const env = report.environment;
  check(object(env) && ['cpu', 'cuda'].includes(env.device) &&
    typeof env.pytorch === 'string' && typeof env.python === 'string' &&
    typeof env.cuda_available === 'boolean' && (env.device !== 'cuda' || env.cuda_available),
  'runtime metadata missing');
  const p = report.protocol;
  check(object(p) && p.task === 'synthetic_noisy_two_pulse_temporal_xor' &&
    p.precision === 'float32' &&
    p.projection === 'seeded_identity_plus_small_gaussian',
  'task and precision mismatch');
  check(natural(p.samples) && p.samples >= 64 && p.samples <= 2048 &&
    natural(p.steps) && p.steps >= 6 && p.steps <= 64 &&
    natural(p.virtual_nodes) && p.virtual_nodes >= 4 && p.virtual_nodes <= 256 &&
    natural(p.repeats) && p.repeats >= 1 && p.repeats <= 10 &&
    natural(p.initial_seed) && p.initial_seed <= 2**31 - p.repeats - 1 &&
    finite(p.ridge_lambda) && p.ridge_lambda >= 1e-8 &&
    p.ridge_lambda <= 1e4 && p.train_fraction === .75,
  'experiment bounds mismatch');
  const methods = [...HYBRID_CPU_METHODS, ...(env.device === 'cuda' ? HYBRID_CUDA_METHODS : [])];
  check(same(p.method_order, methods), 'unexpected methods or CUDA fallback');
  check(Array.isArray(report.runs) && report.runs.length === p.repeats &&
    object(report.aggregate), 'missing per-seed results');
  const holdout = p.samples - Math.floor(p.samples * .75);
  for (const [index, run] of report.runs.entries()) {
    check(object(run) && run.seed === p.initial_seed + index &&
      object(run.methods) && same(Object.keys(run.methods), methods), 'seed or method mismatch');
    for (const method of methods) {
      const m = run.methods[method];
      check(object(m) && same(m.route, routeOf(method)) &&
        m.nonlinearity === (method.endsWith('sine') ? 'sine' : 'tanh'),
      'route or nonlinearity mismatch');
      check(finite(m.accuracy) && m.accuracy >= 0 && m.accuracy <= 1 &&
        m.held_out_samples === holdout && m.feature_dimensions === p.virtual_nodes * 2,
      'accuracy/feature dimensions invalid');
      const matrix = m.confusion_actual_rows_predicted_columns;
      check(Array.isArray(matrix) && matrix.length === 2 &&
        matrix.every(row => Array.isArray(row) && row.length === 2 &&
          row.every(natural)), 'confusion matrix missing');
      const size = matrix.flat().reduce((a, b) => a + b, 0);
      check(size === holdout && Math.abs((matrix[0][0] + matrix[1][1]) / size - m.accuracy) <= 1e-6,
        'accuracy inconsistent with actual predictions');
      check(object(m.stage_ms) && same(Object.keys(m.stage_ms), HYBRID_STAGES),
        'timing schema mismatch');
      const hybrid = method === 'hybrid_cuda_cpu_cuda_sine';
      for (const [key, value] of Object.entries(m.stage_ms)) {
        const missing = key === 'input_transfer_ms' && method.startsWith('cpu_') ||
          ['interstage_to_cpu_ms', 'interstage_to_cuda_ms'].includes(key) && !hybrid;
        check(missing ? value === null : finite(value) && value >= 0,
          'missing/invalid stage ' + key);
      }
      check(finite(m.wall_ms) && m.wall_ms >= 0, 'invalid total wall time');
      const stages = Object.values(m.stage_ms).filter(finite).reduce((a, b) => a + b, 0);
      check(stages <= m.wall_ms + .1, 'timed stages exceed total wall duration');
      const usesGpu = method.startsWith('cuda_') || hybrid;
      const expectedBytes = usesGpu ? p.samples * p.steps * 4 +
        (hybrid ? p.samples * p.steps * 4 + p.samples * p.virtual_nodes * 8 : 0) : 0;
      check(m.transfer_bytes === expectedBytes, 'transfer byte accounting mismatch');
      check(usesGpu ?
        natural(m.peak_incremental_cuda_allocated_bytes) &&
        finite(m.max_abs_feature_drift_from_cpu) &&
        m.max_abs_feature_drift_from_cpu >= 0 :
        m.peak_incremental_cuda_allocated_bytes === null &&
        m.max_abs_feature_drift_from_cpu === null,
      'GPU memory/drift provenance mismatch');
    }
  }
  check(same(Object.keys(report.aggregate), methods), 'unexpected aggregate');
  for (const method of methods) {
    const a = report.aggregate[method];
    const records = report.runs.map(x => x.methods[method]);
    const mean = records.reduce((sum, item) => sum + item.accuracy, 0) / records.length;
    check(object(a) && finite(a.mean_held_out_accuracy) &&
      Math.abs(a.mean_held_out_accuracy - mean) < 0.000002 &&
      finite(a.median_wall_ms) &&
      Math.abs(a.median_wall_ms - median(records.map(r => r.wall_ms))) < .0002,
    'aggregate metric mismatch');
    const usesGpu = method.startsWith('cuda_') || method.startsWith('hybrid_');
    check(usesGpu ? natural(a.median_peak_incremental_cuda_allocated_bytes) :
      a.median_peak_incremental_cuda_allocated_bytes === null,
    'GPU memory aggregate mismatch');
  }
  return report;
}

export function parseHybridReport(raw) {
  check(typeof raw === 'string' && new TextEncoder().encode(raw).byteLength <= HYBRID_MAX_BYTES,
    'missing or >256KiB file');
  let parsed;
  try { parsed = JSON.parse(raw); } catch { fail('malformed JSON'); }
  return validateHybridReport(parsed);
}
