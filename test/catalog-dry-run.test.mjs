import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { refreshCatalogs, lineDiff } from '../scripts/refresh-catalogs.mjs';
import { regenerateIndex } from '../scripts/index-gen.mjs';
import { regenerateAuthoredMocs } from '../scripts/moc-authored-gen.mjs';
import { regenerateBacklogRoadmaps } from '../scripts/backlog-gen.mjs';

// A dry run must predict an apply: the list of files it says would change is the list an apply changes.

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const NOW = new Date('2026-03-05T12:00:00Z');

function page(root, rel, { project = 'alpha', kind = 'note', status } = {}) {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), `---\ntype: authored\nproject: ${project}\nkind: ${kind}\n${status ? `backlog-status: ${status}\n` : ''}sources: []\n---\n# ${rel}\n`);
}
function vault(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-dry-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const project of ['alpha', 'beta']) {
    page(root, `wiki/authored/${project}/overview.md`, { project, kind: 'overview' });
    page(root, `wiki/authored/${project}/shared.md`, { project });
    page(root, `wiki/authored/${project}/backlog/task.md`, { project, kind: 'backlog-item', status: 'planned' });
  }
  return root;
}
function snapshot(root) {
  const out = {};
  const walk = (dir) => {
    out[dir.slice(root.length) || '/'] = { entries: readdirSync(dir).sort(), mtime: statSync(dir).mtimeMs };
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else out[full.slice(root.length)] = { bytes: readFileSync(full, 'utf8'), mtime: statSync(full).mtimeMs };
    }
  };
  walk(root);
  return out;
}
const sorted = (list) => [...list].sort();

test('a fresh project: the dry run names exactly what an apply creates, the index included', (t) => {
  const root = vault(t);
  const dry = refreshCatalogs(root, { project: 'alpha', now: NOW });
  const applied = refreshCatalogs(root, { project: 'alpha', apply: true, now: NOW });
  assert.equal(dry.applied, false);
  assert.deepEqual(sorted(dry.changed), sorted(applied.changed));
  assert.deepEqual(sorted(applied.changed), ['index.md', 'moc/alpha.md', 'wiki/authored/alpha/roadmap.md']);
});

test('the index a dry run plans is the index an apply writes, the new map listed', (t) => {
  const root = vault(t);
  const dry = refreshCatalogs(root, { project: 'alpha', now: NOW, diff: true });
  refreshCatalogs(root, { project: 'alpha', apply: true, now: NOW });
  const written = readFileSync(join(root, 'index.md'), 'utf8').split('\n').filter((l) => l.startsWith('- '));
  const planned = dry.diffs.find((d) => d.path === 'index.md').added.filter((l) => l.startsWith('- '));
  assert.deepEqual(sorted(planned), sorted(written));
  assert.ok(planned.some((l) => /moc\/alpha|\[\[alpha\]\]/.test(l)), 'the new map is not in the planned index');
});

test('a stale project: an added item and a flipped status are in the dry run', (t) => {
  const root = vault(t);
  refreshCatalogs(root, { project: 'alpha', apply: true, now: NOW });
  page(root, 'wiki/authored/alpha/backlog/task-two.md', { kind: 'backlog-item', status: 'planned' });
  page(root, 'wiki/authored/alpha/backlog/task.md', { kind: 'backlog-item', status: 'shipped' });
  const dry = refreshCatalogs(root, { project: 'alpha', now: NOW });
  assert.deepEqual(dry.changed, ['wiki/authored/alpha/roadmap.md']);
  const applied = refreshCatalogs(root, { project: 'alpha', apply: true, now: NOW });
  assert.deepEqual(applied.changed, dry.changed);
});

test('a clean vault: nothing in either mode', (t) => {
  const root = vault(t);
  refreshCatalogs(root, { project: 'alpha', apply: true, now: NOW });
  assert.deepEqual(refreshCatalogs(root, { project: 'alpha', now: NOW }).changed, []);
  assert.deepEqual(refreshCatalogs(root, { project: 'alpha', apply: true, now: NOW }).changed, []);
});

test('a bare link made ambiguous by another project\'s new page is a change, and the diff shows it', (t) => {
  const root = vault(t);
  // a name only alpha has gets written bare; beta then gains a page of the same name
  page(root, 'wiki/authored/alpha/user.md');
  refreshCatalogs(root, { project: 'alpha', apply: true, now: NOW });
  assert.match(readFileSync(join(root, 'moc/alpha.md'), 'utf8'), /- \[\[user\]\]/);
  page(root, 'wiki/authored/beta/user.md', { project: 'beta' });
  const dry = refreshCatalogs(root, { project: 'alpha', now: NOW, diff: true });
  assert.ok(dry.changed.includes('moc/alpha.md'));
  assert.ok(dry.changed.includes('index.md'));
  const moc = dry.diffs.find((d) => d.path === 'moc/alpha.md');
  assert.deepEqual(moc.removed, ['- [[user]]']);
  assert.deepEqual(moc.added, ['- [[wiki/authored/alpha/user|user]]']);
  assert.deepEqual(refreshCatalogs(root, { project: 'alpha', apply: true, now: NOW }).changed, dry.changed);
});

test('a ledger-scoped dry run matches the scoped apply', (t) => {
  const root = vault(t);
  execFileSync('git', ['init', '-q'], { cwd: root });
  refreshCatalogs(root, { project: 'alpha', apply: true, now: NOW });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=a', 'commit', '-qm', 'base'], { cwd: root });
  page(root, 'wiki/authored/alpha/ours.md');
  const owned = ['wiki/authored/alpha/ours.md'];
  const dry = refreshCatalogs(root, { project: 'alpha', ownedPaths: owned, now: NOW });
  assert.deepEqual(sorted(dry.changed), ['index.md', 'moc/alpha.md']);
  assert.deepEqual(sorted(refreshCatalogs(root, { project: 'alpha', apply: true, ownedPaths: owned, now: NOW }).changed), sorted(dry.changed));
});

test('a dry run writes nothing: bytes, entries and times of every file and folder are unchanged', (t) => {
  const root = vault(t);
  const before = snapshot(root);
  refreshCatalogs(root, { project: 'alpha', now: NOW, diff: true });
  assert.deepEqual(snapshot(root), before);
  assert.ok(!existsSync(join(root, 'moc')), 'a dry run created the moc folder');
  assert.ok(!existsSync(join(root, 'index.md')));
});

test('diffs appear only when asked', (t) => {
  const root = vault(t);
  assert.equal('diffs' in refreshCatalogs(root, { project: 'alpha', now: NOW }), false);
  assert.equal(Array.isArray(refreshCatalogs(root, { project: 'alpha', now: NOW, diff: true }).diffs), true);
});

test('the standalone generators report the same changed list in a dry run as in an apply', (t) => {
  const root = vault(t);
  const roadmap = regenerateBacklogRoadmaps(root, { now: NOW });
  const moc = regenerateAuthoredMocs(root, {});
  const index = regenerateIndex(root, { apply: false });
  assert.deepEqual(sorted(roadmap.changed), ['wiki/authored/alpha/roadmap.md', 'wiki/authored/beta/roadmap.md']);
  assert.deepEqual(sorted(moc.changed), ['moc/alpha.md', 'moc/beta.md']);
  assert.equal(index.changed, true);
  assert.ok(!existsSync(join(root, 'moc')) && !existsSync(join(root, 'index.md')));
  assert.deepEqual(sorted(regenerateBacklogRoadmaps(root, { apply: true, now: NOW }).changed), sorted(roadmap.changed));
  assert.deepEqual(sorted(regenerateAuthoredMocs(root, { apply: true }).changed), sorted(moc.changed));
});

test('lineDiff counts each occurrence once and ignores blank lines and order', () => {
  assert.deepEqual(lineDiff('a\nb\nb\n', 'b\nc\n'), { removed: ['a', 'b'], added: ['c'] });
  assert.deepEqual(lineDiff(null, 'x\n'), { removed: [], added: ['x'] });
  assert.deepEqual(lineDiff('a\r\nb\r\n', 'a\nb\n'), { removed: [], added: [] });
  assert.deepEqual(lineDiff('a\n\n\nb', 'a\nb'), { removed: [], added: [] }, 'a changed number of blank lines is not reported');
});

function run(script, args, root) {
  return spawnSync(process.execPath, [join(SCRIPTS, script), ...args], { encoding: 'utf8', env: { ...process.env, WIKI_MASTER_VAULT: root } });
}

test('the command prints the JSON line unchanged, then one diff block per file on stderr, and a dry-run note', (t) => {
  const root = vault(t);
  const r = run('refresh-catalogs.mjs', ['--project', 'alpha', '--diff'], root);
  assert.equal(r.status, 0, r.stderr);
  const json = JSON.parse(r.stdout.trim());
  assert.equal('diffs' in json, false);
  assert.deepEqual(sorted(json.changed), ['index.md', 'moc/alpha.md', 'wiki/authored/alpha/roadmap.md']);
  assert.match(r.stderr, /^diff moc\/alpha\.md$/m);
  assert.match(r.stderr, /^\+ - \[\[wiki\/authored\/alpha\/shared\|shared\]\]$/m);
  assert.match(r.stderr, /dry run — 3 file\(s\) would change; re-run with --apply/);
  assert.ok(!existsSync(join(root, 'moc')));
});

test('a dry run that would change nothing says so', (t) => {
  const root = vault(t);
  refreshCatalogs(root, { project: 'alpha', apply: true, now: NOW });
  const r = run('refresh-catalogs.mjs', ['--project', 'alpha'], root);
  assert.match(r.stderr, /dry run — nothing would change/);
  assert.deepEqual(JSON.parse(r.stdout.trim()).changed, []);
});

test('the standalone commands print the populated list and the note, and refuse --diff', (t) => {
  const root = vault(t);
  const r = run('moc-authored-gen.mjs', [], root);
  assert.deepEqual(sorted(JSON.parse(r.stdout.trim()).changed), ['moc/alpha.md', 'moc/beta.md']);
  assert.match(r.stderr, /dry run — 2 file\(s\) would change; re-run with --apply/);
  for (const script of ['moc-authored-gen.mjs', 'backlog-gen.mjs']) {
    const refused = run(script, ['--diff'], root);
    assert.notEqual(refused.status, 0, script);
    assert.match(refused.stderr, /--diff is supported by refresh-catalogs\.mjs only/);
  }
  assert.ok(!existsSync(join(root, 'moc')));
});
