/*
 * ΦCore369 R1 analytical inference model.
 * NOT a benchmark and NOT a physical performance predictor.
 * The simple roofline ceilings intentionally omit kernels, memory contention,
 * prefill scheduling, quantization error, and real offload execution details.
 */
export const GiB = 1024 ** 3;
export const defaults = Object.freeze({
  parametersB: 8,
  activeRatio: 1,
  weightBits: 4,
  metadataFactor: 1.1,
  contextTokens: 8192,
  layers: 32,
  kvHeads: 8,
  headDim: 128,
  kvBits: 16,
  sessions: 1,
  vramGiB: 12,
  bandwidthGiBs: 550,
  linkGiBs: 24,
  computeTflops: 70,
  efficiency: 0.6,
  reserveGiB: 0.75
});

export const presets = Object.freeze({
  edge: { name: 'EDGE / 8B', detail: 'Dense model • compact local setup', parametersB: 8, activeRatio: 1, layers: 32, kvHeads: 8, headDim: 128 },
  workstation: { name: 'WORKSTATION / 32B', detail: 'Dense model • greater memory demand', parametersB: 32, activeRatio: 1, layers: 64, kvHeads: 8, headDim: 128 },
  large: { name: 'LARGE / 70B', detail: 'Dense model • offload stress test', parametersB: 70, activeRatio: 1, layers: 80, kvHeads: 8, headDim: 128 },
  sparse: { name: 'SPARSE / 120B', detail: 'Hypothetical MoE • 5% active weights', parametersB: 120, activeRatio: 0.05, layers: 64, kvHeads: 8, headDim: 128 }
});

function bounded(value, fallback, lo, hi) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

export function analyze(input = {}) {
  const raw = { ...defaults, ...input };
  const s = {
    parametersB: bounded(raw.parametersB, defaults.parametersB, 0.1, 1000),
    activeRatio: bounded(raw.activeRatio, defaults.activeRatio, 0.001, 1),
    weightBits: bounded(raw.weightBits, defaults.weightBits, 1, 32),
    metadataFactor: bounded(raw.metadataFactor, defaults.metadataFactor, 1, 2),
    contextTokens: bounded(raw.contextTokens, defaults.contextTokens, 1, 1048576),
    layers: bounded(raw.layers, defaults.layers, 1, 256),
    kvHeads: bounded(raw.kvHeads, defaults.kvHeads, 1, 256),
    headDim: bounded(raw.headDim, defaults.headDim, 1, 512),
    kvBits: bounded(raw.kvBits, defaults.kvBits, 1, 32),
    sessions: bounded(raw.sessions, defaults.sessions, 1, 128),
    vramGiB: bounded(raw.vramGiB, defaults.vramGiB, 0.5, 2048),
    bandwidthGiBs: bounded(raw.bandwidthGiBs, defaults.bandwidthGiBs, 1, 100000),
    linkGiBs: bounded(raw.linkGiBs, defaults.linkGiBs, 0.01, 100000),
    computeTflops: bounded(raw.computeTflops, defaults.computeTflops, 0.01, 1000000),
    efficiency: bounded(raw.efficiency, defaults.efficiency, 0.01, 1),
    reserveGiB: bounded(raw.reserveGiB, defaults.reserveGiB, 0, 256)
  };

  // Memory is provisioned for all sessions. No prefix sharing is assumed.
  const weightGiB = (s.parametersB * 1e9 * s.weightBits / 8 * s.metadataFactor) / GiB;
  const kvGiB = (s.contextTokens * s.layers * s.kvHeads * s.headDim * 2 * s.kvBits / 8 * s.sessions) / GiB;
  const workingSetGiB = weightGiB + kvGiB + s.reserveGiB;
  const kvFits = kvGiB + s.reserveGiB <= s.vramGiB;
  const residentGiB = Math.min(weightGiB, Math.max(0, s.vramGiB - kvGiB - s.reserveGiB));
  const offloadedGiB = Math.max(0, weightGiB - residentGiB);

  // Roofline approximation for single-sequence decode. These are intentionally
  // optimistic upper bounds, not achievable measurements. When offload is
  // present, the link limit assumes all nonresident weights traverse it/token.
  const computeCeiling = (s.computeTflops * 1e12 * s.efficiency) /
    (2 * s.parametersB * 1e9 * s.activeRatio);
  const memoryCeiling = (s.bandwidthGiBs * s.efficiency) /
    Math.max(1e-9, weightGiB + kvGiB / s.sessions);
  const linkCeiling = offloadedGiB > 1e-9
    ? (s.linkGiBs * s.efficiency) / offloadedGiB
    : Infinity;

  const ceilings = { compute: computeCeiling, memory: memoryCeiling, link: linkCeiling };
  const limitingFactor = Object.entries(ceilings).reduce((a, b) => b[1] < a[1] ? b : a)[0];
  const tokensPerSecondCeiling = kvFits ? Math.min(...Object.values(ceilings)) : null;
  const warnings = [];
  if (!kvFits) warnings.push('The modeled KV cache plus reserve exceeds accelerator memory. This simplified model cannot estimate that configuration.');
  if (offloadedGiB > 0) warnings.push('Weight offload is required. Real performance depends on transfer overlap, kernels and CPU memory bandwidth.');
  if (s.activeRatio < 1) warnings.push('Sparse-model active compute is modeled; all model weights still occupy storage. Routing overhead is omitted.');
  if (s.kvBits < 16) warnings.push('KV compression may affect model quality; no accuracy evaluation is included.');
  return {
    settings: s, weightGiB, kvGiB, workingSetGiB, residentGiB,
    offloadedGiB, kvFits, ceilings, limitingFactor, tokensPerSecondCeiling, warnings
  };
}

export function kvCompressionScenario(input = {}) {
  const baseline = analyze(input);
  const compressedBits = Math.max(4, baseline.settings.kvBits / 2);
  const hypothesis = analyze({ ...baseline.settings, kvBits: compressedBits });
  return { baseline, hypothesis, compressedBits };
}

export function contextSweep(input = {}, points = [2048, 4096, 8192, 16384, 32768, 65536, 131072]) {
  return points.map(contextTokens => ({
    contextTokens,
    ...analyze({ ...input, contextTokens })
  }));
}
