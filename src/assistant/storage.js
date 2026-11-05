import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateMemory } from './runtime.js';

// Separate from the Git checkout and never uploaded to GitHub Pages.
export const DEFAULT_MEMORY_PATH = path.join(os.homedir(), '.phi369', 'assistant-memory.json');

export async function loadMemories(file = DEFAULT_MEMORY_PATH) {
  try {
    const text = await fs.readFile(file, 'utf8');
    return validateMemory(JSON.parse(text));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function saveMemories(memories, file = DEFAULT_MEMORY_PATH) {
  const valid = validateMemory(memories);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(valid, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, file);
    await fs.chmod(file, 0o600);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
