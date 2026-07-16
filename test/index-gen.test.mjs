import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderCatalog, regenerateIndex, BEGIN_MARK, END_MARK } from '../scripts/index-gen.mjs';
import { buildGraph } from '../scripts/lib/graph.mjs';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'vault');

// index.md is a DERIVED artifact: regenerated in full from the pages, committed
// by atomic rename. Prose outside the fence is preserved verbatim; everything
// inside is disposable. Lost updates dissolve — concurrent regenerations
// converge on the next run.

function tempVault() {
  const v = mkdtempSync(join(tmpdir(), 'wm-index-'));
  cpSync(FIXTURE, v, { recursive: true });
  return v;
}

test('buildGraph parses type from frontmatter', () => {
  const g = buildGraph(FIXTURE);
  const alpha = g.pages.find((p) => p.path === 'wiki/concepts/alpha.md');
  assert.equal(alpha.type, 'concept');
});

test('renderCatalog groups wiki pages by type and flags stubs', () => {
  const catalog = renderCatalog(buildGraph(FIXTURE));
  assert.ok(catalog.includes('## Concepts'), 'has Concepts section');
  assert.ok(catalog.includes('## Entities'), 'has Entities section');
  assert.ok(catalog.includes('[[alpha]]'), 'lists concept pages');
  assert.ok(catalog.match(/\[\[orphan-entity\]\].*\(stub\)/), 'stub status visible');
  assert.ok(!catalog.includes('unparsed-clip'), 'raw/ clippings are not catalog entries');
  assert.ok(!catalog.includes('[[index]]'), 'structural files are not catalog entries');
});

test('regenerateIndex preserves prose outside the fence', () => {
  const v = tempVault();
  writeFileSync(join(v, 'index.md'), [
    '---', 'type: synthesis', '---', '# Index', '',
    '## Start here', '- [[root-synthesis]] — the narrative entry point.', '',
    BEGIN_MARK, 'stale generated content to be replaced', END_MARK, '',
    'Trailing human note that must survive.',
  ].join('\n'));
  regenerateIndex(v);
  const out = readFileSync(join(v, 'index.md'), 'utf8');
  assert.ok(out.includes('the narrative entry point'), 'human prose above fence preserved');
  assert.ok(out.includes('Trailing human note that must survive.'), 'prose below fence preserved');
  assert.ok(!out.includes('stale generated content'), 'fenced region replaced');
  assert.ok(out.includes('## Concepts'), 'catalog generated inside fence');
});

test('regenerateIndex appends a fenced catalog when no markers exist', () => {
  const v = tempVault();
  writeFileSync(join(v, 'index.md'), '---\ntype: synthesis\n---\n# Index\nHand-written legacy catalog.\n');
  regenerateIndex(v);
  const out = readFileSync(join(v, 'index.md'), 'utf8');
  assert.ok(out.includes('Hand-written legacy catalog.'), 'legacy content untouched');
  assert.ok(out.includes(BEGIN_MARK) && out.includes(END_MARK), 'fence added');
  assert.ok(out.includes('## Concepts'), 'catalog present');
});

test('regenerateIndex is idempotent and leaves no temp files', () => {
  const v = tempVault();
  regenerateIndex(v);
  const first = readFileSync(join(v, 'index.md'), 'utf8');
  regenerateIndex(v);
  const second = readFileSync(join(v, 'index.md'), 'utf8');
  assert.equal(first, second, 'second run is byte-identical');
  const stray = readdirSync(v).filter((f) => f.includes('.tmp-'));
  assert.deepEqual(stray, [], 'no temp files left behind');
});
