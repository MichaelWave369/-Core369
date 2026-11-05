#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { askOllama, buildMessages, EVAL_CASES } from '../src/assistant/runtime.js';

const option = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
if (process.argv.includes('--help')) {
  console.log('Usage: npm run assistant:eval -- --model=qwen3:4b [--out=benchmarks/assistant-r0.json]');
  process.exit(0);
}
const model = option('model', 'qwen3:4b');
const out = option('out', 'benchmarks/assistant-r0.json');
const baseUrl = option('base-url', 'http://127.0.0.1:11434');
const report = { schema: 'phi.assistant.eval.v1',
  createdAt: new Date().toISOString(), model, modes: ['bare', 'profile', 'memory'],
  memoryScenario: 'No saved memory in the fixed synthetic suite; profile and memory modes are expected to match in context.',
  results: [] };
for (const item of EVAL_CASES) {
  for (const mode of report.modes) {
    try {
      const messages = buildMessages({ mode, prompt: item.prompt, memories: [] });
      const r = await askOllama({ model, messages, baseUrl });
      const pass = item.expected.test(r.text.trim());
      report.results.push({ case: item.id, mode, passed: pass, response: r.text, elapsedMs: r.elapsedMs, evalCount: r.evalCount });
      console.log(`${item.id.padEnd(12)} ${mode.padEnd(8)} ${pass ? 'PASS' : 'FAIL'} ${r.elapsedMs}ms`);
    } catch (error) {
      report.results.push({ case: item.id, mode, passed: false, error: String(error.message) });
      console.error(`${item.id} ${mode}: ${error.message}`);
    }
  }
}
await fs.mkdir(path.dirname(out), { recursive: true });
await fs.writeFile(out, JSON.stringify(report, null, 2) + '\n');
console.log(`Report: ${out}`);
console.log('Simple literal checks are NOT a measure of general intelligence or model parity.');
