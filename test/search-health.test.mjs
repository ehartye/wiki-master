import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessTiers, embeddingCoverage, shouldAnnounceFull, statusLine,
} from '../scripts/lib/search-health.mjs';

const FULL = { qmd: { installed: true, collectionExists: true, staleCount: 0 },
               ollama: { reachable: true, modelPresent: true, model: 'nomic-embed-text' } };

test('all tiers available resolves to qmd with no gaps', () => {
  const r = assessTiers(FULL);
  assert.equal(r.tier, 'qmd');
  assert.deepEqual(r.gaps, []);
});

test('no qmd but a working Ollama resolves to hybrid', () => {
  const r = assessTiers({ ...FULL, qmd: { installed: false } });
  assert.equal(r.tier, 'hybrid');
  assert.equal(r.gaps.length, 1);
  assert.equal(r.gaps[0].tier, 'qmd');
});

test('nothing available resolves to keyword and names both gaps', () => {
  const r = assessTiers({ qmd: { installed: false }, ollama: { reachable: false } });
  assert.equal(r.tier, 'keyword');
  assert.deepEqual(r.gaps.map((g) => g.tier).sort(), ['ollama', 'qmd']);
});

// The whole reason this module exists. isAvailable() checks the SERVER answers,
// not that the model is pulled — so search() reports `hybrid`, every embed 404s,
// semanticSearch skips each page, and keyword results carry a hybrid label.
test('a reachable Ollama missing its model is flagged as MISREPORTING, not merely degraded', () => {
  const r = assessTiers({
    qmd: { installed: false },
    ollama: { reachable: true, modelPresent: false, model: 'nomic-embed-text' },
  });
  assert.equal(r.tier, 'keyword', 'semantic cannot contribute without the model');
  const g = r.gaps.find((x) => x.tier === 'ollama');
  assert.equal(g.misreports, true);
  assert.match(g.fix, /ollama pull nomic-embed-text/);
});

// qmdProbe() only runs `qmd --version`, so an unconfigured qmd is tried first,
// returns nothing, and falls through — a subprocess per query for no benefit.
test('qmd installed without a collection does not count as the qmd tier', () => {
  const r = assessTiers({ ...FULL, qmd: { installed: true, collectionExists: false } });
  assert.equal(r.tier, 'hybrid');
  assert.match(r.gaps.find((g) => g.tier === 'qmd').state, /no wiki-master collection/);
});

// The asymmetry that shapes the design: the Ollama cache is content-hash keyed
// and can only ever be slow, never wrong. A qmd collection is a real index and
// goes stale silently.
test('a stale qmd collection still answers but is flagged as misreporting', () => {
  const r = assessTiers({ ...FULL, qmd: { installed: true, collectionExists: true, staleCount: 12 } });
  assert.equal(r.tier, 'qmd', 'it still answers — that is what makes staleness dangerous');
  const g = r.gaps.find((x) => x.tier === 'qmd');
  assert.equal(g.misreports, true);
  assert.match(g.state, /12 file\(s\) changed/);
  assert.equal(g.fix, 'qmd embed');
});

test('embeddingCoverage counts cached, uncached and orphaned vectors', () => {
  const r = embeddingCoverage(['a', 'b', 'c'], ['a', 'b', 'zz', 'yy']);
  assert.deepEqual(r, { total: 3, cached: 2, uncached: 1, orphaned: 2 });
});

test('embeddingCoverage on an empty vault is not a divide-by-zero shape', () => {
  assert.deepEqual(embeddingCoverage([], []), { total: 0, cached: 0, uncached: 0, orphaned: 0 });
});

test('the full block announces when never announced before', () => {
  assert.equal(shouldAnnounceFull(null, Date.now()), true);
  assert.equal(shouldAnnounceFull('not a date', Date.now()), true);
});

test('the full block re-arms only after the window', () => {
  const now = Date.parse('2026-08-09T12:00:00Z');
  assert.equal(shouldAnnounceFull('2026-08-09T11:00:00Z', now), false, 'one hour later: quiet');
  assert.equal(shouldAnnounceFull('2026-08-09T07:00:00Z', now), true, 'five hours later: re-arm');
});

// Never silent: even the short form names the tier and that something is off.
test('statusLine always names the tier, and names the gaps when degraded', () => {
  assert.equal(statusLine(assessTiers(FULL)), '(qmd — all tiers available)');
  const degraded = statusLine(assessTiers({ qmd: { installed: false }, ollama: { reachable: false } }));
  assert.match(degraded, /^\(keyword — /);
  assert.match(degraded, /ollama and qmd|qmd and ollama/);
  assert.match(degraded, /--health/);
});

test('statusLine does not repeat a tier that has two gaps', () => {
  const line = statusLine({ tier: 'keyword', gaps: [{ tier: 'qmd' }, { tier: 'qmd' }] });
  assert.equal((line.match(/qmd/g) || []).length, 1);
});
