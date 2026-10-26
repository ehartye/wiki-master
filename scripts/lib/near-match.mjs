import { NO_SKIP } from './quote-match.mjs';

// A triage aid for the lint's unverified tier. That tier holds the page's own wording in quotation marks
// (a coined question, an example) beside a genuine quotation that has been altered, and nothing separates
// them. This aligns a quote with the best stretch of an evidence document, word by word, and shows the
// difference, so a reviewer reads a diff instead of searching the clippings. It adds output and changes no
// tier. Matching is by token and cannot see meaning: an alignment is a pointer, never a verdict.
//
// Scores are the share of the quote's words that align (1.00 = every word has a partner).

export const NEAR_MIN_WORDS = 6;
export const NEAR_THRESHOLD = 0.85;

const MIN_STEM = 3;          // the shorter of two words that differ only in length must have this many letters
const STEM_KEY = 3;          // candidate lookup is by the first three letters
const MAX_STEM_POSITIONS = 300; // a lookup key commoner than this is no anchor ("the", "con...")
const TOP_WINDOWS = 3;

// Equal words, or one a prefix of the other ("know"/"knowing", "sim"/"simulation"). Never a negation, a
// symbol or a number: "not" is not "nothing", "%" is not a word, "40" is not "400".
export function tokensMatch(a, b) {
  if (a === b) return true;
  if (NO_SKIP.has(a) || NO_SKIP.has(b) || /\d/.test(a) || /\d/.test(b)) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= MIN_STEM && long.startsWith(short);
}

// Longest common subsequence of the quote and a stretch of document, as edit operations. Ops are
// { op: '=', q, d, di } (aligned), { op: '-', q } (a word only the page has) and { op: '+', d, di } (a word
// only the source has); `di` is the position in `d`. Within a gap the page's words come before the source's,
// and source words before the first aligned word or after the last are dropped: they are window padding.
export function alignWords(q, d) {
  const n = q.length, m = d.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = tokensMatch(q[i - 1], d[j - 1]) ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const back = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && tokensMatch(q[i - 1], d[j - 1]) && dp[i][j] === dp[i - 1][j - 1] + 1) { back.push({ op: '=', q: q[i - 1], d: d[j - 1], di: j - 1 }); i--; j--; }
    else if (i > 0 && (j === 0 || dp[i - 1][j] >= dp[i][j - 1])) { back.push({ op: '-', q: q[i - 1] }); i--; }
    else { back.push({ op: '+', d: d[j - 1], di: j - 1 }); j--; }
  }
  const forward = back.reverse();
  // Gap order: page words, then source words.
  const ops = [];
  for (let k = 0; k < forward.length;) {
    if (forward[k].op === '=') { ops.push(forward[k++]); continue; }
    const gap = [];
    while (k < forward.length && forward[k].op !== '=') gap.push(forward[k++]);
    ops.push(...gap.filter((x) => x.op === '-'), ...gap.filter((x) => x.op === '+'));
  }
  const first = ops.findIndex((x) => x.op === '=');
  const matched = ops.filter((x) => x.op === '=').length;
  if (first < 0) return { ops: ops.filter((x) => x.op === '-'), matched: 0, score: 0 };
  const last = ops.length - 1 - [...ops].reverse().findIndex((x) => x.op === '=');
  const trimmed = ops.filter((x, k) => !(x.op === '+' && (k < first || k > last)));
  return { ops: trimmed, matched, score: n ? matched / n : 0 };
}

export function renderDiff(ops) {
  return ops.map((x) => (x.op === '=' ? (x.q === x.d ? x.q : `${x.q}~${x.d}`) : x.op === '-' ? `[-${x.q}-]` : `{+${x.d}+}`)).join(' ');
}

const stemOf = (w) => (w.length > STEM_KEY ? w.slice(0, STEM_KEY) : w);
const stemCache = new WeakMap();
function stemIndex(doc) {
  let idx = stemCache.get(doc);
  if (!idx) {
    idx = new Map();
    const T = doc.tokens;
    for (let p = 0; p < T.length; p++) { const s = stemOf(T[p]); const l = idx.get(s); if (l) l.push(p); else idx.set(s, [p]); }
    stemCache.set(doc, idx);
  }
  return idx;
}

// The best alignment of the quote (an array of tokens) inside one prepared document, or null. Candidate
// windows come from the quote's rarer words, so a long clipping costs a lookup and a few small alignments,
// not one alignment per position. Ties go to fewer edits, then to the earlier window.
export function bestWindow(q, doc) {
  const T = doc.tokens, n = q.length;
  if (!n || !T.length) return null;
  const idx = stemIndex(doc);
  const width = n + Math.max(6, Math.ceil(n / 2));
  const hits = [];
  for (const s of new Set(q.map(stemOf))) {
    const at = idx.get(s);
    if (at && at.length <= MAX_STEM_POSITIONS) for (const p of at) hits.push({ p, s });
  }
  if (!hits.length) return null;
  hits.sort((x, y) => x.p - y.p || (x.s < y.s ? -1 : 1));
  // For each hit as a window start, how many distinct quote stems fall within the window.
  const starts = [];
  const inWindow = new Map();
  let hi = 0;
  for (let lo = 0; lo < hits.length; lo++) {
    while (hi < hits.length && hits[hi].p < hits[lo].p + width) { inWindow.set(hits[hi].s, (inWindow.get(hits[hi].s) ?? 0) + 1); hi++; }
    if (lo === 0 || hits[lo].p !== hits[lo - 1].p) starts.push({ p: hits[lo].p, count: inWindow.size });
    const c = inWindow.get(hits[lo].s) - 1;
    if (c) inWindow.set(hits[lo].s, c); else inWindow.delete(hits[lo].s);
  }
  starts.sort((x, y) => y.count - x.count || x.p - y.p);
  const picked = [];
  for (const s of starts) {
    if (picked.length === TOP_WINDOWS) break;
    if (picked.every((o) => Math.abs(o.p - s.p) >= width / 2)) picked.push(s);
  }
  let best = null;
  for (const { p } of picked) {
    const from = Math.max(0, p - 2), to = Math.min(T.length, p + width + 2);
    const a = alignWords(q, T.slice(from, to));
    if (!a.matched) continue;
    const dis = a.ops.filter((x) => x.di !== undefined).map((x) => x.di + from);
    const edits = a.ops.filter((x) => x.op !== '=').length;
    const cand = { score: a.score, matched: a.matched, ops: a.ops.map((x) => (x.di === undefined ? x : { ...x, di: x.di + from })), start: Math.min(...dis), end: Math.max(...dis) + 1, edits };
    if (!best || cand.score > best.score || (cand.score === best.score && (cand.edits < best.edits || (cand.edits === best.edits && cand.start < best.start)))) best = cand;
  }
  return best;
}

