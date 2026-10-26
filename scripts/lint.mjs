import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { helpRequested, exitWithHelp } from './lib/help.mjs';
import { buildGraph, isContent, buildNameIndex, evidencePaths } from './lib/graph.mjs';
import { prepareDocument, classifyFragments, DECLARES_ABSENT, tokenize } from './lib/quote-match.mjs';
import { bestWindow, renderDiff, NEAR_MIN_WORDS, NEAR_THRESHOLD } from './lib/near-match.mjs';

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

// Quotations are paired in document order with a stack, so a phrase quoted
// inside a quotation stays part of the outer quote (its marks are dropped, its
// words kept) and is also checked on its own when it is long enough:
//   - “ opens a curly quotation; ” closes the nearest open one, discarding any
//     straight opener still open above it. A ” with no curly opener is ignored.
//   - " closes the straight opener on top of the stack, else opens a new one. A
//     straight mark never pairs across a blank line, so a stray one (5" pipe)
//     cannot swallow a later paragraph; a curly quotation may span one.
//   - Quotes shorter than MIN_QUOTE_WORDS are consumed but not returned: a short
//     quote ("Adaptive") must still take its closing mark, or parity flips and
//     the text BETWEEN two quotes is captured.
// Each span is { start, text, raw }: text has the inner marks removed for
// matching, raw is the page text as written, for locating its sentence.
const PARAGRAPH_BREAK = /[ \t\r]*\n/y;

function scanQuotes(body) {
  const found = [];
  const open = []; // { curly, at } — at is the index just after the opening mark
  let settled = 0; // open[0..settled) holds only curly openers carried across a blank line
  const close = (at, end) => {
    const raw = body.slice(at, end);
    const text = raw.replace(/["“”]/g, '');
    if ((text.match(/\S+/g) || []).length >= MIN_QUOTE_WORDS) found.push({ start: at, text, raw });
  };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
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
      const top = open[open.length - 1];
      if (top && !top.curly) { close(top.at, i); open.pop(); }
      else open.push({ curly: false, at: i + 1 });
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
    const text = splitFm(readFileSync(join(vaultPath, path), 'utf8'));
    const doc = prepareDocument(text);
    cache.set(path, { doc, size: text.length * DOC_WEIGHT });
    held += text.length * DOC_WEIGHT;
    for (const [k, v] of cache) {
      if (held <= DOC_CACHE_WEIGHT || cache.size <= 1) break;
      cache.delete(k); held -= v.size;
    }
    return doc;
  };
}

// Every quote the verbatim check cannot place, sorted into the tier that says why.
// Returns { examined, verbatim, title, findings }; verbatim and title quotes are counted, not listed.
// A quote that would be unverified but is wholly the title of a clipping the page cites is a title
// match: the title is part of the captured record, though it is not in the body the check searches.
// Only the unverified tier is reconsidered, so no verbatim, convention or gapped quote changes tier. A
// clipping's `source:` URL is not matched: a URL is one whitespace-separated word and a returned quote
// has at least MIN_QUOTE_WORDS, so no quote can be a substring of one.
export function classifyQuotes(vaultPath, graph) {
  const byName = buildNameIndex(graph.pages);
  const pages = new Map(graph.pages.map((p) => [p.path, p]));
  const docFor = makeDocCache(vaultPath);
  const findings = [];
  let examined = 0, verbatim = 0, title = 0;
  for (const p of graph.pages) {
    if (!isContent(p.path)) continue;
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
      const { tier, inserted } = classifyFragments(raw, docs);
      if (tier === 'unverified') {
        titles ??= paths.filter((path) => path.startsWith('raw/')).map((path) => pages.get(path)?.metadata?.title).filter((x) => typeof x === 'string' && x).map(normalize);
        if (fragments.every((f) => titles.some((t) => t.includes(f)))) { title++; continue; }
      }
      // Full quote, never truncated: a repair tool re-checking this finding must
      // see the whole span, or a quote whose tail diverges verifies on its prefix.
      findings.push({ page: p.path, quote: q, tier, checked: evidence.length, ...(tier === 'gapped' ? { inserted } : {}) });
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
    const q = tokenize(f.quote);
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

const TIERS = ['convention', 'gapped', 'unverified'];
const SHOW_BY_DEFAULT = ['gapped', 'unverified'];

function parseArgs(argv) {
  const opt = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const tier = opt('tier');
  if (tier && tier !== 'all' && !TIERS.includes(tier)) throw new Error(`--tier must be one of: ${[...TIERS, 'all'].join(', ')}`);
  return { json: argv.includes('--json'), full: argv.includes('--full'), near: argv.includes('--near'), tier, page: opt('page') };
}

const clip = (q, full, n = 80) => (full || q.length <= n ? q : `${q.slice(0, n)}...`);

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const { path: vaultPath } = resolveVault();
  const graph = buildGraph(vaultPath);
  const { examined, verbatim, title, findings } = classifyQuotes(vaultPath, graph);
  const style = checkStyle(vaultPath, graph);
  const count = (t) => findings.filter((f) => f.tier === t).length;
  const tiers = { examined, verbatim, title, convention: count('convention'), gapped: count('gapped'), unverified: count('unverified') };
  const wanted = args.tier && args.tier !== 'all' ? [args.tier] : (args.json || args.tier === 'all' ? TIERS : SHOW_BY_DEFAULT);
  const inPage = (x) => !args.page || x.page.includes(args.page);
  const listed = findings.filter((f) => wanted.includes(f.tier) && inPage(f));
  // Gapped quotes with the most skipped words first: that is where a spliced
  // passage is likeliest to hide among the header-and-timestamp noise.
  const skipped = (f) => f.inserted.join(' ').split(' ').filter(Boolean).length;
  listed.sort((x, y) => (x.tier === 'gapped' && y.tier === 'gapped' ? skipped(y) - skipped(x) : 0));
  const shownStyle = style.filter(inPage);

  const near = args.near ? nearMatches(vaultPath, graph, findings.filter(inPage)) : null;

  if (args.json) {
    const out = listed.map((f) => (f.tier === 'gapped' ? { ...f, insertedWords: skipped(f) } : f));
    console.log(JSON.stringify({ tiers, findings: out, style: shownStyle, ...(near ? { near } : {}) }, null, 2));
    return { findings: listed, tiers, style: shownStyle, ...(near ? { near } : {}) };
  }

  console.log(`Content lint (warn-only — flags for review, never scored)`);
  console.log(`
Quote tiers: ${tiers.examined} examined, ${tiers.verbatim} verbatim, ${tiers.convention} convention, ${tiers.gapped} gapped, ${tiers.unverified} unverified`);
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
      console.log(`  ${f.page}
    "${clip(f.quote, args.full)}" (checked ${f.checked} sources)`);
      if (f.tier === 'gapped') console.log(`    inserted: ${f.inserted.map((x) => clip(x, args.full, 120)).join(' | ')}`);
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
Style flags: ${shownStyle.length}`);
  for (const [cat, fs] of Object.entries(byCat)) {
    console.log(`  ${cat}: ${fs.length}`);
    for (const f of fs.slice(0, 5)) console.log(`    ${f.page} — ${f.word}`);
    if (fs.length > 5) console.log(`    ... and ${fs.length - 5} more`);
  }
  return { findings: listed, tiers, style: shownStyle };
}

const USAGE = [
  `usage: node scripts/lint.mjs [--json] [--full] [--near] [--tier=<${[...TIERS, 'all'].join('|')}>] [--page=<path>]`,
  '',
  'Content lint: warn-only flags for review (quotes, run-of-spaces, near matches), never scored.',
  '  --json         machine-readable output',
  '  --full         do not shorten quotes in the listing',
  '  --near         add the word diff of each unverified quote against its raw clipping',
  '  --tier=<name>  list one quote tier only',
  '  --page=<path>  limit the report to one page',
  'The vault is the one named by WIKI_MASTER_VAULT (default: ~/.wiki-master-vault).',
].join('\n');

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (helpRequested()) exitWithHelp(USAGE);
  else main();
}
