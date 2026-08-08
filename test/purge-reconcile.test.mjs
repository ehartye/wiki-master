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

// Whichever machine runs it converges, and running it twice changes nothing.
test('reconcile is idempotent — the plan for an already-reconciled vault is empty', () => {
  const first = planReconcile({
    manifests: [manifest],
    pages: [{ path: 'wiki/concepts/Foo.md', name: 'foo' }],
    declines: [],
  });
  assert.equal(first.rebin.length, 1);
  const second = planReconcile({ manifests: [manifest], pages: [], declines: manifest.declines });
  assert.deepEqual(second.rebin, []);
  assert.deepEqual(second.replayDeclines, []);
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
