import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { checkQuotes, checkStyle, classifyQuotes, normalize, quoteFragments } from '../scripts/lint.mjs';
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
  assert.deepEqual(Object.keys(out.tiers).sort(), ['convention', 'examined', 'gapped', 'unverified', 'verbatim']);
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
