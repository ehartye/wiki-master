import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkPrerequisites, gitState, obsidianSession, parseTasklist } from '../scripts/lib/prerequisites.mjs';
import { obsidianGitPrerequisite } from '../scripts/lib/obsidian-git.mjs';

// ---- the Windows process list, from canned output ----

const OBSIDIAN_CONSOLE = '"Obsidian.exe","25320","Console","1","89,368 K"\r\n"Obsidian.exe","25400","Console","1","120,004 K"\r\n';
const NOTHING = 'INFO: No tasks are running which match the specified criteria.\r\n';

test('parseTasklist reads CSV rows, keeps a comma inside a quoted field, and ignores the line tasklist prints for no match', () => {
  assert.deepEqual(parseTasklist(OBSIDIAN_CONSOLE)[0], { image: 'Obsidian.exe', pid: 25320, sessionName: 'Console', session: '1' });
  assert.equal(parseTasklist(OBSIDIAN_CONSOLE).length, 2);
  assert.deepEqual(parseTasklist(NOTHING), []);
  assert.deepEqual(parseTasklist('INFORMATION: Es werden keine Aufgaben ausgeführt.\r\n'), [], 'that line is translated on other systems');
  assert.deepEqual(parseTasklist(''), []);
});

function windows(answers) {
  const calls = [];
  const exec = (command, args) => {
    calls.push([command, ...args]);
    const filter = args.join(' ');
    if (filter.includes('IMAGENAME')) return answers.obsidian;
    if (filter.includes('PID eq')) return answers.own;
    throw new Error(`unexpected command: ${filter}`);
  };
  return { calls, probe: () => obsidianSession({ platform: 'win32', username: 'someone', pid: 4242, exec }) };
}

test('Windows: the two commands filter by bare user name and by this process, with no shell string', () => {
  const { calls, probe } = windows({ obsidian: OBSIDIAN_CONSOLE, own: '"node.exe","4242","Console","1","50,000 K"\r\n' });
  probe();
  assert.deepEqual(calls, [
    ['tasklist', '/FO', 'CSV', '/NH', '/FI', 'IMAGENAME eq Obsidian.exe', '/FI', 'USERNAME eq someone'],
    ['tasklist', '/FO', 'CSV', '/NH', '/FI', 'PID eq 4242'],
  ]);
});

test('Windows: Obsidian in the same session number is this session', () => {
  const { probe } = windows({ obsidian: OBSIDIAN_CONSOLE, own: '"node.exe","4242","Console","1","50,000 K"\r\n' });
  assert.equal(probe(), 'this-session');
});

test('Windows: Obsidian only in another session is another session (an SSH shell in session 0)', () => {
  const { probe } = windows({ obsidian: OBSIDIAN_CONSOLE, own: '"node.exe","4242","Services","0","50,000 K"\r\n' });
  assert.equal(probe(), 'other-session');
});

test('Windows: Obsidian in both this session and another counts as this session', () => {
  const both = `${OBSIDIAN_CONSOLE}"Obsidian.exe","31000","RDP-Tcp#3","2","80,000 K"\r\n`;
  const { probe } = windows({ obsidian: both, own: '"node.exe","4242","RDP-Tcp#3","2","50,000 K"\r\n' });
  assert.equal(probe(), 'this-session');
});

test('Windows: no matching process is none, and the second command is not run', () => {
  const { calls, probe } = windows({ obsidian: NOTHING, own: 'never asked' });
  assert.equal(probe(), 'none');
  assert.equal(calls.length, 1);
});

test('Windows: a process list that lacks this very process is an error, not a guess', () => {
  const { probe } = windows({ obsidian: OBSIDIAN_CONSOLE, own: NOTHING });
  assert.throws(probe, /4242/);
});

// ---- the POSIX process list ----

function posix(output, uid = 501) {
  const calls = [];
  return { calls, probe: () => obsidianSession({ platform: 'darwin', uid, exec: (command, args) => { calls.push([command, ...args]); return output; } }) };
}

test('POSIX: any Obsidian process of this user counts as this session, whatever else is running', () => {
  const { calls, probe } = posix('  501 /Applications/Obsidian.app/Contents/MacOS/Obsidian\n  501 /Applications/Obsidian.app/Contents/Frameworks/Obsidian Helper (GPU).app/Contents/MacOS/Obsidian Helper (GPU)\n    0 /sbin/launchd\n');
  assert.equal(probe(), 'this-session');
  assert.deepEqual(calls, [['/bin/ps', '-eo', 'uid=,comm=']]);
  assert.equal(posix('1000 obsidian\n', 1000).probe(), 'this-session', 'Linux prints the bare name');
});

test('POSIX: another user\'s Obsidian and programs that only resemble it do not count', () => {
  assert.equal(posix('  502 /Applications/Obsidian.app/Contents/MacOS/Obsidian\n').probe(), 'none');
  assert.equal(posix('  501 /usr/bin/obsidian-sync\n  501 vim\n  501 /opt/not-obsidian\n').probe(), 'none');
  assert.equal(posix('').probe(), 'none');
});

// ---- Obsidian Git's settings ----

function vault(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-prereq-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.obsidian', 'plugins', 'obsidian-git'), { recursive: true });
  return root;
}
const setGit = (root, { enabled = ['obsidian-git'], manifest = { id: 'obsidian-git' }, data = { autoSaveInterval: 10 } } = {}) => {
  const plugin = join(root, '.obsidian', 'plugins', 'obsidian-git');
  if (enabled !== null) writeFileSync(join(root, '.obsidian', 'community-plugins.json'), JSON.stringify(enabled));
  if (manifest !== null) writeFileSync(join(plugin, 'manifest.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
  if (data !== null) writeFileSync(join(plugin, 'data.json'), typeof data === 'string' ? data : JSON.stringify(data));
  return root;
};

test('obsidianGitPrerequisite: met when installed, enabled and the timer is above 0', (t) => {
  const r = obsidianGitPrerequisite(setGit(vault(t)));
  assert.equal(r.met, true);
  assert.equal(r.installed, true);
  assert.equal(r.enabled, true);
  assert.equal(r.autoSaveInterval, 10);
});

test('obsidianGitPrerequisite: each way of falling short', (t) => {
  assert.equal(obsidianGitPrerequisite(setGit(vault(t), { enabled: null })).enabled, false, 'no community-plugins.json');
  assert.equal(obsidianGitPrerequisite(setGit(vault(t), { enabled: ['other'] })).enabled, false);
  assert.equal(obsidianGitPrerequisite(setGit(vault(t), { manifest: null })).installed, false);
  assert.equal(obsidianGitPrerequisite(setGit(vault(t), { manifest: 'not json' })).installed, false);
  const zero = obsidianGitPrerequisite(setGit(vault(t), { data: { autoSaveInterval: 0 } }));
  assert.equal(zero.met, false);
  assert.equal(zero.autoSaveInterval, 0);
  assert.equal(obsidianGitPrerequisite(setGit(vault(t), { data: { autoSaveInterval: '10' } })).met, false, 'the plugin needs a number');
  assert.equal(obsidianGitPrerequisite(setGit(vault(t), { data: null })).settings, 'absent');
  const garbled = obsidianGitPrerequisite(setGit(vault(t), { data: '{ nope' }));
  assert.equal(garbled.settings, 'unreadable');
  assert.equal(garbled.met, false);
});

// ---- git ----

const run = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

test('gitState reads a real repository: none, no upstream, an upstream, and a vault in a subfolder of one', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'wm-prereq-git-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const plain = join(root, 'plain');
  mkdirSync(plain);
  const none = gitState(plain);
  assert.equal(none.repo, false);
  assert.ok(none.detail, 'git\'s own words explain it');

  run(root, 'init', '--bare', 'origin.git');
  run(root, 'clone', 'origin.git', 'work');
  const work = join(root, 'work');
  assert.deepEqual({ repo: gitState(work).repo, upstream: gitState(work).upstream }, { repo: true, upstream: false }, 'nothing to track yet');
  run(work, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '--allow-empty', '-m', 'first');
  run(work, 'push', '-u', 'origin', 'HEAD');
  assert.deepEqual({ repo: gitState(work).repo, upstream: gitState(work).upstream }, { repo: true, upstream: true });

  const inner = join(work, 'notes', 'vault');
  mkdirSync(inner, { recursive: true });
  assert.deepEqual({ repo: gitState(inner).repo, upstream: gitState(inner).upstream }, { repo: true, upstream: true }, 'Obsidian Git supports a vault in a repository subfolder');
  assert.equal(gitState(join(work, '.git')).repo, false, 'inside the repository\'s own metadata there is no work tree');
});

test('a vault in a repository subfolder passes every git check, with the real probe', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'wm-prereq-sub-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  run(root, 'init', '--bare', 'origin.git');
  run(root, 'clone', 'origin.git', 'work');
  const work = join(root, 'work');
  run(work, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '--allow-empty', '-m', 'first');
  run(work, 'push', '-u', 'origin', 'HEAD');
  const inner = join(work, 'notes', 'vault');
  mkdirSync(join(inner, '.obsidian', 'plugins', 'obsidian-git'), { recursive: true });
  setGit(inner);
  const r = await checkPrerequisites({ vault: { path: inner, name: 'fixture' }, probes: {
    ollamaUp: async () => true, modelPulled: async () => true, session: () => 'other-session',
  } });
  assert.deepEqual(r.failures, []);
});

// A repository whose current branch has an upstream and conflicts with `side`.
function conflicted(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-prereq-stop-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  run(root, 'init', '--bare', 'origin.git');
  run(root, 'clone', 'origin.git', 'work');
  const work = join(root, 'work');
  const git = (...args) => run(work, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args);
  const save = (text) => { writeFileSync(join(work, 'f.txt'), text); git('add', 'f.txt'); git('commit', '-m', text); };
  save('base\n');
  git('push', '-u', 'origin', 'HEAD');
  const main = git('rev-parse', '--abbrev-ref', 'HEAD').trim();
  git('checkout', '-b', 'side');
  save('side\n');
  git('checkout', main);
  save('main\n');
  const stops = (...args) => assert.throws(() => git(...args), undefined, `git ${args[0]} should stop on the conflict`);
  return { work, git, stops };
}
const shape = ({ repo, upstream, inProgress, detached }) => ({ repo, upstream, inProgress, detached });

test('gitState: a clean branch with an upstream has nothing in progress and is not detached', (t) => {
  const { work } = conflicted(t);
  assert.deepEqual(shape(gitState(work)), { repo: true, upstream: true, inProgress: null, detached: false });
});

test('gitState names a stopped rebase, and does not call its detached HEAD a missing upstream', (t) => {
  const { work, stops } = conflicted(t);
  stops('rebase', 'side');
  assert.equal(gitState(work).inProgress, 'rebase');
  const inner = join(work, 'sub');
  mkdirSync(inner);
  assert.equal(gitState(inner).inProgress, 'rebase', 'also from a vault in a subfolder of the repository');
});

test('gitState names a stopped merge', (t) => {
  const { work, stops } = conflicted(t);
  stops('merge', 'side');
  assert.equal(gitState(work).inProgress, 'merge');
});

test('gitState names a stopped cherry-pick', (t) => {
  const { work, stops } = conflicted(t);
  stops('cherry-pick', 'side');
  assert.equal(gitState(work).inProgress, 'cherry-pick');
});

test('gitState names a detached HEAD', (t) => {
  const { work, git } = conflicted(t);
  git('checkout', '--detach');
  assert.deepEqual(shape(gitState(work)), { repo: true, upstream: false, inProgress: null, detached: true });
});

test('gitState asks git only through rev-parse', (t) => {
  const { work } = conflicted(t);
  const commands = [];
  gitState(work, { exec: (command, args) => { commands.push([command, args[2]]); return run(work, ...args.slice(2)); } });
  assert.ok(commands.length > 0);
  for (const [command, sub] of commands) assert.deepEqual([command, sub], ['git', 'rev-parse']);
});

// ---- all of them ----

// Healthy probes on a healthy fixture, with one override per test. `cli` records its calls.
function world(t, overrides = {}) {
  const root = setGit(vault(t));
  const cliCalls = [];
  const probes = {
    model: 'test-embedder',
    host: 'http://ollama.test:11434',
    ollamaUp: async () => true,
    modelPulled: async () => true,
    session: () => 'this-session',
    cli: (args) => { cliCalls.push(args); return root; },
    git: () => ({ repo: true, upstream: true }),
    ...overrides,
  };
  return { root, cliCalls, check: () => checkPrerequisites({ vault: { path: root, name: 'fixture' }, probes }) };
}
const ids = (r) => r.failures.map((f) => f.id);

test('everything healthy passes with no failure, no note, and one CLI call for the vault path', async (t) => {
  const { check, cliCalls } = world(t);
  const r = await check();
  assert.equal(r.ok, true);
  assert.deepEqual(r.failures, []);
  assert.deepEqual(r.notes, []);
  assert.deepEqual(cliCalls, [['vault', 'info=path']]);
});

test('Ollama down names the host and offers to start it, without asking about the model', async (t) => {
  let asked = false;
  const { check } = world(t, { ollamaUp: async () => false, modelPulled: async () => { asked = true; return false; } });
  const r = await check();
  assert.deepEqual(ids(r), ['ollama']);
  assert.equal(asked, false);
  assert.match(r.failures[0].problem, /ollama\.test:11434/);
  assert.match(r.failures[0].fix, /start Ollama/i);
});

test('a missing model names the configured model and offers to pull it', async (t) => {
  const r = await world(t, { modelPulled: async () => false }).check();
  assert.deepEqual(ids(r), ['ollama-model']);
  assert.match(r.failures[0].problem, /test-embedder/);
  assert.match(r.failures[0].fix, /ollama pull test-embedder/);
});

test('no Obsidian process fails, offers to start it, and never calls the CLI', async (t) => {
  const { check, cliCalls } = world(t, { session: () => 'none' });
  const r = await check();
  assert.deepEqual(ids(r), ['obsidian']);
  assert.match(r.failures[0].fix, /start Obsidian/i);
  assert.deepEqual(cliCalls, []);
});

test('Obsidian only in another session passes with a note and never calls the CLI', async (t) => {
  const { check, cliCalls } = world(t, { session: () => 'other-session' });
  const r = await check();
  assert.equal(r.ok, true);
  assert.deepEqual(cliCalls, []);
  assert.equal(r.notes.length, 1);
  assert.match(r.notes[0], /another session/i);
});

test('a process list that cannot be read fails and never calls the CLI', async (t) => {
  const { check, cliCalls } = world(t, { session: () => { throw new Error('tasklist blew up'); } });
  const r = await check();
  assert.deepEqual(ids(r), ['obsidian-processes']);
  assert.match(r.failures[0].problem, /tasklist blew up/);
  assert.deepEqual(cliCalls, []);
});

for (const code of ['CLI_BUSY', 'CLI_LOCK']) {
  test(`${code} is a failure that says the gate is busy or failing, to rerun, and that a repeat means the CLI is down`, async (t) => {
    const r = await world(t, { cli: () => { throw Object.assign(new Error('gate'), { code }); } }).check();
    assert.deepEqual(ids(r), ['obsidian-cli-gate']);
    assert.match(r.failures[0].problem, /gate is busy or failing/i);
    assert.match(r.failures[0].fix, /rerun/i);
    assert.match(r.failures[0].fix, /repeat.*CLI.*down/i);
  });
}

test('any other CLI failure, or a wrong or empty vault path, is a failure', async (t) => {
  const failed = await world(t, { cli: () => { throw new Error('no such command'); } }).check();
  assert.deepEqual(ids(failed), ['obsidian-cli']);
  assert.match(failed.failures[0].problem, /no such command/);
  const wrong = await world(t, { cli: () => join(tmpdir(), 'some-other-vault') }).check();
  assert.deepEqual(ids(wrong), ['obsidian-vault']);
  assert.match(wrong.failures[0].fix, /open this vault/i);
  assert.deepEqual(ids(await world(t, { cli: () => '' }).check()), ['obsidian-vault']);
});

test('a differently spelled path to the same vault folder is the same vault', async (t) => {
  const { root } = world(t);
  const r = await checkPrerequisites({ vault: { path: root, name: 'fixture' }, probes: {
    ollamaUp: async () => true, modelPulled: async () => true, session: () => 'this-session',
    git: () => ({ repo: true, upstream: true }), cli: () => `${root}/`,
  } });
  assert.deepEqual(r.failures, []);
});

test('Obsidian Git not installed or not enabled offers the install through setup', async (t) => {
  const { root, check } = world(t);
  writeFileSync(join(root, '.obsidian', 'community-plugins.json'), '[]');
  const r = await check();
  assert.deepEqual(ids(r), ['obsidian-git']);
  assert.match(r.failures[0].fix, /wiki-setup/);
});

test('autoSaveInterval at 0 or missing offers a change in the plugin\'s settings, because setup never overwrites', async (t) => {
  const { root, check } = world(t);
  const data = join(root, '.obsidian', 'plugins', 'obsidian-git', 'data.json');
  writeFileSync(data, JSON.stringify({ autoSaveInterval: 0 }));
  const r = await check();
  assert.deepEqual(ids(r), ['obsidian-git-timer']);
  assert.match(r.failures[0].problem, /autoSaveInterval/);
  assert.match(r.failures[0].fix, /Obsidian Git's settings/);
  writeFileSync(data, JSON.stringify({}));
  assert.deepEqual(ids(await check()), ['obsidian-git-timer']);
  writeFileSync(data, '{ nope');
  assert.deepEqual(ids(await check()), ['obsidian-git-timer']);
  rmSync(data);
  assert.deepEqual(ids(await check()), ['obsidian-git-timer'], 'an installed plugin with no settings has its timer off');
});

test('a vault with no plugin folder is one failure: setup writes the settings when it installs', async (t) => {
  const { root, check } = world(t);
  rmSync(join(root, '.obsidian'), { recursive: true, force: true });
  assert.deepEqual(ids(await check()), ['obsidian-git']);
});

test('no repository and no upstream are reported apart, and the owner sets them up', async (t) => {
  const none = await world(t, { git: () => ({ repo: false, upstream: false, detail: 'fatal: not a git repository' }) }).check();
  assert.deepEqual(ids(none), ['git-repository']);
  assert.match(none.failures[0].problem, /not a git repository/);
  assert.match(none.failures[0].fix, /owner/);
  const lonely = await world(t, { git: () => ({ repo: true, upstream: false }) }).check();
  assert.deepEqual(ids(lonely), ['git-upstream']);
  assert.match(lonely.failures[0].fix, /owner/);
});

test('a rebase or merge in progress is its own failure: it may pass, so rerun shortly, and tell the owner if it stays', async (t) => {
  for (const inProgress of ['rebase', 'merge']) {
    const r = await world(t, { git: () => ({ repo: true, upstream: false, inProgress, detached: true }) }).check();
    assert.deepEqual(ids(r), ['git-in-progress']);
    assert.match(r.failures[0].problem, new RegExp(inProgress));
    assert.match(r.failures[0].problem, /Obsidian Git may be/);
    assert.match(r.failures[0].fix, /rerun shortly/i);
    assert.match(r.failures[0].fix, /tell the owner/i);
    assert.match(r.failures[0].fix, /conflict-files-obsidian-git\.md/);
    assert.doesNotMatch(`${r.failures[0].problem} ${r.failures[0].fix}`, /upstream/);
  }
});

test('a detached HEAD names itself and does not mention an upstream', async (t) => {
  const r = await world(t, { git: () => ({ repo: true, upstream: false, inProgress: null, detached: true }) }).check();
  assert.deepEqual(ids(r), ['git-detached']);
  assert.match(r.failures[0].problem, /detached/i);
  assert.match(r.failures[0].fix, /owner/);
  assert.doesNotMatch(`${r.failures[0].problem} ${r.failures[0].fix}`, /upstream/);
});

test('with everything failing every failure is named at once, each with a fix to offer', async (t) => {
  const { root, check, cliCalls } = world(t, {
    ollamaUp: async () => false, session: () => 'none',
    git: () => ({ repo: false, upstream: false, detail: 'nope' }),
  });
  writeFileSync(join(root, '.obsidian', 'community-plugins.json'), '[]');
  writeFileSync(join(root, '.obsidian', 'plugins', 'obsidian-git', 'data.json'), JSON.stringify({ autoSaveInterval: 0 }));
  const r = await check();
  assert.equal(r.ok, false);
  assert.deepEqual(ids(r), ['ollama', 'obsidian', 'obsidian-git', 'obsidian-git-timer', 'git-repository']);
  for (const failure of r.failures) {
    assert.ok(failure.problem, failure.id);
    assert.ok(failure.fix, failure.id);
  }
  assert.deepEqual(cliCalls, []);
});

test('the git probe defaults to the real one', async (t) => {
  const root = setGit(vault(t));
  const r = await checkPrerequisites({ vault: { path: root, name: 'fixture' }, probes: { ollamaUp: async () => true, modelPulled: async () => true, session: () => 'none' } });
  assert.deepEqual(ids(r), ['obsidian', 'git-repository'], 'it ran git and found no repository at the temp folder');
});
