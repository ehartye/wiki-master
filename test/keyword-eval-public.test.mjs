import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadCorpus, build } from '../scripts/build-keyword-eval.mjs';

// The keyword-engine question set is public: its corpus is a pinned snapshot of this plugin's own documentation
// (eval/plugin-docs-vault), so anyone can rebuild and rerun it. The set that measured a real 8,000-page vault named
// private pages and is held in the owner's wiki. These tests keep the committed JSON an honest artifact of the
// committed corpus: rebuilt from it, recomputed from it, and reproduced by the evaluator.

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vaultDir = join(root, 'eval', 'plugin-docs-vault');
const dataset = JSON.parse(readFileSync(join(root, 'eval', 'keyword-engine.questions.json'), 'utf8'));
const baseline = JSON.parse(readFileSync(join(root, 'eval', 'keyword-engine.baseline.json'), 'utf8'));
const corpus = loadCorpus(vaultDir);

test('the corpus is the documentation snapshot: 36 pages, none empty, none naming a private path', () => {
  assert.equal(corpus.length, 36);
  assert.ok(corpus.every((p) => p.text.length > 200), 'every page has content');
  assert.ok(corpus.every((p) => p.path.startsWith('wiki/authored/plugin-docs/')));
  assert.equal(dataset.generated.pages, corpus.length);
});

test('the committed questions are exactly what the builder gives for this corpus and the recorded seed', () => {
  const rebuilt = build(corpus, { seed: dataset.generated.seed, perCategory: 14 });
  assert.deepEqual(dataset.questions, rebuilt);
});

test('the set has 14 questions in each of three categories, with unique ids and both splits', () => {
  const count = (key, value) => dataset.questions.filter((q) => q[key] === value).length;
  assert.equal(dataset.questions.length, 42);
  for (const category of ['rare-token', 'conjunction', 'phrase']) assert.equal(count('category', category), 14, category);
  assert.equal(new Set(dataset.questions.map((q) => q.id)).size, 42);
  assert.ok(count('split', 'development') > 0 && count('split', 'heldout') > 0);
});

test('ground truth is recomputed independently: the pages whose text holds the string, or every term', () => {
  for (const q of dataset.questions) {
    const needles = q.category === 'conjunction' ? q.query.toLowerCase().split(' ') : [q.query.toLowerCase()];
    const holders = corpus.filter((p) => needles.every((n) => p.lower.includes(n))).map((p) => p.path).sort();
    assert.deepEqual([...q.expectedPages].sort(), holders, `${q.id} ${q.query}`);
    assert.ok(q.expectedPages.length >= 1 && q.expectedPages.length <= 4, q.id);
    for (const page of q.expectedPages) assert.ok(existsSync(join(vaultDir, page)), `${q.id}: ${page} exists`);
  }
});

test('the evaluator reproduces the committed baseline on the fixture vault', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'wm-kwpublic-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const out = join(dir, 'run.json');
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'evaluate-retrieval.mjs'), '--questions', join(root, 'eval', 'keyword-engine.questions.json'), '--keyword-only', '--output', out], {
    env: { ...process.env, WIKI_MASTER_VAULT: vaultDir, WIKI_MASTER_BROWSER: '/no/such/browser' }, encoding: 'utf8', timeout: 120000,
  });
  assert.equal(r.status, 0, r.stderr);
  const run = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(run.status, 'complete');
  assert.equal(run.coverage.missingExpectedPages, 0);
  const expected = baseline.runs[0];
  const near = (a, b, label) => assert.ok(Math.abs(a - b) < 0.0011, `${label}: ${a} against ${b}`);
  for (const key of ['pageRecallAt10', 'precisionAt3', 'reciprocalRank']) near(run.summary[key], expected[key], key);
  for (const [category, metrics] of Object.entries(expected.byCategory)) {
    for (const key of ['pageRecallAt10', 'precisionAt3', 'reciprocalRank']) near(run.byCategory[category][key], metrics[key], `${category} ${key}`);
  }
});

test('the baseline says what it measures and that page recall is saturated on a corpus this small', () => {
  assert.equal(baseline.measured.vaultPages, corpus.length);
  assert.equal(baseline.measured.questions, 42);
  assert.match(baseline.measured.note, /28%/);
  assert.equal(baseline.runs[0].pageRecallAt10, 1);
  assert.ok(baseline.runs[0].reciprocalRank < 1, 'reciprocal rank still moves');
});
