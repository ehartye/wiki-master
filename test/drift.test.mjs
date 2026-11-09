import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDrift } from '../scripts/drift.mjs';
import * as drift from '../scripts/drift.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tempVault } from './helpers/temp-vault.mjs';

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

// ─── selection: never-evaluated first, then changed, then oldest ───
// `--limit` used to take the first pages in path order on every run, so the same few pages were checked forever.
// A per-machine state file (.wiki-master/drift-state.json, here in an injected directory) records when each page
// was evaluated and the hash of its text; the next run picks the pages it has not seen, then the ones edited since,
// then the ones evaluated longest ago.

const pad = (i) => String(i).padStart(2, '0');
const pagePath = (i) => `wiki/concepts/P${pad(i)}.md`;
const pageText = (i, extra = '') => `---\nsources: ["[[raw/clippings/R${pad(i)}.md]]"]\n---\nPage ${pad(i)} body${extra}\n`;

function selectionVault(t, count = 25) {
  const v = tempVault({ name: 'wm-drift-select' });
  const state = mkdtempSync(join(realpathSync(tmpdir()), 'wm-drift-state-'));
  t.after(() => { v.restore(); rmSync(state, { recursive: true, force: true }); });
  const put = (path, text) => { mkdirSync(dirname(join(v.path, path)), { recursive: true }); writeFileSync(join(v.path, path), text); };
  for (let i = 1; i <= count; i++) { put(pagePath(i), pageText(i)); put(`raw/clippings/R${pad(i)}.md`, `Evidence ${pad(i)}\n`); }
  put('wiki/concepts/Loose.md', 'No citations here.\n');
  let clock = Date.parse('2026-01-01T00:00:00Z');
  const run = async (args, deps = {}) => {
    const out = [];
    clock += 60_000;
    const r = await drift.main(args, { embed: async () => [1, 0], available: async () => true, stateDir: state, now: () => new Date(clock), print: (line) => out.push(line), ...deps });
    return { r, out };
  };
  const stateFile = () => JSON.parse(readFileSync(join(state, 'drift-state.json'), 'utf8'));
  return { root: v.path, state, put, run, stateFile };
}

const evaluatedPaths = (r) => r.evaluated.map((e) => e.path).sort();

test('two consecutive --limit runs evaluate different pages, and a third takes the rest before repeating any', async (t) => {
  const v = selectionVault(t);
  const first = await v.run(['--limit', '10', '--json']);
  const second = await v.run(['--limit', '10', '--json']);
  assert.equal(first.r.evaluated.length, 10);
  assert.equal(second.r.evaluated.length, 10);
  assert.deepEqual(evaluatedPaths(first.r).filter((p) => evaluatedPaths(second.r).includes(p)), [], 'no page evaluated twice');
  const third = await v.run(['--limit', '10', '--json']);
  assert.deepEqual(third.r.selection.picked.slice(0, 5).map((p) => p.reason), Array(5).fill('never-evaluated'));
  assert.deepEqual(third.r.selection.picked.slice(5).map((p) => p.reason), Array(5).fill('oldest'));
  assert.deepEqual(third.r.selection.picked.slice(5).map((p) => p.path), evaluatedPaths(first.r).slice(0, 5), 'the oldest evaluated, ties by path');
});

test('a page edited since its evaluation is picked before an unchanged evaluated one', async (t) => {
  const v = selectionVault(t, 6);
  await v.run(['--json']);
  v.put(pagePath(4), pageText(4, ' and a new paragraph'));
  const { r } = await v.run(['--limit', '2', '--json']);
  assert.deepEqual(r.selection.picked, [{ path: pagePath(4), reason: 'changed' }, { path: pagePath(1), reason: 'oldest' }]);
});

test('the report names the selection rule and the counts; --json and --coverage --json carry selection and everEvaluated', async (t) => {
  const v = selectionVault(t, 5);
  const text = await v.run(['--limit', '2']);
  assert.ok(text.out.includes('drift: selection: never-evaluated first, then changed since last evaluation, then oldest evaluated (0 of 5 eligible pages evaluated before on this machine)'), text.out.join('\n'));
  const { r } = await v.run(['--limit', '2', '--json']);
  assert.deepEqual(r.selection, {
    rule: 'never-evaluated, changed, oldest', evaluatedBefore: 2, eligible: 5,
    picked: [{ path: pagePath(3), reason: 'never-evaluated' }, { path: pagePath(4), reason: 'never-evaluated' }],
  });
  assert.equal(r.everEvaluated, 4);
  const coverage = await v.run(['--coverage', '--json'], { embed: () => assert.fail('coverage must never embed') });
  assert.equal(coverage.r.selection.evaluatedBefore, 4);
  assert.equal(coverage.r.selection.eligible, 5);
  assert.equal(coverage.r.everEvaluated, 4);
  assert.deepEqual(v.stateFile().pages[pagePath(5)], undefined, 'a coverage run records nothing');
});

test('a state file from another vault root or with another format is ignored', async (t) => {
  const v = selectionVault(t, 4);
  await v.run(['--json']);
  const written = v.stateFile();
  assert.equal(written.format, 1);
  assert.deepEqual(Object.keys(written.pages).sort(), [1, 2, 3, 4].map(pagePath));
  for (const foreign of [{ ...written, root: join(v.root, 'elsewhere') }, { ...written, format: 2 }]) {
    writeFileSync(join(v.state, 'drift-state.json'), JSON.stringify(foreign));
    const { r } = await v.run(['--limit', '1', '--json']);
    assert.equal(r.selection.evaluatedBefore, 0, JSON.stringify(foreign).slice(0, 80));
    assert.deepEqual(r.selection.picked, [{ path: pagePath(1), reason: 'never-evaluated' }]);
  }
});

test('only evaluated pages are recorded, and a deleted page is pruned from the state on the next write', async (t) => {
  const v = selectionVault(t, 4);
  const embed = async (text) => { if (text.includes('Page 02')) throw new Error('embedding failed'); return [1, 0]; };
  await v.run(['--json'], { embed });
  const state = v.stateFile();
  assert.deepEqual(Object.keys(state.pages).sort(), [1, 3, 4].map(pagePath), 'the failed page is not recorded');
  assert.match(state.pages[pagePath(1)].evaluatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(state.pages[pagePath(1)].pageHash, /^[0-9a-f]{64}$/);
  rmSync(join(v.root, pagePath(3)));
  await v.run(['--limit', '1', '--json']);
  assert.equal(v.stateFile().pages[pagePath(3)], undefined);
  assert.ok(v.stateFile().pages[pagePath(1)]);
});

test('--paths-file evaluates exactly the named pages, --limit applies to them, and an ineligible name is not-eligible', async (t) => {
  const v = selectionVault(t, 6);
  const ledger = join(v.state, 'ledger.json');
  writeFileSync(ledger, JSON.stringify([pagePath(5), pagePath(2), 'wiki/concepts/Loose.md', 'wiki/concepts/Absent.md', pagePath(6)]));
  const all = await v.run(['--paths-file', ledger, '--json']);
  assert.deepEqual(evaluatedPaths(all.r), [2, 5, 6].map(pagePath));
  assert.deepEqual(all.r.skippedPages.filter((p) => p.reason === 'not-eligible').map((p) => p.path).sort(), ['wiki/concepts/Absent.md', 'wiki/concepts/Loose.md']);
  assert.ok(all.r.skippedPages.every((p) => [2, 5, 6].every((i) => p.path !== pagePath(i))));
  v.put(pagePath(5), pageText(5, ' edited'));
  const limited = await v.run(['--paths-file', ledger, '--limit', '1', '--json']);
  assert.deepEqual(limited.r.selection.picked, [{ path: pagePath(5), reason: 'changed' }]);
  assert.deepEqual(evaluatedPaths(limited.r), [pagePath(5)]);
});

test('no evidence document is read for a page outside the selection', async (t) => {
  const v = selectionVault(t, 8);
  // The counter sees only drift's own reads (the page texts and the evidence load() reads). buildGraph still reads
  // every Markdown file, evidence included, with its own readFileSync, so this shows that evidence is loaded only for
  // the picked pages, not that nothing else reads an evidence file.
  const reads = [];
  const readFile = (abs, encoding) => { reads.push(abs.replaceAll('\\', '/')); return readFileSync(abs, encoding); };
  const { r } = await v.run(['--limit', '2', '--json'], { readFile });
  assert.deepEqual(r.selection.picked.map((p) => p.path), [1, 2].map(pagePath));
  const evidence = reads.filter((p) => p.includes('/raw/')).map((p) => p.slice(p.indexOf('raw/'))).sort();
  assert.deepEqual(evidence, ['raw/clippings/R01.md', 'raw/clippings/R02.md']);
});
