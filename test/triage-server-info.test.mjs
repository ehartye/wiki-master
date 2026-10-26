import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJsonWhenReady } from './helpers/wait-file.mjs';

// The triage client and the tests poll for state/server-info and read it the moment it exists. The server wrote it in
// place, so a reader that arrived between the file being created and being filled saw it empty or cut off and failed
// with "Unexpected end of JSON input" (twice in one cycle, under a loaded parallel run). It is now written under a
// temporary name and renamed, so a reader sees the whole file or none.

const require = createRequire(import.meta.url);
const { writeFileAtomic } = require('../scripts/triage-ui/atomic-write.cjs');

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'wm-atomic-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('the final path never holds partial text: the content is written elsewhere and renamed into place', (t) => {
  const dir = tempDir(t);
  const final = join(dir, 'server-info');
  const seen = [];
  const realWrite = fs.writeFileSync; const realRename = fs.renameSync;
  fs.writeFileSync = (file, ...rest) => { seen.push({ op: 'write', file: String(file), finalExists: existsSync(final) }); return realWrite(file, ...rest); };
  fs.renameSync = (from, to) => { seen.push({ op: 'rename', from: String(from), to: String(to) }); return realRename(from, to); };
  try { writeFileAtomic(final, '{"port":1}\n'); } finally { fs.writeFileSync = realWrite; fs.renameSync = realRename; }
  assert.equal(seen[0].op, 'write');
  assert.notEqual(seen[0].file, final, 'the text is not written to the final path');
  assert.equal(seen[0].finalExists, false, 'the final path does not exist while the text is being written');
  assert.deepEqual([seen[1].op, seen[1].from, seen[1].to], ['rename', seen[0].file, final]);
  assert.equal(readFileSync(final, 'utf8'), '{"port":1}\n');
  assert.deepEqual(readdirSync(dir), ['server-info'], 'no temporary file is left behind');
});

test('an existing file keeps its old content until the rename and is then replaced whole', (t) => {
  const dir = tempDir(t);
  const final = join(dir, 'server-info');
  writeFileSync(final, '{"port":1}\n');
  const during = [];
  const realWrite = fs.writeFileSync;
  fs.writeFileSync = (file, ...rest) => { during.push(readFileSync(final, 'utf8')); return realWrite(file, ...rest); };
  try { writeFileAtomic(final, '{"port":22222}\n'); } finally { fs.writeFileSync = realWrite; }
  assert.deepEqual(during, ['{"port":1}\n'], 'a reader during the write still sees the previous whole file');
  assert.equal(readFileSync(final, 'utf8'), '{"port":22222}\n');
});

test('readJsonWhenReady waits through a missing, empty and cut-off file', async (t) => {
  const dir = tempDir(t);
  const file = join(dir, 'server-info');
  setTimeout(() => writeFileSync(file, ''), 30);
  setTimeout(() => writeFileSync(file, '{"port":123'), 90);
  setTimeout(() => writeFileSync(file, '{"port":123}\n'), 200);
  const info = await readJsonWhenReady(file, { timeoutMs: 3000, intervalMs: 20 });
  assert.deepEqual(info, { port: 123 });
});

test('readJsonWhenReady times out with the reason when the file never parses', async (t) => {
  const dir = tempDir(t);
  const file = join(dir, 'server-info');
  writeFileSync(file, '{"port":');
  await assert.rejects(readJsonWhenReady(file, { timeoutMs: 150, intervalMs: 20 }), /did not parse yet/);
  await assert.rejects(readJsonWhenReady(join(dir, 'absent'), { timeoutMs: 100, intervalMs: 20 }), /never appeared/);
});

test('the server writes server-info through the atomic writer, never in place', () => {
  const src = readFileSync(new URL('../scripts/triage-ui/server.cjs', import.meta.url), 'utf8');
  assert.match(src, /writeFileAtomic\(path\.join\(STATE_DIR, 'server-info'\)/);
  assert.doesNotMatch(src, /fs\.writeFileSync\(path\.join\(STATE_DIR, 'server-info'\)/);
});
