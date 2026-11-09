/** @lane merge
 * @subject scripts/lint.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { classifyQuotes, LAYOUT_RISK_KEY, INTERLEAVED_LAYOUT } from '../scripts/lint.mjs';
import { gappedMatch, prepareDocument, tokenize } from '../scripts/lib/quote-match.mjs';
import { buildGraph } from '../scripts/lib/graph.mjs';
import { DISPOSITIONS_FILE, appendDispositions, recordFor } from '../scripts/lib/lint-dispositions.mjs';

// A clipping whose extraction interleaves two columns holds a quotation's words in order, but with a line of the other
// column between each pair of lines. The PDF clipper marks such a clipping `layout-risk: columns` in its frontmatter.
// A quotation that would be unverified, and whose words all place in order in one marked clipping with the other
// column's lines skipped, is in the `extraction-noted` tier: still listed with --json and --tier, with the skipped
// words to read, but no longer reported as unverifiable. Nothing else changes tier, and no id changes.

const LINT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'lint.mjs');

const FM = (title, layout) => `---\ntitle: "${title}"\nsource: "https://example.test/${title.toLowerCase()}"\ncreated: 2026-10-26\ntags: [clippings]\nquality: high\n${layout ? `${LAYOUT_RISK_KEY}: ${layout}\n` : ''}---\n`;

// Two columns read across: each line of the left column is followed by a line of the right one.
const ALPHA_BODY = [
  '# Two column paper',
  'The early arcade machines used dedicated sound',
  'Rainfall in the northern valleys was measured across three long seasons by survey teams',
  'chips that could play only a few simple tones',
  'who walked each ridge and wrote every reading into a waterproof field notebook daily',
  'at once, which shaped the music written for them.',
  '',
  'The second section explains how the cartridge stored',
  '148',
  'its samples in a compressed table of short loops.',
  '',
  'Designers of the period wrote melodies around',
  'the committee did not approve the budget for the new bridge in the spring session',
  'the limits of three voices and a noise channel.',
  '',
].join('\n');
const BETA_BODY = '# Beta notes\nIn the old port town the harbour froze solid during the long winter of that year.\n';

const ACROSS = 'The early arcade machines used dedicated sound chips that could play only a few simple tones at once, which shaped the music written for them';
const PAGES = {
  across: { cites: ['alpha-src'], body: `The paper says "${ACROSS}" in its first part.` },
  gapped: { cites: ['alpha-src'], body: 'The paper says "The second section explains how the cartridge stored its samples in a compressed table of short loops" later.' },
  negator: { cites: ['alpha-src'], body: 'The paper says "Designers of the period wrote melodies around the limits of three voices and a noise channel" too.' },
  convention: { cites: ['alpha-src'], body: 'The paper says "The early arcade machines, used dedicated sound" first.' },
  both: { cites: ['alpha-src'], body: 'The paper says "The early arcade machines used dedicated sound chips that could play only ... the limits of three voices and a noise channel" in short.' },
  split: { cites: ['alpha-src', 'beta-src'], body: 'Both say "The early arcade machines used dedicated sound chips that could play only ... the harbour froze solid during the long winter of that year" together.' },
};

function vault(t, { alpha, beta } = {}) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'wm-lint-layout-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const d of ['raw/clippings', 'wiki/concepts', 'wiki/sources']) mkdirSync(join(root, d), { recursive: true });
  const put = (p, text) => writeFileSync(join(root, p), text);
  put('index.md', '---\ntype: synthesis\n---\n# Index\n');
  put('raw/clippings/alpha.md', `${FM('Alpha', alpha)}${ALPHA_BODY}`);
  put('raw/clippings/beta.md', `${FM('Beta', beta)}${BETA_BODY}`);
  for (const name of ['alpha', 'beta']) {
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
  const r = spawnSync(process.execPath, [LINT, ...args], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};
const json = (root, ...args) => JSON.parse(run(root, '--json', ...args));

test('the key and value lint reads are the clipper contract: layout-risk: columns', () => {
  assert.equal(LAYOUT_RISK_KEY, 'layout-risk');
  assert.equal(INTERLEAVED_LAYOUT, 'columns');
});

test('unmarked, a quotation read across the interleaved columns is unverified', (t) => {
  assert.equal(findingsOf(vault(t)).across.tier, 'unverified');
});

test('marked columns, the quotation read across the columns is extraction-noted, with the clipping and the skipped words', (t) => {
  const f = findingsOf(vault(t, { alpha: 'columns' })).across;
  assert.equal(f.tier, 'extraction-noted');
  assert.equal(f.layoutRisk, 'columns');
  assert.equal(f.document, 'raw/clippings/alpha.md');
  assert.deepEqual(f.inserted, [
    'rainfall in the northern valleys was measured across three long seasons by survey teams',
    'who walked each ridge and wrote every reading into a waterproof field notebook daily',
  ]);
});

test('the moved finding keeps its id', (t) => {
  const before = findingsOf(vault(t)).across;
  const after = findingsOf(vault(t, { alpha: 'columns' })).across;
  assert.equal(after.id, before.id);
});

test('its evidence entry names the marked clipping, its lines and the skipped words in place', (t) => {
  const [e, ...rest] = findingsOf(vault(t, { alpha: 'columns' })).across.evidence;
  assert.equal(rest.length, 0);
  assert.equal(e.document, 'raw/clippings/alpha.md');
  assert.equal(e.kind, 'raw clipping');
  assert.equal(e.match, 'extraction-noted');
  assert.deepEqual(e.lines, [10, 14], 'the clipping has eight frontmatter lines and a heading');
  assert.match(e.diff, /^the early arcade machines used dedicated sound \{\+rainfall\+\} .* \{\+teams\+\} chips that could play/);
});

test('a quotation that is gapped on the marked clipping stays gapped', (t) => {
  const f = findingsOf(vault(t, { alpha: 'columns' })).gapped;
  assert.equal(f.tier, 'gapped');
  assert.deepEqual(f.inserted, ['148']);
  assert.equal(f.layoutRisk, undefined);
});

test('marked grid, or any other value, gives the old tier', (t) => {
  for (const alpha of ['grid', 'Columns', '"columns "', 'interleaved']) {
    assert.equal(findingsOf(vault(t, { alpha })).across.tier, 'unverified', alpha);
  }
});

test('a negator in a skipped run keeps the quotation unverified on a marked clipping', (t) => {
  assert.equal(findingsOf(vault(t)).negator.tier, 'unverified');
  assert.equal(findingsOf(vault(t, { alpha: 'columns' })).negator.tier, 'unverified');
});

test('a convention finding is unchanged by the mark', (t) => {
  const before = findingsOf(vault(t)).convention;
  const after = findingsOf(vault(t, { alpha: 'columns' })).convention;
  assert.equal(before.tier, 'convention');
  // The mark is one more frontmatter line, so only the evidence line numbers move.
  const unlined = (f) => ({ ...f, evidence: f.evidence.map(({ lines, ...e }) => e) });
  assert.deepEqual(unlined(after), unlined(before));
  assert.deepEqual(after.evidence[0].lines, before.evidence[0].lines.map((n) => n + 1));
});

test('every fragment places in the same marked clipping', (t) => {
  const marked = findingsOf(vault(t, { alpha: 'columns', beta: 'columns' }));
  assert.equal(marked.both.tier, 'extraction-noted', 'two fragments, both in the marked clipping');
  assert.deepEqual(marked.both.evidence.map((e) => [e.fragment, e.document, e.match]), [
    [0, 'raw/clippings/alpha.md', 'extraction-noted'],
    [1, 'raw/clippings/alpha.md', 'extraction-noted'],
  ]);
  assert.equal(marked.split.tier, 'unverified', 'the second fragment is only in another clipping');
});

test('--tier=extraction-noted lists it; the default listing does not; --json and --tier=all do', (t) => {
  const root = vault(t, { alpha: 'columns' });
  const listed = run(root, '--tier=extraction-noted');
  assert.match(listed, /Extraction-noted quotes: 2\n/);
  assert.match(listed, /wiki\/concepts\/across\.md/);
  assert.match(listed, /inserted: rainfall in the northern/);
  const plain = run(root);
  assert.match(plain, /Quote tiers: \d+ examined, \d+ verbatim, 1 convention, 2 extraction-noted, 1 gapped, 2 unverified\n/);
  assert.doesNotMatch(plain, /wiki\/concepts\/across\.md/);
  assert.doesNotMatch(plain, /Extraction-noted quotes/);
  assert.match(plain, /\n {2}extraction-noted: every word is in a clipping marked layout-risk: columns, in order across its interleaved columns; read the skipped words\n/);
  assert.match(run(root, '--tier=all'), /Extraction-noted quotes: 2\n[\s\S]*wiki\/concepts\/across\.md/);
  const out = json(root);
  const f = out.findings.find((x) => x.page === 'wiki/concepts/across.md');
  assert.equal(f.tier, 'extraction-noted');
  assert.equal(f.layoutRisk, 'columns');
  assert.equal(f.document, 'raw/clippings/alpha.md');
  assert.equal(f.insertedWords, 28);
  assert.equal(out.tiers['extraction-noted'], 2);
  assert.equal(out.tiers.unverified, 2, 'negator and split');
});

test('tiers.reviewed and tiers.unreviewed count it under the same key, and a recorded verdict hides it', (t) => {
  const root = vault(t, { alpha: 'columns' });
  const f = findingsOf(root).across;
  appendDispositions(join(root, DISPOSITIONS_FILE), [recordFor(f, { disposition: 'accepted', reviewer: 'reader', date: '2026-11-09' })]);
  const out = json(root, '--ids');
  assert.equal(out.tiers['extraction-noted'], 2);
  assert.equal(out.tiers.reviewed['extraction-noted'], 1);
  assert.equal(out.tiers.unreviewed['extraction-noted'], 1);
  assert.equal(out.findings.some((x) => x.id === f.id), false, 'a recorded verdict hides it');
  const all = json(root, '--ids', '--include-reviewed');
  assert.equal(all.findings.find((x) => x.id === f.id).reviewed.disposition, 'accepted');
  assert.match(run(root, '--tier=extraction-noted'), /Reviewed \(lint-dispositions\.jsonl\): .*extraction-noted 1.*; not yet reviewed: .*extraction-noted 1/);
});

test('gappedMatch keeps its defaults and takes maxRun and budget as options', () => {
  const doc = prepareDocument(ALPHA_BODY);
  const q = tokenize(ACROSS);
  assert.equal(gappedMatch(q, doc), null, 'a 14-word run is over the default bound');
  assert.equal(gappedMatch(q, doc, { maxRun: 13 }), null, 'the default budget still holds');
  assert.equal(gappedMatch(q, doc, { maxRun: 13, budget: 27 }), null, '28 words skipped');
  const placed = gappedMatch(q, doc, { maxRun: 14, budget: 28 });
  assert.equal(placed.cost, 28);
  assert.equal(placed.inserted.length, 2);
  const negated = tokenize('Designers of the period wrote melodies around the limits of three voices and a noise channel');
  assert.equal(gappedMatch(negated, doc, { maxRun: 40, budget: 200 }), null, 'a negator is never skipped');
});
