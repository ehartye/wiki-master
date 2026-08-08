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

// Files already inside the bin are not live pages coming back. A path-only
// fixture can't defend this filter: nothing in the bin matches `from` by path
// OR by hash unless the bin page also carries the source-hash a binned
// clipping keeps in its frontmatter. This is the real hazard — a collector
// that forgot to dot-skip would hash-match a file already in the bin and
// reconcile would nest it deeper (.recycle/<id>/raw/... -> .recycle/<id>/.recycle/...).
test('bin contents are never treated as resurrections', () => {
  const r = planReconcile({
    manifests: [manifest],
    pages: [{
      path: '.recycle/2026-08-08-topic/raw/clippings/Src-abc1234.md',
      name: 'src-abc1234',
      sourceHash: 'abc1234deadbeef',
    }],
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

// Two entries in the SAME manifest sharing a source-hash is the duplicate-
// clipping condition that motivated the multimap: without the `seen` guard
// inside the hash loop, both entries would emit a row for the one live file.
test('two manifest entries sharing a source-hash never double-count the same live file', () => {
  const dupEntries = {
    id: '2026-08-08-dup-entries',
    entries: [
      { layer: 'raw', from: 'raw/clippings/Src-orig-a.md', sha256: 'sha-a',
        'source-hash': 'dupdupdupdupdup', url: 'https://example.com/dup-a' },
      { layer: 'raw', from: 'raw/clippings/Src-orig-b.md', sha256: 'sha-b',
        'source-hash': 'dupdupdupdupdup', url: 'https://example.com/dup-b' },
    ],
    declines: [],
  };
  const page = { path: 'raw/clippings/Src-live0000.md', name: 'src-live0000', sourceHash: 'dupdupdupdupdup' };
  const r = planReconcile({ manifests: [dupEntries], pages: [page], declines: [] });
  assert.deepEqual(r.rebin, [{ id: '2026-08-08-dup-entries', from: page.path, reason: 'source-hash' }]);
});

// Earliest purge claims a contested path — a page purged, restored, and
// purged again in a later purge appears in both manifests by construction,
// and the module must not let caller order decide which bin it comes back to.
// This also defends the `seen` guard in the path branch: without it, two
// manifests listing the same live path would each emit a row for it.
test('a path claimed by two manifests goes to the earliest purge, regardless of manifest order', () => {
  const alpha = {
    id: '2026-08-01-alpha',
    entries: [{ layer: 'wiki', from: 'wiki/concepts/Foo.md', sha256: 'sha-alpha' }],
    declines: [],
  };
  const beta = {
    id: '2026-09-01-beta',
    entries: [{ layer: 'wiki', from: 'wiki/concepts/Foo.md', sha256: 'sha-beta' }],
    declines: [],
  };
  const pages = [{ path: 'wiki/concepts/Foo.md', name: 'foo' }];
  const expected = [{ id: '2026-08-01-alpha', from: 'wiki/concepts/Foo.md', reason: 'path' }];

  const forward = planReconcile({ manifests: [alpha, beta], pages, declines: [] });
  const reverse = planReconcile({ manifests: [beta, alpha], pages, declines: [] });
  assert.deepEqual(forward.rebin, expected);
  assert.deepEqual(reverse.rebin, expected);
});

// Local declines are recorded in whatever case a prior run happened to use;
// the join must not miss a match on case alone.
test('a decline already present is matched case-insensitively', () => {
  const r = planReconcile({ manifests: [manifest], pages: [], declines: ['HTTPS://EXAMPLE.COM/A'] });
  assert.deepEqual(r.replayDeclines, []);
});

// Manifests are hand-editable JSON; a hash recorded in a different case must
// still resolve to the live clipping's (always-lowercased) hash key.
test('a source-hash match is case-insensitive against the manifest entry', () => {
  const caseManifest = {
    id: '2026-08-08-case',
    entries: [{ layer: 'raw', from: 'raw/clippings/Src-orig.md', sha256: 'sha-case',
      'source-hash': 'ABC1234DEADBEEF' }],
    declines: [],
  };
  const page = { path: 'raw/clippings/Src-newname.md', name: 'src-newname', sourceHash: 'abc1234deadbeef' };
  const r = planReconcile({ manifests: [caseManifest], pages: [page], declines: [] });
  assert.deepEqual(r.rebin, [{ id: '2026-08-08-case', from: page.path, reason: 'source-hash' }]);
});
