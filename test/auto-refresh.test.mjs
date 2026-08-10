import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planAutoRefresh } from '../scripts/lib/auto-refresh.mjs';

// op-commit is the single choke point every mutating operation passes
// through, so it is where the semantic index gets kept current. The decision
// of WHETHER to refresh is separated from the refresh itself so every
// combination can be tested without a live Ollama -- same split, and same
// reason, as scripts/lib/search-health.mjs.
const HEALTHY = {
  ollama: { reachable: true, modelPresent: true, model: 'nomic-embed-text' },
  indexPresent: true,
};

test('a healthy vault with a built index refreshes, with nothing to report', () => {
  const r = planAutoRefresh(HEALTHY);
  assert.equal(r.run, true);
  assert.equal(r.reason, null);
  assert.equal(r.notice, null);
});

test('Ollama not running skips the refresh and names `ollama serve`', () => {
  const r = planAutoRefresh({ ...HEALTHY, ollama: { reachable: false, modelPresent: false, model: 'nomic-embed-text' } });
  assert.equal(r.run, false);
  assert.equal(r.reason, 'ollama-not-running');
  assert.match(r.notice, /ollama serve/);
});

// Mirrors search-health test 3: isAvailable() proves only that the server
// answers. A reachable-but-modelless Ollama would 404 every embed, so the
// refresh must not be attempted -- refreshIndex would fail chunk by chunk.
test('Ollama up but the model not pulled skips the refresh and names the pull command', () => {
  const r = planAutoRefresh({ ...HEALTHY, ollama: { reachable: true, modelPresent: false, model: 'nomic-embed-text' } });
  assert.equal(r.run, false);
  assert.equal(r.reason, 'model-not-pulled');
  assert.match(r.notice, /ollama pull nomic-embed-text/);
});

// The load-bearing decision. An incremental refresh is ~0.2s; a COLD build is
// minutes (54s measured on a 1,821-file vault, and that vault is not the
// largest one this will ever run against). Starting one as a side effect of
// an ordinary commit would hang an operation the user thought was finished,
// with no way to know why. So a missing index is reported, never built.
test('a vault with no index yet is told to build one, and no build is started', () => {
  const r = planAutoRefresh({ ...HEALTHY, indexPresent: false });
  assert.equal(r.run, false);
  assert.equal(r.reason, 'index-not-built');
  assert.match(r.notice, /index-embed\.mjs/);
  assert.match(r.notice, /minutes|first build|cold/i,
    'the notice must explain WHY it was not built automatically, or it reads as a malfunction');
});

// A deliberate divergence from assessTiers' dependency order, which puts
// Ollama first. Here the index check comes first, for two reasons:
//
//   1. `indexPresent` is a local file check; the Ollama checks are network
//      round-trips. Ordering the free check first means a vault that has
//      never built an index -- which includes every vault in this test
//      suite -- pays nothing on every single commit.
//   2. It costs the user nothing. The remedy for a missing index is
//      index-embed.mjs, and refreshIndex preflights Ollama itself, throwing
//      "Ollama is unreachable ... start it before building the index". So a
//      doubly-broken vault still gets told about Ollama -- one step later,
//      by the tool that actually needs it.
test('with Ollama down and no index, the missing index is what gets reported', () => {
  const r = planAutoRefresh({ ollama: { reachable: false, modelPresent: false, model: 'nomic-embed-text' }, indexPresent: false });
  assert.equal(r.run, false);
  assert.equal(r.reason, 'index-not-built');
});
