import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// The questions that measured the maintainer's vault, and their recorded reports, name that vault's private pages and are held
// outside this repository. This sample set is what stays public: 12 questions over the pinned documentation corpus, so the
// retrieval runner can be exercised end to end by anyone. It is checked against the corpus (every expected page and labelled
// passage exists) and run through the real runner. It pins the shape of a run, not its scores: those move when search improves.

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const corpus = join(root, 'eval', 'plugin-docs-vault');
const dataset = JSON.parse(readFileSync(join(root, 'eval', 'evaluator-sample.questions.json'), 'utf8'));

test('the sample has 12 questions in five categories, with both splits and unique ids', () => {
  assert.equal(dataset.questions.length, 12);
  assert.equal(new Set(dataset.questions.map((q) => q.id)).size, 12);
  assert.deepEqual([...new Set(dataset.questions.map((q) => q.category))].sort(), ['complement', 'exact', 'paraphrase', 'state', 'task']);
  assert.ok(dataset.questions.some((q) => q.split === 'development') && dataset.questions.some((q) => q.split === 'heldout'));
});

test('every expected page exists in the corpus, and every labelled passage is on its page', () => {
  let passages = 0;
  for (const q of dataset.questions) {
    for (const page of q.expectedPages) assert.ok(existsSync(join(corpus, page)), `${q.id}: ${page}`);
    for (const p of q.expectedPassages ?? []) {
      passages++;
      assert.ok(readFileSync(join(corpus, p.path), 'utf8').toLowerCase().includes(p.text.toLowerCase()), `${q.id}: "${p.text}" is not on ${p.path}`);
    }
  }
  assert.equal(passages, 5);
});

test('nothing in the sample names anything outside the corpus', () => {
  const text = JSON.stringify(dataset);
  assert.doesNotMatch(text, /raw\/clippings|wiki\/(concepts|sources|syntheses|entities)\//, 'the sample holds only corpus pages');
});

test('the real runner completes on it: every question evaluated, every labelled passage judged, metrics in range', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'wm-sample-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const out = join(dir, 'run.json');
  const r = spawnSync(process.execPath, [join(root, 'scripts', 'evaluate-retrieval.mjs'), '--questions', join(root, 'eval', 'evaluator-sample.questions.json'), '--keyword-only', '--output', out], {
    env: { ...process.env, WIKI_MASTER_VAULT: corpus, WIKI_MASTER_BROWSER: '/no/such/browser' }, encoding: 'utf8', timeout: 120000,
  });
  assert.equal(r.status, 0, r.stderr);
  const run = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(run.status, 'complete');
  assert.deepEqual(
    [run.coverage.total, run.coverage.evaluated, run.coverage.failed, run.coverage.missingExpectedPages, run.coverage.passageExpected, run.coverage.passageEvaluated],
    [12, 12, 0, 0, 5, 5],
  );
  for (const key of ['pageRecallAt10', 'precisionAt3', 'reciprocalRank', 'passageHitRate']) {
    assert.ok(run.summary[key] >= 0 && run.summary[key] <= 1, `${key} = ${run.summary[key]}`);
  }
  assert.deepEqual(Object.keys(run.byCategory).sort(), ['complement', 'exact', 'paraphrase', 'state', 'task']);
  assert.equal(run.byCategory.exact.pageRecallAt10, 1, 'an exact page name finds its page');
  assert.equal(run.configuration.keywordOnly, true);
});
