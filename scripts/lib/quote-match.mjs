// Tiered quote matching for the content lint. The lint's first check is a strict
// verbatim comparison (lint.mjs `normalize`). Everything that fails it lands here,
// where WHY it failed decides how a reviewer should treat it:
//
//   convention  the same words in the same order; only markup, punctuation or
//               extraction spacing differ (`[t](url)`, a comma, "ensur ing").
//   gapped      every quoted word occurs in order in ONE evidence document, with
//               extra evidence words between them. The extra words are returned:
//               they are extraction noise (a running header, a timestamp) when
//               the capture is noisy, and a SILENT OMISSION when the page author
//               joined two passages without an ellipsis. Only a reader can tell.
//   (null)      anything else: a changed, added, reordered or negated word, or
//               text the evidence does not hold. The caller reports it unverified.
//
// A tier is a pointer for review, never a verdict that the quote is faithful.
// Matching is by token, so it cannot see meaning: a gapped quote whose omitted
// words flip the claim is exactly what the `inserted` list is there to expose.

// Bounds, chosen from the live vault (1,954 quotes the verbatim check could not
// place were re-scored with unlimited bounds, then sampled by band):
//  - A run of extra words longer than 12 is a different passage, not noise.
//    Running headers and timestamps insert 1-4 words; a citation, caption or
//    dropped clause 3-12.
//  - A SHORT quote (under 12 words) may skip at most 2. Common words let a short
//    quote be scattered over a long hole ("technically halt the [8 words]
//    progression of game time"); at 2 that stops.
//  - A longer quote may skip a quarter of its length, at most 20 — the room a
//    page break (header + footer + page number) or one dropped clause needs.
//    Everything accepted in samples at that size was extraction noise, an
//    inline citation or parenthetical, or an omitted clause: what a reviewer
//    must see, so none of it is passed silently.
export const GAP_MAX_RUN = 12;
export const GAP_SHORT_QUOTE = 12;
export const GAP_SHORT_BUDGET = 2;
export const GAP_SHARE = 0.25;
export const GAP_CAP = 20;
export const maxInserted = (n) => (n < GAP_SHORT_QUOTE ? GAP_SHORT_BUDGET : Math.min(GAP_CAP, Math.floor(GAP_SHARE * n)));
// Beyond this many words the ordered search is skipped (the quote is a passage,
// not a sentence, and the search is quadratic in the worst case).
const GAP_MAX_QUOTE_TOKENS = 400;
// Anchoring on the rarest quoted word keeps the search to a handful of positions.
const MAX_ANCHORS = 2000;
// A space-free match shorter than this is too easy to hit by accident.
const MIN_COMPACT = 12;

// A sentence that says the quoted text is not in the source is the policy working.
export const DECLARES_ABSENT = /unsourced|not in the (?:clipped |captured )?(?:source|clipping|vault)|nowhere in the vault/i;

// Tokens a gap may never skip: dropping one flips or changes the claim. `t` is the
// tail of an n't contraction (tokenization splits on the apostrophe); the stems are
// listed so "do not"-style omissions of the stem alone are blocked as well. The
// symbols are the ones `tokenize` keeps ("3 × 4" must not match "3 + 4", and a
// dropped "%" turns 40% into 40).
const SYMBOLS = '<>=+×÷±≤≥≠\u2212%$€£';
export const NO_SKIP = new Set([
  'not', 'no', 'never', 'nor', 'neither', 'none', 'nothing', 'nobody', 'nowhere', 'without', 'cannot',
  't', 'don', 'doesn', 'didn', 'isn', 'aren', 'wasn', 'weren', 'won', 'wouldn', 'couldn', 'shouldn',
  'hasn', 'haven', 'hadn', 'ain', 'mustn', 'needn', 'shan', 'mightn', 'oughtn',
  ...SYMBOLS,
]);

// A line that opens (after indentation) with an HTML table tag. Once its tags are stripped, its first cell sits at
// the start of the line, where "1790." or "+" would read as a list marker and ">" as a quote marker. Such a line
// is marked before the tag strip and the marker rules skip it; other tag-led lines are unchanged.
const TABLE_LINE = /(^|\n)(?=[ \t]*<(?:table|thead|tbody|tr|td|th)[\s>/])/gi;
const TABLE_MARK = '\u0000';
// One NUL is removed where it starts a line once list and quote markers are stripped, so a NUL the input already
// had there goes the same way, and a line it leads skips the marker rules like a table line. Any other NUL stays and
// separates words.
const TABLE_MARK_AT_LINE_START = /(^|\n)\u0000/g;

// Reduce markdown to the words a reader sees. Applied to the quote AND the
// evidence, so author-added markup and clipper-added markup cancel out.
export function flattenMarkdown(text) {
  return String(text)
    .normalize('NFKC') // ligatures (ﬁ), full-width and other compatibility forms
    .replace(TABLE_LINE, `$1${TABLE_MARK}`)                 // table rows: exempt from the marker rules below
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')                  // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')                // [text](url) -> text
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')       // [[target|label]] -> label
    // Real tags only: "x < y ... z > w" in prose must survive.
    .replace(/<\/?[a-zA-Z][^<>]{0,200}>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\\([_*\[\]()#>.\-!~`|])/g, '$1')              // backslash escapes
    .replace(/(^|\n)[ \t]*>[ \t>]*/g, '$1')                 // blockquote markers
    .replace(/(^|\n)[ \t]*(?:[-*+]|\d+[.)])[ \t]+/g, '$1')  // list markers
    .replace(TABLE_MARK_AT_LINE_START, '$1')               // a NUL at a line start: the mark, or one the input had
    .replace(/\[\d+\]|\[\^[^\]]+\]/g, ' ');                 // footnote / citation numbers
}

// Words are letters and digits. A few symbols are tokens too, because changing one
// changes the claim ("a < b" / "a > b", "3 × 4" / "3 + 4", "40%" / "40") and
// ignoring punctuation must not make that invisible. Hyphens, slashes and
// quotation marks stay punctuation. A capture that garbles a symbol (÷ read as ˜)
// therefore lands in a higher tier, not in convention.
// The `u` flag is load-bearing: without it \p{L} is a literal and every string
// flattens to nothing, which makes any quote "match".
const WORD = new RegExp(String.raw`[\p{L}\p{N}]+|[${SYMBOLS}]`, 'gu');
// A minus sign and a hyphen are the same character to a capture (U+2212 24 / -24) but
// not to a reader (-24 is not 24): a dash directly before a digit and not after a
// word character is a sign, kept as the symbol U+2212. Ranges (5-10) and compounds
// (well-known) keep their hyphen as punctuation.
const SIGN = new RegExp(String.raw`(^|[^\p{L}\p{N}])-(?=\d)`, 'gu');
export const tokenize = (text) => flattenMarkdown(text).toLowerCase().replace(/\u2212/g, '-').replace(SIGN, '$1\u2212').match(WORD) ?? [];

// One evidence document, prepared lazily: a page with 80 evidence documents only
// pays for the ones a failing quote actually needs, and the representations
// (word string, compact string, word index, line map) are built on first use.
// `lineOffset` is the number of file lines before `text` (a frontmatter block the
// caller removed), so line numbers count from the top of the file.
export function prepareDocument(text, { lineOffset = 0 } = {}) {
  let str, tokens, index, compact, lineOf;
  const self = {
    // " w1 w2 w3 " — a word-bounded search is `str.includes(" w2 w3 ")`.
    get str() { return str ??= ` ${tokenize(text).join(' ')} `; },
    get tokens() { return tokens ??= self.str.slice(1, -1).split(' ').filter(Boolean); },
    get indexBuilt() { return index !== undefined; },
    get index() {
      if (!index) {
        index = new Map();
        const t = self.tokens;
        for (let i = 0; i < t.length; i++) { const l = index.get(t[i]); if (l) l.push(i); else index.set(t[i], [i]); }
      }
      return index;
    },
    // Words concatenated, plus which characters begin/end an original word, so a
    // space-free match can be required to start and end on word boundaries.
    // Typed arrays: a multi-megabyte document must not cost an object per character.
    get compact() {
      if (!compact) {
        const s = self.str;
        const joined = s.replace(/ /g, '');
        const starts = new Uint8Array(joined.length), ends = new Uint8Array(joined.length);
        let at = 0;
        for (let i = 1; i < s.length - 1; i++) {
          if (s.charCodeAt(i) === 32) continue;
          if (s.charCodeAt(i - 1) === 32) starts[at] = 1;
          if (s.charCodeAt(i + 1) === 32) ends[at] = 1;
          at++;
        }
        compact = { text: joined, starts, ends };
      }
      return compact;
    },
    get lineMapBuilt() { return lineOf !== undefined; },
    // The 1-based file lines holding tokens [start, end), or null. Each line is
    // tokenized alone, and the map is used only when those tokens are exactly the
    // whole text's: a construct that spans a line (a tag, a link) can make them
    // differ, and then no token has a line it can be trusted to sit on.
    lineSpan(start, end) {
      if (lineOf === undefined) lineOf = lineMap(String(text), self.tokens);
      if (!lineOf || !(start >= 0 && end > start && end <= lineOf.length)) return null;
      return [lineOf[start] + 1 + lineOffset, lineOf[end - 1] + 1 + lineOffset];
    },
  };
  return self;
}

// Token index -> 0-based line of `text`, or null when a line-by-line reading
// does not give the same tokens as the whole text.
function lineMap(text, whole) {
  const map = new Uint32Array(whole.length);
  let at = 0, line = 0;
  for (let from = 0; from <= text.length; line++) {
    const nl = text.indexOf('\n', from);
    const to = nl < 0 ? text.length : nl;
    for (const t of tokenize(text.slice(from, to))) {
      if (at >= whole.length || whole[at] !== t) return null;
      map[at++] = line;
    }
    if (nl < 0) break;
    from = nl + 1;
  }
  return at === whole.length ? map : null;
}

// The token range [start, end) of the first convention match, or null.
function conventionMatch(q, doc) {
  const at = doc.str.indexOf(` ${q.join(' ')} `);
  if (at !== -1) {
    // Each space after the string's first, up to the match's leading space, ends one earlier token.
    let start = 0;
    for (let i = doc.str.indexOf(' ', 1); i !== -1 && i <= at; i = doc.str.indexOf(' ', i + 1)) start++;
    return { start, end: start + q.length };
  }
  const qc = q.join('');
  if (qc.length < MIN_COMPACT) return null;
  const { text, starts, ends } = doc.compact;
  for (let i = text.indexOf(qc); i !== -1; i = text.indexOf(qc, i + 1)) {
    if (starts[i] && ends[i + qc.length - 1]) {
      let start = -1, end = 0;
      for (let c = 0; c < i + qc.length; c++) if (starts[c]) { end++; if (c <= i) start++; }
      return { start, end };
    }
  }
  return null;
}

// Cheapest in-order placement of every quote word in the document, or null.
// Choose the rarest quote word, then extend left and right from each of its
// positions: each step may skip up to GAP_MAX_RUN evidence words, never a
// negator, and the skipped words are the cost.
function gappedMatch(q, doc) {
  const n = q.length;
  if (n < 3 || n > GAP_MAX_QUOTE_TOKENS) return null;
  // Cheapest rejection first: every quoted word must occur in the document. A string
  // search over the joined words (longest words first, they are the rarest) throws
  // out almost every document before any token array or index is built for it.
  for (const w of [...new Set(q)].sort((x, y) => y.length - x.length)) if (!doc.str.includes(` ${w} `)) return null;
  const T = doc.tokens, idx = doc.index, len = T.length;
  let k = 0;
  for (let j = 1; j < n; j++) if (idx.get(q[j]).length < idx.get(q[k]).length) k = j;
  const anchors = idx.get(q[k]);
  if (anchors.length > MAX_ANCHORS) return null;
  const budget = maxInserted(n);

  const memoR = new Map(), memoL = new Map();
  // Min skipped words to place q[j+1..] after position p, where q[j] sits at p.
  const R = (j, p) => {
    if (j === n - 1) return 0;
    const key = j * (len + 1) + p;
    const hit = memoR.get(key);
    if (hit !== undefined) return hit;
    let best = Infinity;
    for (let s = 1; s <= GAP_MAX_RUN + 1 && p + s < len; s++) {
      const w = T[p + s];
      if (w === q[j + 1]) { const c = (s - 1) + R(j + 1, p + s); if (c < best) best = c; }
      if (NO_SKIP.has(w)) break; // would have to skip it to go further
    }
    memoR.set(key, best);
    return best;
  };
  const L = (j, p) => {
    if (j === 0) return 0;
    const key = j * (len + 1) + p;
    const hit = memoL.get(key);
    if (hit !== undefined) return hit;
    let best = Infinity;
    for (let s = 1; s <= GAP_MAX_RUN + 1 && p - s >= 0; s++) {
      const w = T[p - s];
      if (w === q[j - 1]) { const c = (s - 1) + L(j - 1, p - s); if (c < best) best = c; }
      if (NO_SKIP.has(w)) break;
    }
    memoL.set(key, best);
    return best;
  };

  let bestCost = Infinity, bestAt = -1;
  for (const p of anchors) {
    const c = L(k, p) + R(k, p);
    if (c < bestCost) { bestCost = c; bestAt = p; }
  }
  if (bestCost === Infinity || bestCost > budget) return null;

  // Rebuild the chosen placement to report what was skipped.
  const at = new Array(n);
  at[k] = bestAt;
  for (let j = k; j < n - 1; j++) {
    let pick = -1, cost = Infinity;
    for (let s = 1; s <= GAP_MAX_RUN + 1 && at[j] + s < len; s++) {
      const w = T[at[j] + s];
      if (w === q[j + 1]) { const c = (s - 1) + R(j + 1, at[j] + s); if (c < cost) { cost = c; pick = at[j] + s; } }
      if (NO_SKIP.has(w)) break;
    }
    at[j + 1] = pick;
  }
  for (let j = k; j > 0; j--) {
    let pick = -1, cost = Infinity;
    for (let s = 1; s <= GAP_MAX_RUN + 1 && at[j] - s >= 0; s++) {
      const w = T[at[j] - s];
      if (w === q[j - 1]) { const c = (s - 1) + L(j - 1, at[j] - s); if (c < cost) { cost = c; pick = at[j] - s; } }
      if (NO_SKIP.has(w)) break;
    }
    at[j - 1] = pick;
  }
  const inserted = [];
  for (let j = 0; j < n - 1; j++) {
    if (at[j + 1] - at[j] > 1) inserted.push(T.slice(at[j] + 1, at[j + 1]).join(' '));
  }
  return { cost: bestCost, inserted, at };
}

// Classify one quoted fragment against the evidence documents of its page.
// Convention in ANY document beats gapped; among gapped matches the cheapest wins.
// Where the match is: `doc`, the index in `docs` of the document the tier came
// from (null with no match, or for a fragment with no words), and the token range
// [start, end) it covers in that document; a gapped match adds `at`, the evidence
// position of each quote word.
export function matchFragment(fragment, docs) {
  const q = tokenize(fragment);
  if (!q.length) return { tier: 'convention', inserted: [], doc: null };
  for (let i = 0; i < docs.length; i++) {
    const c = conventionMatch(q, docs[i]);
    if (c) return { tier: 'convention', inserted: [], doc: i, start: c.start, end: c.end };
  }
  let best = null, bestDoc = -1;
  for (let i = 0; i < docs.length; i++) {
    const g = gappedMatch(q, docs[i]);
    if (g && (!best || g.cost < best.cost)) { best = g; bestDoc = i; }
  }
  if (!best) return { tier: null, inserted: [], doc: null };
  return { tier: 'gapped', inserted: best.inserted, doc: bestDoc, start: best.at[0], end: best.at[best.at.length - 1] + 1, at: best.at };
}

// A quote is as weak as its weakest fragment (fragments are the pieces between
// the page's own ellipses and bracketed insertions; each is checked alone).
// `matches` holds every fragment's matchFragment result, in order, so each
// fragment can be located, including those after an unverified one.
export function classifyFragments(fragments, docs) {
  let tier = 'convention';
  const inserted = [];
  const matches = fragments.map((f) => matchFragment(f, docs));
  for (const m of matches) {
    if (m.tier === null) return { tier: 'unverified', inserted: [], matches };
    if (m.tier === 'gapped') { tier = 'gapped'; inserted.push(...m.inserted); }
  }
  return { tier, inserted, matches };
}
