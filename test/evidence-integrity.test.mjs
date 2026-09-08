import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { buildGraph, buildNameIndex, evidencePaths, resolveLinkTarget, computeGraphMetrics } from '../scripts/lib/graph.mjs';
import { resolveEvidence } from '../scripts/resolve-evidence.mjs';

export function fixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'wiki-integrity-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  const { pages } = buildGraph(root);
  return { root, pages, pageByPath: new Map(pages.map(p => [p.path, p])), byName: buildNameIndex(pages) };
}

test('evidence never crosses a lateral concept even after reaching a source', t => {
  const g = fixture(t, { 'wiki/concepts/A.md': '[[wiki/sources/S]]', 'wiki/sources/S.md': '[[wiki/concepts/B]]', 'wiki/concepts/B.md': '[[raw/clippings/R]]', 'raw/clippings/R.md': 'Raw text' });
  assert.deepEqual(evidencePaths(g.pages.find(p => p.path === 'wiki/concepts/A.md'), g.byName, g.pageByPath), ['wiki/sources/S.md']);
});

test('Related navigation cannot supply evidence while inline citations still can', t => {
  const g = fixture(t, { 'wiki/concepts/A.md': 'Inline citation [[wiki/sources/S]].\n## Related\n[[raw/clippings/Unrelated]]\n### Details\n[[raw/clippings/Nested]]\n## Evidence\n[[raw/clippings/Direct]]\nRelated: [[raw/clippings/Line]]', 'wiki/sources/S.md': '[[raw/clippings/R]]', 'raw/clippings/R.md': 'Raw', 'raw/clippings/Direct.md': 'Direct', 'raw/clippings/Unrelated.md': 'No', 'raw/clippings/Nested.md': 'No', 'raw/clippings/Line.md': 'No' });
  const r = resolveEvidence('wiki/concepts/A.md', g);
  assert.deepEqual(r.rawPaths.sort(), ['raw/clippings/Direct.md', 'raw/clippings/R.md']);
  assert.deepEqual(r.routes.find(x => x.path === 'raw/clippings/R.md'), { path: 'raw/clippings/R.md', kind: 'transitive', via: ['wiki/concepts/A.md', 'wiki/sources/S.md', 'raw/clippings/R.md'] });
  assert.equal(r.routes.find(x => x.path === 'raw/clippings/Direct.md').kind, 'direct');
});

test('unique aliases resolve but colliding aliases require canonical paths', t => {
  const g = fixture(t, { 'wiki/concepts/A.md': '---\naliases: ["Shared", "Unique"]\n---\nA', 'wiki/concepts/B.md': '---\naliases:\n  - Shared\n---\nB' });
  assert.equal(resolveLinkTarget(g.byName, 'Unique'), 'wiki/concepts/A.md');
  assert.equal(resolveLinkTarget(g.byName, 'Shared'), undefined);
  assert.equal(resolveLinkTarget(g.byName, 'wiki/concepts/B.md'), 'wiki/concepts/B.md');
});

test('quoted metadata is shared consistently', t => {
  const g = fixture(t, { 'wiki/sources/S.md': "---\ntype: 'source'\nproject: 'sparta/migrator'\nkind: 'overview'\nstatus: 'maintained'\nsources: []\n---\n## Relationships\n[[raw/clippings/R]]", 'raw/clippings/R.md': 'R' });
  const p = g.pageByPath.get('wiki/sources/S.md');
  assert.equal(p.type, 'source');
  assert.equal(p.project, 'sparta/migrator');
  assert.equal(p.kind, 'overview');
  assert.equal(p.status, 'maintained');
});

test('Related raw links do not fill source provenance gaps or credit a legacy ingest', t => {
  const g = fixture(t, { 'wiki/sources/S.md': '## Relationships\n[[raw/clippings/R]]', 'raw/clippings/R.md': 'R' });
  const metrics = computeGraphMetrics({ pages: g.pages });
  assert.deepEqual(metrics.provenanceGaps, ['wiki/sources/S.md']);
  assert.deepEqual(metrics.unsummarizedSources, ['raw/clippings/R.md']);
});

test('a missing qualified target cannot resolve to a different canonical path', t => {
  const g = fixture(t, { 'wiki/sources/S.md': 'S' });
  assert.equal(resolveLinkTarget(g.byName, 'raw/clippings/S.md'), undefined);
});

test('an alias cannot shadow a canonical path with an explicit extension', t => {
  const g = fixture(t, { 'wiki/concepts/A.md': '---\naliases: ["wiki/concepts/B.md"]\n---\nA', 'wiki/concepts/B.md': 'B' });
  assert.equal(resolveLinkTarget(g.byName, 'wiki/concepts/B.md'), 'wiki/concepts/B.md');
});

test('Related labels suppress multiline navigation lists and resume at factual boundaries', t => {
  for (const label of ['Related:', '**Related:**', '**Related**:']) {
    const g = fixture(t, { 'wiki/concepts/A.md': `${label}\n- [[raw/clippings/Unrelated]]\n  continuation [[raw/clippings/Unrelated]]\n\n- [[raw/clippings/Unrelated]]\n\nA factual paragraph cites [[raw/clippings/Inline]].\n## Evidence\n[[raw/clippings/Real]]`, 'raw/clippings/Unrelated.md': 'No', 'raw/clippings/Inline.md': 'Inline evidence', 'raw/clippings/Real.md': 'Evidence' });
    assert.deepEqual(resolveEvidence('wiki/concepts/A.md', g).rawPaths.sort(), ['raw/clippings/Inline.md', 'raw/clippings/Real.md'], label);
  }
});

test('alias and declared title collisions stay ambiguous while canonical paths resolve', t => {
  const g = fixture(t, { 'wiki/concepts/A.md': '---\naliases: ["Agent Memory"]\n---\nA', 'wiki/concepts/B.md': '---\ntitle: Agent Memory\n---\nB' });
  assert.equal(resolveLinkTarget(g.byName, 'Agent Memory'), undefined);
  assert.equal(resolveLinkTarget(g.byName, 'Agent Memory', { nav: true }), undefined);
  assert.equal(resolveLinkTarget(g.byName, 'wiki/concepts/B.md'), 'wiki/concepts/B.md');
});

test('declared titles resolve uniquely but cannot shadow another page basename', t => {
  const g = fixture(t, { 'wiki/concepts/A.md': '---\ntitle: Unique display title\n---\nA', 'wiki/concepts/B.md': '---\ntitle: C\n---\nB', 'wiki/concepts/C.md': 'C' });
  assert.equal(resolveLinkTarget(g.byName, '  UNIQUE DISPLAY TITLE  '), 'wiki/concepts/A.md');
  assert.equal(resolveLinkTarget(g.byName, 'C'), undefined);
});

test('exact identity preserves punctuation and legacy raw/content basename channel preference', t => {
  const g = fixture(t, { 'wiki/concepts/A.md': '---\naliases: ["Agent-memory"]\n---\nA', 'wiki/concepts/B.md': '---\ntitle: Agent memory\n---\nB', 'raw/clippings/Shared.md': '---\ntitle: Shared\n---\nRaw', 'wiki/sources/Shared.md': '---\ntitle: Shared\n---\nSummary' });
  assert.equal(resolveLinkTarget(g.byName, 'Agent-memory'), 'wiki/concepts/A.md');
  assert.equal(resolveLinkTarget(g.byName, 'Agent memory'), 'wiki/concepts/B.md');
  assert.equal(resolveLinkTarget(g.byName, 'Shared'), 'raw/clippings/Shared.md');
  assert.equal(resolveLinkTarget(g.byName, 'Shared', { nav: true }), 'wiki/sources/Shared.md');
});

test('operation titles do not collide with content and raw titles use separate navigation classes', t => {
  const g = fixture(t, { 'log/query-a.md': '---\ntitle: Shared\naliases: [Other]\n---\nLog', 'wiki/concepts/Shared.md': 'Shared', 'raw/clippings/raw-a.md': '---\ntitle: Shared\n---\nRaw A', 'raw/clippings/raw-b.md': '---\ntitle: Shared\n---\nRaw B' });
  assert.equal(resolveLinkTarget(g.byName, 'Shared', { nav: true }), 'wiki/concepts/Shared.md');
  assert.equal(resolveLinkTarget(g.byName, 'Shared'), undefined, 'two raw identities require qualified citations');
  assert.equal(resolveLinkTarget(g.byName, 'Other'), undefined, 'operation aliases are not wiki identities');
});

test('ambiguous content navigation cannot fall back to unique raw evidence', t => {
  const g = fixture(t, { 'wiki/concepts/A.md': '---\naliases: [Shared]\n---\nA', 'wiki/concepts/B.md': '---\ntitle: Shared\n---\nB', 'raw/clippings/Shared.md': 'Raw' });
  assert.equal(resolveLinkTarget(g.byName, 'Shared'), 'raw/clippings/Shared.md');
  assert.equal(resolveLinkTarget(g.byName, 'Shared', { nav: true }), undefined);
});
