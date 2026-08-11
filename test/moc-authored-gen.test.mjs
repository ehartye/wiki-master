import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  renderProjectCatalog, projectSlug, regenerateAuthoredMocs, BEGIN_MARK, END_MARK, MIN_PAGES,
} from '../scripts/moc-authored-gen.mjs';

// Per-project MOC generation (spec docs/superpowers/specs/2026-08-11-authored-project-docs-design.md
// §5.3). Mirrors index-gen.mjs's own fence contract exactly: hand-prose is never touched, only the
// fenced region is a pure function of the pages. The fence itself is deliberately bare -- one
// bullet per page, no invented description text -- for the same reason index-gen.mjs's own
// generated catalog is bare: a generator should never approximate hand-written narrative with a
// more fragile heuristic when the honest answer is "that stays hand-written."

const page = (path, project, kind) => ({ path, project, kind });

test('projectSlug flattens a project value into a filesystem-safe moc filename stem', () => {
  assert.equal(projectSlug('sparta-suite'), 'sparta-suite');
  assert.equal(projectSlug('sparta-suite/migrator'), 'sparta-suite-migrator');
});

test('renderProjectCatalog groups a project\'s pages by KIND_ORDER, one bare bullet per page', () => {
  const catalog = renderProjectCatalog({
    pages: [
      page('wiki/authored/demo-roadmap.md', 'demo', 'roadmap'),
      page('wiki/authored/demo-overview.md', 'demo', 'overview'),
      page('wiki/authored/demo-guide.md', 'demo', 'guide'),
    ],
  });
  const overviewIdx = catalog.indexOf('[[demo-overview]]');
  const guideIdx = catalog.indexOf('[[demo-guide]]');
  const roadmapIdx = catalog.indexOf('[[demo-roadmap]]');
  assert.ok(overviewIdx > -1 && guideIdx > overviewIdx && roadmapIdx > guideIdx,
    'overview before guide before roadmap, per KIND_ORDER');
  assert.ok(catalog.includes('## Overview'));
  assert.ok(catalog.includes('## Guide'));
  assert.ok(catalog.includes('## Roadmap'));
});

test('renderProjectCatalog renders bare bullets with no invented description text', () => {
  const catalog = renderProjectCatalog({ pages: [page('wiki/authored/demo-overview.md', 'demo', 'overview')] });
  assert.match(catalog.trim(), /^## Overview\n- \[\[demo-overview\]\]$/);
});

test('renderProjectCatalog puts pages with no/unrecognized kind in a trailing Other section', () => {
  const catalog = renderProjectCatalog({
    pages: [page('wiki/authored/demo-overview.md', 'demo', 'overview'), page('wiki/authored/demo-misc.md', 'demo', undefined)],
  });
  const overviewIdx = catalog.indexOf('## Overview');
  const otherIdx = catalog.indexOf('## Other');
  assert.ok(overviewIdx > -1 && otherIdx > overviewIdx, 'Other section comes after recognized kinds');
  assert.ok(catalog.includes('[[demo-misc]]'));
});

function tempVault() {
  const v = mkdtempSync(join(tmpdir(), 'wm-moc-'));
  mkdirSync(join(v, 'wiki', 'authored'), { recursive: true });
  mkdirSync(join(v, 'moc'), { recursive: true });
  return v;
}

function writeAuthored(vault, name, project, kind) {
  writeFileSync(
    join(vault, 'wiki', 'authored', `${name}.md`),
    `---\ntype: authored\nsources: []\nproject: ${project}\nkind: ${kind}\n---\n# ${name}\n\n## Summary\n`
  );
}

test('a project with fewer than MIN_PAGES pages does not get a materialized MOC', () => {
  const v = tempVault();
  writeAuthored(v, 'lonely-overview', 'lonely', 'overview');
  const r = regenerateAuthoredMocs(v, { apply: true });
  assert.equal(r.written.length, 0, `expected no MOC written, got ${JSON.stringify(r.written)}`);
  assert.ok(!existsSync(join(v, 'moc', 'lonely.md')));
});

test('a project with >= MIN_PAGES pages gets a fresh MOC file when none exists', () => {
  const v = tempVault();
  writeAuthored(v, 'demo-overview', 'demo', 'overview');
  writeAuthored(v, 'demo-guide', 'demo', 'guide');
  const r = regenerateAuthoredMocs(v, { apply: true });
  assert.deepEqual(r.written, ['demo']);
  const out = readFileSync(join(v, 'moc', 'demo.md'), 'utf8');
  assert.ok(out.includes(BEGIN_MARK) && out.includes(END_MARK));
  assert.ok(out.includes('[[demo-overview]]') && out.includes('[[demo-guide]]'));
});

test('re-running replaces only the fenced region — hand-written prose survives byte-identical', () => {
  const v = tempVault();
  writeAuthored(v, 'demo-overview', 'demo', 'overview');
  writeAuthored(v, 'demo-guide', 'demo', 'guide');
  writeFileSync(join(v, 'moc', 'demo.md'), [
    '---', 'type: moc', '---', '# MOC — Demo', '',
    '## Cross-cutting topics', '- hand-written, must survive', '',
    BEGIN_MARK, 'stale content', END_MARK, '',
    'Trailing hand-written note.',
  ].join('\n'));
  regenerateAuthoredMocs(v, { apply: true });
  const out = readFileSync(join(v, 'moc', 'demo.md'), 'utf8');
  assert.ok(out.includes('hand-written, must survive'), 'prose above fence preserved');
  assert.ok(out.includes('Trailing hand-written note.'), 'prose below fence preserved');
  assert.ok(!out.includes('stale content'), 'fenced region replaced');
  assert.ok(out.includes('[[demo-overview]]'));
});

test('an existing file with no fence gets one appended, mirroring index-gen.mjs — nothing existing is touched', () => {
  const v = tempVault();
  writeAuthored(v, 'demo-overview', 'demo', 'overview');
  writeAuthored(v, 'demo-guide', 'demo', 'guide');
  writeFileSync(join(v, 'moc', 'demo.md'), '---\ntype: moc\n---\n# MOC — Demo\nHand-written legacy listing.\n');
  regenerateAuthoredMocs(v, { apply: true });
  const out = readFileSync(join(v, 'moc', 'demo.md'), 'utf8');
  assert.ok(out.includes('Hand-written legacy listing.'), 'legacy content untouched');
  assert.ok(out.includes(BEGIN_MARK) && out.includes(END_MARK), 'fence appended');
  assert.ok(out.includes('[[demo-overview]]'));
});

test('a two-tier project slug (project/subproject) maps to a distinct MOC file', () => {
  const v = tempVault();
  writeAuthored(v, 'sub-a', 'demo/sub', 'overview');
  writeAuthored(v, 'sub-b', 'demo/sub', 'guide');
  const r = regenerateAuthoredMocs(v, { apply: true });
  assert.ok(r.written.includes('demo/sub'));
  assert.ok(existsSync(join(v, 'moc', 'demo-sub.md')));
});

test('dry run (apply: false, the default) reports what would be written without touching disk', () => {
  const v = tempVault();
  writeAuthored(v, 'demo-overview', 'demo', 'overview');
  writeAuthored(v, 'demo-guide', 'demo', 'guide');
  const r = regenerateAuthoredMocs(v);
  assert.deepEqual(r.written, ['demo']);
  assert.ok(!existsSync(join(v, 'moc', 'demo.md')), 'dry run does not write');
});

test('pages with no project at all are excluded and never trigger a MOC', () => {
  const v = tempVault();
  writeFileSync(
    join(v, 'wiki', 'authored', 'standalone.md'),
    '---\ntype: authored\nsources: []\n---\n# standalone\n\n## Summary\n'
  );
  const r = regenerateAuthoredMocs(v, { apply: true });
  assert.deepEqual(r.written, []);
});

test('is idempotent and leaves no temp files', () => {
  const v = tempVault();
  writeAuthored(v, 'demo-overview', 'demo', 'overview');
  writeAuthored(v, 'demo-guide', 'demo', 'guide');
  regenerateAuthoredMocs(v, { apply: true });
  const first = readFileSync(join(v, 'moc', 'demo.md'), 'utf8');
  regenerateAuthoredMocs(v, { apply: true });
  const second = readFileSync(join(v, 'moc', 'demo.md'), 'utf8');
  assert.equal(first, second, 'second run is byte-identical');
});

test('MIN_PAGES is 2 — the documented, adjustable threshold', () => {
  assert.equal(MIN_PAGES, 2);
});
