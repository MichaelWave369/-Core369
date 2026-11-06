import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HYBRID_SCHEMA, HYBRID_CPU_METHODS, HYBRID_CUDA_METHODS,
  HYBRID_MAX_BYTES, validateHybridReport, parseHybridReport
} from '../src/photonics-hybrid.js';

function fixture(gpu = false) {
  const methods = [...HYBRID_CPU_METHODS, ...(gpu ? HYBRID_CUDA_METHODS : [])];
  const records = {};
  for (const method of methods) {
    const hybrid = method.startsWith('hybrid_');
    const usesGpu = hybrid || method.startsWith('cuda_');
    const stages = {
      input_transfer_ms: usesGpu ? 0.2 : null,
      preprocess_ms: 1.0,
      interstage_to_cpu_ms: hybrid ? .3 : null,
      reservoir_ms: 4.0,
      interstage_to_cuda_ms: hybrid ? .4 : null,
      ridge_readout_ms: 2.0
    };
    records[method] = {
      accuracy: .5, confusion_actual_rows_predicted_columns: [[8, 8], [8, 8]],
      held_out_samples: 32, feature_dimensions: 32,
      route: hybrid ? ['cuda', 'cpu', 'cuda'] :
        usesGpu ? ['cuda', 'cuda', 'cuda'] : ['cpu', 'cpu', 'cpu'],
      nonlinearity: method.endsWith('sine') ? 'sine' : 'tanh',
      stage_ms: stages,
      wall_ms: 10,
      transfer_bytes: usesGpu ? 128 * 12 * 4 * (hybrid ? 2 : 1) +
        (hybrid ? 128 * 16 * 2 * 4 : 0) : 0,
      peak_incremental_cuda_allocated_bytes: usesGpu ? 10000 : null,
      max_abs_feature_drift_from_cpu: usesGpu ? 0.00002 : null
    };
  }
  return {
    schema: HYBRID_SCHEMA, source: 'measured-local-pytorch-digital',
    created_at: '2026-11-05T23:00:00Z',
    research_reference: {doi:'10.1038/s43588-026-01075-w', replication_of_paper: false},
    environment: {
      python: '3.12', pytorch: '2.10', device: gpu ? 'cuda' : 'cpu',
      cuda_available: gpu, gpu_name: gpu ? 'Fake test device' : null, cuda_runtime: null
    },
    protocol: {
      task: 'synthetic_noisy_two_pulse_temporal_xor',
      samples: 128, steps: 12, virtual_nodes: 16,
      repeats: 1, initial_seed: 369, ridge_lambda: .1,
      method_order: methods, train_fraction: .75,
      projection: 'seeded_identity_plus_small_gaussian', precision:'float32'
    },
    runs: [{seed:369, methods: records}],
    aggregate: Object.fromEntries(methods.map(name =>
      [name, {mean_held_out_accuracy:.5, median_wall_ms:10,
        median_peak_incremental_cuda_allocated_bytes:
          name.startsWith('cuda_') || name.startsWith('hybrid_') ? 10000 : null}])),
    hardware: {
      actual_optical_device:false, power_measured:false,
      gpu_memory_metric:'incremental_PyTorch_allocator_peak_not_total_VRAM'
    },
    limits: ['All steps are electronic CPU or CUDA numerical simulation.'],
    interfaces: {execution_authorized:false}
  };
}
const clone = x => JSON.parse(JSON.stringify(x));
test('accepts correctly bounded CPU report', () => {
  const report = fixture();
  assert.equal(validateHybridReport(report), report);
  assert.deepEqual(parseHybridReport(JSON.stringify(report)), report);
});
test('accepts consistent CUDA/hybrid report but never claims optical hardware', () => {
  const report = fixture(true);
  assert.equal(validateHybridReport(report), report);
  report.hardware.actual_optical_device = true;
  assert.throws(() => validateHybridReport(report), /hardware/);
});
test('rejects invented CUDA in CPU-only report', () => {
  const report = fixture();
  report.protocol.method_order.push('cuda_sine');
  assert.throws(() => validateHybridReport(report), /methods/);
});
test('rejects corrupted accuracy and transfer sizes', () => {
  const report = fixture(true);
  report.runs[0].methods.hybrid_cuda_cpu_cuda_sine.transfer_bytes++;
  assert.throws(() => validateHybridReport(report), /transfer byte/);
  const other = fixture();
  other.aggregate.cpu_sine.mean_held_out_accuracy = .9;
  assert.throws(() => validateHybridReport(other), /aggregate/);
});
test('rejects invalid stage timing and unexpected execution permission', () => {
  const report = fixture(true);
  report.runs[0].methods.cuda_sine.stage_ms.interstage_to_cpu_ms = .5;
  assert.throws(() => validateHybridReport(report), /stage/);
  const other = fixture();
  other.interfaces.execution_authorized = true;
  assert.throws(() => validateHybridReport(other), /execution/);
});
test('rejects oversized and malformed import', () => {
  assert.throws(() => parseHybridReport('x'.repeat(HYBRID_MAX_BYTES + 1)), /256KiB/);
  assert.throws(() => parseHybridReport('not json'), /malformed/);
  assert.throws(() => parseHybridReport('{}'), /schema/);
});
