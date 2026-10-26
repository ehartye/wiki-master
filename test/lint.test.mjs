import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { checkQuotes, checkStyle, classifyQuotes, normalize, quoteFragments, quotedSpans } from '../scripts/lint.mjs';
import { buildGraph } from '../scripts/lib/graph.mjs';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'lint-vault');
const graph = () => buildGraph(FIXTURE);

// Both lints are WARN-ONLY by contract: they flag for review, never fix,
// never touch the health score. Quotations are exempt from style checks;
// declared-unsourced sentences are exempt from quote checks — those are the
// style policy working, not violations.

test('normalize folds typographic quotes, dashes, ellipses, case, whitespace', () => {
  assert.equal(
    normalize('“The  Fox—jumps… over-the ‘dog’”'),
    normalize('"the fox-jumps... over-the \'dog\'"')
  );
});

test('normalize handles PDF artifacts: ligatures and doubled straight quotes', () => {
  // Observed live: pdftotext emits ﬁ-ligatures and '' where the citing page
  // has ascii fi and a single quote.
  assert.equal(normalize("to ''incite the look'' and ﬁnd out"),
               normalize("to 'incite the look' and find out"));
});

test('normalize strips author-added markdown emphasis inside quotes', () => {
  assert.equal(normalize('An example from *Super Mario Bros.* is **the tempo**'),
               normalize('An example from Super Mario Bros. is the tempo'));
});

test('quoteFragments splits on editorial elisions and bracketed insertions', () => {
  assert.deepEqual(
    quoteFragments('The player ... controls the event cue, and [in Rez] can trigger the cue'),
    ['The player', 'controls the event cue, and', 'can trigger the cue'].filter(
      (f) => (f.match(/\S+/g) || []).length >= 3
    )
  );
});

test('checkQuotes verifies a genuine quote through the transitive raw/ trail', () => {
  const findings = checkQuotes(FIXTURE, graph());
  // good.md quotes raw text via its source page's provenance chain.
  assert.ok(!findings.some((f) => f.page.includes('good.md')), 'genuine quote passes');
});

test('checkQuotes flags a fabricated quote with page attribution', () => {
  const findings = checkQuotes(FIXTURE, graph());
  const bad = findings.find((f) => f.page === 'wiki/concepts/bad.md');
  assert.ok(bad, 'fabricated quote is flagged');
  assert.ok(bad.quote.includes('completely fabricated'), 'finding carries the quote');
  assert.ok(bad.checked >= 1, 'reports how many sources were checked');
});

// A finding must carry the WHOLE quote. Truncating it here silently corrupts any
// tool that re-checks the finding: a long quote whose opening matches a source and
// whose tail does not will verify on the prefix and be misread as merely miscited
// rather than genuinely unsupported. Truncation is a display concern and belongs
// in the printer.
test('checkQuotes findings carry the full quote, not a truncated one', () => {
  const f = checkQuotes(FIXTURE, graph()).find((x) => x.page === 'wiki/concepts/long-quote.md');
  assert.ok(f, 'the long fabricated quote is flagged');
  assert.ok(f.quote.length > 80, 'the quote is long enough for truncation to be visible');
  assert.ok(f.quote.endsWith('visible to the assertion'), 'the tail of the quote survives');
});

test('checkQuotes follows body links to source pages (both breadcrumb channels)', () => {
  const findings = checkQuotes(FIXTURE, graph());
  // body-linked.md has NO sources: frontmatter; its trail is a body [[wikilink]]
  // to the source page. The v0.2.2 breadcrumb rule names both channels.
  assert.ok(!findings.some((f) => f.page.includes('body-linked.md')),
    'quote verifies through body-link trail');
});

// Real bug, found live in the vault: evidenceBodies() builds its own byName
// map identically to graph.mjs and does the same raw `byName.get(t.toLowerCase())`
// lookup with no path/extension normalization. Since the vault's real
// `sources:` convention cites raw clippings as `[[raw/clippings/X.md]]` (path
// + extension qualified — see qualified-src-page.md), the transitive walk
// from a concept page -> its source page -> the underlying raw clipping
// silently broke at exactly that second hop, so a genuine quote that only
// appears in the raw file (not restated on the source page) was falsely
// flagged as unverifiable.
test('checkQuotes follows a path+extension-qualified sources: citation through to the raw clipping', () => {
  const findings = checkQuotes(FIXTURE, graph());
  assert.ok(!findings.some((f) => f.page.includes('path-qualified-citation.md')),
    'genuine quote in the raw file verifies through the qualified source-page -> raw/ hop');
});

test('checkQuotes exempts sentences that declare themselves unsourced', () => {
  const findings = checkQuotes(FIXTURE, graph());
  assert.ok(!findings.some((f) => f.page.includes('declared.md')),
    'declared-unsourced is the policy working, not a violation');
});

// A page declaring `sources: []` (wiki/authored/ and anywhere else) has, by its
// own declaration, no external artifact to verify a quote against. Before this
// exemption, ANY quotation on such a page was flagged unverifiable against zero
// evidence — a 100% false-positive rate the page's own frontmatter already
// explained away.
test('checkQuotes exempts pages that declare `sources: []` entirely', () => {
  const findings = checkQuotes(FIXTURE, graph());
  assert.ok(!findings.some((f) => f.page.includes('wiki/authored/policy.md')),
    'a declared-no-provenance page is not checked for quote provenance at all');
});

test('checkStyle applies the full list to entities and flags by category', () => {
  const findings = checkStyle(FIXTURE, graph());
  const puffy = findings.filter((f) => f.page === 'wiki/entities/puffy.md');
  const cats = new Set(puffy.map((f) => f.category));
  assert.ok(cats.has('puffery'), 'legendary/world-class flagged');
  assert.ok(cats.has('editorializing'), 'clearly flagged');
  assert.ok(cats.has('weasel'), 'some say / widely regarded flagged');
  assert.ok(cats.has('said-verbs'), 'revealed flagged');
});

test('checkStyle flags contrast connectives without citations only in syntheses', () => {
  const findings = checkStyle(FIXTURE, graph());
  const synth = findings.filter((f) => f.page === 'wiki/syntheses/synthy.md' && f.category === 'connective');
  assert.ok(synth.length >= 1, 'uncited However/despite sentence flagged in synthesis');
  // The connective category never fires outside syntheses/.
  assert.ok(!findings.some((f) => f.category === 'connective' && !f.page.startsWith('wiki/syntheses/')));
});

test('checkStyle exempts quoted spans', () => {
  const findings = checkStyle(FIXTURE, graph());
  // declared.md's flagged-word-free prose plus quotes must produce no style hits;
  // more precisely: nothing inside quotation marks is ever flagged.
  assert.ok(!findings.some((f) => f.page.includes('declared.md')));
});

// wiki/authored/ carries the same permissive license as wiki/syntheses/: these
// are the vault's own first-party voice (advisory documentation, policy, house
// style), and directive language ("clearly", "world-class", "revealed") is the
// point, not a defect to flag.
test('checkStyle applies no style license to wiki/authored/', () => {
  const findings = checkStyle(FIXTURE, graph());
  assert.deepEqual(findings.filter((f) => f.page === 'wiki/authored/policy.md'), []);
});

// ── quote tiers ──────────────────────────────────────────────────────────────
// verbatim (not reported) → convention (same words, markup/punctuation/spacing
// differ) → gapped (all words in order, extra evidence words between them) →
// unverified. Convention and gapped are NOT silently passed: the first is a
// counted pointer, the second lists the inserted words so a reviewer can tell
// extraction noise from a silent omission.

const tierOf = (res, page) => res.findings.filter((f) => f.page === `wiki/concepts/${page}.md`);

test('classifyQuotes: markup, punctuation and extraction-split words are the convention tier', () => {
  const res = classifyQuotes(FIXTURE, graph());
  const found = tierOf(res, 'tier-convention');
  assert.equal(found.length, 2, 'both quotes on the page are flagged by the verbatim check');
  assert.ok(found.every((f) => f.tier === 'convention'), JSON.stringify(found.map((f) => f.tier)));
});

test('classifyQuotes: a quote with extra evidence words inside is gapped and shows them', () => {
  const [f] = tierOf(classifyQuotes(FIXTURE, graph()), 'tier-gapped');
  assert.equal(f.tier, 'gapped');
  assert.deepEqual(f.inserted, ['148 chapter 8']);
  assert.ok(f.quote.includes('then hands the result'), 'carries the whole quote');
});

test('classifyQuotes: a substituted word and a dropped negation stay unverified', () => {
  const res = classifyQuotes(FIXTURE, graph());
  assert.equal(tierOf(res, 'tier-substituted')[0].tier, 'unverified');
  assert.equal(tierOf(res, 'tier-negation-dropped')[0].tier, 'unverified');
  assert.equal(tierOf(res, 'bad')[0].tier, 'unverified');
});

test('classifyQuotes: verbatim quotes are counted but not reported; totals add up', () => {
  const res = classifyQuotes(FIXTURE, graph());
  assert.ok(!res.findings.some((f) => f.page.includes('good.md')));
  assert.ok(res.verbatim >= 1, 'good.md has a verbatim quote');
  assert.equal(res.examined, res.verbatim + res.findings.length);
});

test('classifyQuotes: a page saying the text is not in the clipped source is exempt', () => {
  assert.deepEqual(tierOf(classifyQuotes(FIXTURE, graph()), 'tier-declared-absent'), []);
});

test('checkQuotes keeps its contract: every non-verbatim quote, {page, quote, checked}', () => {
  const findings = checkQuotes(FIXTURE, graph());
  for (const page of ['tier-convention', 'tier-gapped', 'tier-substituted', 'bad']) {
    assert.ok(findings.some((f) => f.page === `wiki/concepts/${page}.md`), page);
  }
  for (const f of findings) assert.deepEqual(Object.keys(f).sort(), ['checked', 'page', 'quote']);
});

const runLint = (...args) => execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'lint.mjs'), ...args],
  { env: { ...process.env, WIKI_MASTER_VAULT: FIXTURE }, encoding: 'utf8' });

test('lint --json emits tier counts, tiered findings and style flags', () => {
  const out = JSON.parse(runLint('--json'));
  assert.deepEqual(Object.keys(out.tiers).sort(), ['convention', 'examined', 'gapped', 'title', 'unverified', 'verbatim']);
  assert.equal(out.tiers.convention, out.findings.filter((f) => f.tier === 'convention').length);
  assert.equal(out.tiers.gapped, out.findings.filter((f) => f.tier === 'gapped').length);
  assert.equal(out.tiers.unverified, out.findings.filter((f) => f.tier === 'unverified').length);
  assert.ok(Array.isArray(out.style) && out.style.some((s) => s.page === 'wiki/entities/puffy.md'));
  assert.ok(out.findings.every((f) => f.quote && f.page && f.tier && Number.isInteger(f.checked)));
});

test('lint --json --tier and --page filter the findings but not the counts', () => {
  const all = JSON.parse(runLint('--json'));
  const gapped = JSON.parse(runLint('--json', '--tier=gapped'));
  assert.ok(gapped.findings.length >= 1 && gapped.findings.every((f) => f.tier === 'gapped'));
  assert.deepEqual(gapped.tiers, all.tiers);
  const one = JSON.parse(runLint('--json', '--page=tier-substituted'));
  assert.deepEqual([...new Set(one.findings.map((f) => f.page))], ['wiki/concepts/tier-substituted.md']);
});

test('lint human output leads with tier counts, lists gapped inserts, and --full avoids truncation', () => {
  const out = runLint();
  assert.match(out, /Quote tiers: \d+ examined, \d+ verbatim, \d+ convention, \d+ gapped, \d+ unverified/);
  assert.match(out, /Gapped quotes: 1/);
  assert.match(out, /inserted: 148 chapter 8/);
  assert.match(out, /Unverifiable quotes: \d+/);
  const long = runLint('--tier=unverified');
  assert.ok(!long.includes('visible to the assertion'), 'default output truncates long quotes for display');
  assert.ok(runLint('--tier=unverified', '--full').includes('visible to the assertion'), '--full prints the whole quote');
});

// ── nested quotations ────────────────────────────────────────────────────────
// A phrase quoted inside a quotation belongs to the outer quote. The old
// extractor removed curly pairs first, so a curly phrase inside a straight
// quotation vanished from the outer text and left a gap of spaces that read as
// inserted words. These tests build their own throwaway vaults.

const BROWN = 'We conclude that in the field of public education the doctrine of “separate but equal” has no place.';

function nestedVault(t, clipping, pages) {
  const root = mkdtempSync(join(tmpdir(), 'wm-lint-nested-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const d of ['raw/clippings', 'wiki/concepts', 'wiki/sources']) mkdirSync(join(root, d), { recursive: true });
  writeFileSync(join(root, 'index.md'), '---\ntype: synthesis\n---\n# Index\n');
  writeFileSync(join(root, 'raw/clippings/clip.md'),
    `---\ntitle: "Clip"\nsource: "https://example.com/clip"\ncreated: 2026-10-24\ntags: [clippings]\nquality: high\n---\n${clipping}\n`);
  writeFileSync(join(root, 'wiki/sources/clip-page.md'),
    '---\ntype: source\ncreated: 2026-10-24\nstatus: maintained\nsources: ["[[clip]]"]\nai-generated: true\n---\n# Clip Page\nA summary of the clipping.\n');
  for (const [name, body] of Object.entries(pages)) {
    writeFileSync(join(root, 'wiki/concepts', `${name}.md`),
      `---\ntype: concept\ncreated: 2026-10-24\nstatus: maintained\nsources: ["[[clip-page]]"]\nai-generated: true\n---\n# ${name}\n${body}\n`);
  }
  return root;
}
const lintNested = (root) => classifyQuotes(root, buildGraph(root));

test('classifyQuotes: a curly phrase inside a straight quotation is part of the outer quote and verifies verbatim', (t) => {
  const root = nestedVault(t, `The opinion states: ${BROWN} The Court went on.`, {
    brown: `The Court wrote "${BROWN}" in its opinion.`,
  });
  const res = lintNested(root);
  assert.deepEqual(res.findings, [], JSON.stringify(res.findings));
  assert.equal(res.examined, 1);
  assert.equal(res.verbatim, 1);
});

test('classifyQuotes: the nested-quote sentence is convention when the clipping differs only in extraction spacing', (t) => {
  const root = nestedVault(t, 'The opinion states: We conclude that in the field of public educa tion the doctrine of separate but equal has no place. The Court went on.', {
    brown: `The Court wrote "${BROWN}" in its opinion.`,
  });
  const [f, ...more] = lintNested(root).findings;
  assert.equal(more.length, 0);
  assert.equal(f.tier, 'convention', JSON.stringify(f));
  assert.ok(!/ {2}/.test(f.quote), 'the quote carries no run of spaces where the inner phrase was');
  assert.ok(f.quote.includes('doctrine of separate but equal has no place'), f.quote);
});

test('classifyQuotes: an altered outer word beside a nested phrase stays unverified', (t) => {
  const root = nestedVault(t, `The opinion states: ${BROWN} The Court went on.`, {
    brown: `The Court wrote "${BROWN.replace('has no place', 'has some place')}" in its opinion.`,
  });
  const [f] = lintNested(root).findings;
  assert.equal(f.tier, 'unverified', JSON.stringify(f));
});

test('classifyQuotes: an altered nested phrase is unverified, not gapped with the phrase listed as inserted', (t) => {
  const root = nestedVault(t, `The opinion states: ${BROWN.replace('separate but equal', 'separate but unequal')} The Court went on.`, {
    brown: `The Court wrote "${BROWN}" in its opinion.`,
  });
  const res = lintNested(root);
  assert.equal(res.findings.length, 1);
  assert.equal(res.findings[0].tier, 'unverified', JSON.stringify(res.findings[0]));
  assert.equal(res.findings[0].inserted, undefined);
});

test('classifyQuotes: a nested phrase of five or more words is checked on its own as well', (t) => {
  const outer = 'The Court held that the rule of “separate but equal under the law” has no place here.';
  const root = nestedVault(t, `The opinion states: ${outer} The Court went on.`, {
    brown: `The Court wrote "${outer}" in its opinion.`,
  });
  const res = lintNested(root);
  assert.deepEqual(res.findings, []);
  assert.equal(res.examined, 2, 'the outer quote and the inner phrase');
  assert.equal(res.verbatim, 2);
});

test('classifyQuotes: a sentence that declares its nested quotation unsourced stays exempt', (t) => {
  const root = nestedVault(t, 'Unrelated clipping text about something else entirely.', {
    absent: 'The summary says "A claim with “nested words” inside it here" and this is unsourced in the clipping.',
  });
  const res = lintNested(root);
  assert.deepEqual(res.findings, []);
  assert.equal(res.examined, 0);
});

test('quotedSpans: a curly phrase inside a straight quotation keeps its words and loses its marks', () => {
  assert.deepEqual(
    quotedSpans(`He wrote "${BROWN}" and left.`),
    ['We conclude that in the field of public education the doctrine of separate but equal has no place.'],
  );
});

test('quotedSpans: a nested phrase of five words is listed after its outer quote, in document order', () => {
  assert.deepEqual(
    quotedSpans('Then "a long outer quote with “five words are inside here” and more" ended.'),
    ['a long outer quote with five words are inside here and more', 'five words are inside here'],
  );
});

test('quotedSpans: a straight phrase inside a curly quotation keeps its words and is listed on its own', () => {
  assert.deepEqual(
    quotedSpans('Then “he said "one two three four five" and left” ended.'),
    ['he said one two three four five and left', 'one two three four five'],
  );
});

test('quotedSpans: sibling quotations never capture the text between them', () => {
  assert.deepEqual(
    quotedSpans('First “a b c d e” then some words between “f g h i j” and "k l m n o" last.'),
    ['a b c d e', 'f g h i j', 'k l m n o'],
  );
});

test('quotedSpans: a short quote consumes its closing mark so parity does not flip', () => {
  assert.deepEqual(quotedSpans('The "Adaptive" mode is "one two three four five" exactly.'), ['one two three four five']);
});

test('quotedSpans: a closing curly mark with no curly opener is ignored without error', () => {
  assert.deepEqual(quotedSpans('He said "one two three four five” and left.'), []);
  assert.deepEqual(quotedSpans('a "b c d e f g” h'), []);
  assert.deepEqual(quotedSpans('a b c d e f g” h'), []);
});

test('quotedSpans: a straight mark never pairs across a blank line', () => {
  assert.deepEqual(
    quotedSpans('The 5" pipe is wide.\n\nHe said "one two three four five" plainly.'),
    ['one two three four five'],
  );
});

test('quotedSpans: a curly quotation may span a blank line', () => {
  const [span, ...more] = quotedSpans('“first paragraph has words here\n\nsecond paragraph has words too”');
  assert.equal(more.length, 0);
  assert.ok(span.includes('first paragraph') && span.includes('second paragraph'), span);
});

test('quotedSpans: an unclosed curly opener does not hide a later complete quotation', () => {
  assert.ok(quotedSpans('A “stray opener here.\n\nLater “one two three four five” ends.').includes('one two three four five'));
});
