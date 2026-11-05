import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { parseNote } from '../scripts/lib/note.mjs';
import { main as freshness } from '../scripts/stale.mjs';
import { main as refreshIndex } from '../scripts/refresh-index.mjs';

const scripts = fileURLToPath(new URL('../scripts/', import.meta.url));

// Executes the shared authoring workflow against a local-only Git repository: write, validate, log once, refresh. The
// refresh's app and embedder are stubbed; its git check is real. This tests commands and artifacts, not whether an LLM
// elects to run those commands.
test('offline authored workflow writes, validates, logs and refreshes from an unrelated cwd, leaving git alone', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wiki-workflow-'));
  const vault = join(root, 'vault'), remote = join(root, 'remote.git'), cwd = join(root, 'unrelated');
  mkdirSync(vault); mkdirSync(cwd);
  const git = (...args) => execFileSync('git', args, { cwd: vault, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  const write = (path, text) => { mkdirSync(dirname(join(vault, path)), { recursive: true }); writeFileSync(join(vault, path), text); };
  const run = (name, args = [], input) => spawnSync(process.execPath, [join(scripts, name), ...args], {
    cwd, env: { ...process.env, WIKI_MASTER_VAULT: vault, WIKI_MASTER_VAULT_NAME: 'test-fixture' }, input, encoding: 'utf8', timeout: 15000, windowsHide: true,
  });
  try {
    git('init', '-q', '--initial-branch=main');
    git('config', 'core.autocrlf', 'false');
    git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'Fixture');
    git('init', '-q', '--bare', remote); git('remote', 'add', 'origin', remote);
    const guide = 'wiki/authored/atlas/guides/user.md';
    const original = '---\ntype: authored\ncreated: 2026-08-01\nstatus: draft\nai-generated: true\nproject: atlas\nkind: guide\nsources: []\nreviewed: 2026-08-01\nupdated: 2026-08-01\n---\n# Atlas guide\nExisting verified behavior.\n';
    write('.gitignore', '.wiki-master/\n'); write(guide, original); write('raw/clippings/evidence.md', '# Immutable evidence\n'); write('personal.md', 'initial\n');
    write('.obsidian/community-plugins.json', JSON.stringify(['obsidian-git']));
    write('.obsidian/plugins/obsidian-git/manifest.json', JSON.stringify({ id: 'obsidian-git' }));
    write('.obsidian/plugins/obsidian-git/data.json', JSON.stringify({ autoSaveInterval: 10 }));
    git('add', '.'); git('commit', '-qm', 'fixture'); git('push', '-q', '-u', 'origin', 'main');
    const repository = () => ({ head: git('rev-parse', 'HEAD'), index: git('ls-files', '--stage'), branch: git('branch', '--show-current'),
      remote: execFileSync('git', ['--git-dir', remote, 'rev-parse', 'refs/heads/main'], { encoding: 'utf8' }).trim() });
    const before = repository();
    write('personal.md', 'unrelated user draft\n');

    const edited = original.replace('updated: 2026-08-01', 'updated: 2026-09-08') + '\n## Offline mode\nPreviously downloaded material works offline. This section was checked against code.\n';
    write(guide, edited);
    assert.equal(parseNote(readFileSync(join(vault, guide), 'utf8')).metadata.reviewed, '2026-08-01');

    // A ledger is a hand-written JSON array of the paths the task wrote.
    const ledger = join(cwd, 'ledger.json');
    writeFileSync(ledger, JSON.stringify([guide]));
    const validated = run('validate-authored.mjs', ['--paths-file', ledger]);
    assert.equal(validated.status, 0, validated.stdout + validated.stderr);

    const logged = run('log-entry.mjs', ['--op', 'relink', '--title', 'Explain Atlas offline mode'], 'Checked only offline section; existing review date retained.\n');
    assert.equal(logged.status, 0, logged.stderr);
    assert.deepEqual(readdirSync(join(vault, 'log')).map(name => 'log/' + name), [logged.stdout.trim()], 'one log entry');

    const lines = [];
    const code = await refreshIndex([], {
      vault: { path: vault, name: 'test-fixture' },
      probes: { model: 'test-embedder', host: 'http://ollama.test:11434', ollamaUp: async () => true, modelPulled: async () => true, session: () => 'this-session', cli: () => vault },
      embedFn: async text => [text.length, 1, 2, 3],
      out: line => lines.push(line), err: line => lines.push(line),
    });
    assert.equal(code, 0, lines.join('\n'));
    assert.ok(readFileSync(join(vault, 'index.md'), 'utf8').includes('[[user]]'), 'the catalog lists the page');
    assert.ok(existsSync(join(vault, '.wiki-master', 'chunks.json')), 'the search index was built');

    // Nothing was staged, committed or sent, and the work and the user's unrelated draft wait on disk for Obsidian Git.
    assert.deepEqual(repository(), before);
    assert.equal(readFileSync(join(vault, 'personal.md'), 'utf8'), 'unrelated user draft\n');
    assert.equal(readFileSync(join(vault, 'raw/clippings/evidence.md'), 'utf8'), '# Immutable evidence\n');
    const status = git('status', '--porcelain');
    assert.match(status, /^ ?M personal\.md$/m);
    assert.ok(status.includes(guide));
    assert.match(status, /^\?\? log\/$/m);

    const page = readFileSync(join(vault, guide), 'utf8');
    const savedVault = process.env.WIKI_MASTER_VAULT;
    process.env.WIKI_MASTER_VAULT = vault;
    let r;
    try {
      r = freshness({ vaultPath: vault, today: new Date('2026-09-08'), obsidianJsonImpl: () => { throw new Error('CLI unavailable'); }, log: () => {} });
    } finally {
      if (savedVault === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = savedVault;
    }
    assert.equal(r.backend, 'filesystem');
    assert.equal(readFileSync(join(vault, guide), 'utf8'), page);
    assert.equal(git('status', '--porcelain'), status);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
