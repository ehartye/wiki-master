import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderBacklogCatalog, regenerateBacklogRoadmaps, BEGIN_MARK, END_MARK } from '../scripts/backlog-gen.mjs';

// Generated roadmap-as-index over backlog/*.md items (spec
// docs/superpowers/specs/2026-08-11-authored-project-structure-v2-design.md §3) — the actual
// completion of the monolith-detection signal: a roadmap.md that regenerates from small,
// individually-edited item files can never again become the place status changes accumulate.
// Mirrors moc-authored-gen.mjs's fence contract exactly (append-if-missing, replace-if-present,
// hand-prose outside the fence untouched).

const item = (path, project, backlogStatus) => ({ path, project, kind: 'backlog-item', backlogStatus });

test('renderBacklogCatalog groups items by BACKLOG_STATUS_ORDER, one bare bullet per item', () => {
  const catalog = renderBacklogCatalog({
    pages: [
      item('wiki/authored/demo/backlog/a.md', 'demo', 'shipped'),
      item('wiki/authored/demo/backlog/b.md', 'demo', 'in-progress'),
      item('wiki/authored/demo/backlog/c.md', 'demo', 'planned'),
    ],
  });
  const inProgressIdx = catalog.indexOf('[[a]]');
  assert.ok(catalog.includes('## In progress'));
  assert.ok(catalog.includes('## Planned'));
  assert.ok(catalog.includes('## Shipped'));
  const shippedIdx = catalog.indexOf('## Shipped');
  const bIdx = catalog.indexOf('[[b]]');
  assert.ok(bIdx > -1 && bIdx < shippedIdx, 'in-progress item listed before the Shipped heading');
});

test('renderBacklogCatalog renders bare bullets with no invented description text', () => {
  const catalog = renderBacklogCatalog({ pages: [item('wiki/authored/demo/backlog/only-item.md', 'demo', 'planned')] });
  assert.match(catalog.trim(), /^## Planned\n- \[\[only-item\]\]$/);
});

// Same collision risk as moc-authored-gen.mjs/index-gen.mjs: a backlog-item
// slug can be reused across two projects' backlog/ folders just as easily as
// overview.md/architecture.md/roadmap.md, and a bare link would silently
// resolve to only one of them, vault-wide.
test('renderBacklogCatalog emits a piped full-path link for a backlog-item basename ambiguous vault-wide', () => {
  const catalog = renderBacklogCatalog({
    pages: [item('wiki/authored/demo/backlog/auth-fix.md', 'demo', 'planned')],
    ambiguousNames: new Set(['auth-fix']),
  });
  assert.ok(catalog.includes('[[wiki/authored/demo/backlog/auth-fix|auth-fix]]'));
});

test('renderBacklogCatalog keeps a bare link when ambiguousNames is omitted — unchanged default behavior', () => {
  const catalog = renderBacklogCatalog({ pages: [item('wiki/authored/demo/backlog/auth-fix.md', 'demo', 'planned')] });
  assert.ok(catalog.includes('[[auth-fix]]'));
});

function tempVault() {
  const v = mkdtempSync(join(tmpdir(), 'wm-backlog-'));
  mkdirSync(join(v, 'wiki', 'authored', 'demo', 'backlog'), { recursive: true });
  return v;
}

function writeItem(vault, name, project, backlogStatus) {
  writeFileSync(
    join(vault, 'wiki', 'authored', project, 'backlog', `${name}.md`),
    `---\ntype: authored\nsources: []\nproject: ${project}\nkind: backlog-item\nbacklog-status: ${backlogStatus}\n---\n# ${name}\n\nbody\n`
  );
}

test('regenerateBacklogRoadmaps creates a fresh roadmap.md fence when none exists', () => {
  const v = tempVault();
  writeItem(v, 'item-a', 'demo', 'in-progress');
  writeItem(v, 'item-b', 'demo', 'shipped');
  const r = regenerateBacklogRoadmaps(v, { apply: true });
  assert.deepEqual(r.written, ['demo']);
  const out = readFileSync(join(v, 'wiki', 'authored', 'demo', 'roadmap.md'), 'utf8');
  assert.ok(out.includes(BEGIN_MARK) && out.includes(END_MARK));
  assert.ok(out.includes('[[item-a]]') && out.includes('[[item-b]]'));
});

test('re-running replaces only the fenced region — hand-written prose survives byte-identical', () => {
  const v = tempVault();
  writeItem(v, 'item-a', 'demo', 'planned');
  writeFileSync(join(v, 'wiki', 'authored', 'demo', 'roadmap.md'), [
    '---', 'type: authored', 'kind: roadmap', '---', '# demo — roadmap', '',
    '## Summary', 'Hand-written framing prose that must survive.', '',
    BEGIN_MARK, 'stale content', END_MARK,
  ].join('\n'));
  regenerateBacklogRoadmaps(v, { apply: true });
  const out = readFileSync(join(v, 'wiki', 'authored', 'demo', 'roadmap.md'), 'utf8');
  assert.ok(out.includes('Hand-written framing prose that must survive.'));
  assert.ok(!out.includes('stale content'));
  assert.ok(out.includes('[[item-a]]'));
});

test('an existing roadmap.md with no fence gets one appended, mirroring index-gen.mjs/moc-authored-gen.mjs', () => {
  const v = tempVault();
  writeItem(v, 'item-a', 'demo', 'planned');
  writeFileSync(join(v, 'wiki', 'authored', 'demo', 'roadmap.md'), '---\ntype: authored\n---\n# demo — roadmap\nLegacy hand-written text.\n');
  regenerateBacklogRoadmaps(v, { apply: true });
  const out = readFileSync(join(v, 'wiki', 'authored', 'demo', 'roadmap.md'), 'utf8');
  assert.ok(out.includes('Legacy hand-written text.'));
  assert.ok(out.includes(BEGIN_MARK) && out.includes(END_MARK));
});

test('a project with zero backlog items produces no roadmap write', () => {
  const v = tempVault(); // has the backlog/ dir but no items written into it
  const r = regenerateBacklogRoadmaps(v, { apply: true });
  assert.deepEqual(r.written, []);
  assert.ok(!existsSync(join(v, 'wiki', 'authored', 'demo', 'roadmap.md')));
});

test('dry run (apply: false, the default) reports without touching disk', () => {
  const v = tempVault();
  writeItem(v, 'item-a', 'demo', 'planned');
  const r = regenerateBacklogRoadmaps(v);
  assert.deepEqual(r.written, ['demo']);
  assert.ok(!existsSync(join(v, 'wiki', 'authored', 'demo', 'roadmap.md')));
});

test('is idempotent and leaves no temp files', () => {
  const v = tempVault();
  writeItem(v, 'item-a', 'demo', 'planned');
  regenerateBacklogRoadmaps(v, { apply: true });
  const first = readFileSync(join(v, 'wiki', 'authored', 'demo', 'roadmap.md'), 'utf8');
  regenerateBacklogRoadmaps(v, { apply: true });
  const second = readFileSync(join(v, 'wiki', 'authored', 'demo', 'roadmap.md'), 'utf8');
  assert.equal(first, second);
});

test('regenerateBacklogRoadmaps: two projects with a same-named backlog item each get a piped link naming their OWN full path', () => {
  const v = tempVault(); // already has demo/backlog/; add a second project's own
  mkdirSync(join(v, 'wiki', 'authored', 'other', 'backlog'), { recursive: true });
  writeItem(v, 'auth-fix', 'demo', 'planned');
  writeItem(v, 'auth-fix', 'other', 'planned');
  const r = regenerateBacklogRoadmaps(v, { apply: true });
  assert.ok(r.written.includes('demo') && r.written.includes('other'));
  const demoRoadmap = readFileSync(join(v, 'wiki', 'authored', 'demo', 'roadmap.md'), 'utf8');
  const otherRoadmap = readFileSync(join(v, 'wiki', 'authored', 'other', 'roadmap.md'), 'utf8');
  assert.ok(demoRoadmap.includes('[[wiki/authored/demo/backlog/auth-fix|auth-fix]]'),
    `demo's roadmap should pipe its OWN auth-fix.md, got: ${demoRoadmap}`);
  assert.ok(otherRoadmap.includes('[[wiki/authored/other/backlog/auth-fix|auth-fix]]'),
    `other's roadmap should pipe its OWN auth-fix.md, got: ${otherRoadmap}`);
});
