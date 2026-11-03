import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync, utimesSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { refreshCatalogs } from '../scripts/refresh-catalogs.mjs';
import { regenerateIndex } from '../scripts/index-gen.mjs';
import { regenerateAuthoredMocs } from '../scripts/moc-authored-gen.mjs';
import { regenerateBacklogRoadmaps } from '../scripts/backlog-gen.mjs';
import { committedPaths, mentionedTargets, keptByMention } from '../scripts/lib/catalog-scope.mjs';

// Two writers share one vault: the operation under test owns one page, and a second writer has pages the
// ledger does not name. A scoped refresh must publish only the owner's work and must not take away what
// the second writer's catalog run already put in the working copy.

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });
function page(root, rel, { kind = 'note', status, project = 'alpha' } = {}) {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), `---\ntype: authored\nproject: ${project}\nkind: ${kind}\n${status ? `backlog-status: ${status}\n` : ''}sources: []\n---\n# ${rel}\n`);
}
function world(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-scope-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'a@b.c'); git(root, 'config', 'user.name', 'a'); git(root, 'config', 'core.autocrlf', 'false');
  page(root, 'wiki/authored/alpha/overview.md', { kind: 'overview' });
  page(root, 'wiki/authored/alpha/base.md');
  page(root, 'wiki/authored/alpha/backlog/item-base.md', { kind: 'backlog-item', status: 'planned' });
  refreshCatalogs(root, { project: 'alpha', apply: true });
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'base');
  return root;
}
const OURS = 'wiki/authored/alpha/ours.md';
const has = (text, name) => new RegExp(`\\[\\[(?:[^\\]|]*/)?${name}(?:\\.md)?(?:\\|[^\\]]*)?\\]\\]`).test(text);
const read = (root, rel) => readFileSync(join(root, rel), 'utf8');

test('an index line the other writer already put in the working copy survives a scoped refresh', (t) => {
  const root = world(t);
  page(root, 'wiki/authored/alpha/foreign-note.md');
  regenerateIndex(root); // the other writer's own catalog run
  assert.ok(has(read(root, 'index.md'), 'foreign-note'));
  page(root, OURS);
  refreshCatalogs(root, { project: 'alpha', apply: true, ownedPaths: [OURS] });
  const after = read(root, 'index.md');
  assert.ok(has(after, 'foreign-note'), 'the other writer\'s line was removed');
  assert.ok(has(after, 'ours'));
  assert.ok(has(after, 'base'));
});

test('a page the other writer only staged is not added by a scoped refresh', (t) => {
  const root = world(t);
  page(root, 'wiki/authored/alpha/foreign-staged.md');
  git(root, 'add', 'wiki/authored/alpha/foreign-staged.md');
  page(root, OURS);
  refreshCatalogs(root, { project: 'alpha', apply: true, ownedPaths: [OURS] });
  for (const rel of ['index.md', 'moc/alpha.md']) assert.ok(!has(read(root, rel), 'foreign-staged'), `${rel} lists a staged page of another writer`);
});

test('an untracked page nobody listed stays out, and the owner\'s page goes in', (t) => {
  const root = world(t);
  page(root, 'wiki/authored/alpha/foreign-quiet.md');
  page(root, OURS);
  refreshCatalogs(root, { project: 'alpha', apply: true, ownedPaths: [OURS] });
  assert.ok(!has(read(root, 'index.md'), 'foreign-quiet'));
  assert.ok(has(read(root, 'index.md'), 'ours'));
});

test('a line for a page that is really gone is still removed', (t) => {
  const root = world(t);
  rmSync(join(root, 'wiki/authored/alpha/base.md'));
  page(root, OURS);
  refreshCatalogs(root, { project: 'alpha', apply: true, ownedPaths: [OURS] });
  assert.ok(!has(read(root, 'index.md'), 'base'));
});

test('the project map and the roadmap keep the other writer\'s lines too', (t) => {
  const root = world(t);
  page(root, 'wiki/authored/alpha/foreign-note.md');
  page(root, 'wiki/authored/alpha/backlog/foreign-item.md', { kind: 'backlog-item', status: 'planned' });
  regenerateAuthoredMocs(root, { apply: true });
  regenerateBacklogRoadmaps(root, { apply: true });
  assert.ok(has(read(root, 'moc/alpha.md'), 'foreign-note'));
  assert.ok(has(read(root, 'wiki/authored/alpha/roadmap.md'), 'foreign-item'));
  page(root, OURS);
  refreshCatalogs(root, { project: 'alpha', apply: true, ownedPaths: [OURS] });
  assert.ok(has(read(root, 'moc/alpha.md'), 'foreign-note'), 'map line removed');
  assert.ok(has(read(root, 'moc/alpha.md'), 'ours'));
  assert.ok(has(read(root, 'wiki/authored/alpha/roadmap.md'), 'foreign-item'), 'roadmap line removed');
});

test('a repository with no commit yet still scopes by what is tracked', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'wm-scope-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '-q'); git(root, 'config', 'core.autocrlf', 'false');
  page(root, 'wiki/authored/alpha/overview.md', { kind: 'overview' });
  page(root, 'wiki/authored/alpha/tracked.md');
  git(root, 'add', '.');
  page(root, OURS);
  assert.deepEqual([...committedPaths(root)].sort(), ['wiki/authored/alpha/overview.md', 'wiki/authored/alpha/tracked.md']);
  refreshCatalogs(root, { project: 'alpha', apply: true, ownedPaths: [OURS] });
  assert.ok(has(read(root, 'index.md'), 'tracked'));
  assert.ok(has(read(root, 'index.md'), 'ours'));
});

test('committedPaths lists the last commit, not the staging area', (t) => {
  const root = world(t);
  page(root, 'wiki/authored/alpha/staged.md');
  git(root, 'add', 'wiki/authored/alpha/staged.md');
  const paths = committedPaths(root);
  assert.ok(paths.has('wiki/authored/alpha/base.md'));
  assert.ok(!paths.has('wiki/authored/alpha/staged.md'));
});

test('mentionedTargets reads only the generated fence, without aliases or the .md suffix', () => {
  const text = 'prose [[outside]]\n%% BEGIN GENERATED CATALOG x %%\n- [[wiki/authored/a/Page One.md|Page One]]\n- [[bare-name]]\n%% END GENERATED CATALOG %%\n[[after]]';
  assert.deepEqual([...mentionedTargets(text)].sort(), ['bare-name', 'wiki/authored/a/page one']);
});

test('a bare mention keeps an excluded page only when the name is unique in the vault', () => {
  const mk = (path) => ({ path, name: path.split('/').pop().replace(/\.md$/, '').toLowerCase() });
  const all = [mk('a/shared.md'), mk('b/shared.md'), mk('a/solo.md')];
  const text = '%% BEGIN GENERATED CATALOG x %%\n- [[shared]]\n- [[solo]]\n%% END GENERATED CATALOG %%';
  const kept = keptByMention([all[1], all[2]], all, text).map((p) => p.path);
  assert.deepEqual(kept, ['a/solo.md']);
  const byPath = '%% BEGIN GENERATED CATALOG x %%\n- [[b/shared|shared]]\n%% END GENERATED CATALOG %%';
  assert.deepEqual(keptByMention([all[1]], all, byPath).map((p) => p.path), ['b/shared.md']);
});

test('project-only preserves foreign catalogs and scoped visibility through dry, apply and repeat', t => {
  const root = world(t);
  page(root, 'wiki/authored/beta/overview.md', { project: 'beta', kind: 'overview' });
  page(root, 'wiki/authored/beta/reference/shared.md', { project: 'beta', kind: 'reference' });
  page(root, 'wiki/authored/beta/backlog/task.md', { project: 'beta', kind: 'backlog-item', status: 'planned' });
  const roadmap = 'wiki/authored/alpha/roadmap.md';
  writeFileSync(join(root, roadmap), read(root, roadmap).replace('type: authored', 'type: authored\nbacklog-shipped: collapse'));
  refreshCatalogs(root, { apply: true });
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'second project and collapse setting');

  // A previous writer has published catalog mentions but not the referenced pages.
  page(root, 'wiki/authored/alpha/foreign-mentioned.md');
  page(root, 'wiki/authored/alpha/backlog/foreign-mentioned-item.md', { kind: 'backlog-item', status: 'planned' });
  regenerateAuthoredMocs(root, { project: 'alpha', apply: true });
  regenerateBacklogRoadmaps(root, { project: 'alpha', apply: true });
  git(root, 'add', roadmap, 'moc/alpha.md'); git(root, 'commit', '-qm', 'existing catalog mentions');
  page(root, 'wiki/authored/alpha/foreign-staged.md');
  git(root, 'add', 'wiki/authored/alpha/foreign-staged.md');
  page(root, 'wiki/authored/alpha/foreign-untracked.md');
  regenerateIndex(root); // already-dirty foreign index, deliberately outside this operation

  const owned = [OURS, 'wiki/authored/alpha/reference/shared.md', 'wiki/authored/alpha/backlog/task.md', 'wiki/authored/alpha/backlog/shipped.md'];
  page(root, OURS);
  page(root, owned[1], { kind: 'reference' });
  page(root, owned[2], { kind: 'backlog-item', status: 'planned' });
  page(root, owned[3], { kind: 'backlog-item', status: 'shipped' });
  const protectedPaths = ['index.md', 'moc/beta.md', 'wiki/authored/beta/roadmap.md'];
  const snapshot = paths => paths.map(path => existsSync(join(root, path))
    ? { path, bytes: read(root, path), mtime: statSync(join(root, path)).mtimeMs } : { path, absent: true });
  for (const path of protectedPaths) utimesSync(join(root, path), new Date('2020-01-01'), new Date('2020-01-01'));
  const before = snapshot(protectedPaths);
  const selected = [roadmap, 'wiki/authored/alpha/roadmap-shipped.md', 'moc/alpha.md'];
  const selectedBefore = snapshot(selected);
  const options = { project: 'alpha', projectOnly: true, ownedPaths: owned, diff: true };
  const dry = refreshCatalogs(root, options);
  assert.deepEqual(snapshot(protectedPaths), before);
  assert.deepEqual(snapshot(selected), selectedBefore, 'dry run must not write selected catalogs');
  assert.deepEqual([...dry.changed].sort(), [...selected].sort());
  assert.deepEqual(dry.diffs.map(d => d.path), dry.changed);
  const applied = refreshCatalogs(root, { ...options, apply: true });
  assert.deepEqual(applied.changed, dry.changed);
  assert.deepEqual(applied.diffs, dry.diffs);
  assert.equal(applied.graphBuilds, 1);
  assert.deepEqual(snapshot(protectedPaths), before, 'global index and unrelated catalogs must keep bytes and times');
  assert.ok(has(read(root, 'moc/alpha.md'), 'ours'));
  assert.ok(has(read(root, 'moc/alpha.md'), 'base'));
  assert.ok(has(read(root, 'moc/alpha.md'), 'foreign-mentioned'));
  assert.ok(has(read(root, roadmap), 'foreign-mentioned-item'));
  for (const name of ['foreign-staged', 'foreign-untracked']) assert.ok(!has(read(root, 'moc/alpha.md'), name));
  assert.match(read(root, 'moc/alpha.md'), /\[\[wiki\/authored\/alpha\/reference\/shared\|shared\]\]/);
  assert.ok(has(read(root, 'moc/alpha.md'), 'roadmap'));
  assert.ok(has(read(root, 'wiki/authored/alpha/roadmap-shipped.md'), 'shipped'));
  assert.ok(applied.staleCatalogs.some(c => c.path === 'moc/beta.md' && c.names.includes('shared')));
  assert.ok(applied.staleCatalogs.some(c => c.path === 'wiki/authored/beta/roadmap.md' && c.names.includes('task')));
  const allAfter = snapshot([...protectedPaths, ...selected]);
  const repeated = refreshCatalogs(root, { ...options, apply: true });
  assert.deepEqual(repeated.changed, []);
  assert.deepEqual(repeated.diffs, []);
  assert.deepEqual(repeated.staleCatalogs, applied.staleCatalogs);
  assert.deepEqual(snapshot([...protectedPaths, ...selected]), allAfter);
});
