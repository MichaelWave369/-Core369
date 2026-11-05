#!/usr/bin/env node
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { randomUUID } from 'node:crypto';
import { askOllama, buildMessages, newMemory } from '../src/assistant/runtime.js';
import { loadMemories, saveMemories, DEFAULT_MEMORY_PATH } from '../src/assistant/storage.js';

function option(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find(arg => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}
const model = option('model', 'qwen3:4b');
const baseUrl = option('base-url', 'http://127.0.0.1:11434');
let mode = option('mode', 'memory');
if (process.argv.includes('--help')) {
  console.log('Usage: npm run assistant:chat -- --model=qwen3:4b [--mode=bare|profile|memory] [--base-url=http://127.0.0.1:11434]');
  console.log('Commands: /help, /mode bare|profile|memory, /remember TEXT, /memories, /forget ID, /compare PROMPT, /reset, /exit');
  process.exit(0);
}
if (!['bare', 'profile', 'memory'].includes(mode)) throw new Error('Mode must be bare, profile, or memory');
let memories = await loadMemories();
let history = [];
const rl = readline.createInterface({ input, output });
console.log(`\nΦ Companion R0 | model: ${model} | mode: ${mode}`);
console.log(`Local inference only. Explicit memory: ${DEFAULT_MEMORY_PATH}`);
console.log('Type /help for commands; Ctrl+C or /exit to leave.\n');
try {
  while (true) {
    const line = (await rl.question('you > ')).trim();
    if (!line) continue;
    if (line === '/exit' || line === '/quit') break;
    if (line === '/help') {
      console.log('/mode bare|profile|memory | /remember TEXT | /memories | /forget ID | /compare PROMPT | /reset | /exit');
      continue;
    }
    if (line.startsWith('/mode ')) {
      const value = line.slice(6).trim();
      if (!['bare', 'profile', 'memory'].includes(value)) console.log('Choose bare, profile, or memory.');
      else { mode = value; history = []; console.log(`Mode: ${mode}; conversation reset for cleaner comparison.`); }
      continue;
    }
    if (line === '/reset') { history = []; console.log('Current conversation cleared (saved memories untouched).'); continue; }
    if (line === '/memories') {
      if (!memories.length) console.log('No saved notes.');
      for (const m of memories) console.log(`${m.id}: ${m.text}`);
      continue;
    }
    if (line.startsWith('/remember ')) {
      try {
        memories = newMemory(memories, line.slice(10), { id: randomUUID() });
        await saveMemories(memories);
        console.log(`Saved locally. ID: ${memories.at(-1).id}`);
      } catch (error) { console.error(`Not saved: ${error.message}`); }
      continue;
    }
    if (line.startsWith('/forget ')) {
      const id = line.slice(8).trim();
      if (!memories.some(m => m.id === id)) console.log('No matching ID.');
      else { const next = memories.filter(m => m.id !== id); await saveMemories(next); memories = next; console.log('Local note deleted.'); }
      continue;
    }
    const compare = line.startsWith('/compare ');
    const prompt = compare ? line.slice(9).trim() : line;
    if (!prompt) { console.log('Enter a prompt.'); continue; }
    const modes = compare ? ['bare', 'profile', 'memory'] : [mode];
    for (const selected of modes) {
      try {
        const messages = buildMessages({ mode: selected, prompt, history, memories });
        const answer = await askOllama({ model, messages, baseUrl });
        console.log(`\n${selected} | ${answer.elapsedMs}ms | ${answer.model}\n${answer.text}\n`);
        if (!compare) history.push({ role: 'user', content: prompt }, { role: 'assistant', content: answer.text });
        // Compare mode does not mutate conversation history.
      } catch (error) { console.error(`${selected}: ${error.message}`); }
    }
  }
} finally { rl.close(); }
