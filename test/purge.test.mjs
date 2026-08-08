import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStructural, inboundMap } from '../scripts/lib/purge.mjs';
import { buildNameIndex } from '../scripts/lib/graph.mjs';

// Structural pages link everything (index.md catalogs the vault; a MOC exists to
// point at pages). If they counted as "an outside page references this", nothing
// would ever qualify for the closure and purge would only ever move its seeds.
test('isStructural covers the catalog, MOCs, the log and templates', () => {
  assert.equal(isStructural('index.md'), true);
  assert.equal(isStructural('log.md'), true);
  assert.equal(isStructural('vault-schema.md'), true);
  assert.equal(isStructural('moc/audio-moc.md'), true);
  assert.equal(isStructural('log/2026-08-08-120000-ingest-foo.md'), true);
  assert.equal(isStructural('_templates/source-note.md'), true);
});

test('isStructural excludes real content and evidence', () => {
  assert.equal(isStructural('wiki/concepts/Alpha.md'), false);
  assert.equal(isStructural('raw/clippings/Src-abc1234.md'), false);
  assert.equal(isStructural('raw/attachments/fig-9f8e7d6.png'), false);
});

test('inboundMap credits a body link to its target, following nav resolution', () => {
  const pages = [
    { path: 'wiki/concepts/A.md', name: 'a', outTargets: ['B'], fmTargets: [] },
    { path: 'wiki/concepts/B.md', name: 'b', outTargets: [], fmTargets: [] },
  ];
  const inbound = inboundMap(pages, buildNameIndex(pages));
  assert.deepEqual([...inbound.get('wiki/concepts/B.md')], ['wiki/concepts/A.md']);
  assert.deepEqual([...inbound.get('wiki/concepts/A.md')], []);
});

test('inboundMap credits a frontmatter sources: link to the raw clipping it cites', () => {
  const pages = [
    { path: 'wiki/sources/S.md', name: 's', outTargets: [], fmTargets: ['raw/clippings/Src-abc1234.md'] },
    { path: 'raw/clippings/Src-abc1234.md', name: 'src-abc1234', outTargets: [], fmTargets: [] },
  ];
  const inbound = inboundMap(pages, buildNameIndex(pages));
  assert.deepEqual([...inbound.get('raw/clippings/Src-abc1234.md')], ['wiki/sources/S.md']);
});

// A page linking to itself must not make itself look externally referenced.
test('inboundMap ignores self-links', () => {
  const pages = [{ path: 'wiki/concepts/A.md', name: 'a', outTargets: ['A'], fmTargets: [] }];
  const inbound = inboundMap(pages, buildNameIndex(pages));
  assert.deepEqual([...inbound.get('wiki/concepts/A.md')], []);
});
