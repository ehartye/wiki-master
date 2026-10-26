import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// On a Windows checkout with core.autocrlf=true every tracked file sat as CRLF in the working tree and LF
// in the index, so scripted multi-line edits found nothing, `git add` printed a warning per file, and a
// re-checkout did not change a stat-clean file. The repository now states its policy in .gitattributes
// (the vault already does): text files are LF in the index and in every working tree, whatever the
// machine's autocrlf says.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'buffer', stdio: ['ignore', 'pipe', 'pipe'] });
const inRepo = (() => { try { execFileSync('git', ['rev-parse', '--git-dir'], { cwd: ROOT, stdio: 'ignore' }); return true; } catch { return false; } })();

test('.gitattributes states the line-ending policy for every text file', () => {
  const rules = readFileSync(join(ROOT, '.gitattributes'), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  assert.ok(rules.includes('* text=auto eol=lf'), `rules: ${rules.join(' | ')}`);
});

test('with core.autocrlf=true, a CRLF file is stored as LF and a clone gets LF back: the policy wins over the machine', (t) => {
  const base = mkdtempSync(join(tmpdir(), 'wm-eol-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const src = join(base, 'src');
  const dst = join(base, 'dst');
  mkdirSync(src);
  git(src, 'init', '-q');
  git(src, 'config', 'core.autocrlf', 'true');
  copyFileSync(join(ROOT, '.gitattributes'), join(src, '.gitattributes'));
  writeFileSync(join(src, 'script.mjs'), 'const a = 1;\r\nconst b = 2;\r\n');
  git(src, 'add', '-A');
  git(src, 'commit', '-q', '-m', 'crlf file');
  const stored = git(src, 'show', 'HEAD:script.mjs');
  assert.ok(!stored.includes(0x0d), 'stored in the repository with LF only');
  git(base, '-c', 'core.autocrlf=true', 'clone', '-q', src, dst);
  assert.ok(!readFileSync(join(dst, 'script.mjs')).includes(0x0d), 'checked out with LF although autocrlf=true');
});

test('a binary file is not touched by the policy', (t) => {
  const base = mkdtempSync(join(tmpdir(), 'wm-eol-bin-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  git(base, 'init', '-q');
  git(base, 'config', 'core.autocrlf', 'true');
  copyFileSync(join(ROOT, '.gitattributes'), join(base, '.gitattributes'));
  const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x0d, 0x0a, 0x00, 0x01, 0x0d, 0x0a, 0xff]);
  writeFileSync(join(base, 'doc.pdf'), bytes);
  git(base, 'add', '-A');
  git(base, 'commit', '-q', '-m', 'binary');
  assert.deepEqual(git(base, 'show', 'HEAD:doc.pdf'), bytes);
});

test('no tracked text file in this repository is stored with CRLF', { skip: !inRepo && 'not a git checkout' }, () => {
  const listing = execFileSync('git', ['ls-files', '--eol'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).split('\n').filter(Boolean);
  const bad = listing.filter((l) => /^i\/(crlf|mixed)\b/.test(l.trim()));
  assert.deepEqual(bad, [], `stored with CRLF: ${bad.slice(0, 5).join(' ; ')}`);
});

test('a fresh checkout of this repository is LF in the working tree whatever autocrlf says', { skip: !inRepo && 'not a git checkout' }, (t) => {
  const base = mkdtempSync(join(tmpdir(), 'wm-eol-clone-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  // Clone the committed state of this checkout under the hostile setting. Only the policy and one script
  // are needed: a local clone of the whole history would be slow.
  const probe = join(base, 'probe');
  mkdirSync(probe);
  git(probe, 'init', '-q');
  git(probe, 'config', 'core.autocrlf', 'true');
  copyFileSync(join(ROOT, '.gitattributes'), join(probe, '.gitattributes'));
  const script = readFileSync(join(ROOT, 'scripts', 'clip.mjs'));
  writeFileSync(join(probe, 'clip.mjs'), script.toString('utf8').replace(/\r?\n/g, '\r\n'));
  git(probe, 'add', '-A');
  git(probe, 'commit', '-q', '-m', 'probe');
  assert.ok(!git(probe, 'show', 'HEAD:clip.mjs').includes(0x0d));
  assert.ok(existsSync(join(probe, 'clip.mjs')));
});
