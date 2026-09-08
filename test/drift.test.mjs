import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDrift } from '../scripts/drift.mjs';
import * as drift from '../scripts/drift.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Fake embedder: map known strings to vectors so cosine is predictable.
const vectors = {
  'alpha body about neural scaling': [1, 0, 0],
  'source about neural scaling': [1, 0.05, 0],       // aligned -> not drifted
  'beta body about cooking recipes': [0, 1, 0],
  'source about neural scaling networks': [1, 0, 0], // orthogonal -> drifted
};
const fakeEmbed = async (t) => vectors[t] ?? [0, 0, 1];

test('computeDrift flags pages whose body diverges from their sources', async () => {
  const pages = [
    { path: 'alpha.md', body: 'alpha body about neural scaling',
      sources: [{ path: 'source-a.md', content: 'source about neural scaling' }] },
    { path: 'beta.md', body: 'beta body about cooking recipes',
      sources: [{ path: 'source-a.md', content: 'source about neural scaling networks' }] },
  ];
  const r = await computeDrift(pages, { embedFn: fakeEmbed, threshold: 0.5 });
  assert.deepEqual(r.drifted.map((d) => d.path), ['beta.md']);
  assert.equal(r.skipped, false);
});

test('computeDrift skips pages with no sources', async () => {
  const r = await computeDrift([{ path: 'x.md', body: 'x', sources: [] }], { embedFn: fakeEmbed });
  assert.deepEqual(r.drifted, []);
  assert.deepEqual(r.evaluated, []);
});

// search.mjs got this guard when the context-window 500 was found live;
// computeDrift never did -- one oversized page (or raw source, typically even
// longer) crashed the entire drift run. A failed page is recorded, not fatal,
// and never silent.
test('computeDrift records a page whose body embedding fails and still evaluates the rest', async () => {
  const failsOn = async (t) => {
    if (t === 'oversized body') throw new Error('Ollama embeddings HTTP 500');
    return fakeEmbed(t);
  };
  const pages = [
    { path: 'big.md', body: 'oversized body',
      sources: [{ path: 'source-a.md', content: 'source about neural scaling' }] },
    { path: 'alpha.md', body: 'alpha body about neural scaling',
      sources: [{ path: 'source-a.md', content: 'source about neural scaling' }] },
  ];
  const r = await computeDrift(pages, { embedFn: failsOn, threshold: 0.5 });
  assert.deepEqual(r.evaluated.map((e) => e.path), ['alpha.md'], 'the healthy page is still evaluated');
  assert.deepEqual(r.failed.map((f) => f.path), ['big.md'], 'the failing page is recorded, not fatal');
});

test('computeDrift records a page whose SOURCE embedding fails (raw sources run longest)', async () => {
  const failsOn = async (t) => {
    if (t === 'oversized raw source') throw new Error('Ollama embeddings HTTP 500');
    return fakeEmbed(t);
  };
  const pages = [
    { path: 'alpha.md', body: 'alpha body about neural scaling',
      sources: [{ path: 'huge-source.md', content: 'oversized raw source' }] },
  ];
  const r = await computeDrift(pages, { embedFn: failsOn, threshold: 0.5 });
  assert.deepEqual(r.evaluated, []);
  assert.deepEqual(r.failed.map((f) => f.path), ['alpha.md']);
});

test('coverage resolves real flow and block sources transitively without an embedder', async t => {
  assert.equal(typeof drift.collectDriftPages, 'function');
  const root = mkdtempSync(join(tmpdir(), 'wiki-drift-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = { 'wiki/concepts/A.md': '---\nsources: ["[[wiki/sources/S]]"]\n---\nA', 'wiki/syntheses/B.md': '---\nsources:\n  - "[[raw/clippings/R.md]]"\n---\nB', 'wiki/concepts/C.md': '## Relationships\n[[raw/clippings/R]]', 'wiki/sources/S.md': '---\nsources: ["[[raw/clippings/R.md]]"]\n---\nS', 'raw/clippings/R.md': 'Original research' };
  for (const [path, body] of Object.entries(files)) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), body); }
  const pages = drift.collectDriftPages(root);
  assert.equal(pages.length, 3);
  assert.deepEqual(pages.find(p => p.path === 'wiki/concepts/A.md').sources.map(s => s.path), ['raw/clippings/R.md']);
  const r = await computeDrift(pages, { coverage: true, embedFn: () => assert.fail('coverage must never embed') });
  assert.deepEqual(r.counts, { total: 3, eligible: 2, ineligible: 1, evaluated: 0, failed: 0, skipped: 3, skippedEligible: 2 });
  assert.match(drift.formatDriftReport(r).join('\n'), /coverage only/i);
});

test('a bounded drift run reports evaluated, failed and skipped pages separately', async () => {
  const pages = [
    { path: 'a.md', body: 'a', sources: [{ content: 'source' }] },
    { path: 'b.md', body: 'bad', sources: [{ content: 'source' }] },
    { path: 'c.md', body: 'c', sources: [{ content: 'source' }] },
    { path: 'd.md', body: 'd', sources: [] },
  ];
  const r = await computeDrift(pages, { limit: 2, embedFn: async text => { if (text === 'bad') throw new Error('failed'); return [1, 0]; } });
  assert.deepEqual(r.counts, { total: 4, eligible: 3, ineligible: 1, evaluated: 1, failed: 1, skipped: 2, skippedEligible: 1 });
  assert.deepEqual(r.skippedPages.map(p => p.path), ['c.md', 'd.md']);
});

test('zero evaluated pages never produce a clean drift verdict', async () => {
  const r = await computeDrift([{ path: 'x.md', body: 'x', sources: [] }], { embedFn: fakeEmbed });
  assert.equal(typeof drift.formatDriftReport, 'function');
  const report = drift.formatDriftReport(r).join('\n');
  assert.match(report, /no pages evaluated/i);
  assert.doesNotMatch(report, /no pages diverged/i);
});

test('drift bounds reject invalid limits before work begins', async () => {
  for (const limit of [0, -1, 1.5, NaN]) await assert.rejects(computeDrift([], { limit }), /limit.*positive integer/);
});

test('drift coverage CLI runs without Obsidian or embeddings and prints JSON counts', t => {
  const root = mkdtempSync(join(tmpdir(), 'wiki-drift-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'wiki/concepts'), { recursive: true });
  writeFileSync(join(root, 'wiki/concepts/Empty.md'), 'No citations');
  const script = fileURLToPath(new URL('../scripts/drift.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [script, '--coverage', '--json', '--limit', '1'], { env: { ...process.env, WIKI_MASTER_VAULT: root }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).counts, { total: 1, eligible: 0, ineligible: 1, evaluated: 0, failed: 0, skipped: 1, skippedEligible: 0 });
  const bad = spawnSync(process.execPath, [script, '--limit', '0'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /limit must be a positive integer/);
});

test('drift accepts equals-form limits used by maintenance workflows', async () => {
  await assert.rejects(drift.main(['--limit=0']), /limit must be a positive integer/);
  const root = mkdtempSync(join(tmpdir(), 'wiki-drift-equals-'));
  try {
    const script = fileURLToPath(new URL('../scripts/drift.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [script, '--coverage', '--limit=10', '--json'], { env: { ...process.env, WIKI_MASTER_VAULT: root }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const counts = JSON.parse(result.stdout).counts;
    assert.equal(counts.total, counts.eligible + counts.ineligible);
    assert.equal(counts.eligible, counts.evaluated + counts.failed + counts.skippedEligible);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('long pages and evidence use bounded chunk samples including the tail and disclose partial coverage', async () => {
  const calls = [];
  const long = 'START ' + 'Evidence text. '.repeat(2000) + ' TAIL';
  const sources = Array.from({ length: 12 }, (_, i) => ({ path: `raw/${i}.md`, content: long }));
  const r = await computeDrift([{ path: 'long.md', body: long, sources }], { embedFn: async text => {
    calls.push(text);
    if (text.length > 1200) throw new Error('input length exceeds context length');
    return [10, 0];
  } });
  assert.equal(r.evaluated.length, 1);
  assert.equal(r.failed.length, 0);
  assert.ok(calls.length <= 72, `embedding work is bounded, got ${calls.length}`);
  assert.ok(calls.some(text => text.includes('TAIL')), 'sampling includes late evidence instead of truncating the head');
  const sampling = r.evaluated[0].sampling;
  assert.equal(sampling.sources.total, 12);
  assert.equal(sampling.sources.sampled, 8);
  assert.ok(sampling.page.total > sampling.page.sampled);
  assert.equal(sampling.partial, true);
  assert.match(drift.formatDriftReport(r).join('\n'), /sampled.*chunks/i);
});

test('chunk aggregation normalizes vector magnitude before combining evidence documents', async () => {
  const r = await computeDrift([{ path: 'a.md', body: 'page', sources: [{ content: 'first' }, { content: 'second' }] }], { embedFn: async text => ({ page: [1, 1], first: [100, 0], second: [0, 1] })[text] });
  assert.ok(r.evaluated[0].sim > 0.999, 'large vector magnitudes cannot dominate the evidence centroid');
});
