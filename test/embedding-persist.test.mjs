import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { refreshIndex, statusReport } from '../scripts/lib/embedding.mjs';
import { EMBED_MODEL } from '../scripts/lib/embed.mjs';
import { decodeVectors } from '../scripts/lib/vector-index.mjs';

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

// ---- a damaged index ----

const damage = {
  'chunks.json is not JSON': (root) => writeFileSync(join(dirOf(root), 'chunks.json'), '{ nope'),
  'chunks.json has the wrong shape': (root) => writeFileSync(join(dirOf(root), 'chunks.json'), '[1,2]'),
  'a manifest entry has no chunks': (root) => writeFileSync(join(dirOf(root), 'chunks.json'), '{"wiki/concepts/a.md":{"mtimeMs":1}}'),
  'a manifest entry is null': (root) => writeFileSync(join(dirOf(root), 'chunks.json'), '{"wiki/concepts/a.md":null}'),
  'vectors.idx.json is not JSON': (root) => writeFileSync(join(dirOf(root), 'vectors.idx.json'), '{ nope'),
  'vectors.idx.json has the wrong shape': (root) => writeFileSync(join(dirOf(root), 'vectors.idx.json'), '{"dim":"four"}'),
  'vectors.bin is cut mid-number': (root) => { const bin = join(dirOf(root), 'vectors.bin'); writeFileSync(bin, readFileSync(bin).subarray(0, 18)); },
  'vectors.bin is missing whole vectors': (root) => { const bin = join(dirOf(root), 'vectors.bin'); writeFileSync(bin, readFileSync(bin).subarray(0, 16)); },
  'vectors.bin is all 0xFF at the same size': (root) => { const bin = join(dirOf(root), 'vectors.bin'); writeFileSync(bin, Buffer.alloc(statSync(bin).size, 0xff)); },
  'one stored vector holds NaN': (root) => poke(root, 1, NaN),
  'one stored vector holds Infinity': (root) => poke(root, 2, Infinity),
  'vectors.bin is longer than the index says': (root) => { const bin = join(dirOf(root), 'vectors.bin'); writeFileSync(bin, Buffer.concat([readFileSync(bin), Buffer.alloc(16)])); },
  'the index says dim 2 over a dim 4 file': (root) => setIndex(root, (idx) => ({ ...idx, dim: 2 })),
  'the index says dim 8 over a dim 4 file': (root) => setIndex(root, (idx) => ({ ...idx, dim: 8 })),
  'the index says dim 0 over vectors': (root) => setIndex(root, (idx) => ({ ...idx, dim: 0 })),
  'two hashes share one slot': (root) => setIndex(root, (idx) => ({ ...idx, slots: Object.fromEntries(Object.keys(idx.slots).map((hash) => [hash, 0])) })),
};

// Overwrites one number of the vector in a slot, keeping the file's size.
function poke(root, slot, value) {
  const file = join(dirOf(root), 'vectors.bin');
  const bytes = readFileSync(file);
  bytes.writeFloatLE(value, slot * 16);
  writeFileSync(file, bytes);
}
function setIndex(root, change) {
  const file = join(dirOf(root), 'vectors.idx.json');
  writeFileSync(file, JSON.stringify(change(JSON.parse(readFileSync(file, 'utf8')))));
}
const storedVectors = (root) => {
  const idx = JSON.parse(readFileSync(join(dirOf(root), 'vectors.idx.json'), 'utf8'));
  const bytes = readFileSync(join(dirOf(root), 'vectors.bin'));
  assert.equal(bytes.byteLength, Object.keys(idx.slots).length * idx.dim * 4, 'the file is exactly as long as the index says');
  return { idx, vectors: Object.values(decodeVectors(bytes, idx)) };
};
const assertHealthyStore = (root, dim) => {
  const { idx, vectors } = storedVectors(root);
  assert.equal(idx.dim, dim);
  for (const vector of vectors) {
    assert.equal(vector.length, dim);
    assert.ok(vector.every(Number.isFinite), `a stored vector holds a non-number: ${[...vector]}`);
  }
};

for (const [label, harm] of Object.entries(damage)) {
  test(`${label}: a plain refresh writes nothing and says to rebuild`, async (t) => {
    const root = vault(t);
    await refresh(root);
    harm(root);
    const content = bytes(root);
    await assert.rejects(refresh(root), (error) => {
      assert.equal(error.code, 'INDEX_CORRUPT');
      assert.match(error.message, /refresh-index\.mjs --rebuild/);
      return true;
    });
    assert.deepEqual(bytes(root), content);
  });

  test(`${label}: a rebuild recovers, and the run after it rewrites nothing`, async (t) => {
    const root = vault(t);
    await refresh(root);
    harm(root);
    const rebuilt = await refresh(root, { rebuild: true });
    assert.equal(rebuilt.result.persisted, true);
    assert.equal(rebuilt.result.chunksFailed, 0);
    assertHealthyStore(root, 4);
    const clean = await refresh(root);
    assert.equal(clean.result.chunksEmbedded, 0, 'nothing is left to embed');
    backdate(root);
    const before = times(root);
    assertUntouched(await refresh(root), root, before);
  });
}

test('a rebuild over a corrupt manifest reuses every readable vector', async (t) => {
  const root = vault(t);
  await refresh(root);
  writeFileSync(join(dirOf(root), 'chunks.json'), '{ nope');
  const run = await refresh(root, { rebuild: true });
  assert.equal(run.result.chunksEmbedded, 0);
});

test('a rebuild over a short vector file reuses the vectors it can read and embeds only the rest', async (t) => {
  const root = vault(t);
  const first = await refresh(root);
  const dim = 4;
  const bin = join(dirOf(root), 'vectors.bin');
  writeFileSync(bin, readFileSync(bin).subarray(0, dim * 4));
  const run = await refresh(root, { rebuild: true });
  assert.equal(run.result.chunksEmbedded, first.result.chunksEmbedded - 1);
  const idx = JSON.parse(readFileSync(join(dirOf(root), 'vectors.idx.json'), 'utf8'));
  assert.equal(readFileSync(bin).byteLength, Object.keys(idx.slots).length * dim * 4);
});

test('a rebuild over an unreadable vector index embeds everything again', async (t) => {
  const root = vault(t);
  const first = await refresh(root);
  writeFileSync(join(dirOf(root), 'vectors.idx.json'), '{ nope');
  const run = await refresh(root, { rebuild: true });
  assert.equal(run.result.chunksEmbedded, first.result.chunksEmbedded);
});

// ---- what counts as a usable vector ----

test('a plain run on an inconsistent store never shrinks or rewrites it', async (t) => {
  const root = vault(t);
  await refresh(root);
  setIndex(root, (idx) => ({ ...idx, dim: 2 }));
  const content = bytes(root);
  await assert.rejects(refresh(root), /refresh-index\.mjs --rebuild/);
  assert.deepEqual(bytes(root), content);
  assert.equal(readFileSync(join(dirOf(root), 'vectors.bin')).byteLength, 48);
});

test('a rebuild re-embeds every vector of an all-0xFF file', async (t) => {
  const root = vault(t);
  await refresh(root);
  damage['vectors.bin is all 0xFF at the same size'](root);
  const run = await refresh(root, { rebuild: true });
  assert.equal(run.result.chunksEmbedded, 3);
  assertHealthyStore(root, 4);
});

test('a rebuild re-embeds only the vector that fails, and reuses the ones that pass', async (t) => {
  const root = vault(t);
  await refresh(root);
  poke(root, 1, NaN);
  const run = await refresh(root, { rebuild: true });
  assert.equal(run.result.chunksEmbedded, 1);
  assertHealthyStore(root, 4);
});

test('a rebuild over an index whose dim disagrees with its file discards the store', async (t) => {
  const root = vault(t);
  await refresh(root);
  setIndex(root, (idx) => ({ ...idx, dim: 2 }));
  const run = await refresh(root, { rebuild: true });
  assert.equal(run.result.chunksEmbedded, 3);
  assertHealthyStore(root, 4);
  assert.equal(readFileSync(join(dirOf(root), 'vectors.bin')).byteLength, 48);
});

test('statusReport names each kind of damage, and is silent on a healthy or missing store', async (t) => {
  const root = vault(t);
  assert.equal(statusReport({ vaultPath: root, dir: dirOf(root) }).damaged, null, 'nothing built yet');
  await refresh(root);
  assert.equal(statusReport({ vaultPath: root, dir: dirOf(root) }).damaged, null);
  for (const [label, harm] of Object.entries(damage)) {
    if (label.includes('chunks.json') || label.includes('manifest entry')) continue;
    const other = vault(t);
    await refresh(other);
    harm(other);
    assert.ok(statusReport({ vaultPath: other, dir: dirOf(other) }).damaged, label);
  }
});

// ---- the embedder has the last word on the dimension ----

// A store that agrees with itself and holds only finite numbers, but at another dimension than the embedder's.
function wrongDimStore(root) {
  setIndex(root, (idx) => ({ ...idx, dim: 2 }));
  const bin = join(dirOf(root), 'vectors.bin');
  writeFileSync(bin, readFileSync(bin).subarray(0, 24));
}
const editPage = (root) => writeFileSync(join(root, 'wiki/concepts/a.md'), '# A\n\nAbout A, edited.\n');

test('a plain run stops when the embedder disagrees with the store, instead of mixing dimensions, and writes nothing', async (t) => {
  const root = vault(t);
  await refresh(root);
  wrongDimStore(root);
  editPage(root);
  const content = bytes(root);
  await assert.rejects(refresh(root), (error) => {
    assert.equal(error.code, 'INDEX_CORRUPT');
    assert.match(error.message, /refresh-index\.mjs --rebuild/);
    return true;
  });
  assert.deepEqual(bytes(root), content);
});

test('a changed embedding model is the same case: plain stops, a rebuild replaces every vector', async (t) => {
  const root = vault(t);
  await refresh(root);
  editPage(root);
  const wider = async (text) => Array.from({ length: 8 }, (_, i) => text.length + i);
  await assert.rejects(refresh(root, { embedFn: wider }), /refresh-index\.mjs --rebuild/);
  const run = await refresh(root, { rebuild: true, embedFn: wider });
  assert.equal(run.result.chunksEmbedded, 3);
  assert.equal(run.result.chunksFailed, 0);
  assertHealthyStore(root, 8);
});

test('a rebuild with anything to embed lets the embedder settle a store of another dimension', async (t) => {
  const root = vault(t);
  await refresh(root);
  wrongDimStore(root);
  editPage(root);
  const run = await refresh(root, { rebuild: true });
  assert.equal(run.result.chunksEmbedded, 3);
  assertHealthyStore(root, 4);
});

test('with nothing to embed, a self-consistent store of another dimension is left as it is: only the embedder could tell', async (t) => {
  const root = vault(t);
  await refresh(root);
  wrongDimStore(root);
  const plain = await refresh(root);
  assert.equal(plain.result.chunksEmbedded, 0);
  assert.equal(plain.result.persisted, false);
  const rebuilt = await refresh(root, { rebuild: true });
  assert.equal(rebuilt.result.chunksEmbedded, 0);
  assert.equal(rebuilt.result.persisted, false);
});

for (const [label, answer] of [
  ['NaN', [NaN, 1, 1, 1]],
  ['Infinity', [1, Infinity, 1, 1]],
  ['an empty vector', []],
  ['nothing', undefined],
  ['a number', 7],
]) {
  test(`an embedder answering ${label} is a failed chunk, and never reaches the store`, async (t) => {
    const root = vault(t);
    let calls = 0;
    const run = await refresh(root, { concurrency: 1, embedFn: async (text) => (++calls === 1 ? answer : [text.length, 1, 1, 1]) });
    assert.equal(run.result.chunksFailed, 1);
    assert.equal(run.result.chunksEmbedded, 2);
    assertHealthyStore(root, 4);
  });
}

test('in a fresh build the first answer sets the dimension, and a differing one is a failed chunk', async (t) => {
  const root = vault(t);
  let calls = 0;
  const run = await refresh(root, { concurrency: 1, embedFn: async (text) => (++calls === 2 ? [1, 2] : [text.length, 1, 1, 1]) });
  assert.equal(run.result.chunksFailed, 1);
  assert.match(run.result.failures[0].error, /2 .*4|4 .*2/);
  assertHealthyStore(root, 4);
});

test('a missing store is not damage: a plain refresh rebuilds it', async (t) => {
  const root = vault(t);
  const first = await refresh(root);
  rmSync(join(dirOf(root), 'vectors.bin'));
  const run = await refresh(root);
  assert.equal(run.result.chunksEmbedded, first.result.chunksEmbedded);
});
