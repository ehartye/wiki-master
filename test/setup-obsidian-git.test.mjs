import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../scripts/setup-obsidian-git.mjs';
import { REQUIRED_SETTINGS } from '../scripts/lib/obsidian-git.mjs';

// Setup installs and configures the one plugin that handles git for the vault. The stubbed app below behaves as the
// real one was read to behave: its CLI exits 0 and prints "Error: ..." or "Vault not found." on failure, and a plugin's
// enabled state reaches community-plugins.json a moment after the command returns.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'scripts', 'setup-obsidian-git.mjs');
const PLUGIN = '.obsidian/plugins/obsidian-git';
const MET = JSON.stringify(REQUIRED_SETTINGS);

function world(t, files = {}) {
  const path = mkdtempSync(join(tmpdir(), 'wm-setup-git-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(path, file)), { recursive: true });
    writeFileSync(join(path, file), text);
  }
  return { path, name: 'scratch' };
}

const INSTALLED = { [`${PLUGIN}/manifest.json`]: JSON.stringify({ id: 'obsidian-git' }) };
const ENABLED = { ...INSTALLED, '.obsidian/community-plugins.json': JSON.stringify(['obsidian-git']) };
const dataOf = (vault) => join(vault.path, PLUGIN, 'data.json');

function snapshot(root, base = root, acc = {}) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) snapshot(full, base, acc);
    else acc[full.slice(base.length)] = readFileSync(full, 'latin1');
  }
  return acc;
}

// `app` overrides how one command answers; the default answers succeed and change the vault's files as the real app does.
function hooks(vault, app = {}) {
  const calls = [];
  const lines = [];
  const installed = () => {
    mkdirSync(join(vault.path, PLUGIN), { recursive: true });
    writeFileSync(join(vault.path, PLUGIN, 'manifest.json'), JSON.stringify({ id: 'obsidian-git' }));
    return 'Installed: obsidian-git v2.39.0';
  };
  const enabled = () => {
    mkdirSync(join(vault.path, '.obsidian'), { recursive: true });
    writeFileSync(join(vault.path, '.obsidian/community-plugins.json'), JSON.stringify(['obsidian-git']));
    return 'Enabled: obsidian-git';
  };
  const answers = {
    vault: () => vault.path,
    'plugins:restrict': () => 'off',
    'plugin:install': installed,
    'plugin:enable': enabled,
    'plugin:reload': () => 'Reloaded: obsidian-git',
    ...app,
  };
  return {
    vault,
    session: app.session ?? (() => 'this-session'),
    delay: async () => {},
    cli: (args, options) => {
      calls.push({ args, options, dataWas: existsSync(dataOf(vault)) ? readFileSync(dataOf(vault), 'utf8') : null });
      const answer = answers[args[0]];
      if (!answer) throw new Error(`the stub has no answer for ${args[0]}`);
      return answer(args);
    },
    out: (line) => lines.push(line),
    err: (line) => lines.push(line),
    calls,
    lines,
    text: () => lines.join('\n'),
    sent: () => calls.map((call) => call.args[0]),
  };
}

// ---- --check ----

test('--check: everything met exits 0, reports each setting and calls no CLI', async (t) => {
  const vault = world(t, { ...ENABLED, [`${PLUGIN}/data.json`]: MET });
  const h = hooks(vault);
  assert.equal(await main(['--check'], h), 0, h.text());
  assert.deepEqual(h.calls, []);
  for (const key of Object.keys(REQUIRED_SETTINGS)) assert.match(h.text(), new RegExp(`met: ${key}\\b`));
  assert.doesNotMatch(h.text(), /differs:|missing:/);
});

test('--check is the default', async (t) => {
  const vault = world(t, { ...ENABLED, [`${PLUGIN}/data.json`]: MET });
  const h = hooks(vault);
  assert.equal(await main([], h), 0, h.text());
  assert.match(h.text(), /met: autoSaveInterval/);
  assert.deepEqual(h.calls, []);
});

test('--check: met, missing and differing settings are told apart, and nothing is written', async (t) => {
  const data = JSON.stringify({ autoSaveInterval: 10, syncMethod: 'merge', mergeStrategy: 'none', autoPushInterval: 0 });
  const vault = world(t, { ...ENABLED, [`${PLUGIN}/data.json`]: data });
  const before = snapshot(vault.path);
  const h = hooks(vault);
  assert.equal(await main(['--check'], h), 1);
  const text = h.text();
  assert.match(text, /met: autoSaveInterval = 10/);
  assert.match(text, /met: autoPushInterval = 0/);
  assert.match(text, /differs: syncMethod is "merge", required "rebase"/);
  assert.match(text, /differs: mergeStrategy is "none", required "theirs"/);
  assert.match(text, /missing: autoPullOnBoot, required true/);
  assert.match(text, /missing: autoPullInterval, required 0/);
  assert.deepEqual(snapshot(vault.path), before);
  assert.deepEqual(h.calls, []);
});

test('--check: no plugin, and a plugin that is not enabled, are each named', async (t) => {
  const none = hooks(world(t));
  assert.equal(await main(['--check'], none), 1);
  assert.match(none.text(), /Obsidian Git: not installed/);
  assert.match(none.text(), /missing: autoSaveInterval, required 10/);
  const off = hooks(world(t, { ...INSTALLED, [`${PLUGIN}/data.json`]: MET }));
  assert.equal(await main(['--check'], off), 1);
  assert.match(off.text(), /Obsidian Git: installed, not enabled/);
});

test('--check: a settings file that cannot be read is reported and left alone', async (t) => {
  const vault = world(t, { ...ENABLED, [`${PLUGIN}/data.json`]: '{ not json' });
  const h = hooks(vault);
  assert.equal(await main(['--check'], h), 1);
  assert.match(h.text(), /data\.json cannot be read/);
  assert.equal(readFileSync(dataOf(vault), 'utf8'), '{ not json');
});

// ---- --apply on a fresh vault ----

test('--apply: installs without enabling, writes the settings, then enables, in that order', async (t) => {
  const vault = world(t);
  const h = hooks(vault);
  assert.equal(await main(['--apply'], h), 0, h.text());
  const order = h.sent().filter((c) => c.startsWith('plugin:'));
  assert.deepEqual(order, ['plugin:install', 'plugin:enable']);
  const install = h.calls.find((c) => c.args[0] === 'plugin:install');
  assert.deepEqual(install.args, ['plugin:install', 'id=obsidian-git'], 'never with enable, so the first load sees the settings');
  assert.equal(install.dataWas, null, 'no settings before the install');
  const enable = h.calls.find((c) => c.args[0] === 'plugin:enable');
  assert.deepEqual(enable.args, ['plugin:enable', 'id=obsidian-git']);
  assert.deepEqual(JSON.parse(enable.dataWas), REQUIRED_SETTINGS, 'the settings are there when the plugin first loads');
  assert.deepEqual(JSON.parse(readFileSync(dataOf(vault), 'utf8')), REQUIRED_SETTINGS);
  assert.match(h.text(), /Obsidian Git: installed and enabled/);
  assert.match(h.text(), /met: autoSaveInterval = 10/);
});

test('--apply: the settings are exactly the required ones, which match the decision', () => {
  assert.deepEqual(REQUIRED_SETTINGS, { autoSaveInterval: 10, syncMethod: 'rebase', mergeStrategy: 'theirs', autoPullOnBoot: true, autoPushInterval: 0, autoPullInterval: 0 });
});

test('--apply: gives the download longer than a plain read gets', async (t) => {
  const h = hooks(world(t));
  await main(['--apply'], h);
  assert.ok(h.calls.find((c) => c.args[0] === 'plugin:install').options.timeout > 30_000);
});

test('--apply: waits for the enabled state to reach the disk, since the app saves it a moment later', async (t) => {
  const vault = world(t);
  let waits = 0;
  const h = hooks(vault, { 'plugin:enable': () => 'Enabled: obsidian-git' });
  h.delay = async () => {
    if (++waits === 3) {
      mkdirSync(join(vault.path, '.obsidian'), { recursive: true });
      writeFileSync(join(vault.path, '.obsidian/community-plugins.json'), JSON.stringify(['obsidian-git']));
    }
  };
  assert.equal(await main(['--apply'], h), 0, h.text());
  assert.equal(waits, 3);
});

test('--apply: what the plugin writes on first load is what gets reported', async (t) => {
  const vault = world(t);
  const h = hooks(vault, {
    'plugin:enable': () => {
      mkdirSync(join(vault.path, '.obsidian'), { recursive: true });
      writeFileSync(join(vault.path, '.obsidian/community-plugins.json'), JSON.stringify(['obsidian-git']));
      writeFileSync(dataOf(vault), JSON.stringify({ ...REQUIRED_SETTINGS, autoSaveInterval: 0 }));
      return 'Enabled: obsidian-git';
    },
  });
  assert.equal(await main(['--apply'], h), 1, 'a first load that dropped the timer is not success');
  assert.match(h.text(), /differs: autoSaveInterval is 0, required 10/);
});

// ---- --apply never overwrites ----

test('--apply: an existing settings file stays byte-identical and its differences are reported', async (t) => {
  const bytes = '{\r\n  "autoSaveInterval": 5,\r\n  "mergeStrategy": "none",\r\n  "extra": [1, 2]\r\n}\r\n';
  const vault = world(t, { ...INSTALLED, [`${PLUGIN}/data.json`]: bytes });
  const h = hooks(vault);
  assert.equal(await main(['--apply'], h), 1, 'installed and enabled, but the settings differ');
  assert.deepEqual(h.sent().filter((c) => c.startsWith('plugin:')), ['plugin:enable']);
  assert.equal(readFileSync(dataOf(vault), 'latin1'), bytes);
  assert.match(h.text(), /differs: autoSaveInterval is 5, required 10/);
  assert.match(h.text(), /differs: mergeStrategy is "none", required "theirs"/);
  assert.match(h.text(), /missing: syncMethod, required "rebase"/);
  assert.match(h.text(), /never overwrites/);
});

test('--apply: a file that cannot be read is kept too', async (t) => {
  const vault = world(t, { ...ENABLED, [`${PLUGIN}/data.json`]: '{ not json' });
  const h = hooks(vault);
  assert.equal(await main(['--apply'], h), 1);
  assert.equal(readFileSync(dataOf(vault), 'utf8'), '{ not json');
  assert.deepEqual(h.calls, [], 'nothing left to do through the CLI');
});

test('--apply: a settings file that appears during the install is kept, not replaced', async (t) => {
  const vault = world(t);
  const h = hooks(vault, {
    'plugin:install': () => {
      mkdirSync(join(vault.path, PLUGIN), { recursive: true });
      writeFileSync(join(vault.path, PLUGIN, 'manifest.json'), JSON.stringify({ id: 'obsidian-git' }));
      writeFileSync(dataOf(vault), '{"autoSaveInterval":3}');
      return 'Installed: obsidian-git v2.39.0';
    },
  });
  assert.equal(await main(['--apply'], h), 1);
  assert.equal(readFileSync(dataOf(vault), 'utf8'), '{"autoSaveInterval":3}');
});

// ---- --apply when part of the work is already done ----

test('--apply: with everything in place it asks the app nothing and reports it', async (t) => {
  const vault = world(t, { ...ENABLED, [`${PLUGIN}/data.json`]: MET });
  const h = hooks(vault);
  assert.equal(await main(['--apply'], h), 0, h.text());
  assert.deepEqual(h.calls, []);
});

test('--apply: an installed plugin is not installed again', async (t) => {
  const vault = world(t, INSTALLED);
  const h = hooks(vault);
  assert.equal(await main(['--apply'], h), 0, h.text());
  assert.deepEqual(h.sent().filter((c) => c.startsWith('plugin:')), ['plugin:enable']);
  assert.deepEqual(JSON.parse(readFileSync(dataOf(vault), 'utf8')), REQUIRED_SETTINGS);
});

test('--apply: a plugin already running without settings is reloaded, since it read none when it started', async (t) => {
  const vault = world(t, ENABLED);
  const h = hooks(vault);
  assert.equal(await main(['--apply'], h), 0, h.text());
  assert.deepEqual(h.sent().filter((c) => c.startsWith('plugin:')), ['plugin:reload']);
  assert.deepEqual(JSON.parse(h.calls.find((c) => c.args[0] === 'plugin:reload').dataWas), REQUIRED_SETTINGS);
});

test('--apply: listed as enabled but missing from disk is installed and reloaded, because enabling would refuse', async (t) => {
  const vault = world(t, { '.obsidian/community-plugins.json': JSON.stringify(['obsidian-git']) });
  const h = hooks(vault);
  assert.equal(await main(['--apply'], h), 0, h.text());
  assert.deepEqual(h.sent().filter((c) => c.startsWith('plugin:')), ['plugin:install', 'plugin:reload']);
});

// ---- blocks: each stops, writes nothing it should not, and gives the manual steps ----

function assertManualSteps(text) {
  assert.match(text, /Manual steps/);
  assert.match(text, /Restricted mode/);
  assert.match(text, /obsidian-git/);
  assert.match(text, /autoSaveInterval: 10/);
  assert.match(text, /mergeStrategy: theirs/);
}

async function blocked(t, app, pattern) {
  const vault = world(t);
  const before = snapshot(vault.path);
  const h = hooks(vault, app);
  assert.equal(await main(['--apply'], h), 1);
  assert.match(h.text(), pattern);
  assertManualSteps(h.text());
  assert.deepEqual(h.sent().filter((c) => c === 'plugin:enable'), []);
  assert.deepEqual(snapshot(vault.path), before, 'nothing written');
  return h;
}

async function blockedBeforeInstall(t, app, pattern) {
  const h = await blocked(t, app, pattern);
  assert.deepEqual(h.sent().filter((c) => c === 'plugin:install'), []);
  return h;
}

test('--apply: restricted mode is reported and left on', async (t) => {
  const h = await blockedBeforeInstall(t, { 'plugins:restrict': () => 'on' }, /[Rr]estricted mode is on/);
  assert.deepEqual(h.calls.find((c) => c.args[0] === 'plugins:restrict').args, ['plugins:restrict'], 'asked, never switched');
});

test('--apply: the app not knowing the vault stops it, although the CLI exits 0 for that', async (t) => {
  await blockedBeforeInstall(t, { vault: () => 'Vault not found.' }, /has not opened this vault|not.*this vault/);
});

test('--apply: a same-named vault elsewhere is not touched', async (t) => {
  const h = await blockedBeforeInstall(t, { vault: () => join(tmpdir(), 'some-other-folder') }, /some-other-folder/);
  assert.deepEqual(h.sent(), ['vault']);
});

test('--apply: the CLI turned off stops it', async (t) => {
  await blockedBeforeInstall(t, { vault: () => 'Command line interface is not enabled. Please turn it on in Settings > General > Advanced.' }, /Command line interface is not enabled/);
});

test('--apply: the CLI failing, or its gate being busy, stops it', async (t) => {
  await blockedBeforeInstall(t, { vault: () => { throw Object.assign(new Error('CLI busy after waiting 10000ms; request not sent.'), { code: 'CLI_BUSY' }); } }, /CLI busy/);
});

test('--apply: Obsidian not running stops it before any CLI call, which could start the app', async (t) => {
  const h = await blockedBeforeInstall(t, { session: () => 'none' }, /Obsidian is not running/);
  assert.deepEqual(h.calls, []);
});

test('--apply: Obsidian in another session stops it before any CLI call', async (t) => {
  const h = await blockedBeforeInstall(t, { session: () => 'other-session' }, /another session/);
  assert.deepEqual(h.calls, []);
});

test('--apply: a failed process list stops it', async (t) => {
  await blockedBeforeInstall(t, { session: () => { throw new Error('tasklist failed'); } }, /tasklist failed/);
});

test('--apply: an install that reports an error stops before the settings and the enable', async (t) => {
  await blocked(t, { 'plugin:install': () => 'Error: Plugin "obsidian-git" version 2.39.0 is not permitted by your organization\'s policy.' }, /not permitted/);
});

test('--apply: an install that claims success with no plugin on disk stops', async (t) => {
  await blocked(t, { 'plugin:install': () => 'Installed: obsidian-git v2.39.0' }, /not.*on disk/i);
});

test('--apply: an install that times out says its outcome is unknown', async (t) => {
  await blocked(t, { 'plugin:install': () => { throw new Error('obsidian plugin:install timed out after 120000ms; command outcome may be unknown'); } }, /outcome may be unknown/);
});

test('--apply: an enable that reports an error keeps what was done and says so', async (t) => {
  const vault = world(t);
  const h = hooks(vault, { 'plugin:enable': () => 'Error: Failed to enable: obsidian-git' });
  assert.equal(await main(['--apply'], h), 1);
  assert.match(h.text(), /Failed to enable/);
  assertManualSteps(h.text());
  assert.ok(existsSync(dataOf(vault)), 'the settings stay, ready for the plugin\'s first load');
});

test('--apply: an enable that never reaches the disk is not reported as done', async (t) => {
  const vault = world(t);
  const h = hooks(vault, { 'plugin:enable': () => 'Enabled: obsidian-git' });
  assert.equal(await main(['--apply'], h), 1);
  assert.match(h.text(), /community-plugins\.json/);
  assert.doesNotMatch(h.text(), /installed and enabled/);
});

test('a settings file that cannot be written stops before the enable', async (t) => {
  const h = hooks(world(t));
  h.writeSettings = () => { throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }); };
  assert.equal(await main(['--apply'], h), 1);
  assert.match(h.text(), /EACCES/);
  assert.deepEqual(h.sent().filter((c) => c === 'plugin:enable'), []);
});

// ---- the command line ----

test('an unknown option, or both modes at once, exits 2 and does nothing', async (t) => {
  const vault = world(t);
  const before = snapshot(vault.path);
  for (const argv of [['--bogus'], ['--check', '--apply']]) {
    const h = hooks(vault);
    assert.equal(await main(argv, h), 2, argv.join(' '));
    assert.deepEqual(h.calls, []);
  }
  assert.deepEqual(snapshot(vault.path), before);
});

test('--help prints usage and touches nothing', (t) => {
  const vault = world(t);
  const before = snapshot(vault.path);
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8', env: { ...process.env, WIKI_MASTER_VAULT: vault.path } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /usage: node scripts\/setup-obsidian-git\.mjs \[--check \| --apply\]/);
  assert.deepEqual(snapshot(vault.path), before);
});

test('--check from the command line reads the vault it is given, and needs no app', (t) => {
  const vault = world(t, { ...ENABLED, [`${PLUGIN}/data.json`]: MET });
  const r = spawnSync(process.execPath, [SCRIPT, '--check'], { encoding: 'utf8', env: { ...process.env, WIKI_MASTER_VAULT: vault.path } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /met: autoSaveInterval = 10/);
  assert.ok(statSync(dataOf(vault)).isFile());
});

// ---- the wiki-setup skill ----

const SKILL_DIR = join(ROOT, 'skills', 'wiki-setup');
const SENTENCE = 'Obsidian Git handles all git operations.';
const reference = (name) => readFileSync(join(SKILL_DIR, 'references', name), 'utf8');
const skill = () => readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8');
const body = () => skill().replace(/^---\n[\s\S]*?\n---\n/, '');
const description = () => /^description: (.*)$/m.exec(skill())[1];

function atOrFail(text, pattern, from = 0) {
  const at = text.slice(from).search(pattern);
  assert.ok(at >= 0, `not found after ${from}: ${pattern}`);
  return at + from;
}

test('the standard sentence comes before the first workflow step', () => {
  const text = body();
  const sentence = text.indexOf(SENTENCE);
  assert.ok(sentence >= 0, 'the sentence is missing');
  assert.ok(sentence < atOrFail(text, /^\d+\. /m), 'before the first numbered step');
  assert.ok(sentence < atOrFail(text, /^## Workflow/m), 'before the workflow heading');
  assert.ok(sentence < atOrFail(text, /^## /m), 'before every section');
});

test('the offer follows the sentence, also before the first step, and existing settings are never overwritten', () => {
  const text = body();
  const firstStep = atOrFail(text, /^\d+\. /m);
  const intro = text.slice(text.indexOf(SENTENCE), firstStep);
  assert.match(intro, /offer to install, enable and configure/i);
  assert.match(intro, /setup-obsidian-git\.mjs/);
  assert.match(intro, /reported,?\s+never\s+overwritten/i);
});

test('the first-run order is the decided one, ending with the refresh', () => {
  const text = body();
  let at = atOrFail(text, /^## First run/m);
  const start = at;
  for (const step of [/prerequisite/i, /init\.mjs/, /git repository and upstream/i, /[Oo]pen the vault in Obsidian/, /setup-obsidian-git\.mjs/, /refresh-index\.mjs/]) at = atOrFail(text, step, at);
  assert.match(text.slice(start), /does not create|creates? no/i);
});

function assertDeclinedPath(text, where) {
  const section = text.slice(atOrFail(text, /declines?\b/i));
  assert.match(section, /read\s+and\s+search/i, where);
  assert.match(section, /authoring\s+cannot\s+complete/i, where);
  assert.match(section, /rerun\s+setup\s+later/i, where);
  assert.match(section, /`refresh-index\.mjs`\s+is\s+not\s+run/i, where);
}

test('initialization names the declined path, and so does the skill', () => {
  assertDeclinedPath(reference('initialization.md'), 'initialization.md');
  assertDeclinedPath(body(), 'SKILL.md');
});

test('initialization still creates no repository, and ends with the refresh', () => {
  const text = reference('initialization.md');
  assert.match(text, /[Nn]ever\s+initialize a guessed directory or create a Git repository/);
  assert.match(text, /[Oo]wner sets up the git repository and upstream/i);
  const steps = [...text.matchAll(/^\d+\. .*$/gm)].map((m) => m[0]);
  assert.match(steps.at(-1), /refresh-index\.mjs/);
});

test('the description still fires for setup and for a genuine setup failure, without operations', () => {
  const text = description();
  assert.ok(text.length <= 1024, `${text.length} characters`);
  for (const trigger of [/initialize a wiki vault/, /Obsidian Git/, /check prerequisites/, /recover/i, /setup/i, /not refreshed/, /conflict-files-obsidian-git\.md/, /search\/index\/app access failures/]) assert.match(text, trigger);
  assert.doesNotMatch(text, /operation/i);
  assert.match(text, /read-only/);
});

test('recovery is about what is written but not refreshed, Obsidian Git errors and its conflict file', () => {
  const text = reference('operation-recovery.md');
  assert.doesNotMatch(text.split('\n')[0], /operation/i, 'the title is renamed; the file name stays for its links');
  assert.match(text, /^## Written but not refreshed/m);
  assert.match(text, /^## Obsidian Git reports an error/m);
  assert.match(text, /^## `conflict-files-obsidian-git\.md`/m);
  assert.match(text, /^## Interrupted purge/m, 'other skills link this anchor');
  assert.match(text, /tell the owner/i);
  assert.doesNotMatch(text, /\bfetch\b/);
  assert.doesNotMatch(text, /\block\b/i, 'no lock language of any kind');
});

test('a refresh stopped by another active vault is explained where an agent looks', () => {
  for (const text of [reference('operation-recovery.md'), reference('app-access.md')]) {
    assert.match(text, /active vault/);
    assert.match(text, /no `vault=`/);
  }
});

test('search diagnostics name the refresh, not the commands it replaced', () => {
  const text = reference('search-diagnostics.md');
  assert.match(text, /refresh-index\.mjs/);
  assert.match(text, /refresh-index\.mjs --rebuild/);
});

test('validation describes the hand-written path list that stays', () => {
  const text = reference('validation.md');
  assert.match(text, /--paths-file/);
  assert.match(text, /JSON array/);
  assert.match(text, /by hand/);
});

const OWNED = () => [
  ...readdirSync(join(SKILL_DIR, 'references')).map((name) => [`references/${name}`, reference(name)]),
  ['SKILL.md', skill()],
  ['vault-schema.md', readFileSync(join(ROOT, 'templates', 'vault-schema.md'), 'utf8')],
  ['init.mjs', readFileSync(join(ROOT, 'scripts', 'init.mjs'), 'utf8')],
  ['doctor-table.mjs', readFileSync(join(ROOT, 'scripts', 'lib', 'doctor-table.mjs'), 'utf8')],
  ['setup-obsidian-git.mjs', readFileSync(SCRIPT, 'utf8')],
];

// A paired run of the old and new skill found these. Each left a first-time agent guessing.
test('a decline given up front is covered, and says what search still does', () => {
  for (const text of [body(), reference('initialization.md')]) {
    assert.match(text, /up\s+front/);
    assert.match(text, /keyword/i);
  }
});

test('the step that ends a content change does not contradict the declined path', () => {
  const stepFour = body().slice(atOrFail(body(), /^4\. Before an authorized change/m), atOrFail(body(), /^## First run/m));
  assert.match(stepFour, /refresh-index\.mjs/);
  assert.match(stepFour, /declined/);
});

test('initialization says how to name the vault to act on', () => {
  assert.match(reference('initialization.md'), /WIKI_MASTER_VAULT/);
});

test('an owner told about a conflict file is told how it gets finished, and an agent still does not pick a side', () => {
  const text = reference('operation-recovery.md');
  const section = text.slice(atOrFail(text, /^## `conflict-files-obsidian-git\.md`/m), atOrFail(text, /^## Interrupted write/m));
  assert.match(section, /source control view/);
  assert.match(section, /which\s+side\s+wins/);
  assert.match(text.slice(atOrFail(text, /\*\*Done only when\*\*/)), /once nothing blocks|when nothing blocks/i);
});

test('every setup file reads as the new contract', () => {
  for (const [name, text] of OWNED()) {
    assert.doesNotMatch(text, /no operation|owner's operation|owned transaction|operation state|the operation\b|an operation\b|completes? the operation/i, name);
  }
});

test('every relative link in the setup skill reaches a file, and links inside it reach a heading', () => {
  const slug = (heading) => heading.toLowerCase().replace(/[`*]/g, '').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
  const files = [['SKILL.md', SKILL_DIR], ...readdirSync(join(SKILL_DIR, 'references')).map((name) => [join('references', name), join(SKILL_DIR, 'references')])];
  for (const [name, dir] of files) {
    const text = readFileSync(join(SKILL_DIR, name), 'utf8').replace(/```[\s\S]*?```/g, '');
    for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^https?:/.test(target)) continue;
      const [file, anchor] = target.split('#');
      const full = file ? join(dir, file) : join(SKILL_DIR, name);
      assert.ok(existsSync(full), `${name}: ${target}`);
      if (anchor && full.startsWith(SKILL_DIR)) {
        const headings = [...readFileSync(full, 'utf8').matchAll(/^#+ (.*)$/gm)].map((m) => slug(m[1]));
        assert.ok(headings.includes(anchor), `${name}: no heading for ${target}`);
      }
    }
  }
});
