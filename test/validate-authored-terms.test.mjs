import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Pages written for a plugin go into a public repository, so they must not name the owner's other projects or
// machines. `--terms-file` runs the same private list the repository scan uses over the pages of one ledger, and
// reports each hit by line and rule number only, so the report itself is safe to paste anywhere.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'scripts', 'validate-authored.mjs');
const SECRET = 'Zorblax Prime';

function page(project, body) {
  return `---\ntype: authored\ncreated: 2026-10-24\nupdated: 2026-10-24\nstatus: draft\nsources: []\nai-generated: true\nproject: ${project}\nkind: note\n---\n${body}`;
}

function world(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-vterms-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, text) => { const file = join(root, 'vault', path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };
  mkdirSync(join(root, 'vault', 'wiki'), { recursive: true });
  put('wiki/authored/plug/notes/clean.md', page('plug', '# Clean\n\nNothing private here.\n'));
  put('wiki/authored/plug/notes/leaky.md', page('plug', `# Leaky\n\nLine three is fine.\nWe borrowed this from ${SECRET} last year.\n`));
  put('wiki/authored/priv/notes/own.md', page('priv', `# Own\n\n${SECRET} is this project.\n`));
  writeFileSync(join(root, 'ledger.json'), JSON.stringify(['wiki/authored/plug/notes/clean.md', 'wiki/authored/plug/notes/leaky.md', 'wiki/authored/priv/notes/own.md']));
  writeFileSync(join(root, 'terms.txt'), `# private\n${SECRET}\n`);
  const run = (...extra) => spawnSync(process.execPath, [SCRIPT, '--paths-file', join(root, 'ledger.json'), ...extra], {
    encoding: 'utf8', timeout: 60000, env: { ...process.env, WIKI_MASTER_VAULT: join(root, 'vault') },
  });
  return { root, put, run, terms: join(root, 'terms.txt') };
}

test('without --terms-file the output is exactly what it was before', (t) => {
  const w = world(t);
  const r = w.run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /private-term/);
  assert.match(r.stdout, /3 pages checked, 0 defects/);
});

test('--terms-file reports a private-term defect at the right line, without the term', (t) => {
  const w = world(t);
  const r = w.run('--terms-file', w.terms);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /wiki\/authored\/plug\/notes\/leaky\.md:14 private-term term #1/);
  assert.match(r.stdout, /wiki\/authored\/priv\/notes\/own\.md:13 private-term term #1/);
  assert.doesNotMatch(r.stdout + r.stderr, /zorblax/i);
  assert.doesNotMatch(r.stdout, /clean\.md/);
});

test('--terms-projects limits the scan to the pages of the named projects', (t) => {
  const w = world(t);
  const r = w.run('--terms-file', w.terms, '--terms-projects', 'plug');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /plug\/notes\/leaky\.md:14 /);
  assert.doesNotMatch(r.stdout, /priv\/notes\/own\.md/, 'a private project may name itself');
  const none = w.run('--terms-file', w.terms, '--terms-projects', 'other');
  assert.equal(none.status, 0, 'no page belongs to the named project, so nothing is scanned');
  const sub = w.run('--terms-file', w.terms, '--terms-projects', 'priv');
  assert.match(sub.stdout, /priv\/notes\/own\.md:13 /);
  assert.doesNotMatch(sub.stdout, /leaky/);
});

test('the project of a sub-project page is its first segment', (t) => {
  const w = world(t);
  w.put('wiki/authored/plug/sub/notes/deep.md', page('plug/sub', `# Deep\n\n${SECRET} again.\n`));
  writeFileSync(join(w.root, 'ledger.json'), JSON.stringify(['wiki/authored/plug/sub/notes/deep.md']));
  const r = w.run('--terms-file', w.terms, '--terms-projects', 'plug');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /plug\/sub\/notes\/deep\.md:13 private-term/);
});

test('--json carries the rule and line, not the term', (t) => {
  const w = world(t);
  const r = w.run('--terms-file', w.terms, '--terms-projects', 'plug', '--json');
  const j = JSON.parse(r.stdout);
  const d = j.defects.find((x) => x.rule === 'private-term');
  assert.deepEqual([d.path, d.line], ['wiki/authored/plug/notes/leaky.md', 14]);
  assert.doesNotMatch(r.stdout, /zorblax/i);
});

test('an unreadable or malformed terms file exits 2 and names no term', (t) => {
  const w = world(t);
  const missing = w.run('--terms-file', join(w.root, 'nope.txt'));
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /terms file/i);
  writeFileSync(join(w.root, 'bad.txt'), 'fine\n/(unclosed/\n');
  const bad = w.run('--terms-file', join(w.root, 'bad.txt'));
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /line 2/);
  assert.doesNotMatch(bad.stderr, /unclosed/);
  const orphan = w.run('--terms-projects', 'plug');
  assert.equal(orphan.status, 2, '--terms-projects without --terms-file is a mistake, not a silent no-op');
});

test('the built-in machine patterns apply with --terms-file too', (t) => {
  const w = world(t);
  const home = ['C:', 'Users', 'jdoe', 'repos'].join(String.fromCharCode(92));
  w.put('wiki/authored/plug/notes/path.md', page('plug', `# Path\n\nSee ${home} for it.\n`));
  writeFileSync(join(w.root, 'ledger.json'), JSON.stringify(['wiki/authored/plug/notes/path.md']));
  const r = w.run('--terms-file', w.terms);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /path\.md:13 private-term home-path-windows/);
});
