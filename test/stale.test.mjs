import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStale } from '../scripts/stale.mjs';

const today = new Date('2026-07-15');
const pages = [
  { path: 'alpha.md', reviewed: '2026-07-10', updated: '2026-07-10' }, // 5d fresh
  { path: 'beta.md', reviewed: '2026-01-05', updated: '2026-01-05' },  // ~191d rotten
  { path: 'gamma.md', reviewed: '2026-06-01', updated: '2026-06-20' }, // 44d since factual review
  { path: 'delta.md', reviewed: '2026-05-01', updated: '2026-05-01' }, // ~75d aging
  { path: 'eps.md', reviewed: '2026-03-01', updated: '2026-03-01' },   // ~136d stale
];

test('computeStale buckets by factual review date despite mechanical updates', () => {
  const r = computeStale(pages, { today });
  assert.deepEqual(r.buckets.fresh.map((p) => p.path).sort(), ['alpha.md']);
  assert.deepEqual(r.buckets.aging.map((p) => p.path), ['gamma.md', 'delta.md']);
  assert.deepEqual(r.buckets.stale.map((p) => p.path), ['eps.md']);
  assert.deepEqual(r.buckets.rotten.map((p) => p.path), ['beta.md']);
});

test('a recent updated date cannot hide a missing factual review', () => {
  const r = computeStale([{ path: 'unreviewed.md', updated: '2026-07-14' }], { today });
  assert.deepEqual(r.missingReview, ['unreviewed.md']);
  assert.equal(r.buckets.rotten[0].ageDays, Infinity);
  assert.match(r.report, /missing review 1/);
});

test('computeStale treats missing dates as rotten', () => {
  const r = computeStale([{ path: 'x.md' }], { today });
  assert.deepEqual(r.buckets.rotten.map((p) => p.path), ['x.md']);
});

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../scripts/stale.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'wiki-stale-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const previousPath = process.env.WIKI_MASTER_VAULT;
  const previousName = process.env.WIKI_MASTER_VAULT_NAME;
  process.env.WIKI_MASTER_VAULT = root;
  delete process.env.WIKI_MASTER_VAULT_NAME;
  t.after(() => {
    if (previousPath === undefined) delete process.env.WIKI_MASTER_VAULT;
    else process.env.WIKI_MASTER_VAULT = previousPath;
    if (previousName === undefined) delete process.env.WIKI_MASTER_VAULT_NAME;
    else process.env.WIKI_MASTER_VAULT_NAME = previousName;
  });
  const notes = {
    'wiki/concepts/old.md': '---\nreviewed: 2026-01-05\nupdated: 2026-07-14\ntype: concept\n---\nOld claim.',
    'wiki/authored/p/new.md': '---\nreviewed: 2026-07-10\n---\nNew claim.',
    'wiki/concepts/unreviewed.md': '---\nupdated: 2026-07-14\n---\nUnchecked.',
    'raw/clippings/source.md': '---\nreviewed: 2026-01-01\n---\nImmutable source.',
    'moc/map.md': 'Map', 'log.md': 'Log', '_templates/note.md': 'Template', '.recycle/deleted.md': 'Deleted',
  };
  for (const [path, body] of Object.entries(notes)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return { root, notes };
}
const noCli = () => { throw new Error('Obsidian CLI timed out after 10000ms'); };

test('freshness falls back to wiki metadata, preserving review dates and all files', t => {
  const { root, notes } = fixture(t);
  const out = [];
  const r = main({ vaultPath: root, today, obsidianJsonImpl: noCli, log: line => out.push(line) });
  assert.equal(r.backend, 'filesystem');
  assert.match(r.reason, /timed out/);
  assert.deepEqual(r.buckets.fresh.map(p => p.path), ['wiki/authored/p/new.md']);
  assert.deepEqual(r.buckets.rotten.map(p => p.path), ['wiki/concepts/old.md', 'wiki/concepts/unreviewed.md']);
  assert.deepEqual(r.missingReview, ['wiki/concepts/unreviewed.md']);
  assert.match(out.join('\n'), /filesystem.*timed out/);
  for (const [path, body] of Object.entries(notes)) assert.equal(readFileSync(join(root, path), 'utf8'), body);
  assert.deepEqual(readdirSync(root).sort(), ['.recycle', '_templates', 'log.md', 'moc', 'raw', 'wiki']);
});

test('valid CLI rows remain the preferred backend', t => {
  const { root } = fixture(t);
  const r = main({ vaultPath: root, today, log() {}, obsidianJsonImpl(args, options) {
    assert.deepEqual(args, ['base:query', 'file=stale.base', 'view=all']);
    assert.equal(options.name, root.split(/[\\/]/).at(-1));
    return [{ 'file.path': 'wiki/concepts/cli.md', reviewed: '2026-07-10' }];
  } });
  assert.equal(r.backend, 'obsidian');
  assert.equal(r.reason, null);
  assert.deepEqual(r.buckets.fresh.map(p => p.path), ['wiki/concepts/cli.md']);
});

test('invalid or suspiciously empty CLI data cannot report an empty green vault', t => {
  const { root } = fixture(t);
  for (const rows of [null, {}, 'error', [], [{ reviewed: '2026-07-10' }], [{ path: '../outside.md' }], [{ path: 'raw/source.md' }], [{ path: 'wiki/_templates/page.md' }]]) {
    const r = main({ vaultPath: root, today, obsidianJsonImpl: () => rows, log() {} });
    assert.equal(r.backend, 'filesystem');
    assert.equal(r.buckets.rotten.length, 2);
    assert.match(r.reason, /invalid|empty/i);
  }
});

test('explicit configured root retains its registered Obsidian vault name', t => {
  const { root } = fixture(t);
  process.env.WIKI_MASTER_VAULT_NAME = 'Registered Wiki';
  let queriedName;
  const r = main({ vaultPath: join(root, '.'), today, log() {}, obsidianJsonImpl(args, options) {
    queriedName = options.name;
    return [{ path: 'wiki/concepts/cli.md', reviewed: '2026-07-10' }];
  } });
  assert.equal(queriedName, 'Registered Wiki');
  assert.equal(r.backend, 'obsidian');
});

test('an alternate filesystem root never guesses another registered vault name', t => {
  const { root } = fixture(t);
  process.env.WIKI_MASTER_VAULT = join(root, 'different-configured-vault');
  let calls = 0;
  const r = main({ vaultPath: root, today, log() {}, obsidianJsonImpl() {
    calls++;
    return [{ path: 'wiki/concepts/wrong-vault.md', reviewed: '2026-07-10' }];
  } });
  assert.equal(calls, 0);
  assert.equal(r.backend, 'filesystem');
  assert.match(r.reason, /registered.*name.*unknown/i);
  assert.deepEqual(r.missingReview, ['wiki/concepts/unreviewed.md']);
});

test('missing vault or wiki root fails explicitly instead of reporting healthy emptiness', t => {
  const { root } = fixture(t);
  for (const vaultPath of [join(root, 'missing'), join(root, 'raw')]) {
    assert.throws(() => main({ vaultPath, obsidianJsonImpl: noCli, log() {} }), /freshness.*unavailable|vault.*unavailable/i);
  }
});

test('a verified empty wiki is reported explicitly', t => {
  const root = mkdtempSync(join(tmpdir(), 'wiki-empty-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'wiki'));
  const r = main({ vaultPath: root, obsidianJsonImpl: () => [], log() {} });
  assert.equal(r.backend, 'filesystem');
  assert.match(r.report, /no wiki pages/i);
});
