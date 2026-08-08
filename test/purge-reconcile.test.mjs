import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planReconcile } from '../scripts/lib/purge.mjs';

const manifest = {
  id: '2026-08-08-topic',
  entries: [
    { layer: 'wiki', from: 'wiki/concepts/Foo.md', sha256: 'sha-foo' },
    { layer: 'raw', from: 'raw/clippings/Src-abc1234.md', sha256: 'sha-src',
      'source-hash': 'abc1234deadbeef', url: 'https://example.com/a' },
  ],
  declines: ['https://example.com/a'],
};

// A manifest whose one purged entry's source-hash now matches TWO live
// clippings — dedupe.mjs's own group-by-source-hash shows this is a real,
// expected condition (a paper bookmarked twice), not a hypothetical.
const dupManifest = {
  id: '2026-08-08-dup',
  entries: [
    { layer: 'raw', from: 'raw/clippings/Src-orig0000.md', sha256: 'sha-dup',
      'source-hash': 'dupdupdupdupdup', url: 'https://example.com/dup' },
  ],
  declines: ['https://example.com/dup'],
};
const dupA = { path: 'raw/clippings/Src-dup1111.md', name: 'src-dup1111', sourceHash: 'dupdupdupdupdup' };
const dupB = { path: 'raw/clippings/Src-dup2222.md', name: 'src-dup2222', sourceHash: 'dupdupdupdupdup' };

// Applying a plan removes rebinned files from the live set (they land in
// dot-skipped .recycle/) and adds replayed declines to the store. Convergence
// means re-planning after that yields nothing — the spec's actual sentence,
// which comparing two hand-built inputs does not test.
function apply({ pages, declines }, plan) {
  const moved = new Set(plan.rebin.map((r) => r.from));
  return {
    pages: pages.filter((p) => !moved.has(p.path)),
    declines: [...declines, ...plan.replayDeclines],
  };
}

// Repeatedly plans and applies until a round finds nothing left to do (or a
// bound is hit, so a regression reports a failure instead of hanging). Each
// round contributes 1 if it found any work (rebin or decline replay), 0 once
// converged — so [1, 0] means "one application settles it" and anything
// longer than that is exactly the non-convergence bug this guards against.
function convergenceRounds(manifests, pages, declines) {
  let state = { pages, declines };
  const rounds = [];
  let plan;
  for (let i = 0; i < 5; i++) {
    plan = planReconcile({ manifests, pages: state.pages, declines: state.declines });
    const hadWork = plan.rebin.length > 0 || plan.replayDeclines.length > 0;
    rounds.push(hadWork ? 1 : 0);
    if (!hadWork) break;
    state = apply(state, plan);
  }
  return { rounds, finalPlan: plan };
}

test('a file back at its original path is re-binned', () => {
  const r = planReconcile({
    manifests: [manifest],
    pages: [{ path: 'wiki/concepts/Foo.md', name: 'foo' }],
    declines: ['https://example.com/a'],
  });
  assert.deepEqual(r.rebin, [{ id: '2026-08-08-topic', from: 'wiki/concepts/Foo.md', reason: 'path' }]);
});

// The case a path-only ledger misses: /wiki-discover re-clips the same source
// and clip.mjs gives it a fresh -<hash7> suffix, so it returns under a new name.
test('a re-clip under a different filename is caught by source-hash', () => {
  const r = planReconcile({
    manifests: [manifest],
    pages: [{ path: 'raw/clippings/Src-zzz9999.md', name: 'src-zzz9999', sourceHash: 'abc1234deadbeef' }],
    declines: ['https://example.com/a'],
  });
  assert.deepEqual(r.rebin, [
    { id: '2026-08-08-topic', from: 'raw/clippings/Src-zzz9999.md', reason: 'source-hash' },
  ]);
});

// declined.json lives under .wiki-master/, which the vault's .gitignore
// excludes — it does not sync. Replaying manifest declines locally is the only
// thing that carries a purge's declines to another machine.
test('a decline missing from the local store is replayed', () => {
  const r = planReconcile({ manifests: [manifest], pages: [], declines: [] });
  assert.deepEqual(r.replayDeclines, ['https://example.com/a']);
});

test('a decline already present is not replayed', () => {
  const r = planReconcile({ manifests: [manifest], pages: [], declines: ['https://example.com/a'] });
  assert.deepEqual(r.replayDeclines, []);
});

test('a clean vault yields an empty plan', () => {
  const r = planReconcile({ manifests: [manifest], pages: [], declines: ['https://example.com/a'] });
  assert.deepEqual(r.rebin, []);
  assert.deepEqual(r.replayDeclines, []);
});

// Whichever machine runs it converges, and running it twice changes nothing —
// tested by actually applying the plan and re-planning, not by hand-building a
// second input that merely resembles the post-apply state.
test('reconcile converges in one application — path match', () => {
  const { rounds, finalPlan } = convergenceRounds(
    [manifest],
    [{ path: 'wiki/concepts/Foo.md', name: 'foo' }],
    [],
  );
  assert.deepEqual(rounds, [1, 0]);
  assert.deepEqual(finalPlan.rebin, []);
  assert.deepEqual(finalPlan.replayDeclines, []);
});

test('reconcile converges in one application — source-hash match', () => {
  const { rounds, finalPlan } = convergenceRounds(
    [manifest],
    [{ path: 'raw/clippings/Src-zzz9999.md', name: 'src-zzz9999', sourceHash: 'abc1234deadbeef' }],
    [],
  );
  assert.deepEqual(rounds, [1, 0]);
  assert.deepEqual(finalPlan.rebin, []);
  assert.deepEqual(finalPlan.replayDeclines, []);
});

// The case the byHash-as-single-value-Map bug missed: with a multimap, both
// duplicates are caught in the SAME round, so this converges in one
// application too — not two, which is what last-write-wins produced.
test('reconcile converges in one application — duplicate source-hash', () => {
  const { rounds, finalPlan } = convergenceRounds([dupManifest], [dupA, dupB], []);
  assert.deepEqual(rounds, [1, 0]);
  assert.deepEqual(finalPlan.rebin, []);
  assert.deepEqual(finalPlan.replayDeclines, []);
});

// Two live clippings sharing a source-hash are the exact case a single-value
// Map (last-write-wins) drops one of: only the last one written into the map
// would ever be reachable, and which one that is depends on filesystem/array
// order. Both matched here in one call, in the same order regardless of the
// order pages are handed in — sortedByPath (inside planReconcile) settles it.
test('two live clippings sharing a source-hash are both rebinned in a single pass, order-stable across input order', () => {
  const expected = [
    { id: '2026-08-08-dup', from: 'raw/clippings/Src-dup1111.md', reason: 'source-hash' },
    { id: '2026-08-08-dup', from: 'raw/clippings/Src-dup2222.md', reason: 'source-hash' },
  ];
  const forward = planReconcile({ manifests: [dupManifest], pages: [dupA, dupB], declines: dupManifest.declines });
  const shuffled = planReconcile({ manifests: [dupManifest], pages: [dupB, dupA], declines: dupManifest.declines });
  assert.deepEqual(forward.rebin, expected);
  assert.deepEqual(shuffled.rebin, expected);
});

// Files already inside the bin are not live pages coming back.
test('bin contents are never treated as resurrections', () => {
  const r = planReconcile({
    manifests: [manifest],
    pages: [{ path: '.recycle/2026-08-08-topic/wiki/concepts/Foo.md', name: 'foo' }],
    declines: manifest.declines,
  });
  assert.deepEqual(r.rebin, []);
});

test('one entry never yields two rebin rows when path and hash both match', () => {
  const r = planReconcile({
    manifests: [manifest],
    pages: [{ path: 'raw/clippings/Src-abc1234.md', name: 'src-abc1234', sourceHash: 'abc1234deadbeef' }],
    declines: manifest.declines,
  });
  assert.equal(r.rebin.length, 1);
  assert.equal(r.rebin[0].reason, 'path');
});
