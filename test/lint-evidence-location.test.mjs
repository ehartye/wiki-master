/** @lane merge
 * @subject scripts/lint.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { classifyQuotes, quoteFragments } from '../scripts/lint.mjs';
import { buildGraph } from '../scripts/lib/graph.mjs';

// Every listed quote finding names where its evidence is: one `evidence` entry per fragment, in fragment order, with
// the document, its kind, the 1-based file lines (frontmatter counted) and how the fragment matched. Convention and
// gapped entries come from the match that set the tier; an unverified fragment gets its best near window, with no
// word floor and no threshold. Lines are given only where a per-line reading of the document gives the same words as
// the whole-text reading; otherwise the entry says `linesUnavailable`.

const LINT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'lint.mjs');
const FM = (title) => `---\ntitle: "${title}"\nsource: "https://example.test/${title.toLowerCase()}"\ncreated: 2026-10-26\ntags: [clippings]\nquality: high\n---\n`;

const ALPHA = `${FM('Alpha')}# Alpha report\nAn opening line with nothing quoted in it.\nThe committee concluded that sampling error rather\nthan bias explained the divergence in the results.\n`;
const BETA = `${FM('Beta')}# Beta manual\nThe pipeline runs each stage in order\n148 Chapter 8\nand then hands the result to the next stage without delay.\n`;
// A tag that spans a line: the whole text drops it, a line-by-line reading does not, so lines cannot be trusted.
const GAMMA = `${FM('Gamma')}# Gamma notes\nA <span\nclass="note">marked</span> passage says the harbour froze solid during the long winter.\n`;

const PAGES = {
  convention: { cites: ['alpha-src'], body: 'The report says "The committee concluded that sampling error, rather than bias, explained the divergence" plainly.' },
  gapped: { cites: ['beta-src'], body: 'The manual says "The pipeline runs each stage in order and then hands the result to the next stage without delay" here.' },
  short: { cites: ['alpha-src'], body: 'The report says "[The board] sampling mistake explained" in brief.' },
  two: { cites: ['alpha-src', 'beta-src'], body: 'Both say "The committee concluded that sampling error, rather than bias, explained ... the pipeline runs each stage in order and then hands the result" together.' },
  tagged: { cites: ['gamma-src'], body: 'The notes say "a marked passage says the harbour froze solid, during the long winter" once.' },
  nowhere: { cites: ['alpha-src'], body: 'The report says "zebra quantum xylophone marmalade obelisk" oddly.' },
};

function vault(t) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'wm-lint-evidence-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const d of ['raw/clippings', 'wiki/concepts', 'wiki/sources']) mkdirSync(join(root, d), { recursive: true });
  const put = (p, text) => writeFileSync(join(root, p), text);
  put('index.md', '---\ntype: synthesis\n---\n# Index\n');
  for (const [name, text] of Object.entries({ alpha: ALPHA, beta: BETA, gamma: GAMMA })) {
    put(`raw/clippings/${name}.md`, text);
    put(`wiki/sources/${name}-src.md`, `---\ntype: source\ncreated: 2026-10-26\nstatus: maintained\nsources: ["[[${name}]]"]\nai-generated: true\n---\n# ${name} source\nA summary of an unrelated topic about gardens.\n`);
  }
  for (const [name, { cites, body }] of Object.entries(PAGES)) {
    put(`wiki/concepts/${name}.md`, `---\ntype: concept\ncreated: 2026-10-26\nstatus: maintained\nsources: [${cites.map((c) => `"[[${c}]]"`).join(', ')}]\nai-generated: true\n---\n# ${name}\n${body}\n`);
  }
  return root;
}

const findingsOf = (root) => {
  const by = {};
  for (const f of classifyQuotes(root, buildGraph(root)).findings) by[f.page.replace(/^wiki\/concepts\/|\.md$/g, '')] = f;
  return by;
};
const run = (root, ...args) => {
  const env = { ...process.env, WIKI_MASTER_VAULT: root };
  delete env.NODE_TEST_CONTEXT;
  return execFileSync(process.execPath, [LINT, ...args], { encoding: 'utf8', env });
};
const lineOf = (root, path, text) => readFileSync(join(root, path), 'utf8').split('\n').findIndex((l) => l.includes(text)) + 1;

test('a convention finding names its clipping and the line range its words occupy', (t) => {
  const f = findingsOf(vault(t)).convention;
  assert.equal(f.tier, 'convention');
  assert.deepEqual(f.evidence, [{ fragment: 0, document: 'raw/clippings/alpha.md', kind: 'raw clipping', lines: [10, 11], match: 'convention' }]);
});

test('line numbers count the frontmatter', (t) => {
  const root = vault(t);
  const [e] = findingsOf(root).convention.evidence;
  const first = lineOf(root, 'raw/clippings/alpha.md', 'The committee concluded');
  assert.ok(first > 7, 'the clipping has seven frontmatter lines');
  assert.deepEqual(e.lines, [first, lineOf(root, 'raw/clippings/alpha.md', 'than bias explained')]);
});

test('a gapped finding shows each inserted word in place in its diff', (t) => {
  const root = vault(t);
  const f = findingsOf(root).gapped;
  assert.equal(f.tier, 'gapped');
  assert.deepEqual(f.inserted, ['148 chapter 8']);
  const [e] = f.evidence;
  assert.equal(e.document, 'raw/clippings/beta.md');
  assert.equal(e.match, 'gapped');
  assert.equal(e.diff, 'the pipeline runs each stage in order {+148+} {+chapter+} {+8+} and then hands the result to the next stage without delay');
  assert.deepEqual(e.lines, [lineOf(root, 'raw/clippings/beta.md', 'The pipeline runs'), lineOf(root, 'raw/clippings/beta.md', 'and then hands')]);
});

test('an unverified finding of three words names its best window with match "near"', (t) => {
  const root = vault(t);
  const f = findingsOf(root).short;
  assert.equal(f.tier, 'unverified');
  assert.deepEqual(quoteFragments(f.quote), ['sampling mistake explained'], 'one fragment of three words, under the --near floor');
  assert.equal(f.evidence.length, 1);
  const [e] = f.evidence;
  assert.equal(e.match, 'near');
  assert.equal(e.document, 'raw/clippings/alpha.md');
  assert.equal(e.kind, 'raw clipping');
  assert.equal(e.score, 0.67);
  assert.match(e.diff, /sampling .*\[-mistake-\].*explained/);
  const first = lineOf(root, 'raw/clippings/alpha.md', 'sampling error');
  assert.deepEqual(e.lines, [first, first + 1]);
});

test('a quote with two fragments in two clippings has two entries, in fragment order', (t) => {
  const f = findingsOf(vault(t)).two;
  assert.equal(f.evidence.length, 2);
  assert.deepEqual(f.evidence.map((e) => [e.fragment, e.document, e.match]), [
    [0, 'raw/clippings/alpha.md', 'convention'],
    [1, 'raw/clippings/beta.md', 'gapped'],
  ]);
});

test('a clipping with a multi-line tag gives linesUnavailable and no lines', (t) => {
  const f = findingsOf(vault(t)).tagged;
  assert.equal(f.tier, 'convention');
  const [e] = f.evidence;
  assert.equal(e.document, 'raw/clippings/gamma.md');
  assert.equal(e.linesUnavailable, true);
  assert.equal('lines' in e, false);
});

test('a quote with no window in any evidence document has document null', (t) => {
  const f = findingsOf(vault(t)).nowhere;
  assert.equal(f.tier, 'unverified');
  assert.equal(f.evidence.length, 1);
  assert.equal(f.evidence[0].document, null);
  assert.equal(f.evidence[0].fragment, 0);
});

test('every finding has one evidence entry per fragment, and --json carries them', (t) => {
  const root = vault(t);
  const out = JSON.parse(run(root, '--json'));
  assert.equal(out.findings.length, Object.keys(PAGES).length);
  for (const f of out.findings) {
    assert.ok(Array.isArray(f.evidence), f.page);
    assert.equal(f.evidence.length, quoteFragments(f.quote).length, f.page);
    assert.deepEqual(f.evidence.map((e) => e.fragment), f.evidence.map((_, i) => i), f.page);
  }
  const gapped = out.findings.find((f) => f.tier === 'gapped');
  assert.equal(gapped.insertedWords, 3, 'the existing gapped fields are unchanged');
});

test('--full prints an evidence line under each finding; the listing without --full has none', (t) => {
  const root = vault(t);
  const full = run(root, '--full', '--tier=all');
  assert.match(full, /wiki\/concepts\/convention\.md\n {4}".*" \(checked \d+ sources\)\n {4}evidence: raw\/clippings\/alpha\.md:10-11\n/);
  assert.match(full, /evidence: raw\/clippings\/beta\.md:\d+-\d+/);
  const plain = run(root, '--tier=all');
  assert.doesNotMatch(plain, /evidence:/);
  // Apart from the evidence lines and the unshortened quotes, --full lists the same lines in the same order.
  const strip = (s) => s.split('\n').filter((l) => !/^ {4}evidence: /.test(l) && !/^ {4}"/.test(l)).join('\n');
  assert.equal(strip(full), strip(plain));
});
