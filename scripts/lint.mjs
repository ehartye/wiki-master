import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { helpRequested, exitWithHelp } from './lib/help.mjs';
import { buildGraph, isContent, buildNameIndex, evidencePaths } from './lib/graph.mjs';
import { prepareDocument, classifyFragments, DECLARES_ABSENT, tokenize } from './lib/quote-match.mjs';
import { bestWindow, renderDiff, NEAR_MIN_WORDS, NEAR_THRESHOLD } from './lib/near-match.mjs';
import { cliGuard, optionValue } from './lib/cli-guard.mjs';
import { checkLedgerPaths, readLedger } from './lib/ledger.mjs';
import { evidenceHashOf, findingId, contextHashOf, DISPOSITIONS_FILE, loadDispositions, reviewedBy } from './lib/lint-dispositions.mjs';
cliGuard(import.meta.url);

// Content lints for the v0.2.2 style policy. WARN-ONLY by contract: flag for
// review, never fix, never score (Wikipedia's own WTW rule: "There are no
// forbidden words"). Quotations are exempt from style checks; sentences that
// declare themselves unsourced are exempt from quote checks — both are the
// policy working, not violations.

// Canonical form for MATCHING only (not display): aggressive folding so that
// PDF extraction artifacts and authorial markup never defeat a genuine match.
export function normalize(s) {
  return s
    .replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl').replace(/ﬀ/g, 'ff')
    .replace(/ﬃ/g, 'ffi').replace(/ﬄ/g, 'ffl') // PDF ligatures
    .replace(/-[ \t]*\r?\n[ \t]*/g, '')         // PDF line-break hyphenation: can-\nnot → cannot
    .replace(/['‘’"“”]/g, '') // quoting style varies too much to preserve
    .replace(/[*_`]/g, '')    // markdown emphasis added by page authors
    .replace(/[—–-]/g, '')    // dash styles never survive extraction faithfully
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

// A quoted span may contain the page author's own editorial marks — elisions
// ("...") and bracketed insertions ("[the player]"). Those are NOT source
// text: split on them and verify each remaining fragment independently.
//   - A bracket standing as its own word ("[the player]", "[sic]") is cut out.
//   - A bracket glued to a letter or digit on either side ("[E]ach", "pi[ne]cones",
//     "borrow\[ing\]") is an edit of that word: the whole run of non-space
//     characters holding it is cut out, so no stub ("ach") is left to fail.
//   - A citation or footnote mark ("cells[12]", "cells[^1]") is cut out alone, so
//     the word before it keeps its letters, as flattenMarkdown strips it.
//   - A Markdown link ("[text](url)") or a wikilink ("[[page]]") is not an edit: it
//     stays in its fragment, and the tiered match reads it as the text a reader sees.
const EDITORIAL_MARK = /\[\[[^\]]*\]\]|\[[^\]]*\]\(|\\\[[^\]]*?\\\]|\[[^\]]*\]|\.\.\.|…/g;
const CITATION_MARK = /^\[(?:\d+|\^[^\]]+)\]$/;
const WORD_CHAR = /[\p{L}\p{N}]/u;
export function quoteFragments(q) {
  const out = [];
  let from = 0; // where the fragment being built starts
  for (const m of q.matchAll(EDITORIAL_MARK)) {
    const mark = m[0];
    let start = m.index, end = start + mark.length;
    if (start < from) continue; // inside a word already cut out
    if (mark.startsWith('[[') || mark.endsWith('(')) continue; // a wikilink or a Markdown link stays
    const bracket = mark.startsWith('[') || mark.startsWith('\\');
    if (bracket && !CITATION_MARK.test(mark) && (WORD_CHAR.test(q[start - 1] ?? '') || WORD_CHAR.test(q[end] ?? ''))) {
      while (start > from && !/\s/.test(q[start - 1])) start--;
      while (end < q.length && !/\s/.test(q[end])) end++;
    }
    out.push(q.slice(from, start));
    from = end;
  }
  out.push(q.slice(from));
  return out
    .map((f) => f.trim())
    .filter((f) => (f.match(/\S+/g) || []).length >= 3);
}

const MIN_QUOTE_WORDS = 5;

function splitFm(md) {
  const m = md.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return md.slice(m ? m[0].length : 0);
}

// Quotations are paired in document order with a stack, so a phrase quoted
// inside a quotation stays part of the outer quote (its marks are dropped, its
// words kept) and is also checked on its own when it is long enough:
//   - “ opens a curly quotation; ” closes the nearest open one, discarding any
//     straight opener still open above it. A ” with no curly opener is ignored.
//   - A straight " is read by where it sits (straightDirection):
//       - after the start, whitespace or ( [ { — – / and before a non-space
//         character, it opens, nesting inside any open straight quotation;
//       - after a non-space character and before the end, whitespace or
//         . , ; : ! ? ) ] } — –, it closes the nearest open straight quotation
//         (any curly opener above it stays open), and with none open it opens
//         nothing;
//       - anywhere else (a"b) it alternates: it closes the straight opener on
//         top of the stack, else opens a new one.
//     A straight mark never pairs across a blank line, so a stray one (5" pipe)
//     cannot swallow a later paragraph; a curly quotation may span one.
//   - Quotes shorter than MIN_QUOTE_WORDS are consumed but not returned: a short
//     quote ("Adaptive") must still take its closing mark, or parity flips and
//     the text BETWEEN two quotes is captured.
//   - Some marks are not quotation syntax and are taken out of play first:
//       - a mark inside code (codeRanges) is code;
//       - a straight mark ending a measurement (7'6", 4'33") is never a delimiter;
//       - a straight mark directly after a digit (5" pipe) opens nothing, but it
//         still closes an open straight quotation, since quotations often end in a
//         number ("in 1999"). So "use a 5" pipe here" still closes early.
//     A mark out of play stays in the quotation's text as written. Direction is
//     judged only for the straight marks still in play.
// Each span is { start, text, raw }: text has the delimiting marks removed for
// matching, raw is the page text as written, for locating its sentence.
const PARAGRAPH_BREAK = /[ \t\r]*\n/y;
const MEASUREMENT = /\d['’]\s?\d+$/;
const BEFORE_OPENER = /[\s([{—–/]/u;
const AFTER_CLOSER = /[\s.,;:!?)\]}—–]/u;
// 'open', 'close', or null when the mark's place says neither or both.
function straightDirection(body, i) {
  const before = body[i - 1], after = body[i + 1];
  const opens = (before === undefined || BEFORE_OPENER.test(before)) && after !== undefined && !/\s/u.test(after);
  const closes = before !== undefined && !/\s/u.test(before) && (after === undefined || AFTER_CLOSER.test(after));
  return opens === closes ? null : opens ? 'open' : 'close';
}

// Where code is in a body, as sorted [start, end) ranges, found once before pairing:
//   - a fenced block, from its opening ``` or ~~~ line to a closing line of the
//     same character at least as long (an unclosed fence hides nothing);
//   - an inline code span, from a backtick run to the next run of the same length
//     in the same paragraph, outside fenced blocks. A backtick fence whose info
//     string holds a backtick is not a fence (```x```), as in CommonMark.
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const BLANK_LINE = /\n[ \t\r]*\n/g;
function codeRanges(body) {
  const fences = [];
  let fence = null; // { at, ch, len }
  for (let pos = 0; pos < body.length;) {
    const nl = body.indexOf('\n', pos);
    const lineEnd = nl < 0 ? body.length : nl;
    const line = body.slice(pos, lineEnd).replace(/\r$/, '');
    if (!fence) {
      const m = FENCE_OPEN.exec(line);
      if (m && !(m[1][0] === '`' && m[2].includes('`'))) fence = { at: pos, ch: m[1][0], len: m[1].length };
    } else {
      const m = FENCE_CLOSE.exec(line);
      if (m && m[1][0] === fence.ch && m[1].length >= fence.len) { fences.push([fence.at, lineEnd]); fence = null; }
    }
    pos = lineEnd + 1;
  }
  const ranges = [];
  const spansIn = (from, to) => {
    const runs = [];
    for (const m of body.slice(from, to).matchAll(/`+/g)) runs.push({ at: from + m.index, len: m[0].length });
    const next = new Array(runs.length).fill(-1);
    const seen = new Map();
    for (let i = runs.length - 1; i >= 0; i--) { next[i] = seen.get(runs[i].len) ?? -1; seen.set(runs[i].len, i); }
    for (let i = 0; i < runs.length;) {
      const j = next[i];
      if (j < 0) { i++; continue; }
      ranges.push([runs[i].at, runs[j].at + runs[j].len]);
      i = j + 1;
    }
  };
  const paragraphsIn = (from, to) => {
    let at = from;
    for (const m of body.slice(from, to).matchAll(BLANK_LINE)) { spansIn(at, from + m.index); at = from + m.index + m[0].length; }
    spansIn(at, to);
  };
  let at = 0;
  for (const [s, e] of fences) { paragraphsIn(at, s); ranges.push([s, e]); at = e; }
  paragraphsIn(at, body.length);
  return ranges.sort((a, b) => a[0] - b[0]);
}

function scanQuotes(body) {
  const found = [];
  const open = []; // { curly, at } — at is the index just after the opening mark
  let settled = 0; // open[0..settled) holds only curly openers carried across a blank line
  const code = codeRanges(body);
  const literal = new Set(); // straight marks taken out of play by the measurement and digit rules
  const inCode = (pos) => {
    let lo = 0, hi = code.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (code[mid][1] <= pos) lo = mid + 1;
      else if (code[mid][0] > pos) hi = mid - 1;
      else return true;
    }
    return false;
  };
  const close = (at, end) => {
    const raw = body.slice(at, end);
    const text = raw.replace(/["“”]/g, (mark, off) => (literal.has(at + off) || inCode(at + off) ? mark : ''));
    if ((text.match(/\S+/g) || []).length >= MIN_QUOTE_WORDS) found.push({ start: at, text, raw });
  };
  let r = 0; // the first code range that does not end before i
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '"' || c === '“' || c === '”') {
      while (r < code.length && code[r][1] <= i) r++;
      if (r < code.length && code[r][0] <= i) continue;
    }
    if (c === '\n') {
      PARAGRAPH_BREAK.lastIndex = i + 1;
      if (!PARAGRAPH_BREAK.test(body)) continue;
      const carried = open.splice(settled).filter((o) => o.curly);
      for (const o of carried) open.push(o);
      settled = open.length;
    } else if (c === '“') {
      open.push({ curly: true, at: i + 1 });
    } else if (c === '”') {
      let k = open.length - 1;
      while (k >= 0 && !open[k].curly) k--;
      if (k < 0) continue;
      close(open[k].at, i);
      open.length = k;
      settled = Math.min(settled, k);
    } else if (c === '"') {
      const afterDigit = /\d/.test(body[i - 1] ?? '');
      if (afterDigit && MEASUREMENT.test(body.slice(Math.max(0, i - 24), i))) { literal.add(i); continue; }
      const direction = straightDirection(body, i);
      if (direction === 'open') {
        open.push({ curly: false, at: i + 1 });
      } else if (direction === 'close') {
        let k = open.length - 1;
        while (k >= 0 && open[k].curly) k--;
        if (k >= 0) { close(open[k].at, i); open.splice(k, 1); }
        else if (afterDigit) literal.add(i);
      } else {
        const top = open[open.length - 1];
        if (top && !top.curly) { close(top.at, i); open.pop(); }
        else if (afterDigit) literal.add(i);
        else open.push({ curly: false, at: i + 1 });
      }
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

export function quotedSpans(body) {
  return scanQuotes(body).map((q) => q.text);
}

// The breadcrumb trail (#13) lives in graph.mjs — health measures reachability
// over the same walk, and two copies would drift into two different answers to
// "can this page be walked back to raw/".
function evidenceBodies(vaultPath, page, byName, pages) {
  return evidencePaths(page, byName, pages)
    .map((p) => splitFm(readFileSync(join(vaultPath, p), 'utf8')));
}

// Prepared evidence documents are shared across pages (one raw clipping backs many
// pages) but bounded, least recently used out. A document costs several times its
// source size once its word string and compact form exist, so the cap is on that
// weighted size, not on raw characters.
const DOC_CACHE_WEIGHT = 160_000_000;
const DOC_WEIGHT = 4;
function makeDocCache(vaultPath) {
  const cache = new Map();
  let held = 0;
  return (path) => {
    const hit = cache.get(path);
    if (hit) { cache.delete(path); cache.set(path, hit); return hit.doc; }
    const md = readFileSync(join(vaultPath, path), 'utf8');
    const text = splitFm(md);
    // The frontmatter's lines, so a located match names the file's own line numbers.
    const lineOffset = (md.slice(0, md.length - text.length).match(/\n/g) ?? []).length;
    const doc = prepareDocument(text, { lineOffset });
    cache.set(path, { doc, size: text.length * DOC_WEIGHT });
    held += text.length * DOC_WEIGHT;
    for (const [k, v] of cache) {
      if (held <= DOC_CACHE_WEIGHT || cache.size <= 1) break;
      cache.delete(k); held -= v.size;
    }
    return doc;
  };
}

const kindOf = (path) => (path.startsWith('raw/') ? 'raw clipping' : 'wiki page');

// Where each fragment of a finding's quote is, in fragment order (classifyQuotes). A convention or gapped fragment is
// located where its tier came from; a gapped entry's diff shows the skipped evidence words in place as {+word+}. An
// unverified fragment gets its best near window over the page's evidence documents, with no word floor and no
// threshold, a raw clipping winning a tie, and a null document when no window exists. Lines are the file's, 1-based,
// and are left out (linesUnavailable) where a per-line reading of the document gives other words than the whole text.
function locateFragments(raw, matches, paths, docs) {
  const order = paths.map((_, i) => i).sort((a, b) => (paths[a] < paths[b] ? -1 : paths[a] > paths[b] ? 1 : 0));
  const at = (entry, doc, start, end, rest) => {
    const lines = doc.lineSpan(start, end);
    return { ...entry, ...(lines ? { lines } : { linesUnavailable: true }), ...rest };
  };
  return raw.map((fragment, i) => {
    const m = matches[i];
    if (m.tier !== null) {
      if (m.doc === null) return { fragment: i, document: null, match: m.tier };
      const doc = docs[m.doc], path = paths[m.doc];
      const entry = { fragment: i, document: path, kind: kindOf(path) };
      if (m.tier === 'convention') return at(entry, doc, m.start, m.end, { match: 'convention' });
      const placed = new Set(m.at);
      const diff = doc.tokens.slice(m.start, m.end).map((w, k) => (placed.has(m.start + k) ? w : `{+${w}+}`)).join(' ');
      return at(entry, doc, m.start, m.end, { match: 'gapped', diff });
    }
    const q = tokenize(fragment);
    let best = null;
    for (const j of order) {
      const w = bestWindow(q, docs[j]);
      if (!w) continue;
      const isRaw = paths[j].startsWith('raw/');
      if (!best || w.score > best.w.score || (w.score === best.w.score && isRaw && !best.isRaw)) best = { j, w, isRaw };
    }
    if (!best) return { fragment: i, document: null, match: 'near' };
    const path = paths[best.j];
    return at({ fragment: i, document: path, kind: kindOf(path) }, docs[best.j], best.w.start, best.w.end,
      { match: 'near', score: Math.round(best.w.score * 100) / 100, diff: renderDiff(best.w.ops) });
  });
}

// Every quote the verbatim check cannot place, sorted into the tier that says why.
// Returns { examined, verbatim, title, findings }; verbatim and title quotes are counted, not listed.
// A quote that would be unverified but is wholly the title of a clipping the page cites is a title
// match: the title is part of the captured record, though it is not in the body the check searches.
// Only the unverified tier is reconsidered, so no verbatim, convention or gapped quote changes tier. A
// clipping's `source:` URL is not matched: a URL is one whitespace-separated word and a returned quote
// has at least MIN_QUOTE_WORDS, so no quote can be a substring of one.
// `pages`, a Set of vault-relative paths, limits the work to those pages (the graph is still built whole, because a
// page's evidence is found through it). Every finding carries `evidenceHash` (the raw documents behind the page's
// quotes) and `id`, which names the finding for a recorded verdict (lib/lint-dispositions.mjs), and `evidence`, where
// each fragment of the quote is (locateFragments).
export function classifyQuotes(vaultPath, graph, { pages: scope } = {}) {
  const byName = buildNameIndex(graph.pages);
  const pages = new Map(graph.pages.map((p) => [p.path, p]));
  const docFor = makeDocCache(vaultPath);
  const findings = [];
  let examined = 0, verbatim = 0, title = 0;
  for (const p of graph.pages) {
    if (!isContent(p.path)) continue;
    if (scope && !scope.has(p.path)) continue;
    // A page declaring `sources: []` has, by its own frontmatter, no external
    // artifact to verify a quote against — checking it would flag every
    // quotation as unverifiable against zero evidence, 100% false-positive by
    // construction. This is what makes wiki/authored/ pages usable: they carry
    // the disclosure by convention and quote-lint honors it, same as the
    // existing per-sentence "unsourced" exemption below honors a narrower claim.
    if (p.declaresNoSources) continue;
    const body = splitFm(readFileSync(join(vaultPath, p.path), 'utf8'));
    const quotes = scanQuotes(body);
    if (!quotes.length) continue;
    const paths = evidencePaths(p, byName, pages);
    const evidence = evidenceBodies(vaultPath, p, byName, pages).map(normalize);
    let docs = null; // prepared only if some quote of this page fails the verbatim check
    let titles = null; // the cited clippings' titles, read only when a quote would be unverified
    let evidenceHash = null; // computed for the first finding of the page
    for (const { text: q, raw: written } of quotes) {
      // A sentence that declares its claim unsourced (or absent from the clipped
      // source) is the policy working.
      const sentence = body.split(/(?<=[.!?])\s+/).find((s) => s.includes(written)) ?? '';
      if (DECLARES_ABSENT.test(sentence)) continue;
      // Edge punctuation is quoting convention, not source text: the page
      // ends a quote "…the image." where the book continues "…the image, so".
      const raw = quoteFragments(q);
      const fragments = raw.map((f) => normalize(f).replace(/^[.,;:!?\s]+|[.,;:!?\s]+$/g, ''));
      if (!fragments.length) continue;
      examined++;
      if (fragments.every((f) => evidence.some((e) => e.includes(f)))) { verbatim++; continue; }
      docs ??= paths.map(docFor);
      const { tier, inserted, matches } = classifyFragments(raw, docs);
      if (tier === 'unverified') {
        titles ??= paths.filter((path) => path.startsWith('raw/')).map((path) => pages.get(path)?.metadata?.title).filter((x) => typeof x === 'string' && x).map(normalize);
        if (fragments.every((f) => titles.some((t) => t.includes(f)))) { title++; continue; }
      }
      // Full quote, never truncated: a repair tool re-checking this finding must
      // see the whole span, or a quote whose tail diverges verifies on its prefix.
      evidenceHash ??= evidenceHashOf(paths, evidence);
      const finding = { page: p.path, quote: q, tier, checked: evidence.length, ...(tier === 'gapped' ? { inserted } : {}), evidenceHash };
      findings.push({ ...finding, id: findingId(finding), evidence: locateFragments(raw, matches, paths, docs) });
    }
  }
  return { examined, verbatim, title, findings };
}

// The strict contract callers (repair-quote-provenance) rely on: every quote the
// verbatim check cannot place, whatever its tier.
export function checkQuotes(vaultPath, graph) {
  return classifyQuotes(vaultPath, graph).findings.map(({ page, quote, checked }) => ({ page, quote, checked }));
}

// Opt-in triage of the unverified tier (--near). For each unverified quote of NEAR_MIN_WORDS or more, the
// best alignment with a raw clipping on the page's evidence path; at NEAR_THRESHOLD or better it is listed as
// a word diff. A quote whose only close match is a wiki page is counted, not listed: a summary can match a
// quote closely without being the source. Changes no tier.
export function nearMatches(vaultPath, graph, findings) {
  const byName = buildNameIndex(graph.pages);
  const pages = new Map(graph.pages.map((p) => [p.path, p]));
  const docFor = makeDocCache(vaultPath);
  const evidenceFor = new Map();
  const listed = [];
  let summaryOnly = 0;
  for (const f of findings) {
    if (f.tier !== 'unverified') continue;
    // The fragments, not the whole quote: an editorial bracket is not source text, so it is not a diff word either.
    const q = tokenize(quoteFragments(f.quote).join(' '));
    if (q.length < NEAR_MIN_WORDS) continue;
    if (!evidenceFor.has(f.page)) evidenceFor.set(f.page, evidencePaths(pages.get(f.page), byName, pages).sort());
    let raw = null, other = null;
    for (const path of evidenceFor.get(f.page)) {
      const m = bestWindow(q, docFor(path));
      if (!m) continue;
      const isRaw = path.startsWith('raw/');
      const best = isRaw ? raw : other;
      if (!best || m.score > best.m.score) { if (isRaw) raw = { path, m }; else other = { path, m }; }
    }
    if (raw && raw.m.score >= NEAR_THRESHOLD) {
      listed.push({ page: f.page, quote: f.quote, score: Math.round(raw.m.score * 100) / 100, document: raw.path, kind: 'raw clipping', diff: renderDiff(raw.m.ops) });
    } else if (other && other.m.score >= NEAR_THRESHOLD) summaryOnly++;
  }
  listed.sort((a, b) => b.score - a.score || (a.page < b.page ? -1 : a.page > b.page ? 1 : 0) || (a.quote < b.quote ? -1 : a.quote > b.quote ? 1 : 0));
  return { listed, summaryOnly, threshold: NEAR_THRESHOLD, minWords: NEAR_MIN_WORDS };
}

// WTW-seeded word lists (flags, not bans). Seeded from MOS:WTW categories.
const STYLE = {
  editorializing: ['clearly', 'obviously', 'notably', 'importantly', 'interestingly',
    'essentially', 'fundamentally', 'of course', 'arguably', 'undoubtedly',
    'sadly', 'fortunately', 'unfortunately', 'it should be noted'],
  weasel: ['some say', 'some people say', 'it is believed', 'widely regarded',
    'experts declare', 'research has shown', 'it is often said', 'critics argue',
    'many people'],
  'said-verbs': ['revealed', 'admitted', 'confessed', 'insisted'],
  puffery: ['legendary', 'world-class', 'groundbreaking', 'revolutionary',
    'iconic', 'visionary', 'cutting-edge'],
  doubt: ['so-called', 'supposedly', 'purported', 'purportedly', 'allegedly'],
};

// Per-type licenses (v0.2.2): entities carry the full list; concepts and
// sources the interpretive-tone lists; syntheses only the connective signal —
// conclusions are licensed there but must not smuggle unsourced joints.
const LICENSE = {
  'wiki/entities/': ['editorializing', 'weasel', 'said-verbs', 'puffery', 'doubt'],
  'wiki/concepts/': ['editorializing', 'weasel'],
  'wiki/sources/': ['editorializing', 'weasel'],
  'wiki/syntheses/': [],
  // Original, no-provenance content (advisory documentation, policy, house
  // style) — the vault's own first-party voice, same license as syntheses.
  'wiki/authored/': [],
};

const CONNECTIVES = /\b(however|but|despite|yet)\b/i;
// Uses of these words that are not a contrast: a time word ("not yet built", "as yet", "is yet to ship", "have yet to"),
// "yet" meaning "again" or "in addition" ("yet another example"), and "but" meaning "except" ("nothing but a stub").
// They are taken out of a sentence before it is tested for a contrast connective. "yet to" is removed only after a verb
// of being or having, so "cheap, yet to many it is slow" is still a contrast. "however" directly before a degree word
// ("however many clauses it takes") means "to whatever degree"; with a comma between ("However, many disagree") it is a
// contrast again.
const NOT_A_CONTRAST = /\bnot yet\b|\bas yet\b|\byet (?:another|again|more)\b|\b(?:is|are|was|were|be|been|has|have|had|remains?|remained)\s+yet\s+to\b|\b(?:nothing|anything|none|all|everyone|everybody|anyone|no one|nobody)\s+but\b|\bhowever (?:many|much|few|little|long|often|far|hard|large|small|big|great|high|low|good|bad|well|soon|late|early|fast|slow)\b/gi;
// Uses of a tone phrase that are not the flagged use, taken out of the tested copy of a sentence the same way: "of course"
// is a tone word only as a discourse marker: at the start of the text or a line, after sentence or clause punctuation,
// or directly after a conjunction, verb, pronoun or "there"/"here" ("This is, of course, wrong", "It is of course wrong",
// "And of course it fails"). Elsewhere it is part of a noun phrase ("a list of course concepts", "as a matter of course").
// A line still starts after indentation, any run of list, heading and blockquote marks each followed by whitespace, and
// then `*` emphasis marks ("- Of course", "## Of course", "> Of course", "**Of course**,", "1) Of course"). `_Of course_`
// is not flagged: `_` is a word character to the flag-word match, and changing that match would change hashed sentences.
const DISCOURSE_LEAD = 'and|but|or|so|yet|then|is|are|was|were|be|been|being|am|will|would|can|could|should|shall|may|might|must|do|does|did|has|have|had|it|this|that|these|those|which|who|we|they|you|he|she|i|there|here';
const LINE_START = String.raw`^[^\S\n]*(?:(?:[-*+>]|#{1,6}|\d+[.)])[ \t][^\S\n]*)*(?:\*+[^\S\n]*)?`;
const NOT_A_TONE = {
  'of course': new RegExp(`(?<!${LINE_START}|[.!?,;:(—–]\\s*)(?<!\\b(?:${DISCOURSE_LEAD})\\s+)(?<![\\w-])of[- ]course(?![\\w-])`, 'gim'),
};
// A paragraph ends at a blank line and also where a list item, heading or table row starts: a citation after a list item
// does not cover the item before it. A heading line is a paragraph of its own (see styleParagraphs).
const STYLE_PARAGRAPH_BREAK = /\r?\n[ \t]*\r?\n|\r?\n(?=[ \t]*(?:[-*+]\s|\d+[.)]\s|#{1,6}\s|\|))/;
const SENTENCE_BREAK = /(?<=[.!?])\s+/;

// The page body as paragraphs. A heading line followed by text is split off, so a heading never becomes the front of the
// next sentence: renaming it must not change that sentence's identity.
function styleParagraphs(body) {
  const out = [];
  for (const paragraph of body.split(STYLE_PARAGRAPH_BREAK)) {
    const heading = /^([ \t]*#{1,6}[ \t][^\r\n]*)\r?\n([\s\S]+)$/.exec(paragraph);
    if (heading) out.push(heading[1], heading[2]);
    else out.push(paragraph);
  }
  return out;
}

// A contrast connective in a sentence is covered when that sentence, or a later sentence of its paragraph, carries a
// [[wikilink]] (the vault's citation form): pages cite at the end of a paragraph, and that citation stands for what
// precedes it. A link only BEFORE the sentence does not cover it, which is the unsourced joint this check exists to find.
// One pass from the end of each paragraph keeps the check linear in the number of sentences.
export function uncoveredContrasts(body) {
  const out = [];
  for (const paragraph of styleParagraphs(body)) {
    const sentences = paragraph.split(SENTENCE_BREAK);
    const found = [];
    let covered = false;
    for (let i = sentences.length - 1; i >= 0; i--) {
      if (sentences[i].includes('[[')) covered = true;
      if (!covered && CONNECTIVES.test(sentences[i].replace(NOT_A_CONTRAST, ' '))) found.push(sentences[i].trim());
    }
    out.push(...found.reverse());
  }
  return out;
}

// Each finding has an id (page, category, the flagged words and a hash of the sentence(s) it was raised on) so a reviewer
// can record that it was read (lint-disposition.mjs). `evidenceHash` stays internal, as it does for quotes.
const styleFinding = (page, category, word, context) => {
  const evidenceHash = contextHashOf(context);
  return { page, category, word, id: findingId({ page, quote: `${category}: ${word}`, evidenceHash }), evidenceHash };
};

export function checkStyle(vaultPath, graph, { pages: scope } = {}) {
  const findings = [];
  for (const p of graph.pages) {
    if (!isContent(p.path)) continue;
    if (scope && !scope.has(p.path)) continue;
    const dir = Object.keys(LICENSE).find((d) => p.path.startsWith(d));
    if (dir === undefined) continue;
    // Line endings are made LF first: the recorded words of a connective flag are the first 70 characters of its
    // sentence, so a CR inside them would give a CRLF copy of a page different ids from the LF copy. Only CRLF is changed:
    // a lone CR was never a line break here, and making it one would move paragraph boundaries and so flags and ids.
    let body = splitFm(readFileSync(join(vaultPath, p.path), 'utf8')).replace(/\r\n/g, '\n');
    // Quotation exemption: nothing inside quotation marks is ever flagged.
    body = body.replace(/["“][^"“”]*["”]/g, '""');
    // The text a tone flag is raised on is the sentence(s) holding the word, taken inside one paragraph, so editing a
    // neighbouring list item or a heading line does not change the flag's identity.
    const sentences = styleParagraphs(body).flatMap((paragraph) => paragraph.split(SENTENCE_BREAK));
    for (const cat of LICENSE[dir]) {
      for (const w of STYLE[cat]) {
        const re = new RegExp(`(?<![\\w-])${w.replace(/[- ]/g, '[- ]')}(?![\\w-])`, 'i');
        // A use that is not the tone word is removed from the tested copy only. The flag's text is still every sentence
        // holding the words, unedited, so a rule that removes flags gives the flags that stay the ids they had.
        const fires = NOT_A_TONE[w] ? re.test(body.replace(NOT_A_TONE[w], ' ')) : re.test(body);
        if (fires) findings.push(styleFinding(p.path, cat, w, sentences.filter((s) => re.test(s)).join('\n') || w));
      }
    }
    // Connective-SYNTH weak signal, syntheses only: a contrast connective in a
    // sentence no [[citation]] covers may be an unsourced joint (WP:SYNTH's
    // "but"). Weakest signal — report last, expect false positives.
    if (dir === 'wiki/syntheses/') {
      for (const s of uncoveredContrasts(body)) findings.push(styleFinding(p.path, 'connective', s.slice(0, 70), s));
    }
  }
  return findings;
}

const TIERS = ['convention', 'gapped', 'unverified'];
const SHOW_BY_DEFAULT = ['gapped', 'unverified'];

function parseArgs(argv) {
  const opt = (name) => optionValue(argv, name);
  const tier = opt('tier');
  if (tier && tier !== 'all' && !TIERS.includes(tier)) throw new Error(`--tier must be one of: ${[...TIERS, 'all'].join(', ')}`);
  const pathsFile = opt('paths-file');
  if (pathsFile === '') throw new Error('--paths-file needs a file: --paths-file=<ledger.json>');
  const since = opt('updated-since');
  if (since !== undefined && !(/^\d{4}-\d{2}-\d{2}$/.test(since) && new Date(`${since}T00:00:00Z`).toISOString().slice(0, 10) === since)) throw new Error('--updated-since must be a date, YYYY-MM-DD');
  return {
    json: argv.includes('--json'), full: argv.includes('--full'), near: argv.includes('--near'), tier, page: opt('page'),
    pathsFile, since, ids: argv.includes('--ids'), includeReviewed: argv.includes('--include-reviewed'),
  };
}

// One evidence entry as the --full listing prints it: <document>:<first>-<last>.
const whereIs = (e) => (e.document === null ? 'none' : e.lines ? `${e.document}:${e.lines[0]}-${e.lines[1]}` : `${e.document} (lines unavailable)`);

const clip = (q, full, n = 80) => (full || q.length <= n ? q : `${q.slice(0, n)}...`);

// The pages a run is limited to, or null for the whole vault: those a ledger names, those whose `updated` is on or
// after a date, or both. A page with no `updated` is not "updated since" anything.
export function scopeOf(graph, { pathsFile, since }) {
  if (pathsFile === undefined && since === undefined) return null;
  const named = pathsFile === undefined ? null : new Set(checkLedgerPaths(readLedger(pathsFile)));
  const pages = new Set();
  for (const p of graph.pages) {
    if (!isContent(p.path)) continue;
    if (named && !named.has(p.path)) continue;
    if (since !== undefined) {
      const u = p.metadata?.updated;
      if (typeof u !== 'string' || u.slice(0, 10) < since) continue;
    }
    pages.add(p.path);
  }
  const by = [...(named ? ['paths-file'] : []), ...(since !== undefined ? ['updated-since'] : [])];
  const info = { pages: pages.size, ...(named ? { named: named.size } : {}), by };
  const text = named && since !== undefined ? `${pages.size} of ${named.size} named page(s) examined, updated on or after ${since}`
    : named ? `${pages.size} of ${named.size} named page(s) examined (paths-file)` : `${pages.size} page(s) updated on or after ${since}`;
  return { pages, info, text };
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const { path: vaultPath } = resolveVault();
  const graph = buildGraph(vaultPath);
  const scope = scopeOf(graph, args);
  const { examined, verbatim, title, findings } = classifyQuotes(vaultPath, graph, scope ? { pages: scope.pages } : {});
  const style = checkStyle(vaultPath, graph, scope ? { pages: scope.pages } : {});
  const count = (t) => findings.filter((f) => f.tier === t).length;
  const tiers = { examined, verbatim, title, convention: count('convention'), gapped: count('gapped'), unverified: count('unverified') };
  // Verdicts a reviewer recorded (lint-disposition.mjs). Without the file nothing below changes.
  const dispositionsFile = join(vaultPath, DISPOSITIONS_FILE);
  const dispositions = existsSync(dispositionsFile) ? loadDispositions(dispositionsFile) : null;
  const verdict = (f) => (dispositions ? reviewedBy(dispositions, f) : null);
  const inPage = (x) => !args.page || x.page.includes(args.page);
  if (dispositions) {
    const per = (reviewed) => Object.fromEntries(TIERS.map((t) => [t, findings.filter((f) => f.tier === t && !!verdict(f) === reviewed).length]));
    tiers.reviewed = per(true);
    tiers.unreviewed = per(false);
    // Counted on the pages --page lists, like the style listing it is printed under.
    tiers.styleReviewed = style.filter((f) => inPage(f) && reviewedBy(dispositions, f)).length;
  }
  const wanted = args.tier && args.tier !== 'all' ? [args.tier] : (args.json || args.tier === 'all' ? TIERS : SHOW_BY_DEFAULT);
  const visible = (f) => args.includeReviewed || !verdict(f);
  // What a finding looks like outside this script: the evidence hash is internal, the id only when asked for, and a
  // reviewed finding that is listed on request carries its verdict.
  const shape = ({ evidenceHash, id, ...rest }) => ({ ...rest, ...(args.ids ? { id } : {}), ...(args.includeReviewed && verdict({ id }) ? { reviewed: (({ disposition, reviewer, date, note }) => ({ disposition, reviewer, date, ...(note ? { note } : {}) }))(verdict({ id })) } : {}) });
  const listed = findings.filter((f) => wanted.includes(f.tier) && inPage(f) && visible(f));
  // Gapped quotes with the most skipped words first: that is where a spliced
  // passage is likeliest to hide among the header-and-timestamp noise.
  const skipped = (f) => f.inserted.join(' ').split(' ').filter(Boolean).length;
  listed.sort((x, y) => (x.tier === 'gapped' && y.tier === 'gapped' ? skipped(y) - skipped(x) : 0));
  // Style pointers follow the same rule as quotes: a recorded verdict hides one, --include-reviewed lists it with the verdict,
  // and the id is shown only when asked for. A pointer whose sentence was reworded has a new id and is read again.
  const styleVerdict = (f) => (dispositions ? reviewedBy(dispositions, f) : null);
  const shapeStyle = ({ evidenceHash, id, ...rest }) => {
    const v = args.includeReviewed ? styleVerdict({ id }) : null;
    return { ...rest, ...(args.ids ? { id } : {}), ...(v ? { reviewed: { disposition: v.disposition, reviewer: v.reviewer, date: v.date, ...(v.note ? { note: v.note } : {}) } } : {}) };
  };
  const shownStyle = style.filter((f) => inPage(f) && (args.includeReviewed || !styleVerdict(f))).map(shapeStyle);

  const near = args.near ? nearMatches(vaultPath, graph, findings.filter((f) => inPage(f) && visible(f))) : null;

  if (args.json) {
    const out = listed.map((f) => (f.tier === 'gapped' ? { ...shape(f), insertedWords: skipped(f) } : shape(f)));
    console.log(JSON.stringify({ tiers, ...(scope ? { scope: scope.info } : {}), findings: out, style: shownStyle, ...(near ? { near } : {}) }, null, 2));
    return { findings: out, tiers, ...(scope ? { scope: scope.info } : {}), style: shownStyle, ...(near ? { near } : {}) };
  }

  console.log(`Content lint (warn-only — flags for review, never scored)`);
  if (scope) console.log(`Scope: ${scope.text}`);
  console.log(`
Quote tiers: ${tiers.examined} examined, ${tiers.verbatim} verbatim, ${tiers.convention} convention, ${tiers.gapped} gapped, ${tiers.unverified} unverified`);
  if (dispositions) {
    const part = (o) => TIERS.filter((t) => o[t]).map((t) => `${t} ${o[t]}`).join(', ') || 'none';
    console.log(`Reviewed (${DISPOSITIONS_FILE}): ${part(tiers.reviewed)}; not yet reviewed: ${part(tiers.unreviewed)}`);
  }
  console.log(`  matched a clipping title: ${tiers.title} (counted, not listed; the quote is wholly the title of a clipping the page cites, which the body check cannot see)`);
  console.log(`  convention: the evidence has these words in this order; markup, punctuation or extraction spacing differ (counted, listed with --tier=convention)`);
  console.log(`  gapped: every word is in the evidence in order, with extra evidence words between them — extraction noise, or a silent omission; read the inserted words`);
  console.log(`  unverified: a word is changed, added, reordered or negated, or the evidence trail does not hold the text`);
  for (const tier of TIERS) {
    if (!wanted.includes(tier)) continue;
    const rows = listed.filter((f) => f.tier === tier);
    const label = tier === 'unverified' ? 'Unverifiable quotes' : `${tier[0].toUpperCase()}${tier.slice(1)} quotes`;
    console.log(`
${label}: ${args.page ? `${rows.length} on matching pages (${tiers[tier]} vault-wide)` : rows.length}`);
    for (const f of rows) {
      console.log(`  ${f.page}${args.ids ? ` [${f.id}]` : ''}
    "${clip(f.quote, args.full)}" (checked ${f.checked} sources)`);
      if (f.tier === 'gapped') console.log(`    inserted: ${f.inserted.map((x) => clip(x, args.full, 120)).join(' | ')}`);
      if (args.full) for (const e of f.evidence) console.log(`    evidence: ${whereIs(e)}`);
      const v = args.includeReviewed ? verdict(f) : null;
      if (v) console.log(`    reviewed: ${v.disposition} by ${v.reviewer} on ${v.date}${v.note ? ` (${v.note})` : ''}`);
    }
  }
  if (near) {
    console.log(`
Near matches (--near): ${near.listed.length} unverified quote(s) of ${near.minWords}+ words align with a raw clipping at ${near.threshold} or better; ${near.summaryOnly} more match only a wiki page (not evidence, not listed)`);
    console.log(`  [-word-] is in the page's quote and not in the clipping; {+word+} is in the clipping only; a~b is a word and its longer form`);
    for (const f of near.listed) {
      console.log(`  ${f.score.toFixed(2)}  ${f.page}
    -> ${f.document} (${f.kind})
    ${f.diff}`);
    }
  }
  const byCat = {};
  for (const f of shownStyle) (byCat[f.category] ??= []).push(f);
  console.log(`
Style flags: ${shownStyle.length}${tiers.styleReviewed && !args.includeReviewed ? ` (${tiers.styleReviewed} more with a recorded verdict, not listed)` : ''}`);
  for (const [cat, fs] of Object.entries(byCat)) {
    console.log(`  ${cat}: ${fs.length}`);
    // With --ids every flag is listed, because the ids are what a reviewer needs; otherwise five per category.
    const shown = args.ids ? fs : fs.slice(0, 5);
    for (const f of shown) {
      console.log(`    ${f.page} — ${f.word}${args.ids ? ` [${f.id}]` : ''}`);
      if (f.reviewed) console.log(`      reviewed: ${f.reviewed.disposition} by ${f.reviewed.reviewer} on ${f.reviewed.date}${f.reviewed.note ? ` (${f.reviewed.note})` : ''}`);
    }
    if (fs.length > shown.length) console.log(`    ... and ${fs.length - shown.length} more`);
  }
  return { findings: listed.map(shape), tiers, ...(scope ? { scope: scope.info } : {}), style: shownStyle };
}

const USAGE = [
  `usage: node scripts/lint.mjs [--json] [--full] [--near] [--tier=<${[...TIERS, 'all'].join('|')}>] [--page=<path>]`,
  '                             [--paths-file=<ledger>] [--updated-since=<YYYY-MM-DD>] [--ids] [--include-reviewed]',
  '',
  'Content lint: warn-only flags for review (quotes, run-of-spaces, near matches), never scored.',
  '  --json         machine-readable output',
  '  --full         do not shorten quotes in the listing, and print where each quote fragment is (evidence: <document>:<lines>)',
  '  --near         add the word diff of each unverified quote against its raw clipping',
  '  --tier=<name>  list one quote tier only',
  '  --page=<path>  limit the report to pages whose path contains this text (the whole vault is still examined)',
  '  --paths-file=<ledger>      examine only the pages a JSON array of vault-relative paths names',
  '  --updated-since=<date>     examine only pages whose `updated` is on or after the date; with --paths-file, both must hold',
  '  --ids          show the id of each finding (quotes and style flags), which lint-disposition.mjs takes',
  '  --include-reviewed         list findings that have a recorded verdict too, with the verdict',
  'When lint-dispositions.jsonl exists in the vault, findings with a recorded verdict are not listed and the summary counts them.',
  'The vault is the one named by WIKI_MASTER_VAULT (default: ~/.wiki-master-vault).',
].join('\n');

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (helpRequested()) exitWithHelp(USAGE);
  else {
    try { main(); }
    catch (err) { console.error(`lint: ${err.message}`); process.exitCode = 2; }
  }
}
