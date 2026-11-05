import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { askOllama, buildMessages, newMemory, ollamaEndpoint, recall, validateMemory, EVAL_CASES } from '../src/assistant/runtime.js';
import { loadMemories, saveMemories } from '../src/assistant/storage.js';

const notes = [
  { id: 'a', text: 'Project PhiOS runs on local hardware', createdAt: '2026-01-01T00:00:00Z' },
  { id: 'b', text: 'The favorite snack is pineapple', createdAt: '2026-01-01T00:00:00Z' },
];

test('bare mode has no profile persona or recalled memory', () => {
  const m = buildMessages({ mode: 'bare', prompt: 'Tell me about PhiOS', memories: notes });
  assert.equal(m.length, 2);
  assert.doesNotMatch(JSON.stringify(m), /pineapple|Phi Companion/);
});

test('profile mode has its own identity without recalled memory', () => {
  const m = buildMessages({ mode: 'profile', prompt: 'PhiOS', memories: notes });
  assert.match(m[0].content, /Phi Companion/);
  assert.equal(m.length, 2);
});

test('memory mode selects relevant notes and excludes irrelevant ones', () => {
  const m = buildMessages({ mode: 'memory', prompt: 'Explain PhiOS hardware', memories: notes });
  assert.equal(m.length, 3);
  assert.match(m[1].content, /PhiOS/);
  assert.doesNotMatch(m[1].content, /pineapple/);
});

test('empty and irrelevant queries do not inject saved notes', () => {
  assert.equal(recall(notes, 'the and is').length, 0);
  assert.equal(buildMessages({ mode: 'memory', prompt: 'Tell me about rain', memories: notes }).length, 2);
});

test('new memory is user-explicit, normalized, duplicate-checked', () => {
  const result = newMemory([], '  Please use local data ', { id: 'test', now: '2026-02-03T00:00:00Z' });
  assert.equal(result[0].text, 'Please use local data');
  assert.throws(() => newMemory(result, 'please use local data'), /already saved/);
  assert.throws(() => newMemory(result, 'x'.repeat(601)), /600/);
});

test('bad duplicate ids or untrusted malformed memory rejected', () => {
  assert.throws(() => validateMemory([notes[0], notes[0]]), /duplicate/);
  assert.throws(() => validateMemory([{ id: 'bad', text: 'okay', createdAt: 'not-a-date' }]), /timestamp/);
  assert.throws(() => validateMemory({ text: 'oops' }), /array/);
});

test('prompt and history are bounded, no tool role allowed', () => {
  assert.throws(() => buildMessages({ mode: 'other', prompt: 'hello' }), /Unknown mode/);
  assert.throws(() => buildMessages({ prompt: '' }), /Prompt/);
  assert.throws(() => buildMessages({ prompt: 'hello', history: [{ role: 'system', content: 'hack' }] }), /Invalid/);
  assert.equal(buildMessages({ prompt: 'hello', history: Array(20).fill({ role: 'user', content: 'hi' }) }).length, 14);
});

test('Ollama origin is loopback only and path-free', () => {
  assert.equal(ollamaEndpoint(), 'http://127.0.0.1:11434/api/chat');
  assert.equal(ollamaEndpoint('http://localhost:11434'), 'http://localhost:11434/api/chat');
  for (const u of ['http://example.com:11434', 'https://localhost:11434', 'http://127.0.0.1:11434/evil', 'http://user:pw@localhost:11434', 'http://localhost:11434/?x=1']) {
    assert.throws(() => ollamaEndpoint(u), /loopback/);
  }
});

test('Ollama adapter uses only local chat endpoint, seed and no streaming', async () => {
  let request;
  const fetchImpl = async (url, init) => {
    request = { url, init, payload: JSON.parse(init.body) };
    return { ok: true, json: async () => ({ model: 'qwen3:4b', message: { content: '42' }, eval_count: 2, eval_duration: 50000 }) };
  };
  const result = await askOllama({ model: 'qwen3:4b', messages: [{ role: 'user', content: 'Question' }], fetchImpl });
  assert.equal(request.url, 'http://127.0.0.1:11434/api/chat');
  assert.equal(request.payload.stream, false);
  assert.deepEqual(request.payload.options, { temperature: 0, seed: 369 });
  assert.equal(result.text, '42');
  assert.equal(result.evalCount, 2);
});

test('Ollama adapter fails closed on model errors or bad replies', async () => {
  const fetchImpl = async () => ({ ok: false, status: 404, text: async () => 'model not found' });
  await assert.rejects(() => askOllama({ model: 'missing', messages: [{}], fetchImpl }), /HTTP 404/);
  await assert.rejects(() => askOllama({ model: 'bad model', messages: [{}], fetchImpl }), /model name/);
  await assert.rejects(() => askOllama({ model: 'good', messages: [{}], fetchImpl: async () => ({ ok: true, json: async () => ({}) }) }), /no assistant text/);
});

test('memory is local, survives save and load, supports deletion by replacement', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'phi-assistant-test-'));
  const file = path.join(directory, 'subdir', 'memories.json');
  try {
    assert.deepEqual(await loadMemories(file), []);
    await saveMemories(notes, file);
    assert.deepEqual(await loadMemories(file), notes);
    await saveMemories([notes[1]], file);
    assert.deepEqual(await loadMemories(file), [notes[1]]);
    if (process.platform !== 'win32') {
      const stat = await fs.stat(file);
      assert.equal(stat.mode & 0o077, 0);
    }
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('eval suite contains deterministic, minimally checkable tasks', () => {
  assert.equal(EVAL_CASES.length, 3);
  assert.equal(EVAL_CASES[0].expected.test('READY'), true);
  assert.equal(EVAL_CASES[1].expected.test('43'), false);
});
