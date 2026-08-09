import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync, existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeVectors } from '../scripts/lib/vector-index.mjs';
import { refreshIndex, statusReport, walkVault } from '../scripts/index-embed.mjs';

// Builds a throwaway vault with the given { relPath: content } map under
// wiki/, plus whatever else the caller writes directly. Returns the vault
// root. Never touches the real vault -- refreshIndex only ever sees this.
function tempVault(files) {
  const v = mkdtempSync(join(tmpdir(), 'wm-index-embed-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(v, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
  return v;
}

// A deterministic fake embed: never calls real Ollama. Dimension is fixed so
// encodeVectors/decodeVectors round-trip cleanly.
function fakeEmbedder() {
  const calls = [];
  const embedFn = async (text) => {
    calls.push(text);
    let seed = 0;
    for (let i = 0; i < text.length; i++) seed = (seed * 31 + text.charCodeAt(i)) % 1000;
    return [seed, seed / 2, seed / 3, 1];
  };
  return { embedFn, calls };
}

const okAvailable = { checkAvailable: async () => true, checkModel: async () => true };

function dir(vault) { return join(vault, '.wiki-master'); }

function readManifestRaw(vault) {
  return JSON.parse(readFileSync(join(dir(vault), 'chunks.json'), 'utf8'));
}

function readVectorsRaw(vault) {
  const idx = JSON.parse(readFileSync(join(dir(vault), 'vectors.idx.json'), 'utf8'));
  const buf = readFileSync(join(dir(vault), 'vectors.bin'));
  return decodeVectors(buf, idx);
}

// ── 1. Cold build indexes every content file and embeds every chunk ────────
test('a cold build indexes every content file and embeds every chunk', async () => {
  const v = tempVault({
    'wiki/concepts/a.md': '# A\n\nSome content about A.\n',
    'wiki/sources/b.md': '# B\n\nSome different content about B.\n',
  });
  const { embedFn, calls } = fakeEmbedder();
  const r = await refreshIndex({ vaultPath: v, dir: dir(v), embedFn, ...okAvailable });

  assert.equal(r.filesChanged, 2);
  assert.ok(r.chunksEmbedded >= 2);
  assert.equal(calls.length, r.chunksEmbedded);

  const manifest = readManifestRaw(v);
  assert.ok(manifest['wiki/concepts/a.md']);
  assert.ok(manifest['wiki/sources/b.md']);
  const vectors = readVectorsRaw(v);
  for (const entry of Object.values(manifest)) {
    for (const c of entry.chunks) assert.ok(vectors[c.hash], `missing vector for hash ${c.hash}`);
  }
});

// ── 2. An unchanged vault re-runs with zero embed calls ─────────────────────
test('an unchanged vault re-runs with zero embed calls', async () => {
  const v = tempVault({ 'wiki/concepts/a.md': '# A\n\nSome content about A.\n' });
  const first = fakeEmbedder();
  await refreshIndex({ vaultPath: v, dir: dir(v), embedFn: first.embedFn, ...okAvailable });

  const second = fakeEmbedder();
  const r = await refreshIndex({ vaultPath: v, dir: dir(v), embedFn: second.embedFn, ...okAvailable });

  // Guards the planRefresh short-circuit specifically: not just "no NEW
  // vectors needed" (true even if every file were wrongly re-chunked, since
  // identical content hashes to the same chunk hashes) but that the file
  // itself was never re-read/re-chunked at all.
  assert.equal(r.filesChanged, 0);
  assert.equal(second.calls.length, 0);
  assert.equal(r.chunksEmbedded, 0);
});

// ── 3. Editing one file re-embeds only that file's chunks ───────────────────
test('editing one file re-embeds only that file\'s chunks', async () => {
  const v = tempVault({
    'wiki/concepts/a.md': '# A\n\nOriginal content about A.\n',
    'wiki/concepts/b.md': '# B\n\nContent about B that never changes.\n',
  });
  const first = fakeEmbedder();
  await refreshIndex({ vaultPath: v, dir: dir(v), embedFn: first.embedFn, ...okAvailable });

  // Change size (not just bytes) so the edit is detected regardless of
  // filesystem mtime resolution.
  writeFileSync(join(v, 'wiki/concepts/a.md'), '# A\n\nCompletely rewritten content about A, now much longer than before.\n');
  utimesSync(join(v, 'wiki/concepts/a.md'), new Date(), new Date());

  const second = fakeEmbedder();
  const r = await refreshIndex({ vaultPath: v, dir: dir(v), embedFn: second.embedFn, ...okAvailable });

  assert.equal(r.filesChanged, 1);
  assert.ok(second.calls.length > 0, 'expected the edited file\'s new chunks to be embedded');
  assert.ok(second.calls.every((t) => t.includes('A')), 'only the edited file\'s chunks should have been embedded');
  assert.ok(!second.calls.some((t) => t.includes('never changes')), 'b.md must not be re-embedded');
});

// ── 4. A deleted file drops from the manifest and its vectors are pruned ────
test('a deleted file drops from the manifest and its vectors are pruned', async () => {
  const v = tempVault({
    'wiki/concepts/a.md': '# A\n\nContent about A.\n',
    'wiki/concepts/b.md': '# B\n\nContent about B.\n',
  });
  const first = fakeEmbedder();
  await refreshIndex({ vaultPath: v, dir: dir(v), embedFn: first.embedFn, ...okAvailable });
  const manifestBefore = readManifestRaw(v);
  const bHashes = manifestBefore['wiki/concepts/b.md'].chunks.map((c) => c.hash);
  assert.ok(bHashes.length > 0);

  rmSync(join(v, 'wiki/concepts/b.md'));
  const second = fakeEmbedder();
  const r = await refreshIndex({ vaultPath: v, dir: dir(v), embedFn: second.embedFn, ...okAvailable });

  assert.equal(r.filesRemoved, 1);
  const manifestAfter = readManifestRaw(v);
  assert.ok(!manifestAfter['wiki/concepts/b.md']);
  const vectorsAfter = readVectorsRaw(v);
  for (const h of bHashes) assert.ok(!vectorsAfter[h], `vector for pruned hash ${h} should be gone`);
});

// ── 5. raw/ and dot-folders are never indexed ────────────────────────────────
test('raw/ and dot-folders are never indexed', async () => {
  const v = tempVault({
    'wiki/concepts/a.md': '# A\n\nReal content.\n',
    'raw/clippings/big.md': '# Big Clipping\n\n' + 'lots of clipped text. '.repeat(500),
    'wiki/.hidden/secret.md': '# Secret\n\nShould never be walked.\n',
  });
  const files = walkVault(v);
  const paths = files.map((f) => f.path);
  assert.ok(paths.includes('wiki/concepts/a.md'));
  assert.ok(!paths.some((p) => p.startsWith('raw/')));
  assert.ok(!paths.some((p) => p.includes('.hidden')));

  const { embedFn, calls } = fakeEmbedder();
  await refreshIndex({ vaultPath: v, dir: dir(v), embedFn, ...okAvailable });
  assert.ok(!calls.some((t) => t.includes('clipped')), 'raw/ content must never be embedded');
  assert.ok(!calls.some((t) => t.includes('Should never be walked')));
});

// ── 6. A 20,000-char page is fully covered ───────────────────────────────────
test('a 20,000-char page is fully covered end to end', async () => {
  const section = (n) => `## Section ${n}\n\n` + 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(30) + '\n\n';
  let text = '# Big Document\n\n';
  for (let i = 0; i < 20; i++) text += section(i);
  assert.ok(text.length > 19000, `fixture too small: ${text.length}`);
  const totalLines = text.split('\n').filter((_, i, arr) => !(i === arr.length - 1 && arr[i] === '')).length;

  const v = tempVault({ 'wiki/concepts/big.md': text });
  const { embedFn } = fakeEmbedder();
  await refreshIndex({ vaultPath: v, dir: dir(v), embedFn, ...okAvailable });

  const manifest = readManifestRaw(v);
  const chunks = manifest['wiki/concepts/big.md'].chunks;
  assert.ok(chunks.length > 5, `expected several chunks, got ${chunks.length}`);
  assert.equal(chunks[0].startLine, 1);
  assert.equal(chunks.at(-1).endLine, totalLines);
  for (let i = 1; i < chunks.length; i++) {
    assert.ok(chunks[i].startLine <= chunks[i - 1].endLine + 1, `gap before chunk ${i}`);
  }
});

// ── 7. An interrupted write leaves the previous index intact ────────────────
test('an interrupted write leaves the previous index intact', async () => {
  const v = tempVault({ 'wiki/concepts/a.md': '# A\n\nOriginal content.\n' });
  const first = fakeEmbedder();
  await refreshIndex({ vaultPath: v, dir: dir(v), embedFn: first.embedFn, ...okAvailable });

  const before = {
    manifest: readFileSync(join(dir(v), 'chunks.json')),
    bin: readFileSync(join(dir(v), 'vectors.bin')),
    idx: readFileSync(join(dir(v), 'vectors.idx.json')),
  };

  writeFileSync(join(v, 'wiki/concepts/a.md'), '# A\n\nCompletely different, much longer content than the original one.\n');

  let writeCount = 0;
  const flakyWrite = (path, data) => {
    writeCount++;
    if (writeCount === 2) throw new Error('simulated disk failure mid-write');
    // real write for the first call so we can prove nothing partial landed
    // on the LIVE paths (only ever hits temp paths in a correct implementation)
    return writeFileSync(path, data);
  };

  const second = fakeEmbedder();
  await assert.rejects(
    refreshIndex({ vaultPath: v, dir: dir(v), embedFn: second.embedFn, ...okAvailable, writeFileImpl: flakyWrite }),
    /simulated disk failure/
  );

  const after = {
    manifest: readFileSync(join(dir(v), 'chunks.json')),
    bin: readFileSync(join(dir(v), 'vectors.bin')),
    idx: readFileSync(join(dir(v), 'vectors.idx.json')),
  };
  assert.deepEqual(after.manifest, before.manifest, 'chunks.json must be untouched after a failed write');
  assert.deepEqual(after.bin, before.bin, 'vectors.bin must be untouched after a failed write');
  assert.deepEqual(after.idx, before.idx, 'vectors.idx.json must be untouched after a failed write');
});

// ── 8. Ollama unavailable -> clear error, non-zero exit, no index written ───
test('ollama unavailable fails clearly before doing any work, no index written', async () => {
  const v = tempVault({ 'wiki/concepts/a.md': '# A\n\nContent.\n' });
  const { embedFn, calls } = fakeEmbedder();

  await assert.rejects(
    refreshIndex({
      vaultPath: v, dir: dir(v), embedFn,
      checkAvailable: async () => false,
      checkModel: async () => true,
    }),
    /[Oo]llama/
  );
  assert.equal(calls.length, 0, 'no chunk should have been embedded');
  assert.ok(!existsSync(join(dir(v), 'chunks.json')), 'no manifest should have been written');
  assert.ok(!existsSync(join(dir(v), 'vectors.bin')), 'no vector store should have been written');
});

test('missing model fails clearly before doing any work, no index written', async () => {
  const v = tempVault({ 'wiki/concepts/a.md': '# A\n\nContent.\n' });
  const { embedFn, calls } = fakeEmbedder();

  await assert.rejects(
    refreshIndex({
      vaultPath: v, dir: dir(v), embedFn,
      checkAvailable: async () => true,
      checkModel: async () => false,
    }),
    /model/i
  );
  assert.equal(calls.length, 0);
  assert.ok(!existsSync(join(dir(v), 'chunks.json')));
});

// ── --status reports coverage without embedding anything ────────────────────
test('statusReport reports coverage without embedding', async () => {
  const v = tempVault({
    'wiki/concepts/a.md': '# A\n\nContent about A.\n',
    'wiki/concepts/b.md': '# B\n\nContent about B.\n',
  });
  const { embedFn } = fakeEmbedder();
  await refreshIndex({ vaultPath: v, dir: dir(v), embedFn, ...okAvailable });

  const r = statusReport({ vaultPath: v, dir: dir(v) });
  assert.equal(r.files, 2);
  assert.equal(r.missing, 0);
  assert.equal(r.filesChanged, 0);
});

// ── --rebuild re-chunks everything but does not re-embed unchanged content ──
test('rebuild re-chunks every file but reuses vectors for unchanged chunk content', async () => {
  const v = tempVault({ 'wiki/concepts/a.md': '# A\n\nContent about A.\n' });
  const first = fakeEmbedder();
  await refreshIndex({ vaultPath: v, dir: dir(v), embedFn: first.embedFn, ...okAvailable });

  const second = fakeEmbedder();
  const r = await refreshIndex({ vaultPath: v, dir: dir(v), embedFn: second.embedFn, ...okAvailable, rebuild: true });

  assert.equal(r.filesChanged, 1, 'rebuild must re-chunk every file, ignoring the manifest');
  assert.equal(second.calls.length, 0, 'unchanged chunk content must not be re-embedded');
});
