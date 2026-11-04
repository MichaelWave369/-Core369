import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, contextSweep, defaults, kvCompressionScenario, presets } from '../src/model.js';

const near = (actual, expected, epsilon = 1e-8) =>
  assert.ok(Math.abs(actual - expected) < epsilon, 'expected ' + actual + ' near ' + expected);

test('weights include quantization metadata factor', () => {
  const r = analyze({ parametersB: 70, weightBits: 4, metadataFactor: 1.1 });
  near(r.weightGiB, 70e9 * 0.5 * 1.1 / (1024 ** 3));
});

test('KV cache scales with context and sessions', () => {
  const a = analyze({ contextTokens: 4096, sessions: 1 });
  const b = analyze({ contextTokens: 8192, sessions: 1 });
  const c = analyze({ contextTokens: 4096, sessions: 2 });
  near(b.kvGiB, a.kvGiB * 2);
  near(c.kvGiB, a.kvGiB * 2);
});

test('small model fits and needs no offload', () => {
  const r = analyze(defaults);
  assert.equal(r.kvFits, true);
  assert.equal(r.offloadedGiB, 0);
  assert.ok(r.tokensPerSecondCeiling > 0);
});

test('larger dense model triggers offload', () => {
  const r = analyze({ ...presets.large, vramGiB: 12, contextTokens: 8192 });
  assert.ok(r.offloadedGiB > 0);
  assert.ok(Number.isFinite(r.ceilings.link));
  assert.ok(r.warnings.some(x => x.includes('offload')));
});

test('KV overflow invalidates token throughput estimate', () => {
  const r = analyze({ vramGiB: 4, contextTokens: 131072 });
  assert.equal(r.kvFits, false);
  assert.equal(r.tokensPerSecondCeiling, null);
});

test('KV compression reduces memory, not weight storage', () => {
  const { baseline, hypothesis, compressedBits } = kvCompressionScenario({ kvBits: 16 });
  assert.equal(compressedBits, 8);
  near(hypothesis.kvGiB * 2, baseline.kvGiB);
  near(hypothesis.weightGiB, baseline.weightGiB);
});

test('MoE compute savings do not erase weight storage', () => {
  const dense = analyze({ parametersB: 120, activeRatio: 1 });
  const sparse = analyze({ parametersB: 120, activeRatio: .05 });
  near(dense.weightGiB, sparse.weightGiB);
  assert.ok(sparse.ceilings.compute > dense.ceilings.compute);
});

test('link ceiling responds to link speed', () => {
  const a = analyze({ parametersB: 70, vramGiB: 12, linkGiBs: 16 });
  const b = analyze({ parametersB: 70, vramGiB: 12, linkGiBs: 32 });
  near(b.ceilings.link, 2 * a.ceilings.link);
});

test('invalid numbers produce stable results', () => {
  const r = analyze({ bandwidthGiBs: NaN, vramGiB: Infinity, parametersB: -5, contextTokens: 'oops' });
  assert.ok(Number.isFinite(r.workingSetGiB));
  assert.ok(r.tokensPerSecondCeiling == null || Number.isFinite(r.tokensPerSecondCeiling));
});

test('context sweep preserves order', () => {
  const points = [1024, 8192, 65536];
  const data = contextSweep(defaults, points);
  assert.deepEqual(data.map(x => x.contextTokens), points);
  assert.ok(data[0].kvGiB < data[1].kvGiB);
  assert.ok(data[1].kvGiB < data[2].kvGiB);
});
