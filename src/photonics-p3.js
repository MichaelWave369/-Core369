/* P3: read-only comparison of two independently captured P2 numerical reports.
 * Validation is not cryptographic authentication or scientific verification.
 * Neither the software nor its results involve physical optical hardware.
 */
import { validatePhotonicsP2, parsePhotonicsP2 } from './photonics-p2.js';

export const PHOTONICS_P3_SCHEMA = 'phicore369.photonics.p3.comparison.v1';
export const PHOTONICS_P3_TIMING_DRIFT_WARN_PERCENT = 25;
export const PHOTONICS_P3_ACCURACY_DRIFT_WARN_POINTS = 2;

const assert = (condition, message) => {
  if (!condition) throw new Error('P3 comparison refused: ' + message);
};
const validText = (x, max) => typeof x === 'string' && x.length > 0 && x.length <= max;
const median = values => {
  const arr = [...values].sort((x,y) => x-y);
  return arr.length % 2 ? arr[(arr.length-1)/2] :
    (arr[arr.length/2-1] + arr[arr.length/2])/2;
};
const round = (value, digits=4) => Number(value.toFixed(digits));
const fields = ['python', 'pytorch', 'os', 'cpu', 'cpu_threads',
  'device', 'cuda_available', 'gpu_name', 'cuda_runtime'];

export function comparePhotonicsP2(a, b) {
  validatePhotonicsP2(a);
  validatePhotonicsP2(b);
  for (const report of [a, b]) {
    const env = report.environment;
    assert(validText(env.os, 250) && validText(env.cpu, 250) &&
      Number.isSafeInteger(env.cpu_threads) && env.cpu_threads >= 1 &&
      env.cpu_threads <= 1024,
      'P2 report is missing P3 host metadata; regenerate using the updated P2 runner');
  }
  const differingFields = fields.filter(key =>
    JSON.stringify(a.environment[key]) !== JSON.stringify(b.environment[key]));
  assert(differingFields.length === 0,
    'software/hardware metadata differs: ' + differingFields.join(', '));
  assert(JSON.stringify(a.protocol) === JSON.stringify(b.protocol),
    'task settings, seeds, model order, or run protocol differ');
  assert(a.created_at !== b.created_at,
    'reports have identical creation timestamps and are not independently identifiable');
  // Copies of the same results with a changed timestamp should not masquerade
  // as independent measurement sessions.
  assert(JSON.stringify(a.tasks) !== JSON.stringify(b.tasks),
    'all task measurements are identical; likely a duplicated report');
  const rows = [], warnings = [];
  for (const task of a.protocol.tasks) {
    for (const method of a.protocol.methods) {
      const first = a.tasks[task].aggregate[method];
      const second = b.tasks[task].aggregate[method];
      const firstMs = first.median_wall_ms, secondMs = second.median_wall_ms;
      const timingDriftPct = firstMs === 0 ? null
        : round((secondMs / firstMs - 1) * 100, 2);
      const accuracyDriftPoints = round(
        (second.mean_held_out_accuracy - first.mean_held_out_accuracy) * 100, 3);
      // Independent repeated sessions use the same per-seed inputs. Report
      // both the aggregate change and the per-seed worst-case variation.
      const pairedAccuracyDifferences = a.tasks[task].runs.map((run, i) => {
        const other = b.tasks[task].runs[i];
        assert(run.seed === other.seed, 'paired seeds diverge');
        return Math.abs(
          other.methods[method].accuracy - run.methods[method].accuracy);
      });
      const maxAbsSeedAccuracyPoints = round(
        Math.max(...pairedAccuracyDifferences) * 100, 3);
      const issues = [];
      if (timingDriftPct === null) {
        issues.push('zero first-session runtime prevents timing ratio');
      } else if (Math.abs(timingDriftPct) > PHOTONICS_P3_TIMING_DRIFT_WARN_PERCENT) {
        issues.push('absolute median timing drift exceeds 25%');
      }
      if (maxAbsSeedAccuracyPoints > PHOTONICS_P3_ACCURACY_DRIFT_WARN_POINTS) {
        issues.push('per-seed test accuracy changed by more than 2 percentage points');
      }
      if (issues.length) warnings.push({task,method,issues});
      rows.push({
        task, method,
        session_a_median_ms: firstMs,
        session_b_median_ms: secondMs,
        median_timing_drift_percent: timingDriftPct,
        session_a_accuracy: first.mean_held_out_accuracy,
        session_b_accuracy: second.mean_held_out_accuracy,
        accuracy_drift_percentage_points: accuracyDriftPoints,
        worst_seed_accuracy_drift_points: maxAbsSeedAccuracyPoints,
        flagged_for_review: issues.length > 0,
      });
    }
  }
  const pairChecks = [];
  for(const task of a.protocol.tasks) {
    const left = a.tasks[task].paired_comparisons;
    const right = b.tasks[task].paired_comparisons;
    assert(left.length === right.length, 'different comparison set');
    for (let i=0;i<left.length;i++) {
      const x=left[i], y=right[i];
      assert(x.baseline === y.baseline && x.candidate === y.candidate,
        'different comparison pair');
      pairChecks.push({
        task,
        baseline: x.baseline, candidate: x.candidate,
        session_a_median_delta_ms: x.median_candidate_minus_baseline_ms,
        session_b_median_delta_ms: y.median_candidate_minus_baseline_ms,
        consistent_sign: Math.sign(x.median_candidate_minus_baseline_ms) ===
          Math.sign(y.median_candidate_minus_baseline_ms)
      });
    }
  }
  return {
    schema: PHOTONICS_P3_SCHEMA,
    source: 'local-comparison-of-two-p2-reports',
    evidence_status: 'exploratory_two_sessions_not_hardware_verification',
    optical_hardware_measured: false,
    measured_energy: false,
    independent_sessions_authenticated: false,
    host_metadata_match_not_identity_proof: true,
    session_count: 2,
    platform: {...Object.fromEntries(fields.map(k=>[k,a.environment[k]]))},
    protocol: {
      tasks: [...a.protocol.tasks],
      methods: [...a.protocol.methods],
      samples: a.protocol.samples,
      repeats_per_task: a.protocol.repeats_per_task,
      virtual_nodes: a.protocol.virtual_nodes,
    },
    results: rows, paired_effects: pairChecks, warnings,
    limitations: [
      'Two matching file headers do not authenticate the same physical machine.',
      'Matched metadata do not establish independent execution or a signed provenance chain.',
      'Timing drift flags are heuristic investigation thresholds, not statistical significance.',
      'Same synthetic seeds test repeatability; they are not independent task generalization.',
      'No optical hardware, power metering or optical energy advantage was measured.',
      'GPU memory and power use of other processes are not controlled or observed.',
      'Human review is required before any scientific conclusion or downstream ingestion.'
    ],
    interfaces: {execution_authorized: false}
  };
}

export function comparePhotonicsP2Texts(first, second) {
  return comparePhotonicsP2(parsePhotonicsP2(first),parsePhotonicsP2(second));
}
