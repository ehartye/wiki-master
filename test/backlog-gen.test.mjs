import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderBacklogCatalog, regenerateBacklogRoadmaps, BEGIN_MARK, END_MARK } from '../scripts/backlog-gen.mjs';
import { regenerateAuthoredMocs } from '../scripts/moc-authored-gen.mjs';
import { validateAuthored } from '../scripts/validate-authored.mjs';
import { REQUIRED_KEYS, PROJECT_KEYS } from '../scripts/lib/authored-contract.mjs';
import { parseNote } from '../scripts/lib/note.mjs';

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

// The roadmap that backlog-gen CREATES must satisfy the contract validate-authored.mjs checks and
// carry the project key the project map groups by. An existing roadmap is never given any of it.
const NOW = new Date('2026-03-05T23:59:59Z');

function freshVault(t, project = 'demo') {
  const v = mkdtempSync(join(tmpdir(), 'wm-backlog-stub-'));
  t.after(() => rmSync(v, { recursive: true, force: true }));
  mkdirSync(join(v, 'wiki', 'authored', ...project.split('/'), 'backlog'), { recursive: true });
  return v;
}

const roadmapOf = (v, project = 'demo') => join(v, 'wiki', 'authored', ...project.split('/'), 'roadmap.md');
const frontmatterOf = (text) => text.match(/^---\n([\s\S]*?)\n---\n/)[1];

test('a created roadmap carries exactly the eight authored keys, in order, and no reviewed key', (t) => {
  const v = freshVault(t);
  writeItem(v, 'item-a', 'demo', 'planned');
  regenerateBacklogRoadmaps(v, { apply: true, now: NOW });
  const out = readFileSync(roadmapOf(v), 'utf8');
  assert.equal(frontmatterOf(out), [
    'type: authored', 'created: 2026-03-05', 'updated: 2026-03-05', 'status: draft',
    'sources: []', 'ai-generated: true', 'project: demo', 'kind: roadmap',
  ].join('\n'));
  assert.doesNotMatch(out, /^reviewed:/m);
  const { metadata } = parseNote(out);
  for (const key of [...REQUIRED_KEYS, ...PROJECT_KEYS]) assert.ok(Object.hasOwn(metadata, key), key);
});

test('created and updated are the UTC day of the run, not the local day', (t) => {
  const v = freshVault(t);
  writeItem(v, 'item-a', 'demo', 'planned');
  regenerateBacklogRoadmaps(v, { apply: true, now: new Date('2026-12-31T23:59:59Z') });
  assert.match(readFileSync(roadmapOf(v), 'utf8'), /^created: 2026-12-31\nupdated: 2026-12-31$/m);
  const w = freshVault(t);
  writeItem(w, 'item-a', 'demo', 'planned');
  regenerateBacklogRoadmaps(w, { apply: true, now: new Date('2027-01-01T00:00:00Z') });
  assert.match(readFileSync(roadmapOf(w), 'utf8'), /^created: 2027-01-01\nupdated: 2027-01-01$/m);
});

test('now defaults to the current UTC day, also when passed as undefined', (t) => {
  const v = freshVault(t);
  writeItem(v, 'item-a', 'demo', 'planned');
  const before = new Date().toISOString().slice(0, 10);
  regenerateBacklogRoadmaps(v, { apply: true, now: undefined });
  const after = new Date().toISOString().slice(0, 10);
  const day = readFileSync(roadmapOf(v), 'utf8').match(/^created: (\S+)$/m)[1];
  assert.ok(day === before || day === after, `created ${day} is neither ${before} nor ${after}`);
});

test('now must be a valid Date, and a bad one fails before anything is written', (t) => {
  const v = freshVault(t);
  writeItem(v, 'item-a', 'demo', 'planned');
  for (const now of ['2026-03-05', 0, null, new Date('nope')]) {
    assert.throws(() => regenerateBacklogRoadmaps(v, { apply: true, now }), /now must be a valid Date/);
  }
  assert.ok(!existsSync(roadmapOf(v)));
});

test('a created roadmap passes validate-authored.mjs, for a plain and a nested project', (t) => {
  for (const project of ['demo', 'acme/tool']) {
    const v = freshVault(t, project);
    writeItem(v, 'item-a', project, 'planned');
    regenerateBacklogRoadmaps(v, { apply: true, now: NOW });
    const result = validateAuthored(v, [`wiki/authored/${project}/roadmap.md`]);
    assert.deepEqual(result.defects, [], project);
    assert.equal(result.checked, 1);
  }
});

test('a created roadmap appears in its project map; without a project key it was missing from it', (t) => {
  const v = freshVault(t);
  writeItem(v, 'item-a', 'demo', 'planned');
  writeFileSync(join(v, 'wiki', 'authored', 'demo', 'overview.md'),
    '---\ntype: authored\ncreated: 2026-03-05\nupdated: 2026-03-05\nstatus: draft\nsources: []\nai-generated: true\nproject: demo\nkind: overview\n---\n# Overview\n');
  regenerateBacklogRoadmaps(v, { apply: true, now: NOW });
  regenerateAuthoredMocs(v, { apply: true });
  const moc = readFileSync(join(v, 'moc', 'demo.md'), 'utf8');
  assert.match(moc, /## Roadmap\n- \[\[roadmap\]\]/);
  assert.match(moc, /## Overview\n- \[\[overview\]\]/);
});

test('a roadmap that already exists keeps every byte outside the fence, whatever now is', (t) => {
  const v = freshVault(t);
  writeItem(v, 'item-a', 'demo', 'planned');
  const hand = '---\ntype: authored\nkind: roadmap\ncreated: 2020-01-01\n---\n# demo - roadmap\n\nHand-written.\n\n';
  const tail = '\n\nHand-written tail.\n';
  writeFileSync(roadmapOf(v), `${hand}${BEGIN_MARK}\nstale\n${END_MARK}${tail}`);
  regenerateBacklogRoadmaps(v, { apply: true, now: NOW });
  const out = readFileSync(roadmapOf(v), 'utf8');
  assert.ok(out.startsWith(hand), 'head is byte-identical');
  assert.ok(out.endsWith(tail), 'tail is byte-identical');
  assert.doesNotMatch(out, /2026-03-05|project:/);
});

test('an existing roadmap without a fence only gains the fence: no stub keys are added', (t) => {
  const v = freshVault(t);
  writeItem(v, 'item-a', 'demo', 'planned');
  const legacy = '---\ntype: authored\n---\n# demo - roadmap\nLegacy.\n';
  writeFileSync(roadmapOf(v), legacy);
  regenerateBacklogRoadmaps(v, { apply: true, now: NOW });
  const out = readFileSync(roadmapOf(v), 'utf8');
  assert.ok(out.startsWith(`${legacy.trimEnd()}\n\n${BEGIN_MARK}`));
  assert.equal(frontmatterOf(out), 'type: authored');
});

test('a dry run creates no stub and no temp file, and never reads now', (t) => {
  const v = freshVault(t);
  writeItem(v, 'item-a', 'demo', 'planned');
  const before = readdirSync(join(v, 'wiki', 'authored', 'demo')).sort();
  const r = regenerateBacklogRoadmaps(v, { now: NOW });
  assert.deepEqual(r.written, ['demo']);
  assert.deepEqual(r.changed, []);
  assert.deepEqual(readdirSync(join(v, 'wiki', 'authored', 'demo')).sort(), before);
  assert.deepEqual(regenerateBacklogRoadmaps(v, { apply: false, now: new Date('nope') }).changed, []);
});

test('a second apply at a later now rewrites nothing: the stub dates are written once', (t) => {
  const v = freshVault(t);
  writeItem(v, 'item-a', 'demo', 'planned');
  regenerateBacklogRoadmaps(v, { apply: true, now: NOW });
  const first = readFileSync(roadmapOf(v), 'utf8');
  const r = regenerateBacklogRoadmaps(v, { apply: true, now: new Date('2030-01-01T00:00:00Z') });
  assert.deepEqual(r.changed, []);
  assert.equal(readFileSync(roadmapOf(v), 'utf8'), first);
});
