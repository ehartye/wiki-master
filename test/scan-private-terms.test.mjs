import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync, symlinkSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseTerms, scanText, BUILTIN_RULES } from '../scripts/lib/private-terms.mjs';
import * as privateTerms from '../scripts/lib/private-terms.mjs';

// The public repository must not name the owner's other projects or machines: that language belongs in the wiki.
// The scanner reads the owner's private list from a file kept outside the repository, scans tracked and
// untracked files, and reports where (path and line) without ever printing the term it matched.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'scripts', 'scan-private-terms.mjs');
const SECRET = 'Zorblax Prime';

function repo(t, files) {
  const dir = mkdtempSync(join(tmpdir(), 'wm-terms-'));
  t.after(() => { rmSync(dir, { recursive: true, force: true }); rmSync(`${dir}.terms.txt`, { force: true }); });
  const git = (...a) => execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd: dir, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.email', 'a@b.c');
  git('config', 'user.name', 'T');
  for (const [name, text] of Object.entries(files.tracked ?? {})) { mkdirSync(dirname(join(dir, name)), { recursive: true }); writeFileSync(join(dir, name), text); }
  git('add', '-A');
  if (files.tracked) git('commit', '-q', '-m', 'init');
  for (const [name, text] of Object.entries(files.untracked ?? {})) { mkdirSync(dirname(join(dir, name)), { recursive: true }); writeFileSync(join(dir, name), text); }
  if (files.gitignore) writeFileSync(join(dir, '.gitignore'), files.gitignore);
  return dir;
}

function scan(dir, terms, extra = []) {
  const args = [SCRIPT, '--root', dir, ...extra];
  if (terms !== null) {
    const f = `${dir}.terms.txt`; // beside the repository, not in it, or the scan would find its own terms
    writeFileSync(f, terms);
    args.push('--terms-file', f);
  }
  return spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 30000 });
}

test('parseTerms reads plain terms and /regex/flags lines, skips blanks and comments, and numbers each rule', () => {
  const rules = parseTerms(['# a comment', '', '  Zorblax Prime  ', String.raw`/\bPip\b/`, String.raw`/\bsaloon\b/i`].join('\n'));
  assert.deepEqual(rules.map((r) => [r.kind, r.id]), [['term', 'term #1'], ['regex', 'regex #2'], ['regex', 'regex #3']]);
  assert.deepEqual(scanText('the Zorblax PRIME ship', rules), [{ line: 1, rule: 'term #1' }]);
  assert.deepEqual(scanText('pip install and Pip the dog', rules).map((h) => h.rule), ['regex #2'], 'a whole-word, case-sensitive regex leaves "pip install" alone');
  assert.deepEqual(scanText('A Saloon scene', rules).map((h) => h.rule), ['regex #3']);
});

test('a g or y flag on a regex line does not make matching depend on the previous line', () => {
  const rules = parseTerms('/foo/g');
  assert.deepEqual(scanText(['foo', 'foo', 'foo'].join(String.fromCharCode(10)), rules).map((h) => h.line), [1, 2, 3]);
});

test('a malformed regex line is an error that names its line number, not the line', () => {
  assert.throws(() => parseTerms('fine\n/(unclosed/\n'), (e) => /line 2/.test(e.message) && !e.message.includes('unclosed'));
});

test('scanText reports each matching line once per rule, with 1-based line numbers', () => {
  const rules = parseTerms('alpha\nbeta');
  assert.deepEqual(scanText('x\nalpha alpha\nclean\nbeta and alpha\n', rules), [
    { line: 2, rule: 'term #1' }, { line: 4, rule: 'term #1' }, { line: 4, rule: 'term #2' },
  ]);
});

test('the CLI finds a term in a tracked and in an untracked file, prints where, and never the term', (t) => {
  const dir = repo(t, {
    tracked: { 'a/doc.md': `line one\nwe met ${SECRET} here\n`, 'clean.md': 'nothing here\n' },
    untracked: { 'new.md': `${SECRET.toLowerCase()} in a new file\n`, 'sub/other.txt': 'fine\n' },
  });
  const r = scan(dir, `${SECRET}\n`);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /a\/doc\.md:2 /);
  assert.match(r.stdout, /new\.md:1 /);
  assert.doesNotMatch(r.stdout + r.stderr, /zorblax/i, 'the term must never be echoed');
  assert.doesNotMatch(r.stdout, /clean\.md|other\.txt/);
  assert.match(r.stdout, /2 hit\(s\) in 2 file\(s\)/);
  assert.doesNotMatch(r.stdout, /folder walk/, 'a git repository is listed by git, not walked');
});

// A folder with no git work tree around it: a fresh temp folder (the suite's temp root is not inside a repository).
function plainFolder(t, files) {
  const dir = mkdtempSync(join(tmpdir(), 'wm-terms-plain-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, data] of Object.entries(files)) { mkdirSync(dirname(join(dir, name)), { recursive: true }); writeFileSync(join(dir, name), data); }
  const probe = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir, encoding: 'utf8' });
  assert.notEqual(probe.status, 0, 'the test folder must sit outside every git work tree, or git would list it');
  return dir;
}

test('a folder outside any git work tree is walked: binary files, tool folders and links that leave it are skipped, and the report says so', (t) => {
  const bs = String.fromCharCode(92);
  const home = ['C:', 'Users', 'alex', 'repos', 'x'].join(bs); // built from parts, so this file holds no home path
  const dir = plainFolder(t, {
    'notes/a.md': `see ${home}\n`,
    'clean.md': 'nothing here\n',
    'bin.dat': Buffer.concat([Buffer.from(`${home} `), Buffer.from([0, 1, 2])]),
    '.obsidian/workspace.json': `${home}\n`,
    '.git/notes.txt': `${home}\n`, // no HEAD, so git does not take it for a repository
    '.wiki-master/state.md': `${home}\n`,
    '.recycle/old.md': `${home}\n`,
    'node_modules/pkg/index.js': `${home}\n`,
    'sub/node_modules/pkg/index.js': `${home}\n`,
  });
  const outside = mkdtempSync(join(tmpdir(), 'wm-terms-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, 'far.md'), `${home}\n`);
  symlinkSync(outside, join(dir, 'out-dir'), 'junction'); // a directory link that leaves the root
  symlinkSync(dir, join(dir, 'notes', 'loop'), 'junction'); // a link back to the root must not loop or count twice
  try { symlinkSync(join(outside, 'far.md'), join(dir, 'out-file.md'), 'file'); } catch (e) { if (e.code !== 'EPERM') throw e; t.diagnostic('file links need a privilege here; only directory links were checked'); }

  const r = scan(dir, null);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const lines = r.stdout.trim().split(/\r?\n/);
  assert.equal(lines.length, 3, r.stdout);
  assert.match(lines[0], /^folder walk: /, 'the report says the folder was walked');
  assert.match(lines[0], /no git listing/);
  assert.equal(lines[1], 'notes/a.md:1 home-path-windows');
  assert.match(lines[2], /^1 hit\(s\) in 1 file\(s\); 2 file\(s\) scanned/);
  assert.equal(r.stderr, '');

  const j = JSON.parse(scan(dir, null, ['--json']).stdout);
  assert.equal(j.listing, 'folder walk', '--json marks a walked folder');
  assert.deepEqual(j.unreadable, [], '--json lists the folders a walk could not read, here none');
  assert.deepEqual(j.hits, [{ file: 'notes/a.md', line: 1, rule: 'home-path-windows' }]);

  // Without git on the PATH there is no git listing either, so the folder is walked the same way.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() !== 'PATH'));
  const nogit = spawnSync(process.execPath, [SCRIPT, '--root', dir], { encoding: 'utf8', timeout: 30000, env: { ...env, PATH: outside } });
  assert.equal(nogit.status, 1, nogit.stdout + nogit.stderr);
  assert.match(nogit.stdout, /^folder walk: .*git/);
  assert.match(nogit.stdout, /^notes\/a\.md:1 home-path-windows$/m);
});

test('a root that does not exist or is not a folder exits 2 with its own message', (t) => {
  const dir = plainFolder(t, { 'file.md': 'text\n' });
  const missing = scan(join(dir, 'no-such-folder'), null);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /^scan-private-terms: the root folder does not exist/m);
  const file = scan(join(dir, 'file.md'), null);
  assert.equal(file.status, 2);
  assert.match(file.stderr, /^scan-private-terms: the root is not a folder/m);
  for (const r of [missing, file]) assert.doesNotMatch(r.stderr, /cannot be listed|fatal:/);
});

test('a git listing that fails inside a repository exits 2 and names the git error', (t) => {
  const dir = repo(t, { tracked: { 'p.md': 'clean\n' } });
  writeFileSync(join(dir, '.git', 'index'), 'garbage'); // git still finds the repository, but cannot read its index
  const r = scan(dir, null);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /^scan-private-terms: the repository cannot be listed: git ls-files failed: .*index/m);
  assert.doesNotMatch(r.stdout, /folder walk/, 'a broken repository is not walked as a plain folder');

  // A .git file that points nowhere: git says "not a git repository", but names the missing folder, so it is an error.
  const linked = plainFolder(t, { '.git': 'gitdir: no-such-gitdir\n', 'p.md': 'clean\n' });
  const pointer = scan(linked, null);
  assert.equal(pointer.status, 2, pointer.stdout + pointer.stderr);
  assert.match(pointer.stderr, /^scan-private-terms: the repository cannot be listed: git rev-parse failed: /m);
  assert.doesNotMatch(pointer.stdout, /folder walk/);
});

test('a clean tree exits 0; ignored files, deleted files and binary files are not scanned', (t) => {
  const dir = repo(t, {
    tracked: { 'keep.md': 'ok\n', 'gone.md': `${SECRET}\n` },
    untracked: { 'ignored/x.md': `${SECRET}\n`, 'bin.dat': Buffer.concat([Buffer.from(`${SECRET} `), Buffer.from([0, 1, 2])]).toString('latin1') },
    gitignore: 'ignored/\n',
  });
  unlinkSync(join(dir, 'gone.md')); // tracked but deleted in the working tree
  const r = scan(dir, `${SECRET}\n`);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /0 hit\(s\)/);
  assert.equal(r.stderr, '', 'a deleted file is gone, not unreadable: no notice');
});

test('--json lists hits as path, line and rule, with counts', (t) => {
  const dir = repo(t, { tracked: { 'p.md': `${SECRET}\n` } });
  const r = scan(dir, `${SECRET}\n`, ['--json']);
  assert.equal(r.status, 1);
  const j = JSON.parse(r.stdout);
  assert.deepEqual(j.hits, [{ file: 'p.md', line: 1, rule: 'term #1' }]);
  assert.equal(j.count, 1);
  assert.equal(j.files, 1);
  assert.deepEqual(Object.keys(j), ['count', 'files', 'hits'], 'a git listing adds no listing field');
  assert.doesNotMatch(r.stdout, /zorblax/i);
});

test('without a terms file only the built-in patterns run; an unreadable terms file exits 2', (t) => {
  const dir = repo(t, { tracked: { 'p.md': `${SECRET}\n` } });
  assert.equal(scan(dir, null).status, 0, 'no terms file means no term rules');
  const r = spawnSync(process.execPath, [SCRIPT, '--root', dir, '--terms-file', join(dir, 'no-such-file.txt')], { encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /terms file/i);
});

test('the built-in patterns catch home paths, GPU models and invisible characters, and let placeholders through', () => {
  const rules = BUILTIN_RULES;
  const ids = (s) => scanText(s, rules).map((h) => h.rule);
  // The samples are built from parts, so this file holds no home path, GPU model or invisible character itself.
  const who = 'jdoe';
  const bs = String.fromCharCode(92);
  assert.deepEqual(ids(['open C:', 'Users', who, 'repos'].join(bs)), ['home-path-windows']);
  assert.deepEqual(ids(`open C:/Users/${who}/repos/thing`), ['home-path-windows'], 'a Windows path with forward slashes is one finding, not two');
  assert.deepEqual(ids(`cd /Users/${who}/code`), ['home-path-posix']);
  assert.deepEqual(ids(`cd /home/${who}/code`), ['home-path-posix']);
  assert.deepEqual(ids(`measured on an RTX ${4090}`), ['gpu-model']);
  for (const cp of [0xAD, 0x200B, 0x200E, 0x2028, 0x202E, 0x2060, 0xFEFF, 0xE0041]) {
    assert.deepEqual(ids(`a${String.fromCodePoint(cp)}b`), ['invisible-character'], `U+${cp.toString(16)} is invisible`);
  }
  for (const fine of [String.raw`C:\Users\you\repos`, String.raw`C:\Users\<name>\x`, String.raw`C:\Users\%USERNAME%\x`, '/Users/you/code', '/home/runner/work/x', 'cd ~/repos', 'the Users guide', 'an RTX-class GPU']) {
    assert.deepEqual(ids(fine), [], `${fine} should not be flagged`);
  }
});

// A home-relative path names the owner's layout once it has two segments after the home token. The samples are
// built from parts, so this file holds no such path itself and the repository's own scan stays clean.
const bs = String.fromCharCode(92);
const under = (token, sep, ...segments) => [token, ...segments].join(sep);

test('home-path-relative flags two segments after a home token, and lets one segment, dot-folders and placeholders through', () => {
  const ids = (s) => scanText(s, BUILTIN_RULES).map((h) => h.rule);
  const hits = [
    under('~', '/', 'repos', 'x'),
    `see ${under('~', '/', 'repos', 'demo', 'notes')}`,
    under('$HOME', '/', 'repos', 'x'),
    under('${HOME}', '/', 'repos', 'x'),
    under('%USERPROFILE%', bs, 'repos', 'x'),
    under('%USERPROFILE%', '/', 'repos', 'x'),
    under('$env:USERPROFILE', bs, 'repos', 'x'),
    under('$env:USERPROFILE', '/', 'repos', 'x'),
    under('~', bs, 'repos', 'x'),
    under('%userprofile%', bs, 'repos', 'x'), // Windows names its variables without regard to case
    `cd "${under('$HOME', '/', 'code', 'demo')}" && ls`,
    `see [notes](${under('~', '/', 'repos', 'demo')}).`,
    `{"output": "done${bs}n${under('~', '/', 'repos', 'x')}"}`, // after a JSON-escaped line end, as in a recorded transcript
    `"${bs}r${bs}n${under('%USERPROFILE%', bs + bs, 'repos', 'x')}"`,
  ];
  for (const s of hits) assert.deepEqual(ids(s), ['home-path-relative'], `${s} should be flagged`);
  const fine = [
    'cd ~/repos', // one segment says nothing about a layout
    '~/.config/wiki-master/vaults.json', // a dot-folder is where tools keep their config
    under('$env:USERPROFILE', bs, '.wiki-master-vault', '.recycle'),
    '~/<repos>/<plugin>', // a placeholder
    under('~', '/', 'repos', 'demo', '<name>'),
    under('~', '/', 'repos', '<name>-worktrees', 'x'),
    under('~', '/', 'repos', '...'), // an ellipsis is not a folder name
    'a~/repos/x/y', // not a home token: a word runs into it
    `outputLength ~${bs}r${bs}n   2 |`, // a tilde before JSON-escaped line ends is not a path
    `${'$'}{home}${bs}n${bs}n`, // a lower-case shell variable is not HOME
  ];
  for (const s of fine) assert.deepEqual(ids(s), [], `${s} should not be flagged`);
});

test('home-path-relative lets through a path that starts with an allow entry, at a segment boundary, and records which entries were used', () => {
  const entry = under('~', '/', 'plugins', 'demo');
  const win = under('%USERPROFILE%', bs, 'plugins', 'demo');
  const rules = privateTerms.builtinRules([{ entry, line: 2 }, { entry: win, line: 4 }, { entry: under('~', '/', 'plugins', 'unused'), line: 6 }]);
  const rule = rules.find((r) => r.id === 'home-path-relative');
  const ids = (s) => scanText(s, rules).map((h) => h.rule);
  assert.deepEqual(ids(`copy it to \`${entry}\``), [], 'the entry itself');
  assert.deepEqual(ids(`run ${under('~', '/', 'plugins', 'demo', 'x')} now`), [], 'a path below the entry');
  assert.deepEqual(ids(`refresh the copy under ${entry}.`), [], 'sentence punctuation after the entry');
  assert.deepEqual(ids(`on Windows ${under('%USERPROFILE%', bs, 'plugins', 'demo', 'skills')}`), []);
  assert.deepEqual(ids(under('~', '/', 'plugins', 'demo-other', 'x')), ['home-path-relative'], 'a prefix only allows whole segments');
  assert.deepEqual(ids(`${entry} and ${under('~', '/', 'repos', 'x')}`), ['home-path-relative'], 'an allowed path does not hide a second path on the line');
  assert.deepEqual(ids(under('$HOME', '/', 'plugins', 'demo')), ['home-path-relative'], 'an entry is matched as written, token and all');
  assert.deepEqual([...rule.used].sort(), [entry, win].sort());
  assert.deepEqual(privateTerms.BUILTIN_RULES.map((r) => r.id), ['home-path-windows', 'home-path-posix', 'home-path-relative', 'gpu-model', 'invisible-character']);
});

test('the allow file needs a # comment above every entry, and each entry must be a home-relative path', () => {
  const entry = under('~', '/', 'plugins', 'demo');
  assert.deepEqual(privateTerms.parseAllow(`# the documented install path\n${entry}\n\n# and its Windows form\r\n${under('%USERPROFILE%', bs, 'plugins', 'demo')}\n`),
    [{ entry, line: 2 }, { entry: under('%USERPROFILE%', bs, 'plugins', 'demo'), line: 5 }]);
  assert.throws(() => privateTerms.parseAllow(`${entry}\n`), (e) => e instanceof privateTerms.AllowFileError && /line 1\b/.test(e.message) && /comment/.test(e.message));
  assert.throws(() => privateTerms.parseAllow(`# why\n${entry}\n${under('~', '/', 'plugins', 'two')}\n`), /line 3\b/, 'one comment documents one entry');
  assert.throws(() => privateTerms.parseAllow(`# why\n\n${entry}\n`), /line 3\b/, 'a blank line parts a comment from the entry');
  assert.throws(() => privateTerms.parseAllow('# why\nplugins/demo\n'), (e) => /line 2\b/.test(e.message) && /home/.test(e.message));
  // An entry allows one documented path, never a whole folder: two folder names at least, and no way back up.
  for (const broad of ['~/', '$HOME/', '~/plugins', '~/plugins/', under('%USERPROFILE%', bs, 'plugins'), '~/plugins/...', under('~', '/', 'plugins', '..', 'repos'), under('~', '/', 'plugins', 'demo', '..')]) {
    assert.throws(() => privateTerms.parseAllow(`# why\n${broad}\n`), (e) => e instanceof privateTerms.AllowFileError && /line 2\b/.test(e.message) && /two folder names/.test(e.message), `${broad} is too broad`);
  }
});

test('the CLI reads .private-terms-allow at the root: an allowed path passes, an undocumented entry exits 2, an unused entry fails by name', (t) => {
  const entry = under('~', '/', 'plugins', 'demo');
  const layout = under('~', '/', 'repos', 'demo', 'notes');
  const allowed = repo(t, { tracked: { 'install.md': `copy to \`${entry}\`\n`, '.private-terms-allow': `# the documented install path\n${entry}\n` } });
  const ok = scan(allowed, null);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /^0 hit\(s\)/m);

  const layoutRepo = repo(t, { tracked: { 'notes.md': `line one\nsee ${layout}\n` } });
  const hit = scan(layoutRepo, null);
  assert.equal(hit.status, 1, hit.stdout + hit.stderr);
  assert.match(hit.stdout, /^notes\.md:2 home-path-relative$/m);
  assert.doesNotMatch(hit.stdout, /repos/, 'the matched path is never printed');

  const undocumented = repo(t, { tracked: { 'install.md': `${entry}\n`, '.private-terms-allow': `${entry}\n` } });
  const bad = scan(undocumented, null);
  assert.equal(bad.status, 2, bad.stdout + bad.stderr);
  assert.match(bad.stderr, /^scan-private-terms: \.private-terms-allow line 1: /m);

  // The entry's own line in the allow file does not count as a use, or no entry could ever go unused.
  const unused = repo(t, { tracked: { 'install.md': `copy to ${entry}\n`, '.private-terms-allow': `# used\n${entry}\n# no longer named anywhere\n${under('~', '/', 'plugins', 'gone')}\n` } });
  const stale = scan(unused, null);
  assert.equal(stale.status, 1, stale.stdout + stale.stderr);
  assert.match(stale.stdout, new RegExp(`^unused allow entry: \\.private-terms-allow:4 ${under('~', '/', 'plugins', 'gone')} `, 'm'));
  assert.doesNotMatch(stale.stdout, /install\.md/);
  const j = JSON.parse(scan(unused, null, ['--json']).stdout);
  assert.deepEqual(j.allow, { entries: 2, unused: [under('~', '/', 'plugins', 'gone')] });

  // A layout in the allow file's own comment is still a hit: only its entries are allowed.
  const comment = repo(t, { tracked: { 'install.md': `${entry}\n`, '.private-terms-allow': `# copied from ${layout}\n${entry}\n` } });
  const own = scan(comment, null);
  assert.equal(own.status, 1, own.stdout + own.stderr);
  assert.match(own.stdout, /^\.private-terms-allow:1 home-path-relative$/m);

  // An entry that would switch the rule off for every path is refused, not silently used.
  const everything = repo(t, { tracked: { 'notes.md': `see ${layout}\n`, '.private-terms-allow': '# everything\n~/\n' } });
  const broad = scan(everything, null);
  assert.equal(broad.status, 2, broad.stdout + broad.stderr);
  assert.match(broad.stderr, /^scan-private-terms: \.private-terms-allow line 2: /m);

  // An allow file that is there but cannot be read is refused too.
  const folder = repo(t, { tracked: { 'p.md': 'clean\n', '.private-terms-allow/keep.md': 'x\n' } });
  const unreadable = scan(folder, null);
  assert.equal(unreadable.status, 2, unreadable.stdout + unreadable.stderr);
  assert.match(unreadable.stderr, /^scan-private-terms: \.private-terms-allow cannot be read/m);
});

const unreadableRoots = process.platform === 'win32' ? 'a folder\'s own permissions do not stop its owner reading it on Windows'
  : process.getuid?.() === 0 ? 'the superuser reads any folder' : false;
test('a root that cannot be read exits 2 with the root\'s own message, not the allow file\'s', { skip: unreadableRoots }, (t) => {
  const dir = plainFolder(t, { 'a.md': 'clean\n', '.private-terms-allow': `# why\n${under('~', '/', 'plugins', 'demo')}\n` });
  chmodSync(dir, 0o000);
  let r;
  try { r = scan(dir, null); } finally { chmodSync(dir, 0o700); }
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /^scan-private-terms: the root folder cannot be read/m);
  assert.doesNotMatch(r.stderr, /private-terms-allow/);

  // Readable but not searchable (r without x): its names can be listed, but no file in it can be opened.
  const listable = plainFolder(t, { 'a.md': 'clean\n' });
  for (const [mode, allowFile] of [[0o400, false], [0o600, true]]) {
    if (allowFile) writeFileSync(join(listable, '.private-terms-allow'), `# why\n${under('~', '/', 'plugins', 'demo')}\n`);
    chmodSync(listable, mode);
    try { r = scan(listable, null); } finally { chmodSync(listable, 0o700); }
    assert.equal(r.status, 2, `mode ${mode.toString(8)}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /^scan-private-terms: the root folder cannot be read/m, `mode ${mode.toString(8)}`);
    assert.doesNotMatch(r.stderr, /private-terms-allow/, `mode ${mode.toString(8)}`);
  }
});

test('a scan names each folder and file it cannot read, root-relative; a walk lists them in --json; the hits still decide the exit', { skip: unreadableRoots }, (t) => {
  const bs = String.fromCharCode(92);
  const home = ['C:', 'Users', 'alex', 'repos', 'x'].join(bs); // built from parts, so this file holds no home path
  const dir = plainFolder(t, {
    'clean.md': 'nothing here\n', 'deep/open.md': 'fine\n',
    'sub/a.md': `${home}\n`, 'deep/locked/b.md': `${home}\n`, // no permissions
    'rnox/c.md': `${home}\n`, 'chained/deeper/d.md': `${home}\n`, // readable but not searchable, as after chmod -R 600
    'locked.md': `${home}\n`, // a file with no permissions
  });
  const at = (p) => join(dir, ...p.split('/'));
  const modes = [['sub', 0o000], ['deep/locked', 0o000], ['rnox', 0o600], ['chained/deeper', 0o600], ['chained', 0o600], ['locked.md', 0o000]];
  for (const [p, mode] of modes) chmodSync(at(p), mode);
  let r, j;
  try { r = scan(dir, null); j = JSON.parse(scan(dir, null, ['--json']).stdout); } finally { for (const [p] of [...modes].reverse()) chmodSync(at(p), p.endsWith('.md') ? 0o600 : 0o700); }
  assert.equal(r.status, 0, 'no hit was found, so the exit is 0; the notices do not change it');
  const notices = r.stderr.split(/\r?\n/).filter((l) => l.includes('unreadable'));
  assert.deepEqual(notices.map((l) => l.replace(/ \(E[A-Z]+\).*$/, '')), [
    'scan-private-terms: unreadable folder: chained/',
    'scan-private-terms: unreadable folder: deep/locked/',
    'scan-private-terms: unreadable file: locked.md',
    'scan-private-terms: unreadable folder: rnox/',
    'scan-private-terms: unreadable folder: sub/',
  ], r.stderr);
  for (const l of notices) assert.match(l, /\(E[A-Z]+\): .*not scanned$/, 'each notice gives the error code and says what was not scanned');
  assert.ok(!r.stderr.includes(dir), 'a notice names the path from the root, never its absolute path');
  assert.match(r.stdout, /0 hit\(s\) in 0 file\(s\); 2 file\(s\) scanned/);
  assert.deepEqual(j.unreadable, ['chained/', 'deep/locked/', 'locked.md', 'rnox/', 'sub/']);
});

test('in a git repository an unreadable tracked file is named on stderr, and the --json keys stay as they were', { skip: unreadableRoots }, (t) => {
  const dir = repo(t, { tracked: { 'a.md': `${SECRET}\n`, 'ok.md': 'clean\n' } });
  chmodSync(join(dir, 'a.md'), 0o000);
  let r, j;
  try { r = scan(dir, `${SECRET}\n`); j = JSON.parse(scan(dir, `${SECRET}\n`, ['--json']).stdout); } finally { chmodSync(join(dir, 'a.md'), 0o600); }
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stderr, /^scan-private-terms: unreadable file: a\.md \(EACCES\): not scanned$/m);
  assert.doesNotMatch(r.stdout, /folder walk/);
  assert.deepEqual(Object.keys(j), ['count', 'files', 'hits'], 'a git listing adds no field');
});

test('every option reads its value as --name value or --name=value; an option with no value exits 2', (t) => {
  const dir = repo(t, { tracked: { 'old/data.json': `${SECRET}\n`, 'src/code.js': `${SECRET}\n` } });
  const terms = `${dir}.terms.txt`; writeFileSync(terms, `${SECRET}\n`);
  const known = `${dir}.known.txt`; writeFileSync(known, 'old/data.json\n'); t.after(() => rmSync(known, { force: true }));
  const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 30000 }); // cwd: this repository, not dir
  const spaced = run(['--root', dir, '--terms-file', terms, '--known', known]);
  assert.equal(spaced.status, 1, spaced.stdout + spaced.stderr);
  assert.match(spaced.stdout, /^src\/code\.js:1 term #1$/m);
  assert.match(spaced.stdout, /^1 known hit\(s\) in 1 file\(s\)/m);
  for (const args of [[`--root=${dir}`, `--terms-file=${terms}`, `--known=${known}`], [`--root=${dir}`, '--terms-file', terms, `--known=${known}`]]) {
    const r = run(args);
    assert.deepEqual([r.status, r.stdout, r.stderr], [spaced.status, spaced.stdout, spaced.stderr], args.join(' '));
  }
  for (const args of [['--root='], ['--root', dir, '--terms-file='], ['--root', dir, '--known'], ['--root', '--json'], ['--root', dir, '--json=yes']]) {
    const r = run(args);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /^scan-private-terms: --[a-z-]+ (needs a value|takes no value)/m, args.join(' '));
  }
});

test('--help describes the folder walk, the allow file and what fails the scan', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^usage: node scripts\/scan-private-terms\.mjs/);
  assert.match(r.stdout, /not in a git work tree/);
  assert.match(r.stdout, /walked/);
  assert.match(r.stdout, /\.private-terms-allow/);
  assert.match(r.stdout, /home-relative/);
  assert.match(r.stdout, /unused allow entry/);
  assert.match(r.stdout, /stale --known entry/);
  assert.match(r.stdout, /cannot read/, 'the help says a scan names the folders and files it cannot read');
  // One line per option, with its default and, for --json, every field it can add.
  assert.match(r.stdout, /^ {2}--root <dir> .*default: the current directory/m);
  assert.match(r.stdout, /^ {2}--terms-file <file> .*WIKI_MASTER_PRIVATE_TERMS_FILE/m);
  assert.match(r.stdout, /^ {2}--known <file> /m);
  const json = r.stdout.split(/\r?\n/).find((l) => /^ {2}--json /.test(l)) ?? '';
  for (const field of ['count', 'files', 'hits', 'listing', 'unreadable', 'known', 'stale', 'allow']) assert.match(json, new RegExp(`\\b${field}\\b`), `--json line names ${field}`);
  assert.match(r.stdout, /--name=<value>/, 'the help gives both spellings of an option');
  // Every exit 2.
  const exit2 = r.stdout.split(/\r?\n/).find((l) => l.startsWith('Exit 2')) ?? '';
  for (const cause of [/terms file/, /--known file/, /\.private-terms-allow/, /no value/, /unknown option/, /missing/, /is a file/, /cannot be read/, /git listing/]) assert.match(exit2, cause, `Exit 2 names ${cause}`);
});

test('--known lists files whose hits are reported but do not fail the scan; a stale entry fails it', (t) => {
  const dir = repo(t, { tracked: { 'old/data.json': `${SECRET}\n`, 'src/code.js': 'clean\n', 'old/other.json': 'clean too\n' } });
  const known = (lines) => { writeFileSync(`${dir}.known.txt`, lines); t.after(() => rmSync(`${dir}.known.txt`, { force: true })); return ['--known', `${dir}.known.txt`]; };

  const ok = scan(dir, `${SECRET}\n`, known('# files still to sanitise\nold/data.json\n'));
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /0 hit\(s\) in 0 file\(s\)/);
  assert.match(ok.stdout, /1 known hit\(s\) in 1 file\(s\)/);

  const stale = scan(dir, `${SECRET}\n`, known('old/data.json\nold/other.json\n'));
  assert.equal(stale.status, 1, 'a known entry that no longer has a hit must be removed from the list');
  assert.match(stale.stdout, /stale known entry: old\/other\.json/);

  const prefix = scan(dir, `${SECRET}\n`, known('old/\n'));
  assert.equal(prefix.status, 0, 'a directory prefix covers the files under it');

  writeFileSync(join(dir, 'src/code.js'), `${SECRET}\n`);
  const fresh = scan(dir, `${SECRET}\n`, known('old/data.json\n'));
  assert.equal(fresh.status, 1, 'a hit outside the known list still fails');
  assert.match(fresh.stdout, /src\/code\.js:1 /);

  const j = JSON.parse(scan(dir, `${SECRET}\n`, [...known('old/data.json\n'), '--json']).stdout);
  assert.deepEqual(j.known, { count: 1, files: 1 });
  assert.deepEqual(j.hits.map((h) => h.file), ['src/code.js']);
  assert.doesNotMatch(JSON.stringify(j), /zorblax/i);
});

test('this repository is clean under the built-in patterns, and under the owner\'s terms when a file is named', (t) => {
  const bare = { ...process.env }; // the built-in run must not pick up the owner's terms from the environment
  delete bare.WIKI_MASTER_PRIVATE_TERMS_FILE; delete bare.PRIVATE_TERMS_FILE;
  const builtin = spawnSync(process.execPath, [SCRIPT, '--root', ROOT], { encoding: 'utf8', timeout: 120000, env: bare });
  assert.equal(builtin.status, 0, `the built-in patterns found something in the repository:\n${builtin.stdout}`);
  const file = process.env.WIKI_MASTER_PRIVATE_TERMS_FILE || process.env.PRIVATE_TERMS_FILE;
  if (!file) { t.skip('no WIKI_MASTER_PRIVATE_TERMS_FILE or PRIVATE_TERMS_FILE is set, so the owner\'s own terms were not checked'); return; }
  const own = spawnSync(process.execPath, [SCRIPT, '--root', ROOT, '--terms-file', file, '--known', join(ROOT, 'test', 'private-terms-known.txt')], { encoding: 'utf8', timeout: 120000 });
  assert.equal(own.status, 0, `the repository names something on the private list:\n${own.stdout}`);
});
