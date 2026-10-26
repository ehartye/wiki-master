import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { classifyQuotes, checkStyle } from '../scripts/lint.mjs';
import { buildGraph } from '../scripts/lib/graph.mjs';

// A task that touched a few pages wants the content lint for those pages only. The lint examined the whole vault and let
// the caller filter what it printed (about two minutes and 1,800 findings for a run that wanted three pages). The scope
// narrows the work: `pages` for the functions, `--paths-file` (an ownership ledger) and `--updated-since` for the command.

const LINT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'lint.mjs');
const CLIP = 'The quick brown fox jumps over the lazy dog near the river bank every morning without fail.';
const GOOD = '"The quick brown fox jumps over the lazy dog near the river"';
const BAD = '"The slow brown fox jumps over the lazy dog near the river"';

function vault(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-lint-scope-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const d of ['raw/clippings', 'wiki/concepts', 'wiki/sources', 'wiki/syntheses']) mkdirSync(join(root, d), { recursive: true });
  writeFileSync(join(root, 'index.md'), '---\ntype: synthesis\n---\n# Index\n');
  writeFileSync(join(root, 'raw/clippings/fox.md'), `---\ntitle: "Fox"\nsource: "https://example.com/fox"\ncreated: 2026-10-26\nquality: high\n---\n${CLIP}\n`);
  writeFileSync(join(root, 'wiki/sources/fox-page.md'), '---\ntype: source\ncreated: 2026-10-26\nstatus: maintained\nsources: ["[[fox]]"]\nai-generated: true\n---\n# Fox page\nA summary of the clipping.\n');
  const page = (name, text, updated, dir = 'concepts') => writeFileSync(join(root, `wiki/${dir}/${name}.md`),
    `---\ntype: ${dir === 'syntheses' ? 'synthesis' : 'concept'}\ncreated: 2026-10-01\nupdated: ${updated}\nstatus: maintained\nsources: ["[[fox-page]]"]\nai-generated: true\n---\n# ${name}\n${text}\n`);
  page('alpha', `Alpha says ${BAD} in passing.`, '2026-10-02');
  page('beta', `Beta says ${BAD} in passing.`, '2026-10-20');
  page('gamma', `Gamma says ${BAD} in passing, and also ${GOOD}.`, '2026-10-26');
  page('delta', 'Delta is a synthesis that utilizes leveraging language, however it has no citation here.', '2026-10-26', 'syntheses');
  return root;
}
const run = (root, args) => spawnSync(process.execPath, [LINT, ...args], { encoding: 'utf8', env: { ...process.env, WIKI_MASTER_VAULT: root } });
const ledger = (root, paths) => { const f = join(root, '..', `ledger-${Math.random().toString(36).slice(2)}.json`); writeFileSync(f, JSON.stringify(paths)); return f; };
const pages = (r) => r.findings.map((f) => f.page).sort();

test('classifyQuotes with a set of pages examines only those pages', (t) => {
  const root = vault(t);
  const graph = buildGraph(root);
  const all = classifyQuotes(root, graph);
  assert.deepEqual(pages(all), ['wiki/concepts/alpha.md', 'wiki/concepts/beta.md', 'wiki/concepts/gamma.md']);
  assert.equal(all.examined, 4);
  const scoped = classifyQuotes(root, graph, { pages: new Set(['wiki/concepts/beta.md']) });
  assert.deepEqual(pages(scoped), ['wiki/concepts/beta.md']);
  assert.equal(scoped.examined, 1);
  assert.equal(scoped.verbatim, 0);
  const none = classifyQuotes(root, graph, { pages: new Set() });
  assert.deepEqual([none.examined, none.findings.length], [0, 0]);
});

test('without the option the result is what it was', (t) => {
  const root = vault(t);
  const graph = buildGraph(root);
  assert.deepEqual(classifyQuotes(root, graph), classifyQuotes(root, graph, {}));
  assert.deepEqual(classifyQuotes(root, graph), classifyQuotes(root, graph, { pages: undefined }));
});

test('checkStyle with a set of pages flags only those pages', (t) => {
  const root = vault(t);
  const graph = buildGraph(root);
  const all = checkStyle(root, graph);
  assert.ok(all.some((f) => f.page === 'wiki/syntheses/delta.md'));
  assert.deepEqual(checkStyle(root, graph, { pages: new Set(['wiki/concepts/alpha.md']) }), []);
  assert.deepEqual(checkStyle(root, graph, { pages: new Set(['wiki/syntheses/delta.md']) }), all.filter((f) => f.page === 'wiki/syntheses/delta.md'));
});

test('--paths-file limits the report to the ledger and says how many pages it covered', (t) => {
  const root = vault(t);
  const r = run(root, [`--paths-file=${ledger(root, ['wiki/concepts/alpha.md', 'wiki/concepts/beta.md'])}`, '--json']);
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.deepEqual(j.findings.map((f) => f.page).sort(), ['wiki/concepts/alpha.md', 'wiki/concepts/beta.md']);
  assert.equal(j.tiers.examined, 2);
  assert.deepEqual(j.scope, { pages: 2, named: 2, by: ['paths-file'] });
  const text = run(root, [`--paths-file=${ledger(root, ['wiki/concepts/alpha.md', 'wiki/concepts/nope.md'])}`]);
  assert.match(text.stdout, /^Scope: 1 of 2 named page\(s\) examined \(paths-file\)$/m);
});

test('--updated-since keeps the pages edited on or after the date', (t) => {
  const root = vault(t);
  const j = JSON.parse(run(root, ['--updated-since=2026-10-20', '--json']).stdout);
  assert.deepEqual(j.findings.map((f) => f.page).sort(), ['wiki/concepts/beta.md', 'wiki/concepts/gamma.md']);
  assert.deepEqual(j.scope, { pages: 3, by: ['updated-since'] }, 'beta, gamma and delta; a page with no updated: key is not "updated since" anything');
  assert.match(run(root, ['--updated-since=2026-10-20']).stdout, /^Scope: 3 page\(s\) updated on or after 2026-10-20$/m);
});

test('--paths-file and --updated-since together keep the pages that satisfy both', (t) => {
  const root = vault(t);
  const j = JSON.parse(run(root, [`--paths-file=${ledger(root, ['wiki/concepts/alpha.md', 'wiki/concepts/gamma.md'])}`, '--updated-since=2026-10-20', '--json']).stdout);
  assert.deepEqual(j.findings.map((f) => f.page), ['wiki/concepts/gamma.md']);
  assert.deepEqual(j.scope.by, ['paths-file', 'updated-since']);
});

test('a run with neither option prints no scope line and keeps its output', (t) => {
  const root = vault(t);
  const text = run(root, []).stdout;
  assert.doesNotMatch(text, /Scope:/);
  assert.match(text, /Quote tiers: 4 examined, 1 verbatim/);
  const j = JSON.parse(run(root, ['--json']).stdout);
  assert.equal('scope' in j, false);
});

test('bad scope options stop with one line and exit 2', (t) => {
  const root = vault(t);
  for (const args of [['--updated-since=yesterday'], ['--paths-file=/no/such/ledger.json'], ['--updated-since=2026-13-45']]) {
    const r = run(root, args);
    assert.equal(r.status, 2, args.join(' '));
    assert.equal(r.stderr.trim().split('\n').length, 1, r.stderr);
  }
});
