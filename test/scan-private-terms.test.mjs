import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseTerms, scanText, BUILTIN_RULES } from '../scripts/lib/private-terms.mjs';

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
});

test('--json lists hits as path, line and rule, with counts', (t) => {
  const dir = repo(t, { tracked: { 'p.md': `${SECRET}\n` } });
  const r = scan(dir, `${SECRET}\n`, ['--json']);
  assert.equal(r.status, 1);
  const j = JSON.parse(r.stdout);
  assert.deepEqual(j.hits, [{ file: 'p.md', line: 1, rule: 'term #1' }]);
  assert.equal(j.count, 1);
  assert.equal(j.files, 1);
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
