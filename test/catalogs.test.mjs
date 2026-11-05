import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refreshCatalogs, regenerateBacklogRoadmaps, regenerateAuthoredMocs, regenerateIndex } from '../scripts/lib/catalogs.mjs';
import { buildGraph } from '../scripts/lib/graph.mjs';
import { validateAuthored } from '../scripts/validate-authored.mjs';

const NOW = new Date('2026-03-05T23:59:59Z');
const sorted = (list) => [...list].sort();

function page(root, rel, { project = 'alpha', kind = 'note', status } = {}) {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), `---\ntype: authored\nproject: ${project}\nkind: ${kind}\n${status ? `backlog-status: ${status}\n` : ''}sources: []\n---\n# ${rel}\n`);
}
function fixture(t, projects = ['alpha', 'beta']) {
  const root = mkdtempSync(join(tmpdir(), 'wm-catalogs-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const project of projects) {
    page(root, `wiki/authored/${project}/overview.md`, { project, kind: 'overview' });
    page(root, `wiki/authored/${project}/shared.md`, { project });
    page(root, `wiki/authored/${project}/backlog/task.md`, { project, kind: 'backlog-item', status: 'planned' });
  }
  return root;
}
const ALL = ['index.md', 'moc/alpha.md', 'moc/beta.md', 'wiki/authored/alpha/roadmap.md', 'wiki/authored/beta/roadmap.md'];

test('a refresh builds one graph, covers every project and names exactly what it changed, the index included', (t) => {
  const root = fixture(t);
  let builds = 0;
  const result = refreshCatalogs(root, { buildGraphImpl: (p) => { builds++; return buildGraph(p); } });
  assert.equal(builds, 1);
  assert.deepEqual(sorted(result.changed), ALL);
  for (const path of ALL) assert.ok(existsSync(join(root, path)), path);
  assert.deepEqual(result.projects, { backlog: ['alpha', 'beta'], moc: ['alpha', 'beta'] });
  assert.match(readFileSync(join(root, 'moc/alpha.md'), 'utf8'), /wiki\/authored\/alpha\/shared\|shared/);
  assert.match(readFileSync(join(root, 'index.md'), 'utf8'), /alpha/);
  const before = readFileSync(join(root, 'index.md'), 'utf8');
  regenerateIndex(root);
  assert.equal(readFileSync(join(root, 'index.md'), 'utf8'), before, 'the index it wrote is the one the catalogs on disk give');
});

test('a repeat refresh writes nothing and leaves file times alone', (t) => {
  const root = fixture(t);
  refreshCatalogs(root);
  const times = ALL.map((p) => statSync(join(root, p)).mtimeMs);
  assert.deepEqual(refreshCatalogs(root).changed, []);
  assert.deepEqual(ALL.map((p) => statSync(join(root, p)).mtimeMs), times);
});

test('an added item and a flipped status change only their own roadmap', (t) => {
  const root = fixture(t);
  refreshCatalogs(root);
  page(root, 'wiki/authored/alpha/backlog/task-two.md', { kind: 'backlog-item', status: 'planned' });
  page(root, 'wiki/authored/alpha/backlog/task.md', { kind: 'backlog-item', status: 'shipped' });
  assert.deepEqual(refreshCatalogs(root).changed, ['wiki/authored/alpha/roadmap.md']);
});

test('a page that is gone leaves the catalogs', (t) => {
  const root = fixture(t);
  page(root, 'wiki/authored/alpha/going.md');
  refreshCatalogs(root);
  assert.match(readFileSync(join(root, 'moc/alpha.md'), 'utf8'), /going/);
  rmSync(join(root, 'wiki/authored/alpha/going.md'));
  assert.deepEqual(sorted(refreshCatalogs(root).changed), ['index.md', 'moc/alpha.md']);
  assert.doesNotMatch(readFileSync(join(root, 'moc/alpha.md'), 'utf8'), /going/);
  assert.doesNotMatch(readFileSync(join(root, 'index.md'), 'utf8'), /going/);
});

test('a new page that makes another project\'s bare link ambiguous repoints that link in the same run', (t) => {
  const root = fixture(t);
  page(root, 'wiki/authored/alpha/user.md');
  refreshCatalogs(root);
  assert.match(readFileSync(join(root, 'moc/alpha.md'), 'utf8'), /- \[\[user\]\]/, 'bare while the name is unique');
  page(root, 'wiki/authored/beta/user.md', { project: 'beta' });
  const { changed } = refreshCatalogs(root);
  assert.ok(changed.includes('moc/alpha.md'));
  assert.ok(changed.includes('index.md'));
  assert.match(readFileSync(join(root, 'moc/alpha.md'), 'utf8'), /- \[\[wiki\/authored\/alpha\/user\|user\]\]/);
  assert.deepEqual(refreshCatalogs(root).changed, []);
});

test('a refresh equals the three generators run in order, including catalogs that collide when first created', (t) => {
  const a = fixture(t), b = fixture(t);
  regenerateBacklogRoadmaps(a, { apply: true, now: NOW });
  regenerateAuthoredMocs(a, { apply: true });
  regenerateIndex(a);
  refreshCatalogs(b, { now: NOW });
  for (const p of ALL) assert.equal(readFileSync(join(a, p), 'utf8'), readFileSync(join(b, p), 'utf8'), p);
});

test('all generators reuse a supplied graph without scanning the vault', (t) => {
  const root = fixture(t);
  const graph = buildGraph(root);
  const missing = join(root, 'absent');
  assert.deepEqual(regenerateBacklogRoadmaps(missing, { graph }).written, ['alpha', 'beta']);
  assert.deepEqual(regenerateAuthoredMocs(missing, { graph }).written, ['alpha', 'beta']);
  assert.ok(regenerateIndex(missing, { graph, apply: false }).pages > 0);
});

// The pass that puts new catalogs in the graph before any is written depends on this.
test('the generators plan by default: they name what a write would change and write nothing', (t) => {
  const root = fixture(t);
  const roadmap = regenerateBacklogRoadmaps(root, { now: NOW });
  const moc = regenerateAuthoredMocs(root);
  const index = regenerateIndex(root, { apply: false });
  assert.deepEqual(sorted(roadmap.changed), ['wiki/authored/alpha/roadmap.md', 'wiki/authored/beta/roadmap.md']);
  assert.deepEqual(sorted(moc.changed), ['moc/alpha.md', 'moc/beta.md']);
  assert.equal(index.changed, true);
  assert.ok(!existsSync(join(root, 'moc')) && !existsSync(join(root, 'index.md')));
  assert.deepEqual(sorted(regenerateBacklogRoadmaps(root, { apply: true, now: NOW }).changed), sorted(roadmap.changed));
  assert.deepEqual(sorted(regenerateAuthoredMocs(root, { apply: true }).changed), sorted(moc.changed));
});

// A roadmap the refresh creates must satisfy validate-authored.mjs and be listed in its project's map.
test('a refresh forwards now: the roadmap it creates carries all eight authored keys and validates', (t) => {
  const root = fixture(t);
  const result = refreshCatalogs(root, { now: NOW });
  assert.ok(result.changed.includes('wiki/authored/alpha/roadmap.md'));
  const text = readFileSync(join(root, 'wiki/authored/alpha/roadmap.md'), 'utf8');
  assert.match(text, /^---\ntype: authored\ncreated: 2026-03-05\nupdated: 2026-03-05\nstatus: draft\nsources: \[\]\nai-generated: true\nproject: alpha\nkind: roadmap\n---\n/);
  assert.doesNotMatch(text, /^reviewed:/m);
  assert.deepEqual(validateAuthored(root, ['wiki/authored/alpha/roadmap.md']).defects, []);
});

test('with one project the new roadmap gets a bare link in the project map and the index', (t) => {
  const root = fixture(t, ['alpha']);
  refreshCatalogs(root, { now: NOW });
  assert.match(readFileSync(join(root, 'moc/alpha.md'), 'utf8'), /## Roadmap\n- \[\[roadmap\]\]/);
  assert.match(readFileSync(join(root, 'index.md'), 'utf8'), /\[\[roadmap\]\]/);
});

test('with two projects each new roadmap is listed under its own project with a path link', (t) => {
  const root = fixture(t);
  refreshCatalogs(root, { now: NOW });
  for (const project of ['alpha', 'beta']) {
    const moc = readFileSync(join(root, `moc/${project}.md`), 'utf8');
    assert.match(moc, new RegExp(`## Roadmap\\n- \\[\\[wiki/authored/${project}/roadmap\\|roadmap\\]\\]`), project);
    assert.deepEqual(validateAuthored(root, [`wiki/authored/${project}/roadmap.md`]).defects, [], project);
  }
});

test('now: undefined falls through to the current day', (t) => {
  const root = fixture(t);
  const before = new Date().toISOString().slice(0, 10);
  refreshCatalogs(root, { now: undefined });
  const after = new Date().toISOString().slice(0, 10);
  const day = readFileSync(join(root, 'wiki/authored/alpha/roadmap.md'), 'utf8').match(/^created: (\S+)$/m)[1];
  assert.ok(day === before || day === after, day);
});

test('an invalid now fails before any catalog is written', (t) => {
  const root = fixture(t);
  assert.throws(() => refreshCatalogs(root, { now: 'today' }), /now must be a valid Date/);
  for (const path of ['wiki/authored/alpha/roadmap.md', 'moc', 'index.md']) assert.ok(!existsSync(join(root, path)), path);
});

test('a nested project gets its own flat map, and a vault with no pages changes only the index', (t) => {
  const root = fixture(t, ['alpha/nested']);
  assert.ok(refreshCatalogs(root).changed.includes('moc/alpha-nested.md'));
  assert.ok(existsSync(join(root, 'wiki/authored/alpha/nested/roadmap.md')));
  const empty = mkdtempSync(join(tmpdir(), 'wm-catalogs-'));
  t.after(() => rmSync(empty, { recursive: true, force: true }));
  assert.deepEqual(refreshCatalogs(empty).changed, ['index.md']);
});
