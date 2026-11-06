/* ΦCore369 Photonics R0: defensive, read-only parser for LOCAL benchmark JSON.
 * No network calls; a checksum is not proof of origin or hardware measurement.
 */
export const PHOTONICS_SCHEMA = 'phicore369.photonics.r0.v1';
export const PHOTONICS_METHODS = Object.freeze([
  'linear_input', 'electronic_tanh', 'photonic_inspired_sine'
]);
export const PHOTONICS_MAX_BYTES = 262144;

const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = v => typeof v === 'number' && Number.isFinite(v);
const integer = v => Number.isSafeInteger(v);
const assert = (ok, message) => { if (!ok) throw new Error('Invalid photonics R0 report: ' + message); };

export function validatePhotonicsReport(report) {
  assert(object(report), 'root must be an object');
  assert(report.schema === PHOTONICS_SCHEMA, 'wrong schema');
  assert(report.source === 'numerical-simulation-pytorch', 'source must identify numerical simulation');
  assert(typeof report.created_at === 'string' && !Number.isNaN(Date.parse(report.created_at)), 'timestamp missing');
  assert(object(report.research_reference) && report.research_reference.replication_of_paper === false,
    'paper replication must not be claimed');
  assert(object(report.environment) && ['cpu', 'cuda'].includes(report.environment.device) &&
    typeof report.environment.pytorch === 'string', 'runtime identification missing');
  const p = report.protocol;
  assert(object(p) && p.task === 'synthetic_noisy_two_pulse_temporal_xor' &&
    p.data === 'generated_only_no_external_inputs', 'unsupported task');
  assert(integer(p.samples) && p.samples >= 64 && p.samples <= 4096 &&
    integer(p.steps) && p.steps >= 6 && p.steps <= 64 &&
    integer(p.virtual_nodes) && p.virtual_nodes >= 4 && p.virtual_nodes <= 512,
    'invalid shape');
  assert(integer(p.repeats) && p.repeats >= 1 && p.repeats <= 10 &&
    integer(p.initial_seed) && p.initial_seed >= 0 &&
    finite(p.ridge_lambda) && p.ridge_lambda > 0,
    'invalid repeats, seed or ridge');
  assert(JSON.stringify(p.methods) === JSON.stringify(PHOTONICS_METHODS), 'unexpected comparison methods');
  assert(Array.isArray(report.runs) && report.runs.length === p.repeats, 'run count mismatch');
  assert(object(report.aggregate), 'aggregate missing');
  for (const [index, run] of report.runs.entries()) {
    assert(object(run) && run.seed === p.initial_seed + index && object(run.methods),
      'run seed or methods mismatch');
    for (const method of PHOTONICS_METHODS) {
      const r = run.methods[method];
      assert(object(r), 'missing ' + method);
      assert(finite(r.accuracy) && r.accuracy >= 0 && r.accuracy <= 1,
        'invalid accuracy for ' + method);
      assert(integer(r.test_samples) && r.test_samples === p.samples - Math.floor(p.samples * .75),
        'invalid holdout size');
      assert(integer(r.feature_dimensions) && r.feature_dimensions ===
        (method === 'linear_input' ? p.steps : p.virtual_nodes * 2),
        'feature dimension mismatch');
      assert(r.trainable_readout_coefficients === r.feature_dimensions + 1,
        'invalid coefficient count');
      assert(finite(r.feature_ms) && r.feature_ms >= 0 &&
        finite(r.readout_fit_and_predict_ms) && r.readout_fit_and_predict_ms >= 0,
        'invalid timing');
      const matrix = r.confusion_actual_rows_predicted_columns;
      assert(Array.isArray(matrix) && matrix.length === 2 &&
        matrix.every(row => Array.isArray(row) && row.length === 2 &&
          row.every(n => integer(n) && n >= 0)), 'invalid confusion matrix');
      const total = matrix.flat().reduce((a, b) => a + b, 0);
      const correct = matrix[0][0] + matrix[1][1];
      assert(total === r.test_samples && Math.abs(r.accuracy - correct / total) < 0.000002,
        'accuracy and confusion matrix disagree');
    }
  }
  for (const method of PHOTONICS_METHODS) {
    const stats = report.aggregate[method];
    assert(object(stats) && finite(stats.mean_test_accuracy) &&
      stats.mean_test_accuracy >= 0 && stats.mean_test_accuracy <= 1, 'invalid aggregate');
    const measured = report.runs.map(run => run.methods[method].accuracy);
    const mean = measured.reduce((a, b) => a + b, 0) / measured.length;
    assert(Math.abs(stats.mean_test_accuracy - mean) < 0.000002, 'aggregate accuracy mismatch');
    assert(stats.sample_std_accuracy === null ||
      finite(stats.sample_std_accuracy) && stats.sample_std_accuracy >= 0,
      'invalid standard deviation');
  }
  assert(object(report.interfaces) && report.interfaces.execution_authorized === false,
    'results do not authorize execution');
  assert(Array.isArray(report.limits) && report.limits.some(x =>
    typeof x === 'string' && x.includes('No optical hardware')), 'missing hardware limitation');
  return report;
}

export function parsePhotonicsReport(text) {
  assert(typeof text === 'string' && new TextEncoder().encode(text).byteLength <= PHOTONICS_MAX_BYTES,
    'report is missing or too large');
  let obj;
  try { obj = JSON.parse(text); } catch { throw new Error('Invalid photonics R0 report: malformed JSON'); }
  return validatePhotonicsReport(obj);
}
