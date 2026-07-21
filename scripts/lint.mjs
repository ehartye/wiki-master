import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { buildGraph, isContent, buildNameIndex, evidencePaths } from './lib/graph.mjs';

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
export function quoteFragments(q) {
  return q
    .split(/\.\.\.|…|\[[^\]]*\]/)
    .map((f) => f.trim())
    .filter((f) => (f.match(/\S+/g) || []).length >= 3);
}

const MIN_QUOTE_WORDS = 5;

function splitFm(md) {
  const m = md.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return md.slice(m ? m[0].length : 0);
}

function quotedSpans(body) {
  const out = [];
  const keep = (s) => {
    if ((s.match(/\S+/g) || []).length >= MIN_QUOTE_WORDS) out.push(s);
  };
  // Curly pairs are unambiguous — extract them first and remove them, so a
  // straight quote can never mispair with a curly one and capture the text
  // BETWEEN two quotations.
  const rest = body.replace(/“([^“”]+?)”/g, (_, g) => { keep(g); return ' '; });
  // No length minimum in the regex: a short quote ("Adaptive") must still
  // consume its closing mark, or parity flips and we capture BETWEEN quotes.
  for (const m of rest.matchAll(/"([^"]*?)"/g)) keep(m[1]);
  return out;
}

// The breadcrumb trail (#13) lives in graph.mjs — health measures reachability
// over the same walk, and two copies would drift into two different answers to
// "can this page be walked back to raw/".
function evidenceBodies(vaultPath, page, byName, pages) {
  return evidencePaths(page, byName, pages)
    .map((p) => splitFm(readFileSync(join(vaultPath, p), 'utf8')));
}

export function checkQuotes(vaultPath, graph) {
  const byName = buildNameIndex(graph.pages);
  const pages = new Map(graph.pages.map((p) => [p.path, p]));
  const findings = [];
  for (const p of graph.pages) {
    if (!isContent(p.path)) continue;
    const body = splitFm(readFileSync(join(vaultPath, p.path), 'utf8'));
    const quotes = quotedSpans(body);
    if (!quotes.length) continue;
    const evidence = evidenceBodies(vaultPath, p, byName, pages).map(normalize);
    for (const q of quotes) {
      // A sentence that declares its claim unsourced is the policy working.
      const sentence = body.split(/(?<=[.!?])\s+/).find((s) => s.includes(q)) ?? '';
      if (/unsourced/i.test(sentence)) continue;
      // Edge punctuation is quoting convention, not source text: the page
      // ends a quote "…the image." where the book continues "…the image, so".
      const fragments = quoteFragments(q)
        .map((f) => normalize(f).replace(/^[.,;:!?\s]+|[.,;:!?\s]+$/g, ''));
      if (!fragments.length) continue;
      if (!fragments.every((f) => evidence.some((e) => e.includes(f)))) {
        // Full quote, never truncated: a repair tool re-checking this finding must
        // see the whole span, or a quote whose tail diverges verifies on its prefix.
        findings.push({ page: p.path, quote: q, checked: evidence.length });
      }
    }
  }
  return findings;
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
};

const CONNECTIVES = /\b(however|but|despite|yet)\b/i;

export function checkStyle(vaultPath, graph) {
  const findings = [];
  for (const p of graph.pages) {
    if (!isContent(p.path)) continue;
    const dir = Object.keys(LICENSE).find((d) => p.path.startsWith(d));
    if (dir === undefined) continue;
    let body = splitFm(readFileSync(join(vaultPath, p.path), 'utf8'));
    // Quotation exemption: nothing inside quotation marks is ever flagged.
    body = body.replace(/["“][^"“”]*["”]/g, '""');
    for (const cat of LICENSE[dir]) {
      for (const w of STYLE[cat]) {
        const re = new RegExp(`(?<![\\w-])${w.replace(/[- ]/g, '[- ]')}(?![\\w-])`, 'i');
        if (re.test(body)) findings.push({ page: p.path, category: cat, word: w });
      }
    }
    // Connective-SYNTH weak signal, syntheses only: a contrast connective in a
    // sentence carrying no [[citation]] may be an unsourced joint (WP:SYNTH's
    // "but"). Weakest signal — report last, expect false positives.
    if (dir === 'wiki/syntheses/') {
      for (const s of body.split(/(?<=[.!?])\s+/)) {
        if (CONNECTIVES.test(s) && !s.includes('[[')) {
          findings.push({ page: p.path, category: 'connective', word: s.trim().slice(0, 70) });
        }
      }
    }
  }
  return findings;
}

export function main() {
  const { path: vaultPath } = resolveVault();
  const graph = buildGraph(vaultPath);
  const quotes = checkQuotes(vaultPath, graph);
  const style = checkStyle(vaultPath, graph);
  console.log(`Content lint (warn-only — flags for review, never scored)`);
  console.log(`\nUnverifiable quotes: ${quotes.length}`);
  for (const f of quotes) console.log(`  ${f.page}\n    "${f.quote.slice(0, 80)}..." (checked ${f.checked} sources)`);
  const byCat = {};
  for (const f of style) (byCat[f.category] ??= []).push(f);
  console.log(`\nStyle flags: ${style.length}`);
  for (const [cat, fs] of Object.entries(byCat)) {
    console.log(`  ${cat}: ${fs.length}`);
    for (const f of fs.slice(0, 5)) console.log(`    ${f.page} — ${f.word}`);
    if (fs.length > 5) console.log(`    ... and ${fs.length - 5} more`);
  }
  return { quotes, style };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
