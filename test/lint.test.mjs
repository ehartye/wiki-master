import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkQuotes, checkStyle, normalize, quoteFragments } from '../scripts/lint.mjs';
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

test('checkQuotes follows body links to source pages (both breadcrumb channels)', () => {
  const findings = checkQuotes(FIXTURE, graph());
  // body-linked.md has NO sources: frontmatter; its trail is a body [[wikilink]]
  // to the source page. The v0.2.2 breadcrumb rule names both channels.
  assert.ok(!findings.some((f) => f.page.includes('body-linked.md')),
    'quote verifies through body-link trail');
});

test('checkQuotes exempts sentences that declare themselves unsourced', () => {
  const findings = checkQuotes(FIXTURE, graph());
  assert.ok(!findings.some((f) => f.page.includes('declared.md')),
    'declared-unsourced is the policy working, not a violation');
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
