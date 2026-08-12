import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isWrappedTarget, dewrapWhitespace, hyphenAdjacent, candidateDewraps, resolveDewrap, findWrappedLinks, dewrapText,
} from '../scripts/lib/dewrap-links.mjs';

// A wikilink is inline Markdown/Obsidian syntax — it can never legitimately span a
// line break. When hard-wrapped prose (a common paragraph-formatting habit, whether
// hand- or LLM-authored) happens to wrap mid-[[Target]], the bracket span survives
// as one link with an embedded newline in its target, which Obsidian — and this
// vault's own resolveLinkTarget (graph.mjs) — can never resolve. Confirmed against
// the real vault: a `## Summary` paragraph wrote "Like [[Tooling API Reference and
// Developer Guide (v67.0)]]" wrapped at a column width with the link straddling it —
// not copied from a clipping (pandoc's `--wrap=none` and pdftotext's non-`-layout`
// mode don't hyphenate body text either), but plain paragraph word-wrap.
//
// Detection is a structural fact, not a heuristic: there is no legitimate multi-line
// wikilink, so a raw newline inside a `[[...]]` span is unambiguously a defect.
// Repair is the mechanical REVERSAL of the wrap — collapse the whitespace run that
// contains the newline back to the single space paragraph-wrapping replaced. Nothing
// is invented for the ordinary case, only undone.
//
// The one genuinely ambiguous shape is a hyphen glued to the word right before the
// break ("Diagno-\nstics") — indistinguishable, by character shape alone, from a
// title that legitimately ends a line in a trailing hyphen ("Wizards-\n  Definition
// and Design Recommendations", a REAL title in this vault). Both match the exact
// same raw pattern <word>-\n<spaces><word>, so no regex can tell them apart — this
// was the first, wrong design (a syntax-only "risk" flag), caught by writing this
// exact pair of vault-derived cases as tests before trusting it. The fix mirrors
// repair-provenance-links.mjs's own discipline: don't guess from shape, check both
// candidate readings (hyphen kept vs hyphen removed) against the REAL page index and
// only apply the one that resolves — report, never guess, when zero or both do.

test('isWrappedTarget is true only for a target containing a raw newline', () => {
  assert.equal(isWrappedTarget('Some Page'), false);
  assert.equal(isWrappedTarget('Some Page\nContinued'), true);
  assert.equal(isWrappedTarget(''), false);
});

test('dewrapWhitespace collapses a whitespace run containing a newline to one space, leaving other spaces alone', () => {
  assert.equal(dewrapWhitespace('Salesforce Metadata API Permission\n   Diagnostics'), 'Salesforce Metadata API Permission Diagnostics');
  assert.equal(dewrapWhitespace('Tooling API Reference and\nDeveloper Guide (v67.0)'), 'Tooling API Reference and Developer Guide (v67.0)');
  assert.equal(dewrapWhitespace('No Wrap Here'), 'No Wrap Here', 'a normal single-space target is untouched');
});

test('dewrapWhitespace collapses a wrap spanning more than two lines', () => {
  assert.equal(dewrapWhitespace('A\nB\nC'), 'A B C');
});

test('hyphenAdjacent detects a hyphen glued to the character right before the break, with no judgment about correctness', () => {
  assert.equal(hyphenAdjacent('Diagno-\nstics'), true);
  assert.equal(hyphenAdjacent('Wizards-\n  Definition and Design Recommendations'), true,
    'same raw shape as a true hyphenation break — detection alone cannot and does not decide which this is');
  assert.equal(hyphenAdjacent('There Can Be Only One (Branch)- Trunk-Based\n  Development for Salesforce'), false,
    'the hyphen in "Trunk-Based" is mid-line; the character right before the break is "d", not a hyphen');
});

test('candidateDewraps returns one candidate for a non-hyphen-adjacent wrap', () => {
  assert.deepEqual(candidateDewraps('Tooling API Reference and\nDeveloper Guide (v67.0)'), ['Tooling API Reference and Developer Guide (v67.0)']);
});

test('candidateDewraps returns two candidates (hyphen kept, hyphen removed) for a hyphen-adjacent wrap', () => {
  assert.deepEqual(candidateDewraps('Diagno-\nstics'), ['Diagno- stics', 'Diagnostics']);
  // "hyphen removed" always rejoins with NO separator (correct for true syllable
  // hyphenation, e.g. Diagnostics above) — for a case where the hyphen was actually
  // intentional punctuation, that candidate is expected to be nonsensical
  // ("WizardsDefinition..."); it is never the one resolveDewrap picks for THIS input,
  // it exists only to be checked against the real page index and rejected.
  assert.deepEqual(candidateDewraps('Wizards-\n  Definition and Design Recommendations'),
    ['Wizards- Definition and Design Recommendations', 'WizardsDefinition and Design Recommendations']);
});

test('resolveDewrap picks the sole candidate outright when there is no hyphen ambiguity', () => {
  const r = resolveDewrap('Tooling API Reference and\nDeveloper Guide (v67.0)', { resolves: () => false });
  assert.equal(r.chosen, 'Tooling API Reference and Developer Guide (v67.0)');
  assert.equal(r.reason, 'unambiguous');
});

test('resolveDewrap picks the hyphen-removed candidate when only it resolves against the real page index', () => {
  const resolves = (name) => name === 'Diagnostics';
  const r = resolveDewrap('Diagno-\nstics', { resolves });
  assert.equal(r.chosen, 'Diagnostics');
  assert.equal(r.reason, 'hyphen-resolved');
});

test('resolveDewrap picks the hyphen-kept candidate when only it resolves against the real page index', () => {
  const resolves = (name) => name === 'Wizards- Definition and Design Recommendations';
  const r = resolveDewrap('Wizards-\n  Definition and Design Recommendations', { resolves });
  assert.equal(r.chosen, 'Wizards- Definition and Design Recommendations');
  assert.equal(r.reason, 'hyphen-resolved');
});

test('resolveDewrap refuses to guess when neither hyphen candidate resolves', () => {
  const r = resolveDewrap('Diagno-\nstics', { resolves: () => false });
  assert.equal(r.chosen, null);
  assert.equal(r.reason, 'unresolved');
  assert.deepEqual(r.candidates, ['Diagno- stics', 'Diagnostics']);
});

test('resolveDewrap refuses to guess when both hyphen candidates resolve (pathological, but never guessed)', () => {
  const r = resolveDewrap('Diagno-\nstics', { resolves: () => true });
  assert.equal(r.chosen, null);
  assert.equal(r.reason, 'ambiguous');
});

test('resolveDewrap without an injected resolver fails closed — never fixes an ambiguous hyphen case blindly', () => {
  const r = resolveDewrap('Diagno-\nstics', {});
  assert.equal(r.chosen, null);
  assert.equal(r.reason, 'unresolved');
});

test('findWrappedLinks finds a wrapped link and resolves its dewrapped form', () => {
  const text = 'Like [[Tooling API Reference and\nDeveloper Guide (v67.0)]], its value is being...';
  const found = findWrappedLinks(text, { resolves: () => false });
  assert.equal(found.length, 1);
  assert.equal(found[0].raw, 'Tooling API Reference and\nDeveloper Guide (v67.0)');
  assert.equal(found[0].chosen, 'Tooling API Reference and Developer Guide (v67.0)');
  assert.equal(found[0].reason, 'unambiguous');
});

test('findWrappedLinks ignores a normal, unwrapped link', () => {
  assert.deepEqual(findWrappedLinks('See [[Some Page]] for more.', { resolves: () => false }), []);
});

test('dewrapText fixes a safe (non-hyphen-adjacent) wrap and reports one fixed, zero skipped', () => {
  const text = 'Like [[Tooling API Reference and\nDeveloper Guide (v67.0)]], its value is being...';
  const { text: next, fixed, skipped } = dewrapText(text, { resolves: () => false });
  assert.equal(next, 'Like [[Tooling API Reference and Developer Guide (v67.0)]], its value is being...');
  assert.equal(fixed, 1);
  assert.equal(skipped, 0);
});

test('dewrapText skips an unresolved hyphen-adjacent wrap, leaving it byte-identical, and reports it', () => {
  const text = 'See [[Diagno-\nstics]] for details.';
  const { text: next, fixed, skipped, skippedSpans } = dewrapText(text, { resolves: () => false });
  assert.equal(next, text, 'left completely untouched — never guess');
  assert.equal(fixed, 0);
  assert.equal(skipped, 1);
  assert.deepEqual(skippedSpans, ['[[Diagno-\nstics]]']);
});

test('dewrapText fixes a hyphen-adjacent wrap once the real page index resolves which candidate is correct', () => {
  const text = 'See [[Wizards-\n  Definition and Design Recommendations]] for details.';
  const resolves = (name) => name === 'Wizards- Definition and Design Recommendations';
  const { text: next, fixed, skipped } = dewrapText(text, { resolves });
  assert.equal(next, 'See [[Wizards- Definition and Design Recommendations]] for details.');
  assert.equal(fixed, 1);
  assert.equal(skipped, 0);
});

test('dewrapText leaves an already-correct link and surrounding prose untouched', () => {
  const text = '# Heading\n\nSome prose with [[A Fine Link]] and more prose.\n';
  const { text: next, fixed, skipped } = dewrapText(text, { resolves: () => false });
  assert.equal(next, text);
  assert.equal(fixed, 0);
  assert.equal(skipped, 0);
});

test('dewrapText fixes multiple wrapped links in one page independently, skipping only the unresolved one', () => {
  const text = [
    'Para one cites [[Salesforce Metadata API Permission\n   Diagnostics]] here.',
    '',
    'Para two cites [[Diagno-\nstics]] and also [[A Fine Link]] normally.',
  ].join('\n');
  const { text: next, fixed, skipped } = dewrapText(text, { resolves: () => false });
  assert.match(next, /\[\[Salesforce Metadata API Permission Diagnostics\]\]/);
  assert.match(next, /\[\[Diagno-\nstics\]\]/, 'the unresolved one is left exactly as-is');
  assert.match(next, /\[\[A Fine Link\]\]/);
  assert.equal(fixed, 1);
  assert.equal(skipped, 1);
});

test('dewrapText preserves a piped alias while dewrapping the target portion', () => {
  const text = 'Cross-project cite: [[wiki/authored/sparta-suite/migrator/roadmap.md|sparta-migrator\'s\nroadmap]] here.';
  const { text: next, fixed } = dewrapText(text, { resolves: () => false });
  assert.equal(fixed, 1);
  assert.equal(next, 'Cross-project cite: [[wiki/authored/sparta-suite/migrator/roadmap.md|sparta-migrator\'s roadmap]] here.');
});
