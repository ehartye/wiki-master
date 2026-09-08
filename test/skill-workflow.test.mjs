import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseNote } from '../scripts/lib/note.mjs';
import { main as freshness } from '../scripts/stale.mjs';

const scripts = fileURLToPath(new URL('../scripts/', import.meta.url));

// Executes the shared authoring lifecycle against local-only Git repositories.
// This tests commands/artifacts, not whether an LLM elects to run those commands.
test('offline authored workflow commits only its edit and publishes to its configured local remote from unrelated cwd', () => {
  const root = mkdtempSync(join(tmpdir(), 'wiki-workflow-'));
  const vault = join(root, 'vault'), remote = join(root, 'remote.git'), cwd = join(root, 'unrelated');
  mkdirSync(vault); mkdirSync(cwd);
  const git = (...args) => execFileSync('git', args, { cwd: vault, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  const write = (path, text) => { mkdirSync(dirname(join(vault, path)), { recursive: true }); writeFileSync(join(vault, path), text); };
  const run = (name, args = [], input) => execFileSync(process.execPath, [join(scripts, name), ...args], {
    cwd, env: { ...process.env, WIKI_MASTER_VAULT: vault, WIKI_MASTER_VAULT_NAME: 'test-fixture' }, input, encoding: 'utf8', timeout: 15000, windowsHide: true,
  }).trim();
  try {
    git('init', '-q', '--initial-branch=main');
    git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'Fixture');
    git('init', '-q', '--bare', remote); git('remote', 'add', 'origin', remote);
    const guide = 'wiki/authored/atlas/guides/user.md';
    const original = '---\ntype: authored\nproject: atlas\nkind: guide\nsources: []\nreviewed: 2026-08-01\nupdated: 2026-08-01\n---\n# Atlas guide\nExisting verified behavior.\n';
    write('.gitignore', '.wiki-master/\n'); write(guide, original); write('raw/clippings/evidence.md', '# Immutable evidence\n'); write('personal.md', 'initial\n');
    git('add', '.'); git('commit', '-qm', 'fixture'); git('push', '-q', '-u', 'origin', 'main');
    write('personal.md', 'unrelated user draft\n');
    const token = run('op-begin.mjs', ['--op', 'relink']);
    assert.match(token, /^[a-f0-9]+$/);
    const edited = original.replace('updated: 2026-08-01', 'updated: 2026-09-08') + '\n## Offline mode\nPreviously downloaded material works offline. This section was checked against code.\n';
    write(guide, edited);
    assert.equal(parseNote(readFileSync(join(vault, guide), 'utf8')).metadata.reviewed, '2026-08-01');
    run('index-gen.mjs'); run('moc-authored-gen.mjs', ['--apply']);
    run('log-entry.mjs', ['--op', 'relink', '--title', 'Explain Atlas offline mode'], 'Checked only offline section; existing review date retained.\n');
    const output = run('op-commit.mjs', ['--op', 'relink', '--title', 'Explain Atlas offline mode', '--since', token]);
    assert.match(output, /committed/);
    const changed = git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').split('\n');
    assert.ok(changed.includes(guide)); assert.ok(changed.some(p => p.startsWith('log/')));
    assert.ok(!changed.includes('personal.md')); assert.ok(!changed.some(p => p.startsWith('raw/')));
    assert.equal(readFileSync(join(vault, 'raw/clippings/evidence.md'), 'utf8'), '# Immutable evidence\n');
    assert.equal(git('branch', '--show-current'), 'main');
    git('push', '-q', 'origin', 'main');
    assert.equal(git('rev-parse', 'HEAD'), execFileSync('git', ['--git-dir', remote, 'rev-parse', 'refs/heads/main'], { encoding: 'utf8' }).trim());
    assert.equal(git('status', '--porcelain'), 'M personal.md');
    const before = readFileSync(join(vault, guide), 'utf8');
    const r = freshness({ vaultPath: vault, today: new Date('2026-09-08'), obsidianJsonImpl: () => { throw new Error('CLI unavailable'); }, log: () => {} });
    assert.equal(r.backend, 'filesystem');
    assert.equal(readFileSync(join(vault, guide), 'utf8'), before);
    assert.equal(git('status', '--porcelain'), 'M personal.md');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
