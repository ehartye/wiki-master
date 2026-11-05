import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { refreshIndex } from '../scripts/lib/embedding.mjs';
import { EMBED_MODEL } from '../scripts/lib/embed.mjs';

// A refresh that has nothing to do rewrites no file, so a timed backup of the vault never sees a change it did not
// cause. Vectors are already sorted; the manifest's keys are sorted here. What must still persist is a change of
// mtime: a touched file with identical content has to reach the manifest once, or it would be re-chunked forever.

const ARTIFACTS = ['chunks.json', 'vectors.bin', 'vectors.idx.json'];
const OLD = new Date('2020-01-01T00:00:00Z');

function vault(t, files = { 'wiki/concepts/a.md': '# A\n\nAbout A.\n', 'wiki/concepts/b.md': '# B\n\nAbout B.\n', 'wiki/concepts/c.md': '# C\n\nAbout C.\n' }) {
  const root = mkdtempSync(join(tmpdir(), 'wm-persist-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const embedFn = async (text) => [text.length, text.length / 2, 1, 1];
const dirOf = (root) => join(root, '.wiki-master');

// One refresh, counting what it writes and renames.
async function refresh(root, options = {}) {
  const writes = [];
  const renames = [];
  const result = await refreshIndex({
    vaultPath: root, dir: dirOf(root), embedFn, checkAvailable: async () => true, checkModel: async () => true,
    writeFileImpl: (path, data) => { writes.push(path); writeFileSync(path, data); },
    renameImpl: (from, to) => { renames.push(to); renameSync(from, to); },
    ...options,
  });
  return { result, writes, renames };
}

// Backdates the artifacts so an unchanged modification time means the file was not rewritten, whatever the
// resolution of the file system's clock.
function backdate(root) { for (const name of ARTIFACTS) utimesSync(join(dirOf(root), name), OLD, OLD); }
const times = (root) => ARTIFACTS.map((name) => statSync(join(dirOf(root), name)).mtimeMs);
const bytes = (root) => ARTIFACTS.map((name) => readFileSync(join(dirOf(root), name)).toString('base64'));
const manifest = (root) => JSON.parse(readFileSync(join(dirOf(root), 'chunks.json'), 'utf8'));

function assertUntouched(run, root, before) {
  assert.deepEqual(run.writes, [], 'a run with nothing to do writes no temp file');
  assert.deepEqual(run.renames, [], 'a run with nothing to do renames nothing');
  assert.equal(run.result.persisted, false);
  assert.deepEqual(times(root), before, 'modification times are unchanged');
}

test('a missing index is built, and the run after it rewrites no file', async (t) => {
  const root = vault(t);
  const first = await refresh(root);
  assert.equal(first.result.persisted, true);
  assert.equal(first.renames.length, 3);
  assert.equal(first.result.filesChanged, 3);
  backdate(root);
  const before = times(root);
  assertUntouched(await refresh(root), root, before);
});

test('the run right after an edit rewrites no file, although the edit moved a key to the end of the manifest', async (t) => {
  const root = vault(t);
  await refresh(root);
  writeFileSync(join(root, 'wiki/concepts/a.md'), '# A\n\nAbout A, and a new sentence.\n');
  const edit = await refresh(root);
  assert.equal(edit.result.persisted, true);
  assert.deepEqual(Object.keys(manifest(root)), [...Object.keys(manifest(root))].sort(), 'manifest keys are written sorted');
  backdate(root);
  const before = times(root);
  assertUntouched(await refresh(root), root, before);
});

test('a touched file with the same content changes the manifest once, embeds nothing, and then stops', async (t) => {
  const root = vault(t);
  await refresh(root);
  backdate(root);
  const touched = new Date('2021-06-01T00:00:00Z');
  utimesSync(join(root, 'wiki/concepts/b.md'), touched, touched);
  const vectorsBefore = readFileSync(join(dirOf(root), 'vectors.bin'));

  const once = await refresh(root);
  assert.equal(once.result.persisted, true);
  assert.equal(once.result.chunksEmbedded, 0);
  assert.equal(manifest(root)['wiki/concepts/b.md'].mtimeMs, touched.getTime(), 'the new mtime reached the manifest');
  assert.deepEqual(readFileSync(join(dirOf(root), 'vectors.bin')), vectorsBefore);

  backdate(root);
  const before = times(root);
  const again = await refresh(root);
  assertUntouched(again, root, before);
  assert.equal(again.result.filesChanged, 0, 'the file is no longer re-chunked');
});

test('all three files are written or none: one changed output replaces the set', async (t) => {
  const root = vault(t);
  await refresh(root);
  backdate(root);
  const before = times(root);
  rmSync(join(dirOf(root), 'vectors.idx.json'));
  const run = await refresh(root);
  assert.equal(run.result.persisted, true);
  assert.equal(run.writes.length, 3);
  assert.equal(run.renames.length, 3);
  assert.ok(times(root).every((time, i) => time !== before[i]), 'every artifact was replaced');
});

test('a deleted page changes the index once, then stops', async (t) => {
  const root = vault(t);
  await refresh(root);
  rmSync(join(root, 'wiki/concepts/c.md'));
  const removed = await refresh(root);
  assert.equal(removed.result.persisted, true);
  assert.equal(removed.result.filesRemoved, 1);
  assert.equal(manifest(root)['wiki/concepts/c.md'], undefined);
  backdate(root);
  const before = times(root);
  assertUntouched(await refresh(root), root, before);
});

test('a manifest in the old key order is rewritten once, with the same content, then left alone', async (t) => {
  const root = vault(t);
  await refresh(root);
  const sorted = manifest(root);
  const reversed = Object.fromEntries(Object.entries(sorted).reverse());
  writeFileSync(join(dirOf(root), 'chunks.json'), JSON.stringify(reversed));
  const once = await refresh(root);
  assert.equal(once.result.persisted, true);
  assert.equal(once.result.chunksEmbedded, 0);
  assert.equal(readFileSync(join(dirOf(root), 'chunks.json'), 'utf8'), JSON.stringify(sorted));
  backdate(root);
  const before = times(root);
  assertUntouched(await refresh(root), root, before);
});

test('--rebuild with nothing changed re-chunks every file and still rewrites nothing', async (t) => {
  const root = vault(t);
  await refresh(root);
  backdate(root);
  const before = times(root);
  const content = bytes(root);
  const run = await refresh(root, { rebuild: true });
  assert.equal(run.result.filesChanged, 3);
  assert.equal(run.result.chunksEmbedded, 0);
  assertUntouched(run, root, before);
  assert.deepEqual(bytes(root), content);
});

test('a chunk that keeps failing is reported each run, and a repeat failure rewrites nothing', async (t) => {
  const root = vault(t, { 'wiki/concepts/a.md': '# A\n\nAbout A.\n' });
  const failing = async () => { throw new Error('too long'); };
  const first = await refresh(root, { embedFn: failing });
  assert.equal(first.result.chunksFailed, first.result.filesChanged);
  assert.equal(first.result.persisted, true);
  backdate(root);
  const before = times(root);
  const again = await refresh(root, { embedFn: failing });
  assert.ok(again.result.chunksFailed > 0);
  assertUntouched(again, root, before);
});

test('the pull advice names the configured model, not a fixed one', async (t) => {
  const root = vault(t);
  await assert.rejects(refresh(root, { checkModel: async () => false, model: 'custom-embedder' }), /ollama pull custom-embedder/);
  await assert.rejects(refresh(root, { checkModel: async () => false }), new RegExp(`ollama pull ${EMBED_MODEL}`));
});
