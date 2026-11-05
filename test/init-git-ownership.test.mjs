import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { REQUIRED_SETTINGS } from '../scripts/lib/obsidian-git.mjs';
import { vaultPrefix } from '../scripts/init.mjs';

const initScript = fileURLToPath(new URL('../scripts/init.mjs', import.meta.url));

function runInit(vault, home) {
  return spawnSync(process.execPath, [initScript], {
    encoding: 'utf8',
    env: { ...process.env, WIKI_MASTER_VAULT: vault, HOME: home, USERPROFILE: home,
           WIKI_MASTER_BROWSER: '/no/such/browser' },
  });
}

test('a new vault gets a schema that says who owns Git', () => {
  const vault = mkdtempSync(join(tmpdir(), 'wm-gitown-'));
  const home = mkdtempSync(join(tmpdir(), 'wm-gitown-home-'));
  const r = runInit(vault, home);
  assert.equal(r.status, 0, r.stderr);
  const schema = readFileSync(join(vault, 'vault-schema.md'), 'utf8');
  const section = schema.slice(schema.search(/^## Git ownership$/m));
  assert.match(section, /^## Git ownership\n\nObsidian Git handles all git operations\./);
  for (const [key, value] of Object.entries(REQUIRED_SETTINGS)) assert.ok(section.includes('`' + key + ': ' + value + '`'), key);
  assert.match(section, /write.*validate.*log.*refresh-index\.mjs/s);
  assert.match(section, /setup-obsidian-git\.mjs/);
  // The old passage called every other instruction stale, and init keeps an existing schema, so it outlived the policy.
  assert.doesNotMatch(section, /auto-commit|auto-push|commit on file change|stale/i);
});

test('a new vault gets .gitattributes with the union rules, and says what clears their duplicates', () => {
  const vault = mkdtempSync(join(tmpdir(), 'wm-gitown-'));
  const home = mkdtempSync(join(tmpdir(), 'wm-gitown-home-'));
  const r = runInit(vault, home);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /created: \.gitattributes/);
  const text = readFileSync(join(vault, '.gitattributes'), 'utf8');
  const rules = text.split('\n').filter((line) => line && !line.startsWith('#')).map((line) => line.split(/\s+/));
  assert.deepEqual(rules, [['index.md', 'merge=union'], ['log.md', 'merge=union'], ['moc/**', 'merge=union']]);
  const comment = text.split('\n').filter((line) => line.startsWith('#')).join('\n');
  assert.match(comment, /refresh-index\.mjs/);
  assert.match(comment, /duplicate/);
  assert.doesNotMatch(text, /post-merge|\.githooks/);
  assert.equal(existsSync(join(vault, '.git')), false, 'init still creates no repository');
});

// A timer commits whatever changed, and using the app changes these on every machine.
const PER_MACHINE = ['.obsidian/workspace.json', '.obsidian/workspace-mobile.json', '.obsidian/app.json', '.obsidian/graph.json', '.obsidian/types.json'];

test('a new vault ignores per-machine Obsidian state, and keeps what the plugin settings need tracked', () => {
  const vault = mkdtempSync(join(tmpdir(), 'wm-gitown-'));
  const home = mkdtempSync(join(tmpdir(), 'wm-gitown-home-'));
  assert.equal(runInit(vault, home).status, 0);
  const lines = readFileSync(join(vault, '.gitignore'), 'utf8').split('\n');
  for (const entry of ['.wiki-master/', ...PER_MACHINE]) assert.ok(lines.includes(entry), entry);
  const rules = lines.filter((line) => line && !line.startsWith('#'));
  assert.deepEqual(rules.sort(), ['.wiki-master/', ...PER_MACHINE].sort(), 'community-plugins.json and data.json have to stay tracked');
});

test('a vault that already has .gitignore keeps it byte for byte', () => {
  const vault = mkdtempSync(join(tmpdir(), 'wm-gitown-'));
  const home = mkdtempSync(join(tmpdir(), 'wm-gitown-home-'));
  const custom = 'mine/\r\n';
  writeFileSync(join(vault, '.gitignore'), custom);
  const r = runInit(vault, home);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /preserved: \.gitignore/);
  assert.equal(readFileSync(join(vault, '.gitignore'), 'utf8'), custom);
});

test('the skill offers those lines to an existing vault rather than editing its file', () => {
  const text = readFileSync(fileURLToPath(new URL('../skills/wiki-setup/references/initialization.md', import.meta.url)), 'utf8');
  for (const entry of PER_MACHINE) assert.ok(text.includes(entry), entry);
  assert.match(text, /[Oo]ffer to add/);
});

test('a vault that already has .gitattributes keeps it byte for byte', () => {
  const vault = mkdtempSync(join(tmpdir(), 'wm-gitown-'));
  const home = mkdtempSync(join(tmpdir(), 'wm-gitown-home-'));
  const custom = '*.pdf binary\r\n# mine\r\n';
  writeFileSync(join(vault, '.gitattributes'), custom);
  const r = runInit(vault, home);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /preserved: \.gitattributes/);
  assert.match(r.stdout, /differing: \.gitattributes/);
  assert.equal(readFileSync(join(vault, '.gitattributes'), 'utf8'), custom);
});

test('the one-time steps name the owner\'s repository, the plugin and the refresh, in order', () => {
  const vault = mkdtempSync(join(tmpdir(), 'wm-gitown-'));
  const home = mkdtempSync(join(tmpdir(), 'wm-gitown-home-'));
  const r = runInit(vault, home);
  assert.equal(r.status, 0, r.stderr);
  const order = [/git repository and upstream/i, /Open folder as vault/, /setup-obsidian-git\.mjs/, /refresh-index\.mjs/].map((pattern) => r.stdout.search(pattern));
  assert.ok(order.every((at) => at >= 0), order.join());
  assert.deepEqual(order, [...order].sort((x, y) => x - y));
});

// ---- the vault a named init was run on is the vault its next steps act on ----

// A healthy default vault is the decoy: a printed command that loses the vault reads this one and exits 0.
function decoyHome() {
  const home = mkdtempSync(join(tmpdir(), 'wm-gitown-home-'));
  const plugin = join(home, '.wiki-master-vault', '.obsidian', 'plugins', 'obsidian-git');
  mkdirSync(plugin, { recursive: true });
  writeFileSync(join(home, '.wiki-master-vault', '.obsidian', 'community-plugins.json'), JSON.stringify(['obsidian-git']));
  writeFileSync(join(plugin, 'manifest.json'), JSON.stringify({ id: 'obsidian-git' }));
  writeFileSync(join(plugin, 'data.json'), JSON.stringify(REQUIRED_SETTINGS));
  return home;
}

// The printed line run as printed, in the shell it was printed for, with no vault in its environment.
function runPrinted(line, home) {
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.WIKI_MASTER_VAULT;
  delete env.WIKI_MASTER_VAULT_NAME;
  return process.platform === 'win32'
    ? spawnSync('powershell.exe', ['-NoProfile', '-Command', line], { encoding: 'utf8', env })
    : spawnSync('sh', ['-c', line], { encoding: 'utf8', env });
}

const printedLine = (stdout, script) => {
  const line = stdout.split(/\r?\n/).find((l) => l.includes(script));
  assert.ok(line, `no printed command for ${script}:\n${stdout}`);
  return line.slice(line.search(/\$env:|WIKI_MASTER_VAULT=|node "/));
};

test('the commands a named init prints act on that vault, run as printed with nothing else set', () => {
  const vault = mkdtempSync(join(tmpdir(), 'wm-gitown-'));
  const home = decoyHome();
  const r = runInit(vault, home);
  assert.equal(r.status, 0, r.stderr);
  for (const script of ['obsidian.mjs', 'setup-obsidian-git.mjs', 'refresh-index.mjs']) {
    assert.match(printedLine(r.stdout, script), /WIKI_MASTER_VAULT/, script);
  }
  const check = runPrinted(printedLine(r.stdout, 'setup-obsidian-git.mjs').replace('--apply', '--check'), home);
  assert.equal(check.status, 1, `${check.stdout}${check.stderr}`);
  assert.ok(check.stdout.includes(vault), check.stdout);
  assert.match(check.stdout, /not installed/);
  const status = runPrinted(`${printedLine(r.stdout, 'refresh-index.mjs')} --status`, home);
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /not built|stale|current/);
  assert.equal(existsSync(join(home, '.wiki-master-vault', 'index.md')), false, 'the default vault is left alone');
});

test('a vault name set for the app is carried too', () => {
  const vault = mkdtempSync(join(tmpdir(), 'wm-gitown-'));
  const r = spawnSync(process.execPath, [initScript], { encoding: 'utf8', env: { ...process.env, WIKI_MASTER_VAULT: vault, WIKI_MASTER_VAULT_NAME: 'Named Vault', HOME: vault, USERPROFILE: vault } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(printedLine(r.stdout, 'setup-obsidian-git.mjs'), /WIKI_MASTER_VAULT_NAME/);
  assert.match(r.stdout, /Named Vault/);
});

test('a command for the default vault stays bare', () => {
  const home = mkdtempSync(join(tmpdir(), 'wm-gitown-home-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.WIKI_MASTER_VAULT;
  delete env.WIKI_MASTER_VAULT_NAME;
  const r = spawnSync(process.execPath, [initScript], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /WIKI_MASTER_VAULT/);
});

test('the printed form suits each shell, and quotes what a path can hold', () => {
  const env = { WIKI_MASTER_VAULT: "/tmp/it's a vault" };
  assert.equal(vaultPrefix(env, 'linux'), "WIKI_MASTER_VAULT='/tmp/it'\\''s a vault' ");
  assert.equal(vaultPrefix({ WIKI_MASTER_VAULT: "C:/it's" }, 'win32'), "$env:WIKI_MASTER_VAULT='C:/it''s'; ");
  assert.equal(vaultPrefix({}, 'linux'), '');
  assert.equal(vaultPrefix({ WIKI_MASTER_VAULT: '/v', WIKI_MASTER_VAULT_NAME: 'n' }, 'darwin'), "WIKI_MASTER_VAULT='/v' WIKI_MASTER_VAULT_NAME='n' ");
  assert.equal(vaultPrefix({ WIKI_MASTER_VAULT: 'C:/v', WIKI_MASTER_VAULT_NAME: 'n' }, 'win32'), "$env:WIKI_MASTER_VAULT='C:/v'; $env:WIKI_MASTER_VAULT_NAME='n'; ");
});

test('a vault that already has a schema file keeps it unchanged', () => {
  const vault = mkdtempSync(join(tmpdir(), 'wm-gitown-'));
  const home = mkdtempSync(join(tmpdir(), 'wm-gitown-home-'));
  assert.equal(runInit(vault, home).status, 0);
  const custom = '# My own schema\n\nNothing about Git here.\n';
  writeFileSync(join(vault, 'vault-schema.md'), custom);
  assert.equal(runInit(vault, home).status, 0);
  assert.equal(readFileSync(join(vault, 'vault-schema.md'), 'utf8'), custom);
});

test('CLI reports preserved differing paths without exposing content and help agrees', t => {
  const vault = mkdtempSync(join(tmpdir(), 'wm-init-cli-'));
  t.after(() => rmSync(vault, { recursive: true, force: true }));
  mkdirSync(join(vault, '_templates'));
  writeFileSync(join(vault, '_templates', 'authored-backlog-item.md'), 'PRIVATE TEMPLATE CONTENT');
  const result = runInit(vault, vault);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /preserved: _templates\/authored-backlog-item\.md/);
  assert.match(result.stdout, /differing: _templates\/authored-backlog-item\.md/);
  assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE TEMPLATE CONTENT/);
  assert.equal(existsSync(join(vault, '.git')), false);
  const help = spawnSync(process.execPath, [initScript, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Existing files are kept/);
  assert.match(help.stdout, /partial creation/);
});

test('CLI returns nonzero for an obstruction and discloses retained creations', t => {
  const vault = mkdtempSync(join(tmpdir(), 'wm-init-cli-'));
  t.after(() => rmSync(vault, { recursive: true, force: true }));
  mkdirSync(join(vault, 'index.md'));
  const result = runInit(vault, vault);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /blocked: index\.md/);
  assert.match(result.stderr, /Created files remain/);
  assert.match(result.stdout, /created: log\.md/);
  assert.equal(existsSync(join(vault, '.git')), false);
});
