import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// A skill rename leaves other plugins citing names that no longer exist. check-skill-citations reads the current
// names from this plugin's skills/ folder and reports every `wiki-master:<name>` below the given directories that
// is not one of them, with the replacement from docs/skill-migration.md when that table has one.

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'check-skill-citations.mjs');

function plugin(t, files) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'wm-citations-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}
const scan = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 30000 });

test('a retired name is reported with file:line and its replacement, and the run exits 1', (t) => {
  const dir = plugin(t, { 'skills/helper/SKILL.md': '---\nname: helper\n---\nLoad wiki-master:wiki-author to write the page.\n' });
  const r = scan(dir);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /SKILL\.md:4: wiki-master:wiki-author is not a current skill; use wiki-master:wiki-project/);
});

test('a current name passes with exit 0', (t) => {
  const dir = plugin(t, { 'skills/helper/SKILL.md': 'Use @wiki-master:wiki-search first, then wiki-master:wiki-setup.\n' });
  const r = scan(dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /is not a current skill/);
});

test('JSON files are read, node_modules and .git are not, and a name with no replacement is still reported', (t) => {
  const dir = plugin(t, {
    '.claude-plugin/plugin.json': '{\n  "skills": ["wiki-master:wiki-ingest"]\n}\n',
    'node_modules/dep/README.md': 'wiki-master:wiki-author\n',
    '.git/notes.md': 'wiki-master:wiki-author\n',
    'notes.txt': 'wiki-master:wiki-author\n',
    'docs/guide.md': 'Ask wiki-master:wiki-unheard-of.\n',
  });
  const r = scan(dir);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /plugin\.json:2: wiki-master:wiki-ingest is not a current skill; use wiki-master:wiki-researcher/);
  assert.match(r.stdout, /guide\.md:1: wiki-master:wiki-unheard-of is not a current skill\s*$/m);
  assert.doesNotMatch(r.stdout, /node_modules|[\\/]\.git[\\/]|notes\.txt/);
});

test('dated records under docs/superpowers/ are skipped unless --include-history', (t) => {
  const dir = plugin(t, { 'docs/superpowers/plans/2026-01-01-plan.md': 'line one\nRun wiki-master:wiki-discover.\n' });
  const quiet = scan(dir);
  assert.equal(quiet.status, 0, quiet.stdout);
  const full = scan('--include-history', dir);
  assert.equal(full.status, 1);
  assert.match(full.stdout, /2026-01-01-plan\.md:2: wiki-master:wiki-discover is not a current skill; use wiki-master:wiki-researcher/);
});

test('several directories are scanned in one run', (t) => {
  const a = plugin(t, { 'a.md': 'wiki-master:wiki-search\n' });
  const b = plugin(t, { 'b.md': 'wiki-master:wiki-health\nwiki-master:clip-pdf\n' });
  const r = scan(a, b);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /b\.md:2: wiki-master:clip-pdf is not a current skill; use wiki-master:wiki-researcher/);
  assert.match(r.stdout, /b\.md:1: wiki-master:wiki-health is not a current skill; use wiki-master:wiki-setup/);
});

test('no directory, or one that does not exist, is a usage error with exit 2', (t) => {
  const none = scan();
  assert.equal(none.status, 2);
  assert.match(none.stderr, /usage: node scripts\/check-skill-citations\.mjs/);
  const missing = join(plugin(t, {}), 'not-here');
  const r = scan(missing);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /not a directory/);
});
