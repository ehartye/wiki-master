import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { renameUnsafeClippings } from '../scripts/rename-unsafe-clippings.mjs';
import { scanIntegrity } from '../scripts/health.mjs';

const GH = 'raw/clippings/gh/o/r';
const clipping = (title) => `---\ntitle: "${title}"\nsource: "https://example.com"\nsource-hash: "${'a'.repeat(64)}"\n---\n\nEvidence for ${title}.\n`;
const BODY = 'A substantive summary of the repository: its build, its ignore rules and the checks it runs on every push.';
const source = (name, cites, extra = '') => `---\ntype: source\nstatus: maintained\nsources:\n${cites.map((c) => `  - "[[${c}]]"`).join('\n')}\n---\n${BODY}\n${extra}`;

function vault(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'wm-rename-clip-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}
const read = (root, p) => readFileSync(join(root, p), 'utf8');
const rules = (root) => scanIntegrity(root).issues.map((i) => i.rule);

const base = () => ({
  [`${GH}/.gitignore.md`]: clipping('.gitignore'),
  [`${GH}/.github-workflows-ci.yml.md`]: clipping('ci'),
  [`${GH}/README.md`]: clipping('README'),
  'raw/clippings/`stringify` advisory.md': clipping('advisory'),
  'raw/book-nom/.booknom-state.json': '{"hidden":"on purpose"}',
  'wiki/sources/Repo Summary.md': source('Repo Summary', [`${GH}/.gitignore.md`, `${GH}/.github-workflows-ci.yml.md`, `${GH}/README.md`]),
  // Health blanks a backtick pair in BODY prose as a code span; the frontmatter copy resolves.
  'wiki/sources/Advisory.md': source('Advisory', ['raw/clippings/`stringify` advisory.md'], 'See [[raw/clippings/`stringify` advisory.md|the advisory]].\n'),
  'log/2026-01-01-ingest-repo.md': `## [2026-01-01] ingest | repo\n\nClipped ${GH}/.gitignore.md and [[${GH}/.gitignore.md]].\n`,
});

test('before the rename every citation of a hidden or backtick-named clipping is unresolved', (t) => {
  const root = vault(t, base());
  const found = rules(root);
  assert.ok(found.filter((r) => r === 'unresolved-citation').length >= 3, `expected unresolved citations, got ${found}`);
});

test('dry run plans every rename and repoint and writes nothing', (t) => {
  const root = vault(t, base());
  const before = readFileSync(join(root, 'wiki/sources/Repo Summary.md'), 'utf8');
  const r = renameUnsafeClippings(root);
  assert.equal(r.renames.length, 3);
  assert.equal(r.refused.length, 0);
  assert.deepEqual(r.pages.map((p) => [p.page, p.links]).sort(), [['wiki/sources/Advisory.md', 2], ['wiki/sources/Repo Summary.md', 2]]);
  assert.equal(read(root, 'wiki/sources/Repo Summary.md'), before);
  assert.ok(existsSync(join(root, GH, '.gitignore.md')));
  assert.ok(!existsSync(join(root, GH, 'dot-gitignore.md')));
});

test('--apply renames the files, repoints the citations and the graph resolves them', (t) => {
  const root = vault(t, base());
  const r = renameUnsafeClippings(root, { apply: true });
  assert.deepEqual(readdirSync(join(root, GH)).sort(), ['README.md', 'dot-github-workflows-ci.yml.md', 'dot-gitignore.md']);
  assert.ok(existsSync(join(root, 'raw/clippings/stringify advisory.md')));
  const page = read(root, 'wiki/sources/Repo Summary.md');
  assert.ok(page.includes(`[[${GH}/dot-gitignore.md]]`));
  assert.ok(page.includes(`[[${GH}/dot-github-workflows-ci.yml.md]]`));
  assert.ok(page.includes(`[[${GH}/README.md]]`));
  const advisory = read(root, 'wiki/sources/Advisory.md');
  assert.ok(advisory.includes('"[[raw/clippings/stringify advisory.md]]"'));
  assert.ok(advisory.includes('[[raw/clippings/stringify advisory.md|the advisory]]'));
  assert.deepEqual(rules(root), [], 'no integrity defect once the names are safe');
  assert.equal(read(root, `${GH}/dot-gitignore.md`), clipping('.gitignore'), 'clipping content is untouched');
  assert.deepEqual(r.paths, [...new Set(r.paths)].sort(), 'ledger is unique and sorted');
  for (const p of [`${GH}/.gitignore.md`, `${GH}/dot-gitignore.md`, 'wiki/sources/Repo Summary.md', 'wiki/sources/Advisory.md', 'raw/clippings/`stringify` advisory.md', 'raw/clippings/stringify advisory.md']) {
    assert.ok(r.paths.includes(p), `ledger lists ${p}`);
  }
});

test('a state file under raw/ and the log are left exactly as they were', (t) => {
  const root = vault(t, base());
  const log = read(root, 'log/2026-01-01-ingest-repo.md');
  const r = renameUnsafeClippings(root, { apply: true });
  assert.equal(read(root, 'raw/book-nom/.booknom-state.json'), '{"hidden":"on purpose"}');
  assert.equal(read(root, 'log/2026-01-01-ingest-repo.md'), log, 'log is append-only history');
  assert.ok(!r.paths.includes('log/2026-01-01-ingest-repo.md'));
  assert.ok(r.loose.some((l) => l.page === 'log/2026-01-01-ingest-repo.md'), 'the log mentions are reported, not hidden');
});

test('running it again finds nothing to do', (t) => {
  const root = vault(t, base());
  renameUnsafeClippings(root, { apply: true });
  const again = renameUnsafeClippings(root, { apply: true });
  assert.deepEqual([again.renames, again.refused, again.pages, again.paths], [[], [], [], []]);
});

test('a run that stopped after the page edits is finished by running it again', (t) => {
  const root = vault(t, base());
  // Simulate the crash: pages already repointed, files not yet renamed.
  const page = join(root, 'wiki/sources/Repo Summary.md');
  writeFileSync(page, read(root, 'wiki/sources/Repo Summary.md').replaceAll('/.gitignore.md', '/dot-gitignore.md'));
  const r = renameUnsafeClippings(root, { apply: true });
  assert.ok(existsSync(join(root, GH, 'dot-gitignore.md')));
  assert.deepEqual(rules(root), []);
  assert.equal(r.renames.length, 3);
});

test('a target that already exists is refused and nothing is overwritten', (t) => {
  const files = base();
  files[`${GH}/dot-gitignore.md`] = clipping('a different file that already has the safe name');
  const root = vault(t, files);
  const r = renameUnsafeClippings(root, { apply: true });
  assert.equal(r.refused.length, 1);
  assert.equal(r.refused[0].from, `${GH}/.gitignore.md`);
  assert.equal(read(root, `${GH}/dot-gitignore.md`), clipping('a different file that already has the safe name'));
  assert.ok(existsSync(join(root, GH, '.gitignore.md')), 'the refused file stays where it is');
});

test('a link example inside a code block keeps its old path and is reported', (t) => {
  const files = base();
  files['wiki/concepts/How To.md'] = `---\ntype: concept\nstatus: maintained\nsources: []\n---\nCite it as:\n\n\`\`\`\n[[${GH}/.gitignore.md]]\n\`\`\`\n`;
  const root = vault(t, files);
  renameUnsafeClippings(root, { apply: true });
  assert.ok(read(root, 'wiki/concepts/How To.md').includes(`[[${GH}/.gitignore.md]]`));
});
