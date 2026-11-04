/*
 * Local-only measurement report validation and comparison.
 * Imported reports are treated as UNTRUSTED files, never executable code.
 */
export const REPORT_SCHEMA = 'phicore369.measurement.v1';
const MAX_RUNS = 10000;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const positive = value => finite(value) && value >= 0;

export function median(values) {
  const sorted = values.filter(finite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const half = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2;
}

export function validateReport(report) {
  const fail = msg => { throw new Error('Invalid ΦCore369 report: ' + msg); };
  if (!report || typeof report !== 'object' || Array.isArray(report)) fail('root must be an object');
  if (report.schema !== REPORT_SCHEMA) fail('unsupported schema');
  if (report.source !== 'measured-ollama-local') fail('source must be measured-ollama-local');
  if (!report.manifest || typeof report.manifest !== 'object') fail('manifest missing');
  const m = report.manifest;
  if (m.backend !== 'ollama') fail('backend must be ollama');
  if (typeof m.model !== 'string' || !m.model || m.model.length > 256) fail('model missing');
  if (typeof m.modelDigest !== 'string' || !/^[a-f0-9]{64}$/i.test(m.modelDigest)) fail('model digest missing');
  if (!m.hardware || typeof m.hardware !== 'object') fail('hardware metadata missing');
  if (typeof m.hardware.os !== 'string' || typeof m.hardware.cpu !== 'string') fail('hardware identification missing');
  if (!m.options || typeof m.options !== 'object') fail('generation options missing');
  if (!Array.isArray(m.promptIds) || m.promptIds.length === 0 || m.promptIds.length > 100) fail('prompt identifiers missing');
  if (!m.promptIds.every(p => typeof p === 'string' && p.length > 0 && p.length <= 100)) fail('invalid prompt identifiers');
  if (!Array.isArray(report.runs) || !report.runs.length || report.runs.length > MAX_RUNS) fail('runs missing or excessive');
  for (const [index, run] of report.runs.entries()) {
    if (!run || typeof run !== 'object') fail('invalid run at index ' + index);
    if (!Number.isInteger(run.sequence) || run.sequence < 1) fail('invalid sequence');
    if (!m.promptIds.includes(run.promptId)) fail('unknown prompt ID');
    if (!/^[a-f0-9]{64}$/i.test(run.promptSha256 || '')) fail('invalid prompt hash');
    if (typeof run.ok !== 'boolean') fail('success flag missing');
    if (run.ok) {
      for (const key of ['promptTokens', 'generatedTokens', 'promptSeconds', 'decodeSeconds', 'totalSeconds', 'loadSeconds', 'promptTokensPerSec', 'decodeTokensPerSec']) {
        if (!positive(run[key])) fail('invalid ' + key + ' in run ' + run.sequence);
      }
      if (run.generatedTokens <= 0 || run.decodeSeconds <= 0) fail('successful run needs nonzero generated tokens and time');
      if (run.clientTtftMs !== null && !positive(run.clientTtftMs)) fail('invalid first token time');
    }
  }
  return report;
}

export function summarize(report) {
  validateReport(report);
  const successful = report.runs.filter(r => r.ok);
  const failures = report.runs.length - successful.length;
  return {
    total: report.runs.length,
    successful: successful.length,
    failures,
    decodeMedian: median(successful.map(r => r.decodeTokensPerSec)),
    promptMedian: median(successful.map(r => r.promptTokensPerSec)),
    ttftMedianMs: median(successful.map(r => r.clientTtftMs)),
    endToEndMedian: median(successful.map(r => r.totalSeconds)),
    generatedTokensMedian: median(successful.map(r => r.generatedTokens)),
    byPrompt: report.manifest.promptIds.map(promptId => ({
      promptId,
      count: successful.filter(r => r.promptId === promptId).length,
      decodeMedian: median(successful.filter(r => r.promptId === promptId).map(r => r.decodeTokensPerSec))
    }))
  };
}

export function compareReports(first, second) {
  validateReport(first);
  validateReport(second);
  const a = first.manifest;
  const b = second.manifest;
  const mismatches = [];
  const check = (label, one, two) => {
    if (JSON.stringify(one) !== JSON.stringify(two)) mismatches.push(label);
  };
  check('model digest', a.modelDigest, b.modelDigest);
  check('model name', a.model, b.model);
  check('hardware', a.hardware, b.hardware);
  check('Ollama version', a.backendVersion, b.backendVersion);
  check('generation settings', a.options, b.options);
  check('prompt set and order', a.promptIds, b.promptIds);
  check('prompt checksums', a.promptHashes, b.promptHashes);
  const sa = summarize(first);
  const sb = summarize(second);
  if (sa.successful < 5 || sb.successful < 5) mismatches.push('minimum five successful runs per report');
  if (sa.failures || sb.failures) mismatches.push('failed runs present');
  if (sa.byPrompt.some((p, i) => p.count !== sb.byPrompt[i]?.count)) mismatches.push('unbalanced prompt distribution');
  const compatible = mismatches.length === 0;
  const deltaPercent = compatible && sa.decodeMedian > 0 && sb.decodeMedian !== null
    ? (sb.decodeMedian / sa.decodeMedian - 1) * 100
    : null;
  return { compatible, mismatches, baseline: sa, repeat: sb, deltaPercent };
}
