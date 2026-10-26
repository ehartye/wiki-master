import { existsSync, readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

// Waits for a JSON file to exist and parse. A file a server has created but not finished writing is empty or cut off,
// and parsing it at once fails with "Unexpected end of JSON input": the flake in the triage-auth tests under load.
export async function readJsonWhenReady(file, { timeoutMs = 5000, intervalMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = 'it never appeared';
  for (;;) {
    if (existsSync(file)) {
      try { return JSON.parse(readFileSync(file, 'utf8')); } catch (error) { last = `it did not parse yet: ${error.message}`; }
    }
    if (Date.now() >= deadline) throw new Error(`${file}: ${last} within ${timeoutMs} ms`);
    await sleep(intervalMs);
  }
}
