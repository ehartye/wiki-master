import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { evaluateRetrieval } from '../scripts/evaluate-retrieval.mjs';

const dataset = { version: 1, questions: [
  { id: 'q1', query: 'process', split: 'development', category: 'known-item', expectedPages: ['wiki/concepts/a.md'], expectedPassages: [{ path: 'wiki/concepts/a.md', text: 'regulate action' }], expectedEvidence: ['raw/clippings/paper.md'], forbiddenEvidence: ['raw/clippings/wrong.md'], options: { status: 'accepted' } },
  { id: 'q2', query: 'problem', split: 'heldout', category: 'cross-domain', expectedPages: ['wiki/concepts/b.md'] },
] };

test('evaluation measures page, passage and evidence quality with explicit cost estimates and split isolation', async () => {
  const calls = [];
  const r = await evaluateRetrieval(dataset, { split: 'development', searchFn: async (query, opts) => {
    calls.push({ query, opts });
    return { results: [{ path: 'wiki/concepts/noise.md', passage: 'noise', provenance: [] }, { path: 'wiki/concepts/a.md', passage: 'We regulate action.', provenance: ['raw/clippings/paper.md', 'raw/clippings/wrong.md'] }] };
  } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.status, 'accepted');
  assert.equal(r.summary.pageRecallAt10, 1);
  assert.equal(r.summary.precisionAt3, 1 / 3);
  assert.equal(r.summary.reciprocalRank, 0.5);
  assert.equal(r.summary.passageHitRate, 1);
  assert.equal(r.summary.evidenceRecall, 1);
  assert.equal(r.summary.evidenceCorrectness, 0.5);
  assert.equal(r.questions[0].forbiddenEvidenceHits[0], 'raw/clippings/wrong.md');
  assert.ok(r.summary.outputCharacters > 0);
  assert.equal(r.cost.tokenEstimateMethod, 'ceil(outputCharacters / 4); estimate, not tokenizer usage');
  assert.equal(r.coverage.selected, 1);
  assert.equal(r.coverage.evaluated, 1);
});

test('legacy search exposes unavailable passage/evidence metrics instead of falsely scoring citation errors', async () => {
  const r = await evaluateRetrieval(dataset, { split: 'development', searchFn: async () => ({ results: [{ path: 'wiki/concepts/a.md', startLine: 1 }] }) });
  assert.equal(r.summary.pageRecallAt10, 1);
  assert.equal(r.summary.passageHitRate, null);
  assert.equal(r.summary.evidenceRecall, null);
  assert.equal(r.coverage.passageEvaluated, 0);
  assert.equal(r.coverage.evidenceEvaluated, 0);
  assert.ok(r.questions[0].diagnostics.some(d => d.includes('unavailable')));
});

test('evaluation retains backend availability and freshness diagnostics', async () => {
  const r = await evaluateRetrieval(dataset, { split: 'heldout', searchFn: async () => ({ tier: 'semantic', index: { modified: 2 }, diagnostics: ['keyword-failed'], results: [] }) });
  assert.deepEqual(r.questions[0].searchDiagnostics, ['keyword-failed']);
  assert.equal(r.questions[0].tier, 'semantic');
  assert.equal(r.questions[0].index.modified, 2);
});

test('missing expected pages, failed searches and empty splits remain visible', async () => {
  const vaultRoot = mkdtempSync(join(tmpdir(), 'wiki-eval-'));
  try {
    const r = await evaluateRetrieval(dataset, { vaultRoot, searchFn: async () => { throw new Error('offline'); } });
    assert.equal(r.coverage.failed, 2);
    assert.equal(r.coverage.evaluated, 0);
    assert.equal(r.coverage.missingExpectedPages, 2);
    assert.equal(r.status, 'incomplete');
    assert.equal(r.summary.pageRecallAt10, null);
    await assert.rejects(evaluateRetrieval({ questions: [] }, { searchFn: async () => [] }), /empty|question/i);
    await assert.rejects(evaluateRetrieval({ questions: [dataset.questions[0]] }, { split: 'heldout', searchFn: async () => [] }), /empty|selected/i);
    await assert.rejects(evaluateRetrieval({ questions: [{ ...dataset.questions[0], expectedPages: [] }] }, { searchFn: async () => [] }), /expectedPages/);
  } finally { rmSync(vaultRoot, { recursive: true, force: true }); }
});

test('declared source provenance resolves to raw evidence without following lateral concept links', async () => {
  const vaultRoot = mkdtempSync(join(tmpdir(), 'wiki-eval-evidence-'));
  const files = {
    'wiki/concepts/a.md': '---\nsources: ["[[wiki/sources/summary]]"]\n---\nregulate action',
    'wiki/sources/summary.md': '---\nsources: ["[[raw/clippings/paper]]"]\n---\nSummary.',
    'raw/clippings/paper.md': 'Raw source.',
  };
  try {
    for (const [path, text] of Object.entries(files)) { mkdirSync(dirname(join(vaultRoot, path)), { recursive: true }); writeFileSync(join(vaultRoot, path), text); }
    const r = await evaluateRetrieval(dataset, { vaultRoot, split: 'development', searchFn: async () => ({ results: [{ path: 'wiki/concepts/a.md', passage: 'regulate action', provenance: ['[[wiki/sources/summary]]'] }] }) });
    assert.equal(r.summary.evidenceRecall, 1);
    assert.equal(r.summary.evidenceCorrectness, 1);
    assert.equal(r.coverage.missingExpectedPages, 0);
  } finally { rmSync(vaultRoot, { recursive: true, force: true }); }
});

test('empty successful searches score misses, duplicate results keep the first passage, and invalid judgments fail validation', async () => {
  const empty = await evaluateRetrieval(dataset, { split: 'development', searchFn: async () => ({ results: [] }) });
  assert.equal(empty.summary.pageRecallAt10, 0);
  assert.equal(empty.summary.passageHitRate, 0);
  assert.equal(empty.summary.evidenceRecall, 0);
  assert.equal(empty.coverage.evaluated, 1);
  const duplicate = await evaluateRetrieval(dataset, { split: 'development', searchFn: async () => ({ results: [
    { path: 'wiki/concepts/a.md', passage: 'regulate action', provenance: [] },
    { path: 'wiki/concepts/a.md', passage: 'different chunk', provenance: [] },
  ] }) });
  assert.equal(duplicate.summary.passageHitRate, 1);
  assert.equal(duplicate.summary.precisionAt3, 1 / 3);
  await assert.rejects(evaluateRetrieval({ questions: [{ ...dataset.questions[0], forbiddenEvidence: ['raw/clippings/paper.md'] }] }, { searchFn: async () => [] }), /overlap/);
  await assert.rejects(evaluateRetrieval({ questions: [{ ...dataset.questions[0], expectedPages: ['wiki/../.recycle/a.md'] }] }, { searchFn: async () => [] }), /canonical/);
});

test('returned forbidden citations remain errors when their canonical file does not exist', async () => {
  const vaultRoot = mkdtempSync(join(tmpdir(), 'wiki-eval-forbidden-'));
  try {
    mkdirSync(join(vaultRoot, 'wiki/concepts'), { recursive: true });
    writeFileSync(join(vaultRoot, 'wiki/concepts/a.md'), 'A');
    const questions = [{ id: 'forbidden', query: 'A', split: 'development', expectedPages: ['wiki/concepts/a.md'], forbiddenEvidence: ['raw/clippings/fabricated.md'] }];
    const r = await evaluateRetrieval({ questions }, { vaultRoot, searchFn: async () => ({ results: [{ path: 'wiki/concepts/a.md', provenance: ['[[raw/clippings/fabricated.md]]'] }] }) });
    assert.equal(r.summary.evidenceCorrectness, 0);
    assert.deepEqual(r.questions[0].forbiddenEvidenceHits, ['raw/clippings/fabricated.md']);
    assert.deepEqual(r.questions[0].unresolvedEvidence, ['raw/clippings/fabricated.md']);
    assert.deepEqual(r.questions[0].returnedEvidence, [], 'an absent citation has no resolved evidence route');
  } finally { rmSync(vaultRoot, { recursive: true, force: true }); }
});
