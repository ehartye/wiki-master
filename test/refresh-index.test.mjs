import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { main } from '../scripts/refresh-index.mjs';
import { LEGACY_BEGIN_MARKS, BEGIN_MARK, END_MARK } from '../scripts/lib/index-fence.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'refresh-index.mjs');
const page = (project, kind, extra = '') => `---\ntype: authored\ncreated: 2026-01-01\nupdated: 2026-01-01\nstatus: draft\nsources: []\nai-generated: true\nproject: ${project}\nkind: ${kind}\n${extra}---\n# ${project} ${kind}\n\nA paragraph about ${project} and its ${kind}.\n`;

const PAGES = {
  'wiki/concepts/idea.md': '---\ntype: concept\nsources: []\n---\n# Idea\n\nA concept page.\n',
  'wiki/authored/alpha/overview.md': page('alpha', 'overview'),
  'wiki/authored/alpha/guide.md': page('alpha', 'guide'),
  'wiki/authored/alpha/backlog/task.md': page('alpha', 'backlog-item', 'backlog-status: planned\n'),
  'wiki/authored/beta/overview.md': page('beta', 'overview'),
  'wiki/authored/beta/guide.md': page('beta', 'guide'),
  'wiki/authored/beta/backlog/chore.md': page('beta', 'backlog-item', 'backlog-status: planned\n'),
};

function vault(t, extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'wm-refresh-index-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = {
    ...PAGES,
    '.obsidian/community-plugins.json': JSON.stringify(['obsidian-git']),
    '.obsidian/plugins/obsidian-git/manifest.json': JSON.stringify({ id: 'obsidian-git' }),
    '.obsidian/plugins/obsidian-git/data.json': JSON.stringify({ autoSaveInterval: 10 }),
    ...extra,
  };
  for (const [path, text] of Object.entries(files)) {
    if (text === null) continue;
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

// Every folder and file in the vault, with modification times and file content: "writes nothing" means this does not
// change. A folder's own time also shows a temp file that was created and removed again.
function snapshot(root) {
  const out = {};
  (function walk(dir, rel) {
    for (const name of readdirSync(dir)) {
      if (name === '.git') continue;
      const abs = join(dir, name);
      const path = rel ? `${rel}/${name}` : name;
      if (statSync(abs).isDirectory()) {
        out[`${path}/`] = String(statSync(abs).mtimeMs);
        walk(abs, path);
      } else out[path] = `${statSync(abs).mtimeMs} ${createHash('sha1').update(readFileSync(abs)).digest('hex')}`;
    }
  })(root, '');
  return out;
}

test('the snapshot sees an empty folder', (t) => {
  const root = vault(t);
  const before = snapshot(root);
  mkdirSync(join(root, '.wiki-master'));
  assert.notDeepEqual(snapshot(root), before);
});

// Runs main in-process with healthy probes and no real app, server or model. Each test overrides what it fails.
async function run(root, argv = [], overrides = {}) {
  const lines = [];
  const cliCalls = [];
  const embedCalls = [];
  const probes = {
    model: 'test-embedder',
    host: 'http://ollama.test:11434',
    ollamaUp: async () => true,
    modelPulled: async () => true,
    session: () => 'this-session',
    cli: (args) => { cliCalls.push(args); return root; },
    git: () => ({ repo: true, upstream: true }),
    ...overrides.probes,
  };
  const embedFn = overrides.embedFn ?? (async (text) => { embedCalls.push(text); return [text.length, 1, 2, 3]; });
  const code = await main(argv, {
    vault: { path: root, name: 'fixture' }, probes, embedFn,
    out: (line) => lines.push(line), err: (line) => lines.push(line),
  });
  return { code, output: lines.join('\n'), cliCalls, embedCalls };
}

const INDEX_FILES = ['chunks.json', 'vectors.bin', 'vectors.idx.json'].map((name) => `.wiki-master/${name}`);
const read = (root, path) => readFileSync(join(root, path), 'utf8');
const begins = (text) => text.split('%% BEGIN GENERATED CATALOG').length - 1;

// ---- it succeeds ----

test('with healthy probes it exits 0 and updates a roadmap, a project map, index.md and the embedding files', async (t) => {
  const root = vault(t);
  const r = await run(root);
  assert.equal(r.code, 0, r.output);
  assert.match(read(root, 'wiki/authored/alpha/roadmap.md'), /backlog\/task|\[\[task/);
  assert.match(read(root, 'moc/alpha.md'), /guide/);
  assert.match(read(root, 'index.md'), /idea/);
  for (const path of INDEX_FILES) assert.ok(existsSync(join(root, path)), path);
  assert.ok(r.embedCalls.length > 0);
  assert.deepEqual(r.cliCalls, [['vault', 'info=path']]);
});

test('it always covers the whole vault', async (t) => {
  const root = vault(t);
  await run(root);
  for (const path of ['wiki/authored/alpha/roadmap.md', 'wiki/authored/beta/roadmap.md', 'moc/alpha.md', 'moc/beta.md']) {
    assert.ok(existsSync(join(root, path)), path);
  }
  assert.ok(read(root, 'index.md').includes(BEGIN_MARK));
});

test('catalogs run before embedding: the manifest holds each catalog at the time it was just written', async (t) => {
  const root = vault(t);
  await run(root);
  const manifest = JSON.parse(read(root, '.wiki-master/chunks.json'));
  for (const path of ['wiki/authored/alpha/roadmap.md', 'moc/alpha.md']) {
    assert.equal(manifest[path].mtimeMs, statSync(join(root, path)).mtimeMs, path);
  }
});

test('a second run rewrites no file and embeds nothing: every modification time is unchanged, embedding files included', async (t) => {
  const root = vault(t);
  assert.equal((await run(root)).code, 0);
  const before = snapshot(root);
  for (const path of INDEX_FILES) assert.ok(before[path], path);
  await delay(20);
  const again = await run(root);
  assert.equal(again.code, 0, again.output);
  assert.deepEqual(again.embedCalls, []);
  assert.deepEqual(snapshot(root), before);
});

test('a run right after an edit picks up the edit, and the run after that rewrites nothing', async (t) => {
  const root = vault(t);
  await run(root);
  writeFileSync(join(root, 'wiki/concepts/idea.md'), '---\ntype: concept\nsources: []\n---\n# Idea\n\nA changed concept page.\n');
  const edited = await run(root);
  assert.equal(edited.code, 0);
  assert.ok(edited.embedCalls.length > 0);
  const before = snapshot(root);
  await delay(20);
  await run(root);
  assert.deepEqual(snapshot(root), before);
});

test('--rebuild re-chunks every page, reuses vectors by chunk hash, and has nothing to save when nothing changed', async (t) => {
  const root = vault(t);
  await run(root);
  const before = snapshot(root);
  await delay(20);
  const r = await run(root, ['--rebuild']);
  assert.equal(r.code, 0);
  assert.deepEqual(r.embedCalls, []);
  assert.deepEqual(snapshot(root), before);
});

test('--rebuild distrusts modification times: only it notices an edit that kept the size and the time', async (t) => {
  const root = vault(t);
  const path = join(root, 'wiki/concepts/idea.md');
  const when = new Date('2021-03-04T05:06:07Z');
  utimesSync(path, when, when);
  await run(root);
  const hashOf = () => JSON.parse(read(root, '.wiki-master/chunks.json'))['wiki/concepts/idea.md'].contentHash;
  const original = hashOf();
  writeFileSync(path, read(root, 'wiki/concepts/idea.md').replace('A concept page.', 'A concept PAGE.'));
  utimesSync(path, when, when);

  const plain = await run(root);
  assert.equal(plain.code, 0);
  assert.deepEqual(plain.embedCalls, [], 'a plain run trusts the unchanged time and size');
  assert.equal(hashOf(), original);

  const rebuilt = await run(root, ['--rebuild']);
  assert.equal(rebuilt.code, 0, rebuilt.output);
  assert.equal(rebuilt.embedCalls.length, 1, 'only the changed chunk is embedded; the rest reuse their vectors');
  assert.match(rebuilt.embedCalls[0], /A concept PAGE\./);
  assert.notEqual(hashOf(), original);
  assert.match(rebuilt.output, /search index: saved/);
});

// A catalog created in a run can share its file name with a page, which makes that name ambiguous and changes the
// links of any catalog rendered before it existed. All of that has to settle in one run.
const item = (project) => page(project, 'backlog-item', 'backlog-status: planned\n');
for (const [label, files] of [
  ['a backlog item named after its project', { 'wiki/authored/alpha/backlog/alpha.md': item('alpha') }],
  ['a project page named after its project', { 'wiki/authored/beta/beta.md': page('beta', 'note') }],
  ['a backlog item named roadmap', { 'wiki/authored/gamma/backlog/roadmap.md': item('gamma'), 'wiki/authored/gamma/overview.md': page('gamma', 'overview') }],
  ['a page elsewhere named roadmap', { 'wiki/concepts/roadmap.md': '---\ntype: concept\nsources: []\n---\n# Roadmap\n\nA concept.\n' }],
  ['an item in one project named after another', { 'wiki/authored/alpha/backlog/beta.md': item('alpha') }],
]) {
  test(`${label}: the first run converges, so a second rewrites nothing`, async (t) => {
    const root = vault(t, files);
    assert.equal((await run(root)).code, 0);
    const before = snapshot(root);
    await delay(20);
    const again = await run(root);
    assert.equal(again.code, 0, again.output);
    assert.deepEqual(snapshot(root), before);
    assert.match(again.output, /catalogs: 0 file\(s\) changed/);
  });
}

test('a project added later settles in its own run too, including the older catalogs its name affects', async (t) => {
  const root = vault(t, { 'wiki/authored/alpha/backlog/delta.md': item('alpha') });
  await run(root);
  for (const name of ['overview', 'guide']) {
    const path = join(root, `wiki/authored/delta/${name}.md`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, page('delta', name));
  }
  await run(root);
  const before = snapshot(root);
  await delay(20);
  await run(root);
  assert.deepEqual(snapshot(root), before);
  assert.match(read(root, 'wiki/authored/alpha/roadmap.md'), /backlog\/delta\|delta/);
});

const framed = (begin) => `---\ntype: moc\n---\n# Hand-written\n\nAbove.\n\n${begin}\n- [[stale]]\n${END_MARK}\n\nBelow.\n`;

for (const [path, begin] of [
  ['index.md', LEGACY_BEGIN_MARKS[0]],
  ['wiki/authored/alpha/roadmap.md', LEGACY_BEGIN_MARKS[1]],
  ['moc/alpha.md', LEGACY_BEGIN_MARKS[2]],
]) {
  test(`${path} with its old marker ends with exactly one fence, the new one, with manual framing kept`, async (t) => {
    const root = vault(t, { [path]: framed(begin) });
    assert.equal((await run(root)).code, 0);
    const text = read(root, path);
    assert.equal(begins(text), 1, text);
    assert.ok(text.includes(BEGIN_MARK));
    assert.ok(!text.includes('[[stale]]'));
    assert.match(text, /# Hand-written\n\nAbove\.\n\n%% BEGIN/);
    assert.match(text, /%% END GENERATED CATALOG %%\n\nBelow\.\n$/);
  });
}

test('a page nobody has saved to the repository yet is listed: catalogs read the working tree', async (t) => {
  const root = vault(t);
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  git('init');
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-m', 'seed');
  const head = git('rev-parse', 'HEAD');
  writeFileSync(join(root, 'wiki/authored/alpha/pending.md'), page('alpha', 'guide'));
  assert.equal((await run(root)).code, 0);
  assert.match(read(root, 'moc/alpha.md'), /pending/);
  assert.equal(git('rev-parse', 'HEAD'), head, 'it does not touch history');
});

// ---- it fails hard, before any write ----

const TIMER_OFF = { '.obsidian/plugins/obsidian-git/data.json': JSON.stringify({ autoSaveInterval: 0 }) };
const NOT_ENABLED = { '.obsidian/community-plugins.json': '[]' };

const IN_TURN = [
  ['Ollama down', {}, { ollamaUp: async () => false }, /Ollama is not reachable/, /start Ollama/i],
  ['the model missing', {}, { modelPulled: async () => false }, /test-embedder is not pulled/, /ollama pull test-embedder/],
  ['Obsidian not running', {}, { session: () => 'none' }, /Obsidian is not running/, /start Obsidian/i],
  ['Obsidian Git not installed', { '.obsidian/plugins/obsidian-git/manifest.json': null }, {}, /Obsidian Git is not installed/, /wiki-setup/],
  ['Obsidian Git not enabled', NOT_ENABLED, {}, /Obsidian Git is not enabled/, /wiki-setup/],
  ['autoSaveInterval at 0', TIMER_OFF, {}, /autoSaveInterval is 0/, /Obsidian Git's settings/],
  ['no repository', {}, { git: () => ({ repo: false, upstream: false }) }, /not a git repository/, /owner/],
  ['no upstream', {}, { git: () => ({ repo: true, upstream: false }) }, /no upstream/, /owner/],
  ['a stopped rebase', {}, { git: () => ({ repo: true, upstream: false, inProgress: 'rebase', detached: true }) }, /rebase is in progress/, /conflict-files-obsidian-git\.md/],
  ['a detached HEAD', {}, { git: () => ({ repo: true, upstream: false, inProgress: null, detached: true }) }, /detached/i, /owner/],
];

for (const [label, files, probes, problem, fix] of IN_TURN) {
  test(`${label}: exits 1, names it, gives the fix to offer, and writes nothing`, async (t) => {
    const root = vault(t, files);
    const before = snapshot(root);
    const r = await run(root, [], { probes });
    assert.equal(r.code, 1, r.output);
    assert.match(r.output, problem);
    assert.match(r.output, fix);
    assert.match(r.output, /written but not refreshed/);
    assert.deepEqual(r.embedCalls, []);
    assert.deepEqual(snapshot(root), before);
  });
}

test('with all five failing the output names every failure, and nothing is written', async (t) => {
  const root = vault(t, { ...TIMER_OFF, ...NOT_ENABLED });
  const before = snapshot(root);
  const r = await run(root, [], { probes: {
    ollamaUp: async () => false, session: () => 'none', git: () => ({ repo: false, upstream: false }),
  } });
  assert.equal(r.code, 1);
  for (const problem of [/Ollama is not reachable/, /Obsidian is not running/, /Obsidian Git is not enabled/, /autoSaveInterval is 0/, /not a git repository/]) {
    assert.match(r.output, problem);
  }
  assert.deepEqual(r.cliCalls, []);
  assert.deepEqual(snapshot(root), before);
});

for (const code of ['CLI_BUSY', 'CLI_LOCK']) {
  test(`${code}: exits 1, writes nothing, says to rerun and to treat a repeat as the CLI being down`, async (t) => {
    const root = vault(t);
    const before = snapshot(root);
    const r = await run(root, [], { probes: { cli: () => { throw Object.assign(new Error('gate'), { code }); } } });
    assert.equal(r.code, 1);
    assert.match(r.output, /gate is busy or failing/i);
    assert.match(r.output, /rerun/i);
    assert.match(r.output, /repeat.*CLI.*down/i);
    assert.deepEqual(snapshot(root), before);
  });
}

test('Obsidian only in another session: passes with a note, and the CLI stub records no call', async (t) => {
  const root = vault(t);
  const r = await run(root, [], { probes: { session: () => 'other-session' } });
  assert.equal(r.code, 0, r.output);
  assert.match(r.output, /another session/i);
  assert.deepEqual(r.cliCalls, []);
  assert.ok(existsSync(join(root, 'index.md')));
});

test('no Obsidian process: it fails, and the CLI stub records no call', async (t) => {
  const root = vault(t);
  const r = await run(root, [], { probes: { session: () => 'none' } });
  assert.equal(r.code, 1);
  assert.deepEqual(r.cliCalls, []);
});

test('a CLI failure or the wrong vault fails', async (t) => {
  const root = vault(t);
  const failed = await run(root, [], { probes: { cli: () => { throw new Error('cannot connect'); } } });
  assert.equal(failed.code, 1);
  assert.match(failed.output, /cannot connect/);
  const wrong = await run(root, [], { probes: { cli: () => join(tmpdir(), 'another-vault') } });
  assert.equal(wrong.code, 1);
  assert.match(wrong.output, /open this vault/i);
  assert.ok(!existsSync(join(root, 'index.md')));
});

// ---- embedding failures come after the catalogs ----

test('a failed chunk exits 1 with the count and advice to rerun, and the catalogs written stay', async (t) => {
  const root = vault(t);
  let calls = 0;
  const r = await run(root, [], { embedFn: async (text) => { if (++calls === 1) throw new Error('too long'); return [text.length, 1, 2, 3]; } });
  assert.equal(r.code, 1, r.output);
  assert.match(r.output, /1 chunk\(s\) failed/);
  assert.match(r.output, /rerun/i);
  assert.ok(read(root, 'wiki/authored/alpha/roadmap.md').includes(BEGIN_MARK));
  assert.ok(read(root, 'moc/alpha.md').includes(BEGIN_MARK));
  assert.ok(read(root, 'index.md').includes(BEGIN_MARK));
  assert.ok(existsSync(join(root, '.wiki-master/chunks.json')), 'the partial index is saved, and the next run retries');
  const retry = await run(root);
  assert.equal(retry.code, 0, retry.output);
  assert.equal(retry.embedCalls.length, 1, 'only the failed chunk is embedded again');
});

test('every chunk failing exits 1 with the count, the catalogs stay, and no index is saved', async (t) => {
  const root = vault(t);
  const r = await run(root, [], { embedFn: async () => { throw new Error('backend died'); } });
  assert.equal(r.code, 1);
  assert.match(r.output, /\d+\/\d+/);
  assert.match(r.output, /backend died/);
  assert.match(r.output, /rerun/i);
  assert.ok(read(root, 'index.md').includes(BEGIN_MARK));
  assert.ok(!existsSync(join(root, '.wiki-master/chunks.json')));
});

test('Ollama failing between the check and the embedding exits 1 and keeps the catalogs', async (t) => {
  const root = vault(t);
  let asked = 0;
  const r = await run(root, [], { probes: { ollamaUp: async () => ++asked === 1 } });
  assert.equal(r.code, 1);
  assert.match(r.output, /Ollama is unreachable/);
  assert.ok(existsSync(join(root, 'index.md')));
});

for (const name of ['chunks.json', 'vectors.idx.json']) {
  test(`a corrupt ${name} says to run --rebuild, not to rerun, and --rebuild recovers it`, async (t) => {
    const root = vault(t);
    assert.equal((await run(root)).code, 0);
    writeFileSync(join(root, '.wiki-master', name), '{ nope');
    const plain = await run(root);
    assert.equal(plain.code, 1, plain.output);
    assert.match(plain.output, /refresh-index\.mjs --rebuild/);
    assert.doesNotMatch(plain.output, /\bRerun refresh-index\.mjs\./);
    assert.ok(read(root, 'index.md').includes(BEGIN_MARK), 'the catalogs written stay');
    assert.equal((await run(root)).code, 1, 'a plain rerun cannot help');

    const rebuilt = await run(root, ['--rebuild']);
    assert.equal(rebuilt.code, 0, rebuilt.output);
    assert.equal((await run(root)).code, 0);
  });
}

test('--status on a corrupt index exits 0 and names --rebuild', async (t) => {
  const root = vault(t);
  await run(root);
  writeFileSync(join(root, '.wiki-master', 'chunks.json'), '{ nope');
  const r = await run(root, ['--status']);
  assert.equal(r.code, 0);
  assert.match(r.output, /unavailable/);
  assert.match(r.output, /refresh-index\.mjs --rebuild/);
});

// ---- --status and the command line ----

const throwing = () => { throw new Error('a probe ran during --status'); };

test('--status exits 0 with everything down, runs no prerequisite, embeds nothing and writes nothing', async (t) => {
  const root = vault(t, { ...TIMER_OFF, ...NOT_ENABLED });
  const before = snapshot(root);
  const r = await run(root, ['--status'], { probes: { ollamaUp: throwing, modelPulled: throwing, session: throwing, cli: throwing, git: throwing }, embedFn: throwing });
  assert.equal(r.code, 0);
  assert.match(r.output, /not built/);
  assert.deepEqual(snapshot(root), before);
});

test('--status reports stale after an edit and current after a refresh', async (t) => {
  const root = vault(t);
  await run(root);
  assert.match((await run(root, ['--status'])).output, /current/);
  writeFileSync(join(root, 'wiki/concepts/idea.md'), '# changed\n\nNew text.\n');
  const stale = await run(root, ['--status']);
  assert.match(stale.output, /stale/);
  assert.match(stale.output, /1 file\(s\) changed/);
  await run(root);
  assert.match((await run(root, ['--status'])).output, /current/);
});

test('--status still exits 0 when the vault cannot be read, and says so', async () => {
  const lines = [];
  const code = await main(['--status'], { vault: { path: join(tmpdir(), 'wm-no-such-vault-zq'), name: 'x' }, out: (l) => lines.push(l), err: (l) => lines.push(l) });
  assert.equal(code, 0);
  assert.match(lines.join('\n'), /unavailable/);
});

test('an unknown option exits 2 and does nothing', async (t) => {
  const root = vault(t);
  const before = snapshot(root);
  const r = await run(root, ['--project', 'alpha']);
  assert.equal(r.code, 2);
  assert.match(r.output, /unknown option --project/);
  assert.deepEqual(snapshot(root), before);
});

const spawned = (args, env) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 30_000, input: '', env: { ...process.env, ...env } });

test('--help, spawned, prints the usage with both options and exits 0', () => {
  const r = spawned(['--help'], {});
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^usage: node scripts\/refresh-index\.mjs \[--rebuild\] \[--status\]/);
});

test('--status, spawned against a fixture with nothing running, exits 0 and writes nothing', (t) => {
  const root = vault(t);
  const before = snapshot(root);
  const r = spawned(['--status'], { WIKI_MASTER_VAULT: root, OLLAMA_HOST: 'http://127.0.0.1:9' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /refresh-index --status/);
  assert.deepEqual(snapshot(root), before);
});
