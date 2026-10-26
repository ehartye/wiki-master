import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
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
function page(root, rel, { kind = 'note', status } = {}) {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), `---\ntype: authored\nproject: alpha\nkind: ${kind}\n${status ? `backlog-status: ${status}\n` : ''}sources: []\n---\n# ${rel}\n`);
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
