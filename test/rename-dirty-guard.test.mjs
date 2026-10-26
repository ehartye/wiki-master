import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runRenameCli } from '../scripts/rename-unsafe-clippings.mjs';
import { renameDoubledExtensionClippings } from '../scripts/rename-doubled-extension-clippings.mjs';

// The vault is shared. A rename that rewrites a page another writer is in the middle of editing would mix
// the two edits, and the repoint could not be committed with the rename. An apply therefore refuses to
// start when any file it would change has uncommitted changes, and changes nothing.

const GH = 'raw/clippings/gh/acme/agent';
const FILES = {
  [`${GH}/README.md.md`]: '---\ntitle: "README"\nsource: "https://x.test/r"\n---\nEvidence one.\n',
  'wiki/sources/Cites.md': `---\ntype: source\nsources:\n  - "[[${GH}/README.md.md]]"\n---\nA substantive summary of the repository and its build.\n`,
  'wiki/sources/Other.md': '---\ntype: source\nsources: []\n---\nUnrelated page.\n',
};

function gitVault(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-dirty-'));
  const prior = process.env.WIKI_MASTER_VAULT;
  process.env.WIKI_MASTER_VAULT = root;
  t.after(() => { if (prior === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = prior; rmSync(root, { recursive: true, force: true }); });
  for (const [path, text] of Object.entries(FILES)) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); }
  const git = (...a) => execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'core.autocrlf=false', ...a], { stdio: 'pipe' });
  git('init', '-q'); git('add', '-A'); git('commit', '-q', '-m', 'init');
  return { root, git };
}
const quiet = (fn) => { const log = console.log, err = console.error; console.log = () => {}; console.error = () => {}; try { return fn(); } finally { console.log = log; console.error = err; } };
const run = (argv) => quiet(() => runRenameCli(argv, { type: 'rename-doubled-extension-clippings', run: renameDoubledExtensionClippings }));

test('an apply refuses to start when a page it would rewrite has uncommitted changes, and changes nothing', (t) => {
  const v = gitVault(t);
  writeFileSync(join(v.root, 'wiki/sources/Cites.md'), `${FILES['wiki/sources/Cites.md']}\nSomeone else is editing this.\n`);
  assert.throws(() => run(['--apply']), /uncommitted changes[\s\S]*wiki\/sources\/Cites\.md/);
  assert.ok(existsSync(join(v.root, `${GH}/README.md.md`)));
  assert.match(readFileSync(join(v.root, 'wiki/sources/Cites.md'), 'utf8'), /README\.md\.md/);
});

test('an apply refuses when a file it would rename has uncommitted changes', (t) => {
  const v = gitVault(t);
  writeFileSync(join(v.root, `${GH}/README.md.md`), `${FILES[`${GH}/README.md.md`]}edited\n`);
  assert.throws(() => run(['--apply']), /uncommitted changes/);
  assert.ok(existsSync(join(v.root, `${GH}/README.md.md`)));
});

test('an unrelated uncommitted file does not block an apply', (t) => {
  const v = gitVault(t);
  writeFileSync(join(v.root, 'wiki/sources/Other.md'), `${FILES['wiki/sources/Other.md']}\nSomeone else is editing this.\n`);
  const r = run(['--apply']);
  assert.equal(r.renames.length, 1);
  assert.ok(existsSync(join(v.root, `${GH}/README.md`)));
});

test('a dry run never refuses, even when files it would touch are dirty', (t) => {
  const v = gitVault(t);
  writeFileSync(join(v.root, 'wiki/sources/Cites.md'), `${FILES['wiki/sources/Cites.md']}\nSomeone else is editing this.\n`);
  assert.equal(run([]).renames.length, 1);
});

test('a vault that is not a git repository is not blocked', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'wm-nogit-'));
  const prior = process.env.WIKI_MASTER_VAULT;
  process.env.WIKI_MASTER_VAULT = root;
  t.after(() => { if (prior === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = prior; rmSync(root, { recursive: true, force: true }); });
  for (const [path, text] of Object.entries(FILES)) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); }
  assert.equal(run(['--apply']).renames.length, 1);
});
