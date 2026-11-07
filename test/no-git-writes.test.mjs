import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanSource, scanTree, formatFinding } from './helpers/git-call-scan.mjs';
import { TOOLS } from '../scripts/lib/doctor-table.mjs';
import { main as refreshIndex } from '../scripts/refresh-index.mjs';

// The plugin runs no git writes: Obsidian Git handles all git operations. The static half reads every script for git
// and gh calls; the live half runs a page write, a log entry, a refresh and a purge in a real repository and checks
// that the commit and the index did not move.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = join(ROOT, 'scripts');

const flagged = (line, file) => scanSource(line, file).findings.map((f) => f.problem);

// ---- the scanner sees every form of call ----

const WRITES = [
  'execFileSync(\'git\', [\'commit\', \'-m\', \'x\'])',
  'spawnSync("git", ["push"])',
  'execSync(`git add ${p}`)',
  'run(\'git\', [\'rebase\'])',
  'git([\'reset\'])',
  'execFile(\'git\', [\'fetch\'], callback)',
  'spawn(\'git\', [\'stash\'])',
  'exec(\'git pull --rebase\')',
  'execSync(\'git status && git push\')',
  'spawn(\'git commit -m x\', { shell: true })',
  'spawnSync(\'sh\', [\'-c\', \'git push\'])',
  'cp.spawnSync(\'git\', [\'tag\', \'v1\'])',
  'execFileSync(\'/usr/bin/git\', [\'clean\', \'-fd\'])',
  'execFileSync(\'git.exe\', [\'checkout\', \'main\'])',
  'execFileSync(\'git\', [\'-C\', dir, \'merge\', \'x\'])',
  'execFileSync(\'git\', [\'-c\', \'core.quotePath=false\', \'--literal-pathspecs\', \'add\', \'.\'])',
  'execFileSync(\'git\', [\n  \'-C\', dir,\n  \'switch\', \'main\',\n], { encoding: \'utf8\' })',
  'git(dir, \'reset\', \'--hard\')',
  'git(cwd, [\'add\', path], { input })',
  'const args = [\'push\']; execFileSync(\'git\', args)',
  'const sub = \'rm\'; execFileSync(\'git\', [sub, file])',
  'const GIT = \'git\'; execFileSync(GIT, [\'mv\', a, b])',
  'const commitArgs = [\'commit\', \'-q\']; git(cwd, commitArgs, { input })',
  'const sh = (cwd, ...a) => execFileSync(\'git\', a, { cwd }); sh(v, \'restore\', \'.\')',
  'function helper(dir, ...args) { return execFileSync(\'git\', [\'-C\', dir, ...args]); } helper(v, \'worktree\', \'add\')',
  'const list = (args) => new Set(execFileSync(\'git\', args)); list([\'init\'])',
  'import { spawnSync as go } from \'node:child_process\'; const GO = \'git\'; go(GO, [\'branch\', \'x\'])',
  'function f({ run = execFileSync }) { const prog = \'git\'; run(prog, [\'clone\', url]); }',
  'sh(run, \'git\', [\'commit\'])',
  'execFileSync(\'git\', [\'config\', \'user.name\', \'x\'])',
  'execFileSync(\'git\', [\'cherry-pick\', \'abc\'])',
  'execFileSync(\'git\', [other])',
  'execFileSync(\'git\', makeArgs())',
  'execFileSync(\'gh\', [\'pr\', \'create\'])',
  'run(\'gh\', [\'repo\', \'delete\', name])',
  'run(\'gh\', args)',
  'execFileSync(\'gh\', [\'repo\', \'clone\', name, tmp])',
  'const a = [\'api\', \'repos\', \'--method\', \'POST\']; run(\'gh\', a)',
  'execSync(`gh pr merge ${n}`)',
  // Only `remote get-url` is a read: every other form can change the repository's remotes, or cannot be read.
  'execFileSync(\'git\', [\'remote\', \'add\', \'origin\', url])',
  'execFileSync(\'git\', [\'-C\', dir, \'remote\', \'set-url\', \'origin\', url])',
  'execFileSync(\'git\', [\'remote\', \'remove\', \'origin\'])',
  'execFileSync(\'git\', [\'remote\', action, \'origin\'])',
  'execFileSync(\'git\', [\'remote\'])',
  'git(dir, \'remote\', \'add\', \'origin\', url)',
  'execSync(\'git remote add origin x\')',
  // gh api becomes a POST as soon as it is given a body, without any method flag.
  'run(\'gh\', [\'api\', route, \'-f\', \'title=x\'])',
  'run(\'gh\', [\'api\', route, \'-F\', \'n=1\'])',
  'run(\'gh\', [\'api\', route, \'--field\', \'title=x\'])',
  'run(\'gh\', [\'api\', route, \'--raw-field\', \'title=x\'])',
  'run(\'gh\', [\'api\', route, \'--input\', file])',
  'run(\'gh\', [\'api\', route, \'-ftitle=x\'])',
  'run(\'gh\', [\'api\', route, \'--field=title=x\'])',
  'run(\'gh\', [\'api\', route, \'-X\', \'POST\'])',
  'run(\'gh\', [\'api\', route, \'-XPOST\'])',
  'run(\'gh\', [\'api\', route, \'--method=POST\'])',
  'run(\'gh\', [\'api\', route, \'--method\', method])',
  'run(\'gh\', [\'api\', route, ...more])',
  'execSync(\'gh api repos/a/b/issues -f title=x\')',
  // A list can gain its write form after it is declared.
  'const args = [\'api\', route]; args.push(\'-f\', \'title=x\'); run(\'gh\', args)',
  'const args = [\'api\', route]; if (body) args.push(\'--input\', file); run(\'gh\', args)',
  'const args = [\'api\', route, \'--method\', \'GET\']; args.push(\'--method\', \'POST\'); run(\'gh\', args)',
  'const args = [\'api\', route]; args.push(...more); run(\'gh\', args)',
  'const args = [route]; args.unshift(\'api\', \'-X\', \'DELETE\'); run(\'gh\', args)',
  'const args = []; args.push(\'commit\', \'-m\', \'x\'); execFileSync(\'git\', args)',
  'const args = [\'-C\', dir]; args.push(\'push\'); execFileSync(\'git\', args)',
  'const args = [\'remote\']; args.push(\'add\', \'origin\', url); execFileSync(\'git\', args)',
];

for (const line of WRITES) {
  test(`the scan flags: ${line.replace(/\n\s*/g, ' ')}`, () => {
    assert.ok(flagged(line).length > 0, 'nothing flagged');
  });
}

const READS = [
  'execFileSync(\'git\', [\'-C\', tmp, \'rev-parse\', \'HEAD\'], { encoding: \'utf8\' })',
  'execFileSync(\'git\', [\'-C\', vaultPath, \'status\', \'--porcelain\', \'-z\'])',
  'execFileSync(\'git\', [\'-c\', \'core.quotePath=false\', \'ls-files\', \'-z\', \'--cached\'], { cwd: root })',
  'execFileSync(\'git\', [\'config\', \'--get\', \'user.name\'])',
  'exec(\'git\', [\'-C\', vaultPath, \'rev-parse\', ...args])',
  'git(dir, \'remote\', \'get-url\', \'origin\')',
  'git(cwd, [\'rev-parse\', \'HEAD\'])',
  'function git(dir, ...args) { return execFileSync(\'git\', [\'-C\', dir, ...args]); } git(d, \'status\');',
  'execSync(\'git status --porcelain\')',
  'spawnSync(\'git\', [\'--version\'])',
  'execFileSync(\'gh\', [\'--version\'], { stdio: \'ignore\' })',
  'execFileSync(\'gh\', [\'auth\', \'status\'], { encoding: \'utf8\' })',
  'execFileSync(\'gh\', [\'repo\', \'view\', name, \'--json\', \'description\'])',
  'function r({ run = execFileSync }) { const args = [\'api\', \'--hostname\', \'github.com\', \'--method\', \'GET\', route]; if (jq) args.push(\'--jq\', jq); return run(\'gh\', args, { encoding: \'utf8\' }); }',
  'run(\'gh\', [\'api\', route])',
  'run(\'gh\', [\'api\', route, \'-X\', \'GET\'])',
  'run(\'gh\', [\'api\', route, \'-XGET\'])',
  'run(\'gh\', [\'api\', route, \'--method=GET\'])',
  'const args = [\'api\', \'--method\', \'GET\', route]; if (jq) args.push(\'--jq\', jq); run(\'gh\', args)',
  'const args = [\'-C\', dir]; args.push(\'rev-parse\', \'HEAD\'); execFileSync(\'git\', args)',
  '// execFileSync(\'git\', [\'commit\'])',
  '/* run(\'git\', [\'push\']) */ const x = 1;',
  'console.log(\'Run `git push` from the vault\');',
  'console.error(\'gh repo clone failed\');',
  'const message = "execFileSync(\'git\', [\'commit\'])";',
  'const pushed = /git push/.test(line);',
  'const m = /^source: "?git commit/m.exec(text);',
  'const x = text.replace(/^["\']|["\']$/g, \'\'); execFileSync(\'git\', [\'status\']);',
  'execFileSync(\'pandoc\', [path])',
  'const s = `a ${b} git push ${c}`;',
];

for (const line of READS) {
  test(`the scan passes: ${line}`, () => {
    assert.deepEqual(flagged(line), []);
  });
}

test('gh repo clone is allowed in the GitHub clipper only', () => {
  const line = 'execFileSync(\'gh\', [\'repo\', \'clone\', name, tmp])';
  assert.deepEqual(flagged(line, 'scripts/clip-gh.mjs'), []);
  assert.equal(flagged(line, 'scripts/clip.mjs').length, 1);
  assert.equal(flagged('execFileSync(\'git\', [\'clone\', url, tmp])', 'scripts/clip-gh.mjs').length, 1, 'only gh, and only there');
});

test('a call whose program the source does not name is reported, not passed', () => {
  assert.deepEqual(scanSource('spawnSync(cmd, args)').dynamic.map((d) => d.program), ['cmd']);
  assert.deepEqual(scanSource('function f({ run = execFileSync }) { run(tool, []); }').dynamic.map((d) => d.program), ['tool']);
  assert.deepEqual(scanSource('execFileSync(process.execPath, [script])').dynamic, []);
  assert.deepEqual(scanSource('const m = /x/.exec(text);').dynamic, []);
  assert.deepEqual(scanSource('const state = git(path);').dynamic.map((d) => d.program), ['git(path)'], 'a name with no process call behind it here');
  assert.equal(scanSource('const git = (cwd, args) => execFileSync(\'git\', args, { cwd }); git(a, b);').findings.length, 1, 'a real wrapper, called with something unreadable');
});

// ---- the static half: every script ----

const scan = scanTree(SCRIPTS);

// Without these the scan could stop seeing real code and still report nothing.
test('the scan reads the calls that stay', () => {
  const seen = scan.calls.map((c) => `${c.file} ${c.tool} ${c.command}`);
  for (const pattern of [
    /^scripts\/clip-gh\.mjs gh --version/,
    /^scripts\/clip-gh\.mjs gh auth status/,
    /^scripts\/clip-gh\.mjs gh repo clone/,
    /^scripts\/clip-gh\.mjs gh repo view/,
    /^scripts\/clip-gh\.mjs git -C <?tmp>? rev-parse/,
    /^scripts\/lib\/github-selection\.mjs gh api/,
    /^scripts\/lib\/private-terms\.mjs git -c core\.quotePath=false ls-files/,
    /^scripts\/rename-unsafe-clippings\.mjs git -C <?vaultPath>? status/,
    /^scripts\/session-brief\.mjs git remote get-url/,
    /^scripts\/session-brief\.mjs git rev-parse --show-toplevel/,
    /^scripts\/lib\/prerequisites\.mjs git -C <?vaultPath>? rev-parse/,
  ]) assert.ok(seen.some((s) => pattern.test(s)), `not seen: ${pattern}\n${seen.join('\n')}`);
});

test('no script runs a git or gh write', () => {
  assert.deepEqual(scan.findings.map(formatFinding), []);
});

// A program that is not a literal in the source cannot be judged, so each one was read by hand. A new one fails here
// until someone reads it too, and one that goes away has to leave the list.
const REVIEWED_DYNAMIC = {
  'scripts/clip-pdf.mjs cmd': 'present() is called with pdftoppm and tesseract only',
  'scripts/clip-pdf.mjs tool': 'pdfinfo, resolved by name or path, asked for the document title only',
  'scripts/clip-pptx.mjs cmd': 'a Python interpreter chosen from a fixed list',
  'scripts/clip.mjs cmd': 'the extraction launchers: node or npx running this plugin\'s extractor',
  'scripts/doctor.mjs cmd': 'lib/doctor-table.mjs, checked below, and the Python candidates',
  'scripts/lib/cli-transport.mjs command': 'the Obsidian CLI, through its gate',
  'scripts/lib/pdf-doctor.mjs command': 'the PDF tools being probed',
  'scripts/lib/pdf-doctor.mjs taskkill': 'the Windows taskkill, stopping its own probe',
  'scripts/lib/pdf-figures.mjs cmd': 'poppler tools, by name or by resolved path',
  'scripts/lib/pdf-figures.mjs tools.pdftoppm': 'poppler',
  'scripts/lib/prerequisites.mjs command': 'run(): the callers name tasklist, /bin/ps or a git call the scan reads where it is made',
  'scripts/lib/prerequisites.mjs git(vaultPath)': 'the probe seam for gitState, which only runs rev-parse',
};

test('every process call with a computed program has been reviewed', () => {
  const found = [...new Set(scan.dynamic.map((d) => `${d.file} ${d.program}`))].sort();
  assert.deepEqual(found, Object.keys(REVIEWED_DYNAMIC).sort());
});

test('the doctor table starts git and gh only for their version, and every other tool only to probe it', () => {
  assert.deepEqual(TOOLS.git.args, ['--version']);
  assert.deepEqual(TOOLS.gh.args, ['--version']);
  for (const [id, tool] of Object.entries(TOOLS)) {
    if (tool.args === null) continue;
    assert.equal(tool.args.length, 1, id);
    assert.ok(['--version', '-v'].includes(tool.args[0]), `${id}: ${tool.args[0]}`);
  }
});

test('the GitHub clipper clones only into a folder it just made under the temp directory', () => {
  const source = readFileSync(join(SCRIPTS, 'clip-gh.mjs'), 'utf8');
  assert.match(source, /const tmp = mkdtempSync\(join\(tmpdir\(\), /);
  assert.match(source, /const cloneArgs = \['repo', 'clone', [^,]+, tmp, /);
});

test('the git write module is gone', () => {
  assert.equal(existsSync(join(SCRIPTS, 'lib', 'git.mjs')), false);
});

// ---- the live half: a real repository ----

const PAGE = (title) => `---\ntype: concept\nsources: ["[[raw/clippings/Src-abc1234.md]]"]\n---\n# ${title}\n\nA page about ${title}.\n`;

function repository(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-no-git-writes-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = {
    '.gitignore': '.wiki-master/\n',
    '.obsidian/community-plugins.json': JSON.stringify(['obsidian-git']),
    '.obsidian/plugins/obsidian-git/manifest.json': JSON.stringify({ id: 'obsidian-git' }),
    '.obsidian/plugins/obsidian-git/data.json': JSON.stringify({ autoSaveInterval: 10 }),
    'index.md': '# Index\n',
    'wiki/concepts/Foo.md': PAGE('Foo'),
    'wiki/concepts/Bar.md': PAGE('Bar'),
    'raw/clippings/Src-abc1234.md': '---\ntitle: "Src"\nsource: https://example.com/a\nsource-hash: abc1234deadbeef\n---\ntext\n',
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q', '-b', 'main');
  // Everything a commit would need is set, so a stray write would succeed and show up here.
  for (const [key, value] of [['user.email', 'fixture@example.com'], ['user.name', 'Fixture'], ['core.autocrlf', 'false'], ['commit.gpgsign', 'false']]) git('config', key, value);
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture');
  const state = () => ({
    head: git('rev-parse', 'HEAD').trim(),
    commits: git('rev-list', '--count', '--all').trim(),
    index: git('ls-files', '--stage'),
    staged: git('diff', '--cached', '--name-status'),
    stash: git('stash', 'list'),
    branches: git('branch', '--list'),
  });
  return { root, state };
}

const script = (root, name, args, input) => spawnSync(process.execPath, [join(SCRIPTS, name), ...args], {
  env: { ...process.env, WIKI_MASTER_VAULT: root, WIKI_MASTER_BROWSER: '/no/such/browser' }, encoding: 'utf8', input, timeout: 60000,
});

test('a page write, a log entry and a refresh leave HEAD and the index alone', async (t) => {
  const { root, state } = repository(t);
  const before = state();
  writeFileSync(join(root, 'wiki/concepts/New.md'), PAGE('New'));

  const logged = script(root, 'log-entry.mjs', ['--op', 'relink', '--title', 'A new page'], 'Wrote one page.\n');
  assert.equal(logged.status, 0, logged.stderr);
  assert.ok(existsSync(join(root, logged.stdout.trim())), logged.stdout);

  const lines = [];
  const code = await refreshIndex([], {
    vault: { path: root, name: 'fixture' },
    probes: {
      model: 'test-embedder', host: 'http://ollama.test:11434', ollamaUp: async () => true, modelPulled: async () => true,
      session: () => 'this-session', cli: () => root, git: () => ({ repo: true, upstream: true }),
    },
    embedFn: async (text) => [text.length, 1, 2, 3],
    out: (line) => lines.push(line), err: (line) => lines.push(line),
  });
  assert.equal(code, 0, lines.join('\n'));
  assert.ok(existsSync(join(root, '.wiki-master', 'chunks.json')), 'the refresh ran');

  assert.deepEqual(state(), before);
});

test('a purge leaves HEAD and the index alone', (t) => {
  const { root, state } = repository(t);
  const before = state();
  const purged = script(root, 'purge.mjs', ['--apply', 'Foo', '--seeds', 'wiki/concepts/Foo.md']);
  assert.equal(purged.status, 0, `${purged.stdout}${purged.stderr}`);
  assert.equal(existsSync(join(root, 'wiki/concepts/Foo.md')), false, 'the purge ran');
  assert.deepEqual(state(), before);
});
