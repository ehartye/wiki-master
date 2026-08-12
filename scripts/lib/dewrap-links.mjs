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
// same raw pattern <word>-\n<spaces><word>, so no regex can tell them apart — a
// first, syntax-only "risk" flag design was WRONG (caught by writing this exact pair
// of vault-derived cases as tests before trusting it, not by inspection). The fix
// mirrors repair-provenance-links.mjs's own discipline: don't guess from shape,
// build both candidate readings (hyphen kept vs hyphen removed) and only apply the
// one that resolves against the REAL page index — report, never guess, when zero or
// both do.

const LINK_RE = /\[\[([^\]]+)\]\]/g;
// A non-space character immediately before a hyphen, then optional trailing
// spaces/tabs, then the newline: "...Diagno-\n..." and "...Wizards-\n..." both
// match (the hyphen is glued to the word before the break); "...Trunk-Based\n..."
// does not (the hyphen is mid-line — the character right before the break is "d").
const HYPHEN_BREAK_RE = /(\S)-[ \t]*\n[ \t]*/;

export function isWrappedTarget(target) {
  return typeof target === 'string' && target.includes('\n');
}

// Collapses only whitespace runs that themselves contain a newline; a pre-existing
// single space elsewhere in the span (e.g. around a `|` alias) is left untouched.
// Always keeps the hyphen where one precedes the break — correct for the ordinary
// (non-hyphen-adjacent) case and for a title that legitimately ends a line in a
// trailing hyphen; WRONG only for true syllable hyphenation, which is why this alone
// is never applied to a hyphenAdjacent span without checking candidateDewraps/
// resolveDewrap first.
export function dewrapWhitespace(raw) {
  return raw.replace(/[ \t]*\n[ \t]*/g, ' ');
}

export function hyphenAdjacent(raw) {
  return HYPHEN_BREAK_RE.test(raw);
}

// One candidate (hyphen kept) for an ordinary wrap; two candidates (hyphen kept,
// hyphen removed) for a hyphen-adjacent wrap, since shape alone cannot say which
// reading is correct.
export function candidateDewraps(raw) {
  const kept = dewrapWhitespace(raw);
  if (!hyphenAdjacent(raw)) return [kept];
  // Remove the hyphen-adjacent break entirely (no separator at all — "Diagno-\nstics"
  // rejoins to "Diagnostics", not "Diagno stics"); any OTHER wrap elsewhere in the
  // same span still gets the ordinary space-collapse.
  const removed = raw.replace(HYPHEN_BREAK_RE, (_, before) => before).replace(/[ \t]*\n[ \t]*/g, ' ');
  return [kept, removed];
}

// Chooses which candidate (if any) to apply. `resolves(name)` is an injected
// predicate — in real use, backed by graph.mjs's own name index (the same ground
// truth resolveLinkTarget checks links against), so this never has to guess: an
// ordinary wrap has one candidate and is always applied (a lossless mechanical undo,
// correct whether or not the target page exists yet); a hyphen-adjacent wrap is only
// applied when EXACTLY one of its two candidates resolves to a real page — zero or
// both resolving means genuine ambiguity, reported rather than guessed. Failing to
// pass a resolver at all fails closed: an ambiguous case is never fixed blindly.
export function resolveDewrap(raw, { resolves = () => false } = {}) {
  const candidates = candidateDewraps(raw);
  if (candidates.length === 1) return { chosen: candidates[0], candidates, reason: 'unambiguous' };
  const matches = candidates.filter(resolves);
  if (matches.length === 1) return { chosen: matches[0], candidates, reason: 'hyphen-resolved' };
  return { chosen: null, candidates, reason: matches.length === 0 ? 'unresolved' : 'ambiguous' };
}

// Read-only scan: every `[[...]]` span whose captured content contains a raw
// newline, with its resolution precomputed. Used both for reporting
// (health.mjs / classifyBrokenLinks) and as the basis for dewrapText's rewrite.
export function findWrappedLinks(text, opts = {}) {
  const found = [];
  for (const m of text.matchAll(LINK_RE)) {
    const raw = m[1];
    if (!isWrappedTarget(raw)) continue;
    found.push({ match: m[0], raw, index: m.index, ...resolveDewrap(raw, opts) });
  }
  return found;
}

// Rewrites a whole page's text: every wrapped link that resolves to exactly one
// candidate is dewrapped in place; anything unresolved or ambiguous is left
// byte-identical and counted separately rather than guessed at. Safe to run
// repeatedly — a page with no wrapped links is returned unchanged.
export function dewrapText(text, opts = {}) {
  let fixed = 0;
  const skippedSpans = [];
  const next = text.replace(LINK_RE, (full, raw) => {
    if (!isWrappedTarget(raw)) return full;
    const { chosen } = resolveDewrap(raw, opts);
    if (chosen === null) {
      skippedSpans.push(full);
      return full;
    }
    fixed += 1;
    return `[[${chosen}]]`;
  });
  return { text: next, fixed, skipped: skippedSpans.length, skippedSpans };
}
