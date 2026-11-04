import test from 'node:test';
import assert from 'node:assert/strict';
import { compareReports, median, summarize, validateReport } from '../src/measurements.js';
import { collect, parseArgs, streamGenerate, PROMPTS } from '../scripts/ollama-bench.mjs';

const digest = 'a'.repeat(64);
const mockResult = {
  promptTokens: 50, generatedTokens: 20, promptSeconds: .5, decodeSeconds: 2,
  totalSeconds: 3, loadSeconds: .1, promptTokensPerSec: 100,
  decodeTokensPerSec: 10, clientTtftMs: 200, doneReason: 'stop'
};
const localConfig = () => parseArgs(['--model', 'qwen3:4b', '--runs', '6']);
const dependencies = () => ({
  fetchJson: async url => url.endsWith('/api/tags')
    ? { models: [{ name: 'qwen3:4b', digest, size: 5e9 }] }
    : { version: '0.10.mock' },
  generate: async () => mockResult,
  deviceInfo: () => ({ os: 'mock OS', cpu: 'mock CPU', gpu: null }),
  log: () => {}
});

test('median uses center value(s) only', () => {
  assert.equal(median([100, 1, 3, 2]), 2.5);
  assert.equal(median([6, 2, 5]), 5);
  assert.equal(median([]), null);
});

test('collector creates genuine schema-shaped data without generated text', async () => {
  let requests = 0;
  const deps = dependencies();
  const originalGenerate = deps.generate;
  deps.generate = async (...args) => { requests++; return originalGenerate(...args); };
  const r = await collect(localConfig(), deps);
  assert.equal(r.schema, 'phicore369.measurement.v1');
  assert.equal(r.source, 'measured-ollama-local');
  assert.equal(r.manifest.modelDigest, digest);
  assert.equal(r.runs.length, 6);
  assert.equal(requests, 7); // one unrecorded warmup
  assert.deepEqual(r.runs.map(x => x.promptId), ['explain', 'reason', 'code', 'explain', 'reason', 'code']);
  validateReport(r);
  assert.ok(!JSON.stringify(r).includes(PROMPTS[0].text));
  assert.ok(!JSON.stringify(r).includes('"response"'));
});

test('summarizer counts successful runs and calculates throughput medians', async () => {
  const report = await collect(localConfig(), dependencies());
  const stats = summarize(report);
  assert.equal(stats.total, 6);
  assert.equal(stats.successful, 6);
  assert.equal(stats.decodeMedian, 10);
  assert.equal(stats.promptMedian, 100);
  assert.equal(stats.byPrompt[0].count, 2);
});

test('repeated identical conditions compare without claiming a real improvement', async () => {
  const [a, b] = await Promise.all([
    collect(localConfig(), dependencies()),
    collect(localConfig(), dependencies())
  ]);
  const c = compareReports(a, b);
  assert.equal(c.compatible, true);
  assert.equal(c.deltaPercent, 0);
  b.manifest.options.num_ctx = 8192;
  const invalid = compareReports(a, b);
  assert.equal(invalid.compatible, false);
  assert.ok(invalid.mismatches.includes('generation settings'));
});

test('report validator rejects malformed and misleading inputs', async () => {
  const original = await collect(localConfig(), dependencies());
  assert.throws(() => validateReport({ ...original, schema: 'unknown' }), /unsupported schema/);
  const invalid = structuredClone(original);
  invalid.runs[0].decodeTokensPerSec = Infinity;
  assert.throws(() => validateReport(invalid), /decodeTokensPerSec/);
  const failed = structuredClone(original);
  failed.runs[0] = { sequence: 1, promptId: 'explain', promptSha256: failed.runs[0].promptSha256, ok: false, error: 'request timed out' };
  const stats = summarize(failed);
  assert.equal(stats.successful, 5);
  assert.equal(stats.failures, 1);
});

test('CLI blocks nonlocal endpoint and invalid sample sizes', () => {
  assert.throws(() => parseArgs(['--model', 'qwen3:4b', '--url', 'https://example.org']), /localhost/);
  assert.throws(() => parseArgs(['--model', 'qwen3:4b', '--url', 'http://192.168.1.20:11434']), /localhost/);
  assert.throws(() => parseArgs(['--model', 'qwen3:4b', '--runs', '2']), /--runs/);
  assert.equal(parseArgs(['--model', 'qwen3:4b']).runs, 6);
  assert.equal(parseArgs(['--help']).help, true);
});

test('stream parser tolerates chunk splits and takes Ollama decode metrics', async () => {
  const encoder = new TextEncoder();
  const events = [
    JSON.stringify({ response: 'Hello', done: false }) + '\n',
    JSON.stringify({
      response: '', done: true, prompt_eval_count: 30,
      prompt_eval_duration: 1000000000, prompt_eval_cached_count: 10, eval_count: 20,
      eval_duration: 2000000000, total_duration: 3000000000,
      load_duration: 500000000, done_reason: 'stop'
    }) + '\n'
  ].join('');
  const bytes = encoder.encode(events);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.subarray(0, 16));
      controller.enqueue(bytes.subarray(16, 44));
      controller.enqueue(bytes.subarray(44));
      controller.close();
    }
  });
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(stream, { status: 200 });
  try {
    const r = await streamGenerate('http://127.0.0.1:11434', { model: 'test', prompt: 'text' });
    assert.equal(r.decodeTokensPerSec, 10);
    assert.equal(r.promptTokens, 30);
    assert.equal(r.promptCachedTokens, 10);
    assert.equal(r.promptUncachedTokens, 20);
    assert.equal(r.promptTokensPerSec, 20);
    assert.equal(r.generatedTokens, 20);
    assert.ok(r.clientTtftMs >= 0);
    assert.equal(r.loadSeconds, .5);
  } finally {
    globalThis.fetch = oldFetch;
  }
});
