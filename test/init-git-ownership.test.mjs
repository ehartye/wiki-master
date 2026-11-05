import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { REQUIRED_SETTINGS } from '../scripts/lib/obsidian-git.mjs';
import { commandForms } from '../scripts/lib/vault.mjs';

const initScript = fileURLToPath(new URL('../scripts/init.mjs', import.meta.url));
const ROOT_SCRIPTS = fileURLToPath(new URL('../scripts/', import.meta.url));

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

test('the printed open step asks for restricted mode off, since the install stops until it is', () => {
  const vault = mkdtempSync(join(tmpdir(), 'wm-gitown-'));
  const home = mkdtempSync(join(tmpdir(), 'wm-gitown-home-'));
  const r = runInit(vault, home);
  assert.equal(r.status, 0, r.stderr);
  const step = r.stdout.slice(r.stdout.search(/Open folder as vault/), r.stdout.search(/3\. Verify/));
  assert.match(step, /[Rr]estricted mode/);
  assert.match(step, /trust/i);
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

function shellEnv(home) {
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.WIKI_MASTER_VAULT;
  delete env.WIKI_MASTER_VAULT_NAME;
  return env;
}

const runs = (command, args) => spawnSync(command, args, { encoding: 'utf8', timeout: 60000 }).status === 0;
// A shell counts as present only if it can also reach node: a Windows bash can be a launcher for a system with neither.
const firstShell = (names, args) => names.find((name) => runs(name, [...args, 'node --version']));
const SHELLS = {
  'POSIX shell': { name: firstShell(['bash'], ['-c']), args: ['-c'] },
  PowerShell: { name: firstShell(['pwsh', 'powershell.exe', 'powershell'], ['-NoProfile', '-Command']), args: ['-NoProfile', '-Command'] },
};
const runIn = (shell, line, home) => spawnSync(shell.name, [...shell.args, line], { encoding: 'utf8', env: shellEnv(home), timeout: 60000 });

// The command printed under one label, for one script.
function printedForm(stdout, label, script) {
  const line = stdout.split(/\r?\n/).find((l) => l.trimStart().startsWith(`${label}:`) && l.includes(script));
  assert.ok(line, `no ${label} line for ${script}:\n${stdout}`);
  return line.trimStart().slice(label.length + 1).trim();
}

// A vault folder holding what a path can hold, with a healthy default vault as the decoy.
function namedVaultWorld(t) {
  const parent = mkdtempSync(join(tmpdir(), 'wm-gitown-'));
  const vault = join(parent, "it's a vault");
  const home = decoyHome();
  t.after(() => { rmSync(parent, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); });
  const r = runInit(vault, home);
  assert.equal(r.status, 0, r.stderr);
  return { vault, home, stdout: r.stdout };
}

for (const [label, shell] of Object.entries(SHELLS)) {
  test(`printed for ${label}, run through it as printed: it acts on the named vault, not the default`, { skip: shell.name ? false : `${label} is not on this machine` }, (t) => {
    const { vault, home, stdout } = namedVaultWorld(t);
    const check = runIn(shell, printedForm(stdout, label, 'setup-obsidian-git.mjs').replace('--apply', '--check'), home);
    assert.notEqual(check.status, 0, 'the vault is not set up, and a failure must show in the exit code');
    assert.ok(check.stdout.includes(vault), `${check.stdout}${check.stderr}`);
    assert.match(check.stdout, /not installed/);
    assert.doesNotMatch(check.stdout, /\.wiki-master-vault/);
    mkdirSync(join(vault, 'wiki', 'concepts'), { recursive: true });
    writeFileSync(join(vault, 'wiki', 'concepts', 'page.md'), '---\ntype: concept\nsources: []\n---\n# Page\n\nA page.\n');
    const refresh = printedForm(stdout, label, 'refresh-index.mjs');
    const status = runIn(shell, refresh.replace(/refresh-index\.mjs(["'])/, 'refresh-index.mjs$1 --status'), home);
    assert.equal(status.status, 0, `${status.stdout}${status.stderr}`);
    assert.match(status.stdout, /not built/, 'this vault has a page and no index; the decoy has no page and would say current');
    assert.equal(existsSync(join(home, '.wiki-master-vault', 'index.md')), false, 'the default vault is left alone');
  });
}

for (const [label, wrong, shell] of [['PowerShell', 'a POSIX shell', SHELLS['POSIX shell']], ['POSIX shell', 'PowerShell', SHELLS.PowerShell]]) {
  test(`a ${label} line pasted into ${wrong} never reaches node, so it cannot fall through to the default vault`, { skip: shell.name ? false : `${wrong} is not on this machine` }, (t) => {
    const { home, stdout } = namedVaultWorld(t);
    const r = runIn(shell, printedForm(stdout, label, 'setup-obsidian-git.mjs').replace('--apply', '--check'), home);
    assert.notEqual(r.status, 0);
    assert.doesNotMatch(r.stdout, /setup-obsidian-git:|met: autoSaveInterval/, `${r.stdout}${r.stderr}`);
  });
}

test('init prints both labeled forms on every platform, with nothing bare beside them', (t) => {
  const { stdout } = namedVaultWorld(t);
  for (const script of ['obsidian.mjs', 'setup-obsidian-git.mjs', 'refresh-index.mjs']) {
    assert.match(printedForm(stdout, 'PowerShell', script), /^if \(\$env:WIKI_MASTER_VAULT=/, script);
    assert.match(printedForm(stdout, 'POSIX shell', script), /^WIKI_MASTER_VAULT=/, script);
  }
  const unlabeled = stdout.split(/\r?\n/).filter((l) => l.includes('node ') && !/^\s*(PowerShell|POSIX shell):/.test(l));
  assert.deepEqual(unlabeled, []);
});

// PowerShell closes a single-quoted string on any of these, so a typographic apostrophe in a path is a parse error.
const POWERSHELL_QUOTES = ["'", '‘', '’', '‚', '‛'];

test('the PowerShell form doubles every quote character PowerShell recognizes', () => {
  for (const quote of POWERSHELL_QUOTES) {
    const { powershell } = commandForms(`/opt/a${quote}b/x.mjs`, '', { WIKI_MASTER_VAULT: `/v${quote}w` });
    assert.equal(powershell, `if ($env:WIKI_MASTER_VAULT='/v${quote}${quote}w') { node '/opt/a${quote}${quote}b/x.mjs' }`, `U+${quote.codePointAt(0).toString(16)}`);
  }
  assert.equal(commandForms('/x.mjs', '', { WIKI_MASTER_VAULT: '/v’w' }).posix, "WIKI_MASTER_VAULT='/v’w' node '/x.mjs'", 'a POSIX shell treats it as an ordinary character');
});

test('a path holding every PowerShell quote character reaches the named vault', { skip: SHELLS.PowerShell.name ? false : 'PowerShell is not on this machine' }, (t) => {
  const parent = mkdtempSync(join(tmpdir(), 'wm-gitown-'));
  const vault = join(parent, `q${POWERSHELL_QUOTES.join('')}v`);
  const home = decoyHome();
  t.after(() => { rmSync(parent, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); });
  const r = runInit(vault, home);
  assert.equal(r.status, 0, r.stderr);
  mkdirSync(join(vault, 'wiki', 'concepts'), { recursive: true });
  writeFileSync(join(vault, 'wiki', 'concepts', 'page.md'), '---\ntype: concept\nsources: []\n---\n# Page\n\nA page.\n');
  const line = commandForms(join(ROOT_SCRIPTS, 'refresh-index.mjs'), ' --status', { WIKI_MASTER_VAULT: vault }).powershell;
  const status = runIn(SHELLS.PowerShell, line, home);
  assert.equal(status.status, 0, `${status.stdout}${status.stderr}`);
  assert.match(status.stdout, /not built/, 'only this vault has a page and no index');
});

// The forms as initialization.md writes them, filled in and run: `'body' | if (...)` is a parse error in PowerShell.
const initializationDoc = () => readFileSync(new URL('../skills/wiki-setup/references/initialization.md', import.meta.url), 'utf8');
function documentedPipe(label) {
  const line = initializationDoc().split('\n').find((l) => l.startsWith(`- Piped input, ${label}: `));
  assert.ok(line, `initialization.md gives no piped form for ${label}`);
  return /`(.*)`/.exec(line)[1];
}

for (const [label, shell] of Object.entries(SHELLS)) {
  test(`the documented way to pipe a log body works in ${label}, on the named vault`, { skip: shell.name ? false : `${label} is not on this machine` }, (t) => {
    const parent = mkdtempSync(join(tmpdir(), 'wm-gitown-'));
    const vault = join(parent, 'piped vault');
    const home = decoyHome();
    t.after(() => { rmSync(parent, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); });
    assert.equal(runInit(vault, home).status, 0);
    const quoted = (value) => (label === 'PowerShell' ? value.replaceAll("'", "''") : value.replaceAll("'", String.raw`'\''`));
    const line = documentedPipe(label)
      .replace('<root>', quoted(vault))
      .replace('node ...', `node '${quoted(join(ROOT_SCRIPTS, 'log-entry.mjs'))}' --op relink --title 'Initialize vault'`);
    const r = runIn(shell, line, home);
    assert.equal(r.status, 0, `${line}\n${r.stdout}${r.stderr}`);
    const written = readdirSync(join(vault, 'log')).filter((name) => name.endsWith('.md'));
    assert.equal(written.length, 1, r.stdout);
    assert.match(readFileSync(join(vault, 'log', written[0]), 'utf8'), /body/);
    assert.equal(existsSync(join(home, '.wiki-master-vault', 'log')), false, 'the default vault is left alone');
  });
}

test('the log step points at the piped forms', () => {
  const text = initializationDoc();
  const step = text.slice(text.search(/^2\. Run `init\.mjs`/m), text.search(/^3\. The owner/m));
  assert.match(step, /log-entry\.mjs/);
  assert.match(step, /piped\s+form/);
});

test('a vault name set for the app is carried in both forms', () => {
  const vault = mkdtempSync(join(tmpdir(), 'wm-gitown-'));
  const r = spawnSync(process.execPath, [initScript], { encoding: 'utf8', env: { ...process.env, WIKI_MASTER_VAULT: vault, WIKI_MASTER_VAULT_NAME: 'Named Vault', HOME: vault, USERPROFILE: vault } });
  assert.equal(r.status, 0, r.stderr);
  for (const label of ['PowerShell', 'POSIX shell']) assert.match(printedForm(r.stdout, label, 'setup-obsidian-git.mjs'), /WIKI_MASTER_VAULT_NAME/, label);
  assert.match(r.stdout, /Named Vault/);
});

test('a command for the default vault stays bare', () => {
  const home = mkdtempSync(join(tmpdir(), 'wm-gitown-home-'));
  const r = spawnSync(process.execPath, [initScript], { encoding: 'utf8', env: shellEnv(home) });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /WIKI_MASTER_VAULT|PowerShell:|POSIX shell:/);
});

test('each form quotes spaces and apostrophes for its own shell', () => {
  const forms = commandForms("/opt/it's plugin/refresh-index.mjs", '', { WIKI_MASTER_VAULT: "/tmp/it's a vault" });
  assert.equal(forms.posix, String.raw`WIKI_MASTER_VAULT='/tmp/it'\''s a vault' node '/opt/it'\''s plugin/refresh-index.mjs'`);
  assert.equal(forms.powershell, "if ($env:WIKI_MASTER_VAULT='/tmp/it''s a vault') { node '/opt/it''s plugin/refresh-index.mjs' }");
  const named = commandForms('/p/x.mjs', ' --apply', { WIKI_MASTER_VAULT: '/v', WIKI_MASTER_VAULT_NAME: 'n' });
  assert.equal(named.posix, "WIKI_MASTER_VAULT='/v' WIKI_MASTER_VAULT_NAME='n' node '/p/x.mjs' --apply");
  assert.equal(named.powershell, "if (($env:WIKI_MASTER_VAULT='/v') -and ($env:WIKI_MASTER_VAULT_NAME='n')) { node '/p/x.mjs' --apply }");
  assert.equal(commandForms('/p/x.mjs', '', {}), null);
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
