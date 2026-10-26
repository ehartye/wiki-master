import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderBacklogCatalog, renderShippedCatalog, regenerateBacklogRoadmaps, roadmapStub, BEGIN_MARK, END_MARK } from '../scripts/backlog-gen.mjs';
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
  assert.deepEqual(r.changed, ['wiki/authored/demo/roadmap.md'], 'a dry run names the roadmap an apply would create');
  assert.deepEqual(readdirSync(join(v, 'wiki', 'authored', 'demo')).sort(), before);
  assert.deepEqual(regenerateBacklogRoadmaps(v, { apply: false, now: new Date('nope') }).changed, ['wiki/authored/demo/roadmap.md']);
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

// ------------------------------------------------------------- depends-on --
// A prerequisite never changes an item's own status: the catalog keeps every item under the
// status its author set, notes what an open item still waits on, and lists the items whose
// prerequisites have all closed. An item that declares nothing renders exactly as before.

const dep = (slug, status, dependsOn) => ({
  path: `wiki/authored/demo/backlog/${slug}.md`, project: 'demo', kind: 'backlog-item', backlogStatus: status,
  metadata: dependsOn ? { 'depends-on': dependsOn } : {},
});

test('items that declare no depends-on render exactly as they did before the key existed', () => {
  const withMetadata = [dep('a', 'shipped'), dep('b', 'planned'), dep('c', 'blocked')];
  const without = withMetadata.map(({ metadata, ...rest }) => rest);
  assert.equal(renderBacklogCatalog({ pages: withMetadata }), renderBacklogCatalog({ pages: without }));
  assert.ok(!renderBacklogCatalog({ pages: withMetadata }).includes('Ready to start'));
});

test('an open item notes the prerequisites it still waits on and stays under its own status', () => {
  const catalog = renderBacklogCatalog({ pages: [dep('base', 'planned'), dep('next', 'planned', ['[[base]]'])] });
  assert.equal(catalog, '## Planned\n- [[base]]\n- [[next]] — waiting on [[base]]');
});

test('a human-set blocked item stays under Blocked, notes what it waits on, and is never listed as ready', () => {
  const catalog = renderBacklogCatalog({ pages: [dep('base', 'shipped'), dep('held', 'blocked', ['[[base]]'])] });
  assert.ok(catalog.includes('## Blocked\n- [[held]]'));
  assert.ok(!catalog.includes('Ready to start'));
  const waiting = renderBacklogCatalog({ pages: [dep('base', 'planned'), dep('held', 'blocked', ['[[base]]'])] });
  assert.ok(waiting.includes('## Blocked\n- [[held]] — waiting on [[base]]'));
});

test('a planned item whose prerequisites are all shipped or dropped is listed under Ready to start, after the status groups', () => {
  const catalog = renderBacklogCatalog({ pages: [dep('done', 'shipped'), dep('gone', 'dropped'), dep('next', 'planned', ['[[done]]', '[[gone]]']), dep('late', 'planned', ['[[next]]'])] });
  assert.ok(catalog.endsWith('## Ready to start\n- [[next]]'));
  assert.ok(catalog.includes('- [[late]] — waiting on [[next]]'));
  assert.ok(catalog.indexOf('## Ready to start') > catalog.indexOf('## Shipped'));
});

test('a shipped item is not annotated even when its own prerequisites are not met', () => {
  const catalog = renderBacklogCatalog({ pages: [dep('open', 'planned'), dep('odd', 'shipped', ['[[open]]'])] });
  assert.ok(catalog.includes('## Shipped\n- [[odd]]'));
  assert.ok(!/odd\]\] — waiting/.test(catalog));
});

test('a prerequisite that does not resolve is shown as plain text, never as a dead link', () => {
  const catalog = renderBacklogCatalog({ pages: [dep('next', 'planned', ['[[nowhere]]'])] });
  assert.equal(catalog, '## Planned\n- [[next]] — waiting on `nowhere`');
});

test('a prerequisite whose name is ambiguous vault-wide is linked by its full path', () => {
  const catalog = renderBacklogCatalog({ pages: [dep('base', 'planned'), dep('next', 'planned', ['[[base]]'])], ambiguousNames: new Set(['base']) });
  assert.ok(catalog.includes('- [[next]] — waiting on [[wiki/authored/demo/backlog/base|base]]'));
});

test('regenerating from files renders the annotation and the ready list from frontmatter', () => {
  const v = tempVault();
  const file = (name, status, deps) => writeFileSync(join(v, 'wiki', 'authored', 'demo', 'backlog', `${name}.md`),
    `---\ntype: authored\nsources: []\nproject: demo\nkind: backlog-item\nbacklog-status: ${status}\n${deps ? `depends-on: ${deps}\n` : ''}---\n# ${name}\n\nbody\n`);
  file('base', 'shipped');
  file('next', 'planned', '["[[base]]"]');
  file('later', 'planned', '["[[next]]"]');
  regenerateBacklogRoadmaps(v, { apply: true });
  const out = readFileSync(join(v, 'wiki', 'authored', 'demo', 'roadmap.md'), 'utf8');
  assert.ok(out.includes('- [[later]] — waiting on [[next]]'));
  assert.ok(out.includes('## Ready to start\n- [[next]]'));
});

// ---------------------------------------------------- unrecognized status --
// A generator that filters its input says what it filtered: an item whose status is outside the
// vocabulary, or missing, is listed under its own heading instead of vanishing from the roadmap.

test('an item whose status is outside the vocabulary is listed under Unrecognized status, with the value and the allowed words', () => {
  const catalog = renderBacklogCatalog({ pages: [item('wiki/authored/demo/backlog/a.md', 'demo', 'planned'), item('wiki/authored/demo/backlog/idea.md', 'demo', 'proposed')] });
  assert.ok(catalog.includes('## Unrecognized status'));
  assert.ok(catalog.includes('- [[idea]] — `proposed`'));
  assert.ok(catalog.includes('in-progress, planned, blocked, shipped, dropped'));
  assert.ok(catalog.indexOf('## Planned') < catalog.indexOf('## Unrecognized status'));
});

test('an item with no status at all is listed as having none', () => {
  const catalog = renderBacklogCatalog({ pages: [item('wiki/authored/demo/backlog/bare.md', 'demo', undefined)] });
  assert.ok(catalog.includes('- [[bare]] — no backlog-status'));
});

test('a catalog whose items all have a recognized status has no Unrecognized status section', () => {
  const catalog = renderBacklogCatalog({ pages: [item('wiki/authored/demo/backlog/a.md', 'demo', 'planned'), item('wiki/authored/demo/backlog/b.md', 'demo', 'dropped')] });
  assert.ok(!catalog.includes('Unrecognized'));
});

test('regenerating from files writes the section and names the item in the result', () => {
  const v = tempVault();
  writeItem(v, 'ok', 'demo', 'planned');
  writeItem(v, 'idea', 'demo', 'proposed');
  const r = regenerateBacklogRoadmaps(v, { apply: true });
  assert.deepEqual(r.unrecognized, ['wiki/authored/demo/backlog/idea.md']);
  const out = readFileSync(join(v, 'wiki', 'authored', 'demo', 'roadmap.md'), 'utf8');
  assert.ok(out.includes('## Unrecognized status\n'));
  assert.ok(out.includes('- [[idea]] — `proposed`'));
});

test('a dry run also names the unrecognized items, and a clean vault names none', () => {
  const v = tempVault();
  writeItem(v, 'idea', 'demo', 'open');
  assert.deepEqual(regenerateBacklogRoadmaps(v).unrecognized, ['wiki/authored/demo/backlog/idea.md']);
  const clean = tempVault();
  writeItem(clean, 'ok', 'demo', 'shipped');
  assert.deepEqual(regenerateBacklogRoadmaps(clean).unrecognized, []);
});

// ------------------------------------------------- project names in a stub --
// The project is a YAML value. A name that is not a plain scalar must be quoted, or parseNote
// reads a truncated or different value (a ` #` starts a comment, a `: ` splits a key).

const STUB_DAY = new Date('2026-10-25T00:00:00Z');

test('a plain project name is written unquoted, as before', () => {
  assert.match(roadmapStub('demo', STUB_DAY), /\nproject: demo\n/);
  assert.match(roadmapStub('acme/tool', STUB_DAY), /\nproject: acme\/tool\n/);
  assert.match(roadmapStub('demo-valley 2', STUB_DAY), /\nproject: demo-valley 2\n/);
  assert.match(roadmapStub('café', STUB_DAY), /\nproject: café\n/);
});

test('a project name that is not a plain scalar round-trips through parseNote', () => {
  for (const name of ['a: b', 'a #b', 'x:', '- x', '"quoted" name', "it's", 'back\slash', ' lead', 'trail ', '[x]', '#x', '@x', '*x', '!x', 'a, b', '% x', '`x`', '{x}', '> x', '| x']) {
    assert.equal(parseNote(roadmapStub(name, STUB_DAY)).metadata.project, name, JSON.stringify(name));
  }
});

test('a project folder with a comment marker in its name gets a stub that validates and names the folder', () => {
  const v = tempVault();
  mkdirSync(join(v, 'wiki', 'authored', 'demo #1', 'backlog'), { recursive: true });
  writeFileSync(join(v, 'wiki', 'authored', 'demo #1', 'backlog', 'item-a.md'),
    `---\ntype: authored\nsources: []\nproject: ${JSON.stringify('demo #1')}\nkind: backlog-item\nbacklog-status: planned\n---\n# item-a\n\nbody\n`);
  const r = regenerateBacklogRoadmaps(v, { apply: true });
  assert.deepEqual(r.written, ['demo #1']);
  const rel = 'wiki/authored/demo #1/roadmap.md';
  const text = readFileSync(join(v, ...rel.split('/')), 'utf8');
  assert.equal(parseNote(text).metadata.project, 'demo #1');
  assert.deepEqual(validateAuthored(v, [rel]).defects, []);
});

// ------------------------------------------- titles and a collapsed Shipped --
// Both are opt-in per project, from the project's own roadmap.md frontmatter. A project that opts
// in to neither regenerates exactly as before.

const at = (slug, status) => item(`wiki/authored/demo/backlog/${slug}.md`, 'demo', status);
const titlesOf = (pairs) => new Map(pairs.map(([slug, t]) => [`wiki/authored/demo/backlog/${slug}.md`, t]));

test('with titles on, a link shows the item heading, ordering unchanged', () => {
  const catalog = renderBacklogCatalog({ pages: [at('b', 'shipped'), at('a', 'planned')], titles: titlesOf([['a', 'Alpha work'], ['b', 'Beta done']]) });
  assert.equal(catalog, '## Planned\n- [[a|Alpha work]]\n\n## Shipped\n- [[b|Beta done]]');
});

test('an item with no heading keeps its bare link when titles are on', () => {
  const catalog = renderBacklogCatalog({ pages: [at('a', 'planned'), at('b', 'planned')], titles: titlesOf([['a', 'Alpha work']]) });
  assert.equal(catalog, '## Planned\n- [[a|Alpha work]]\n- [[b]]');
});

test('an ambiguous name still links by full path, with the heading as its text', () => {
  const catalog = renderBacklogCatalog({ pages: [at('a', 'planned')], titles: titlesOf([['a', 'Alpha work']]), ambiguousNames: new Set(['a']) });
  assert.equal(catalog, '## Planned\n- [[wiki/authored/demo/backlog/a|Alpha work]]');
});

test('a heading with link syntax in it cannot break the link', () => {
  const catalog = renderBacklogCatalog({ pages: [at('a', 'planned')], titles: titlesOf([['a', 'Fix `a|b` and [[c]]']]) });
  assert.equal(catalog, '## Planned\n- [[a|Fix `a b` and c]]');
});

test('with Shipped collapsed, the main catalog keeps a count and a link instead of the list', () => {
  const pages = [at('p', 'planned'), at('s1', 'shipped'), at('s2', 'shipped'), at('s3', 'shipped')];
  const catalog = renderBacklogCatalog({ pages, shipped: { link: 'wiki/authored/demo/roadmap-shipped' } });
  assert.ok(catalog.includes('## Planned\n- [[p]]'));
  assert.ok(catalog.includes('## Shipped\n3 shipped items: [[wiki/authored/demo/roadmap-shipped|all shipped items]]'));
  assert.ok(!catalog.includes('[[s1]]'));
  assert.ok(renderBacklogCatalog({ pages: [at('s1', 'shipped')], shipped: { link: 'x/y' } }).includes('1 shipped item: '));
  assert.ok(!renderBacklogCatalog({ pages: [at('p', 'planned')], shipped: { link: 'x/y' } }).includes('Shipped'));
});

test('the shipped page lists every shipped item, with headings when titles are on, and nothing else', () => {
  const pages = [at('p', 'planned'), at('s2', 'shipped'), at('s1', 'shipped'), at('d', 'dropped')];
  assert.equal(renderShippedCatalog({ pages }), '## Shipped\n- [[s1]]\n- [[s2]]');
  assert.equal(renderShippedCatalog({ pages, titles: titlesOf([['s1', 'One']]) }), '## Shipped\n- [[s1|One]]\n- [[s2]]');
  assert.equal(renderShippedCatalog({ pages: [at('p', 'planned')] }), '');
});

function optedVault(frontmatterExtra) {
  const v = tempVault();
  const file = (name, status, heading) => writeFileSync(join(v, 'wiki', 'authored', 'demo', 'backlog', `${name}.md`),
    `---\ntype: authored\nsources: []\nproject: demo\nkind: backlog-item\nbacklog-status: ${status}\n---\n# ${heading}\n\nbody\n`);
  file('open-one', 'planned', 'Open work one');
  file('old-one', 'shipped', 'Finished work one');
  file('old-two', 'shipped', 'Finished work two');
  writeFileSync(join(v, 'wiki', 'authored', 'demo', 'roadmap.md'), `---\ntype: authored\ncreated: 2026-10-26\nupdated: 2026-10-26\nstatus: draft\nsources: []\nai-generated: true\nproject: demo\nkind: roadmap\n${frontmatterExtra}---\n# demo — roadmap\n\nHand-written framing.\n`);
  return v;
}
const roadmapText = (v) => readFileSync(join(v, 'wiki', 'authored', 'demo', 'roadmap.md'), 'utf8');
const shippedPath = (v) => join(v, 'wiki', 'authored', 'demo', 'roadmap-shipped.md');

test('a project with both settings gets titled links, a collapsed Shipped and a valid sibling page, idempotently', () => {
  const v = optedVault('backlog-titles: true\nbacklog-shipped: collapse\n');
  const r = regenerateBacklogRoadmaps(v, { apply: true });
  assert.deepEqual(r.changed.sort(), ['wiki/authored/demo/roadmap-shipped.md', 'wiki/authored/demo/roadmap.md']);
  const main = roadmapText(v);
  assert.ok(main.includes('- [[open-one|Open work one]]'));
  assert.ok(main.includes('2 shipped items: [[wiki/authored/demo/roadmap-shipped|all shipped items]]'));
  assert.ok(!main.includes('old-one'));
  assert.ok(main.includes('Hand-written framing.'));
  const shipped = readFileSync(shippedPath(v), 'utf8');
  assert.ok(shipped.includes('- [[old-one|Finished work one]]') && shipped.includes('- [[old-two|Finished work two]]'));
  assert.equal(parseNote(shipped).metadata.project, 'demo');
  assert.deepEqual(validateAuthored(v, ['wiki/authored/demo/roadmap-shipped.md']).defects, []);
  assert.deepEqual(regenerateBacklogRoadmaps(v, { apply: true }).changed, []);
});

test('titles alone do not create a shipped page, and collapse alone keeps bare links', () => {
  const titles = optedVault('backlog-titles: true\n');
  regenerateBacklogRoadmaps(titles, { apply: true });
  assert.ok(roadmapText(titles).includes('- [[old-one|Finished work one]]'));
  assert.ok(!existsSync(shippedPath(titles)));
  const collapse = optedVault('backlog-shipped: collapse\n');
  regenerateBacklogRoadmaps(collapse, { apply: true });
  assert.ok(roadmapText(collapse).includes('- [[open-one]]'));
  assert.ok(readFileSync(shippedPath(collapse), 'utf8').includes('- [[old-one]]'));
});

test('a project that opts in to neither regenerates exactly the default catalog and writes no extra page', () => {
  const v = optedVault('');
  regenerateBacklogRoadmaps(v, { apply: true });
  const text = roadmapText(v);
  const fenced = text.slice(text.indexOf(BEGIN_MARK) + BEGIN_MARK.length + 1, text.indexOf(END_MARK) - 1);
  assert.equal(fenced, '## Planned\n- [[open-one]]\n\n## Shipped\n- [[old-one]]\n- [[old-two]]');
  assert.ok(!existsSync(shippedPath(v)));
});

test('turning collapse off lists Shipped on the roadmap again and leaves the old sibling page alone', () => {
  const v = optedVault('backlog-shipped: collapse\n');
  regenerateBacklogRoadmaps(v, { apply: true });
  writeFileSync(join(v, 'wiki', 'authored', 'demo', 'roadmap.md'), roadmapText(v).replace('backlog-shipped: collapse\n', ''));
  regenerateBacklogRoadmaps(v, { apply: true });
  assert.ok(roadmapText(v).includes('- [[old-one]]'));
  assert.ok(existsSync(shippedPath(v)));
});
