import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, realpathSync, statSync, utimesSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { runReclips } from '../scripts/lib/reclip.mjs';

// A quarantine checks which wiki pages cite a clipping four times in one transaction: once to plan it, once to
// resume it, and twice more to prove that nothing new began citing the clipping while the pages and the raw file
// were written. The passes share a snapshot of what each file said; a later pass re-reads only a file whose size or
// modification time changed, or whose modification time was within the racy window (2,000 ms) of the read that
// produced its entry. These tests pin the restriction outcome of each kind of change between passes, and count file
// reads (never time) to show that an unchanged page is read once per transaction.

const hash = text => createHash('sha256').update(text).digest('hex');
const H = hash('target'), H2 = hash('other');
const TARGET = 'raw/clippings/target.md', OTHER = 'raw/clippings/other.md';
const fm = fields => `---\n${fields}\n---\n`;
const FILES = {
  [TARGET]: `${fm(`title: "Target capture"\nsource: "https://example.test/target.pdf"\nsource-hash: ${H}\naliases: ["Shared Label"]`)}Captured words.\n`,
  [OTHER]: `${fm(`title: "Other capture"\nsource: "https://example.test/other.pdf"\nsource-hash: ${H2}\naliases: ["Shared Label"]`)}Other words.\n`,
  'wiki/sources/by-hash.md': `${fm(`type: source\nsource-hashes: [${H}]`)}# By hash\n\nA summary of the target.\n`,
  'wiki/concepts/by-link.md': `${fm('type: concept')}# By link\n\nCites [[raw/clippings/target]].\n`,
  // Two clippings share this alias, so the link names neither until one of them drops it.
  'wiki/concepts/by-alias.md': `${fm('type: concept')}# By alias\n\nSee [[Shared Label]].\n`,
  'wiki/concepts/bystander.md': `${fm('type: concept')}# Bystander\n\nLinks [[by-link]] only.\n`,
};
const CITERS = ['wiki/concepts/by-link.md', 'wiki/sources/by-hash.md'];
const OLD = Date.now() / 1000 - 3600;

function vault(t) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'wm-reclip-snapshot-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, text, { old = true } = {}) => {
    const abs = join(root, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
    // Outside the racy window, so a later pass may keep the entry its first read made.
    if (old) utimesSync(abs, OLD, OLD);
  };
  for (const [path, text] of Object.entries(FILES)) put(path, text);
  return { root, put, abs: path => join(root, path), read: path => readFileSync(join(root, path), 'utf8') };
}
const restricted = (root, path) => readFileSync(join(root, path), 'utf8').includes(`Do not cite ${TARGET}:`);
const restrictedPages = root => {
  const out = [];
  (function walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md')) { const r = relative(root, p).replaceAll('\\', '/'); if (restricted(root, r)) out.push(r); }
    }
  })(join(root, 'wiki'));
  return out.sort();
};
const journals = root => { const dir = join(root, '.wiki-master', 'reclip-transactions'); return existsSync(dir) ? readdirSync(dir) : []; };
const journal = root => JSON.parse(readFileSync(join(root, '.wiki-master', 'reclip-transactions', journals(root)[0]), 'utf8'));
// The write hook runs the real write, then the change under test, at a chosen point between two passes.
const writeThen = (root, when, change) => {
  let done = false;
  return (path, text) => {
    writeFileSync(path, text);
    if (!done && when(relative(root, path).replaceAll('\\', '/'))) { done = true; change(); }
  };
};
const atRaw = path => path === TARGET, atFirstPage = path => path.startsWith('wiki/');

// Counts every read of a vault file by path: whole-file reads and the descriptor opens of header reads. A whole-file
// read without an encoding opens its file through fs.openSync, so an open inside a whole-file read is not counted again.
async function countReads(root, run) {
  let depth = 0;
  const counts = new Map(), bump = p => { if (typeof p !== 'string') return; const r = relative(root, p).replaceAll('\\', '/'); if (!r.startsWith('..')) counts.set(r, (counts.get(r) ?? 0) + 1); };
  const { readFileSync: readFile, openSync: open } = fs;
  fs.readFileSync = function (p, ...rest) { bump(p); depth++; try { return readFile.call(this, p, ...rest); } finally { depth--; } };
  fs.openSync = function (p, ...rest) { if (!depth) bump(p); return open.call(this, p, ...rest); };
  syncBuiltinESMExports();
  try { return { result: await run(), counts }; }
  finally { fs.readFileSync = readFile; fs.openSync = open; syncBuiltinESMExports(); }
}

test('a quarantine restricts every citer and reads each unchanged page once', async t => {
  const { root } = vault(t);
  const { result, counts } = await countReads(root, () => runReclips({ vaultPath: root, apply: true, targets: [TARGET], quarantineReason: 'Unverified rows' }));
  assert.equal(result.quarantined, 1);
  assert.deepEqual(result.changed.sort(), [...CITERS, TARGET].sort());
  assert.deepEqual(restrictedPages(root), [...CITERS].sort());
  assert.deepEqual(journals(root), []);
  for (const page of ['wiki/concepts/by-alias.md', 'wiki/concepts/bystander.md']) assert.equal(counts.get(page), 1, `${page} is read by the first pass only`);
  // settle() reads the header of every other clipping twice more (peers and predecessors); that is outside the passes.
  assert.ok(counts.get(OTHER) <= 3, `${OTHER} identity is read once by the passes (${counts.get(OTHER)} reads in all)`);
});

test('a citer added between the raw write and the last pass is caught, journaled and restricted on retry', async t => {
  const { root, put } = vault(t);
  const late = 'wiki/concepts/late.md';
  const first = await countReads(root, () => runReclips({ vaultPath: root, apply: true, targets: [TARGET], quarantineReason: 'Unverified rows',
    write: writeThen(root, atRaw, () => put(late, `${fm(`type: concept\nsource-hashes: [${H}]`)}# Late\n`)) }));
  assert.equal(first.result.quarantined, 0);
  assert.deepEqual(first.result.conflictDetails, [{ path: TARGET, reason: 'Citation membership changed; pending repair retained', pending: true }]);
  assert.ok(journal(root).pages.includes(late));
  assert.equal(restricted(root, late), false);
  assert.equal(first.counts.get('wiki/concepts/bystander.md'), 1, 'one read in the first transaction');
  const retry = await countReads(root, () => runReclips({ vaultPath: root, apply: true, targets: [TARGET] }));
  assert.equal(retry.result.quarantined, 1);
  assert.deepEqual(restrictedPages(root), [...CITERS, late].sort());
  assert.deepEqual(journals(root), []);
  assert.equal(retry.counts.get('wiki/concepts/bystander.md'), 1, 'one read in the resumed transaction');
});

test('an alias change on another clipping that makes a link name the target is caught by the next pass', async t => {
  const { root, put } = vault(t);
  const result = await runReclips({ vaultPath: root, apply: true, targets: [TARGET], quarantineReason: 'Unverified rows',
    write: writeThen(root, atFirstPage, () => put(OTHER, FILES[OTHER].replace('aliases: ["Shared Label"]', 'aliases: ["Others Label"]'), { old: false })) });
  assert.equal(result.quarantined, 0);
  assert.deepEqual(result.conflictDetails, [{ path: TARGET, reason: 'Citation membership changed; pending repair retained', pending: true }]);
  assert.ok(journal(root).pages.includes('wiki/concepts/by-alias.md'));
  assert.match(readFileSync(join(root, TARGET), 'utf8'), /^source-hash:/m, 'the raw file is still unwritten');
  assert.doesNotMatch(readFileSync(join(root, TARGET), 'utf8'), /citation-status/);
  const retry = await runReclips({ vaultPath: root, apply: true, targets: [TARGET] });
  assert.equal(retry.quarantined, 1);
  assert.deepEqual(restrictedPages(root), [...CITERS, 'wiki/concepts/by-alias.md'].sort());
});

test('a same-size edit inside the racy window that keeps the file time is re-read and caught', async t => {
  const { root, put, abs } = vault(t);
  const page = 'wiki/concepts/fresh.md', before = `${fm('type: concept')}# Fresh\n\nSee [[raw/clippings/zzzzzz]].\n`;
  const after = before.replace('zzzzzz', 'target');
  assert.equal(after.length, before.length);
  // A whole second just past, so the restored time is bit-for-bit the same and is inside the window of the first read.
  const stamp = Math.floor(Date.now() / 1000);
  put(page, before, { old: false }); utimesSync(abs(page), stamp, stamp);
  const kept = statSync(abs(page));
  const result = await runReclips({ vaultPath: root, apply: true, targets: [TARGET], quarantineReason: 'Unverified rows',
    write: writeThen(root, atFirstPage, () => {
      writeFileSync(abs(page), after); utimesSync(abs(page), stamp, stamp); // a clock too coarse to see the edit
      const now = statSync(abs(page));
      assert.deepEqual([now.size, now.mtimeMs], [kept.size, kept.mtimeMs], 'the edit keeps size and time');
    }) });
  assert.deepEqual(result.conflictDetails, [{ path: TARGET, reason: 'Citation membership changed; pending repair retained', pending: true }]);
  assert.ok(journal(root).pages.includes(page));
  const retry = await runReclips({ vaultPath: root, apply: true, targets: [TARGET] });
  assert.equal(retry.quarantined, 1);
  assert.deepEqual(restrictedPages(root), [...CITERS, page].sort());
});

test('a same-size edit outside the racy window that restores the old file time is re-read, because its change time moved', async t => {
  const { root, put, abs } = vault(t);
  const page = 'wiki/concepts/quiet.md', before = `${fm('type: concept')}# Quiet\n\nSee [[raw/clippings/zzzzzz]].\n`;
  const after = before.replace('zzzzzz', 'target');
  put(page, before);
  const kept = statSync(abs(page));
  let edited;
  const result = await runReclips({ vaultPath: root, apply: true, targets: [TARGET], quarantineReason: 'Unverified rows',
    write: writeThen(root, atFirstPage, () => { writeFileSync(abs(page), after); utimesSync(abs(page), OLD, OLD); edited = statSync(abs(page)); }) });
  assert.deepEqual([edited.size, edited.mtimeMs], [kept.size, kept.mtimeMs], 'the edit keeps size and modification time');
  // utimes cannot set the change time; a file system that leaves it alone gives this test nothing to see.
  if (edited.ctimeMs === kept.ctimeMs) { t.skip('this file system kept the change time across a rewrite and utimes'); return; }
  assert.deepEqual(result.conflictDetails, [{ path: TARGET, reason: 'Citation membership changed; pending repair retained', pending: true }]);
  assert.ok(journal(root).pages.includes(page));
  const retry = await runReclips({ vaultPath: root, apply: true, targets: [TARGET] });
  assert.equal(retry.quarantined, 1);
  assert.deepEqual(restrictedPages(root), [...CITERS, page].sort());
});

test('a concurrent edit of a pending page stops the transaction, and the retry keeps the edit', async t => {
  const { root, abs, read } = vault(t);
  const edited = 'wiki/sources/by-hash.md';
  const result = await runReclips({ vaultPath: root, apply: true, targets: [TARGET], quarantineReason: 'Unverified rows',
    write: writeThen(root, path => path === 'wiki/concepts/by-link.md', () => writeFileSync(abs(edited), read(edited) + 'Concurrent note.\n')) });
  assert.deepEqual(result.conflictDetails, [{ path: TARGET, reason: `Concurrent page edit: ${edited}`, pending: true }]);
  assert.equal(restricted(root, edited), false);
  const retry = await runReclips({ vaultPath: root, apply: true, targets: [TARGET] });
  assert.equal(retry.quarantined, 1);
  assert.deepEqual(restrictedPages(root), [...CITERS].sort());
  assert.ok(read(edited).includes('Concurrent note.'));
});

test('a page edit during completion is reported and the journal is retained', async t => {
  const { root, abs, read } = vault(t);
  const page = 'wiki/concepts/by-link.md';
  const result = await runReclips({ vaultPath: root, apply: true, targets: [TARGET], quarantineReason: 'Unverified rows',
    write: writeThen(root, atRaw, () => writeFileSync(abs(page), FILES[page] + 'Restriction removed by hand.\n')) });
  assert.deepEqual(result.conflictDetails, [{ path: TARGET, reason: 'Dependent edit during completion; pending repair retained', pending: true }]);
  const retry = await runReclips({ vaultPath: root, apply: true, targets: [TARGET] });
  assert.equal(retry.quarantined, 1);
  assert.deepEqual(restrictedPages(root), [...CITERS].sort());
  assert.ok(read(page).includes('Restriction removed by hand.'));
});

test('an interrupted quarantine resumes from its journal and sees pages added or edited since', async t => {
  const { root, put, read } = vault(t);
  const first = await runReclips({ vaultPath: root, apply: true, targets: [TARGET], quarantineReason: 'Unverified rows', write: () => { throw new Error('interrupted'); } });
  assert.deepEqual(first.conflictDetails, [{ path: TARGET, reason: 'interrupted', pending: true }]);
  assert.deepEqual(restrictedPages(root), []);
  put('wiki/concepts/late.md', `${fm('type: concept')}# Late\n\nCites [[raw/clippings/target.md]].\n`);
  put('wiki/concepts/bystander.md', read('wiki/concepts/bystander.md') + `Now cites ${H}.\n`);
  const retry = await countReads(root, () => runReclips({ vaultPath: root, apply: true, targets: [TARGET] }));
  assert.equal(retry.result.quarantined, 1);
  assert.deepEqual(restrictedPages(root), [...CITERS, 'wiki/concepts/bystander.md', 'wiki/concepts/late.md'].sort());
  assert.match(read(TARGET), /^citation-status: quarantined$/m);
  assert.deepEqual(journals(root), []);
  assert.equal(retry.counts.get('wiki/concepts/by-alias.md'), 1, 'the resumed transaction reads an unchanged page once');
});

test('a quarantine waits for the vault gate: a second writer is refused and changes nothing', async t => {
  const { root } = vault(t);
  let unblock, started;
  const waiting = new Promise(r => { unblock = r; }), ready = new Promise(r => { started = r; });
  // The owner tries a repair, cannot obtain the source, and quarantines instead, all inside the gate.
  const owner = runReclips({ vaultPath: root, apply: true, targets: [TARGET], onFailure: 'quarantine',
    obtain: async () => { started(); await waiting; throw new Error('Source unavailable'); } });
  await ready;
  const second = await runReclips({ vaultPath: root, apply: true, targets: [TARGET], quarantineReason: 'Second writer' });
  assert.deepEqual(second.conflicts, ['repair-session']);
  assert.equal(second.quarantined, 0);
  assert.deepEqual(restrictedPages(root), []);
  assert.deepEqual(journals(root), []);
  unblock();
  const result = await owner;
  assert.equal(result.quarantined, 1);
  assert.deepEqual(restrictedPages(root), [...CITERS].sort());
  assert.ok(readFileSync(join(root, 'wiki/sources/by-hash.md'), 'utf8').includes(`Do not cite ${TARGET}: Source unavailable`));
});
