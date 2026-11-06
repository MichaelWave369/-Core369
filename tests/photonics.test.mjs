import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PHOTONICS_SCHEMA, PHOTONICS_METHODS, PHOTONICS_MAX_BYTES,
  validatePhotonicsReport, parsePhotonicsReport
} from '../src/photonics.js';

function fixture() {
  const methods = {};
  for (const name of PHOTONICS_METHODS) {
    const dimension = name === 'linear_input' ? 12 : 32;
    methods[name] = {
      accuracy: 0.5,
      confusion_actual_rows_predicted_columns: [[4, 4], [4, 4]],
      feature_ms: 1.1, readout_fit_and_predict_ms: 2.2,
      test_samples: 16, feature_dimensions: dimension,
      trainable_readout_coefficients: dimension + 1
    };
  }
  return {
    schema: PHOTONICS_SCHEMA, source: 'numerical-simulation-pytorch',
    created_at: '2026-11-05T22:00:00Z',
    research_reference: { doi: '10.1038/s43588-026-01075-w', replication_of_paper: false },
    environment: { python: '3.12', pytorch: '2.10', device: 'cpu', device_name: 'test CPU' },
    protocol: {
      task: 'synthetic_noisy_two_pulse_temporal_xor',
      data: 'generated_only_no_external_inputs',
      samples: 64, steps: 12, virtual_nodes: 16,
      repeats: 1, initial_seed: 369, ridge_lambda: .1,
      methods: [...PHOTONICS_METHODS]
    },
    runs: [{ seed: 369, methods }],
    aggregate: Object.fromEntries(PHOTONICS_METHODS.map(name =>
      [name, { mean_test_accuracy: .5, sample_std_accuracy: null }])),
    limits: ['No optical hardware or optical energy measurement.'],
    interfaces: { execution_authorized: false }
  };
}
const clone = obj => JSON.parse(JSON.stringify(obj));

test('accepts bounded local numerical report', () => {
  const example = fixture();
  assert.equal(validatePhotonicsReport(example), example);
  assert.deepEqual(parsePhotonicsReport(JSON.stringify(example)), example);
});
test('rejects claimed physical or paper hardware results', () => {
  const example = fixture();
  example.source = 'measured-optical-hardware';
  assert.throws(() => validatePhotonicsReport(example), /simulation/);
  example.source = 'numerical-simulation-pytorch';
  example.research_reference.replication_of_paper = true;
  assert.throws(() => validatePhotonicsReport(example), /replication/);
});
test('rejects tampered accuracy and comparison aggregate', () => {
  const example = fixture();
  example.runs[0].methods.linear_input.accuracy = 0.99;
  assert.throws(() => validatePhotonicsReport(example), /accuracy and confusion/);
  const other = fixture();
  other.aggregate.electronic_tanh.mean_test_accuracy = .99;
  assert.throws(() => validatePhotonicsReport(other), /aggregate accuracy/);
});
test('rejects mismatched repeats or unknown method', () => {
  const example = fixture();
  example.protocol.repeats = 2;
  assert.throws(() => validatePhotonicsReport(example), /run count/);
  const other = fixture();
  other.protocol.methods.push('pretend_photonics');
  assert.throws(() => validatePhotonicsReport(other), /comparison/);
});
test('rejects giant and malformed imports without side effects', () => {
  assert.throws(() => parsePhotonicsReport('x'.repeat(PHOTONICS_MAX_BYTES + 1)), /too large/);
  assert.throws(() => parsePhotonicsReport('not json'), /malformed/);
  assert.throws(() => parsePhotonicsReport('{}'), /wrong schema/);
});
test('rejects malformed confusion and authorization claims', () => {
  const example = fixture();
  example.runs[0].methods.electronic_tanh.confusion_actual_rows_predicted_columns = [[16, 0], [0, 0]];
  assert.throws(() => validatePhotonicsReport(example), /accuracy and confusion/);
  const other = clone(fixture());
  other.interfaces.execution_authorized = true;
  assert.throws(() => validatePhotonicsReport(other), /authorize/);
});
