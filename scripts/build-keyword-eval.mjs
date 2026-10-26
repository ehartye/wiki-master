#!/usr/bin/env node
// Builds eval/keyword-engine.questions.json: questions only a keyword channel can answer.
//
// The 40-question set in eval/wiki-efficacy.questions.json is dominated by exact names and
// paraphrases, where the identity and semantic channels carry the result, so two keyword engines
// score identically on it. These questions have ground truth computed by exact, case-insensitive
// substring match over the real vault, the same semantics the keyword channel uses, so "expected"
// means "the string is on that page" and nothing is judged by taste.
//
//   rare-token    an identifier-like string (EACCES, wm_triage_port, v2.1) found on 1-4 pages and
//                 absent from every title, alias and filename, so identity lookup cannot help.
//   conjunction   three moderately common terms (each on 10-300 pages) whose conjunction is on 1-3
//                 pages. A ranker that puts all-terms matches first finds them; an unranked,
//                 capped list of partial matches loses them.
//   phrase        a three-word phrase on 1-3 pages whose words are each common.
//
// Sampling is seeded and sorted, so the same vault and seed give the same questions. The vault
// changes, so the committed JSON is the artifact: regenerate on purpose, not as part of a run.
//
//   node scripts/build-keyword-eval.mjs [--vault DIR] [--seed N] [--per-category N] [--out FILE]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { resolveVault } from './lib/vault.mjs';
import { inScope, noteIdentity } from './lib/retrieval.mjs';
import { cliGuard } from './lib/cli-guard.mjs';
cliGuard(import.meta.url);

const STOP = new Set(['about', 'above', 'after', 'again', 'against', 'also', 'because', 'before', 'being', 'between', 'could', 'during', 'each', 'every', 'from', 'have', 'into', 'more', 'most', 'only', 'other', 'over', 'same', 'should', 'some', 'such', 'than', 'that', 'their', 'then', 'there', 'these', 'they', 'this', 'those', 'through', 'under', 'very', 'were', 'what', 'when', 'where', 'which', 'while', 'will', 'with', 'would', 'your']);

function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function walk(vaultPath, scope) {
  const out = [];
  const visit = (rel) => {
    for (const entry of readdirSync(join(vaultPath, rel), { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === '_templates') continue;
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) visit(child); else if (inScope(child)) out.push(child);
    }
  };
  try { visit(scope); } catch { /* scope absent */ }
  return out;
}

export function loadCorpus(vaultPath) {
  const paths = [...walk(vaultPath, 'wiki'), ...walk(vaultPath, 'moc')].sort();
  return paths.map((path) => {
    const text = readFileSync(join(vaultPath, path), 'utf8');
    const identity = noteIdentity(text, path);
    const names = [path, identity.title, ...identity.aliases].join('\n').toLowerCase();
    return { path, text, lower: text.toLowerCase(), names };
  });
}

const holders = (corpus, needle) => corpus.filter((p) => p.lower.includes(needle));
// Identifiers a person would actually search for: snake_case, camelCase, and ALLCAPS codes
// (ETIMEDOUT). Letter-digit mixtures are left out on purpose: in this vault they are mostly hashes.
const identifier = /\b(?:[A-Za-z]+_[A-Za-z]+[A-Za-z_]*|[a-z]+[A-Z][a-z]+[A-Za-z]*|[A-Z]{6,})\b/g;
const looksJunk = (t) => t.length < 6 || t.length > 28;

function rareToken(corpus, random, taken) {
  for (let attempt = 0; attempt < 4000; attempt++) {
    const page = corpus[Math.floor(random() * corpus.length)];
    const matches = page.text.match(identifier);
    if (!matches) continue;
    const token = matches[Math.floor(random() * matches.length)];
    const key = token.toLowerCase();
    if (looksJunk(token) || taken.has(key)) continue;
    const found = holders(corpus, key);
    if (found.length < 1 || found.length > 4 || found.some((p) => p.names.includes(key))) continue;
    taken.add(key);
    return { query: token, expected: found.map((p) => p.path) };
  }
  return null;
}

function contentWords(text) {
  // terms() caps at 12 words, which would only ever see a page's frontmatter keys.
  return [...new Set((text.toLowerCase().match(/\p{L}{5,}/gu) ?? []).filter((w) => !STOP.has(w)))];
}

function conjunction(corpus, random, dfCache, taken) {
  for (let attempt = 0; attempt < 3000; attempt++) {
    const page = corpus[Math.floor(random() * corpus.length)];
    // Terms from one paragraph, as a topical query would have them, not from across the page.
    const paragraphs = page.text.split(/\r?\n\s*\r?\n/).filter((p) => p.split(/\s+/).length >= 30);
    if (!paragraphs.length) continue;
    const words = contentWords(paragraphs[Math.floor(random() * paragraphs.length)]);
    if (words.length < 6) continue;
    const pick = [];
    for (let i = 0; i < 12 && pick.length < 3; i++) {
      const w = words[Math.floor(random() * words.length)];
      if (pick.includes(w)) continue;
      if (!dfCache.has(w)) dfCache.set(w, holders(corpus, w).length);
      if (dfCache.get(w) >= 10 && dfCache.get(w) <= 300) pick.push(w);
    }
    if (pick.length < 3) continue;
    const key = [...pick].sort().join(' ');
    if (taken.has(key)) continue;
    const found = corpus.filter((p) => pick.every((w) => p.lower.includes(w)));
    if (found.length < 1 || found.length > 3 || found.some((p) => pick.some((w) => p.names.includes(w)))) continue;
    taken.add(key);
    return { query: pick.join(' '), expected: found.map((p) => p.path) };
  }
  return null;
}

function phrase(corpus, random, dfCache, taken) {
  for (let attempt = 0; attempt < 3000; attempt++) {
    const page = corpus[Math.floor(random() * corpus.length)];
    const sentences = page.text.split(/[.\n!?]/).map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 8);
    if (!sentences.length) continue;
    const words = sentences[Math.floor(random() * sentences.length)].replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter(Boolean);
    const at = Math.floor(random() * (words.length - 2));
    const gram = words.slice(at, at + 3);
    if (gram.some((w) => w.length < 4 || STOP.has(w.toLowerCase()) && false)) continue;
    const text = gram.join(' ').toLowerCase();
    if (taken.has(text) || !gram.every((w) => /^\p{L}[\p{L}'-]*$/u.test(w))) continue;
    if (gram.some((w) => { const k = w.toLowerCase(); if (!dfCache.has(k)) dfCache.set(k, holders(corpus, k).length); return dfCache.get(k) < 10; })) continue;
    const found = holders(corpus, text);
    if (found.length < 1 || found.length > 3 || found.some((p) => p.names.includes(text))) continue;
    taken.add(text);
    return { query: gram.join(' '), expected: found.map((p) => p.path) };
  }
  return null;
}

export function build(corpus, { seed = 20261019, perCategory = 14, categories = ['rare-token', 'conjunction', 'phrase'] } = {}) {
  const random = rng(seed);
  const taken = new Set();
  const dfCache = new Map();
  const makers = [['rare-token', () => rareToken(corpus, random, taken)], ['conjunction', () => conjunction(corpus, random, dfCache, taken)], ['phrase', () => phrase(corpus, random, dfCache, taken)]]
    .filter(([category]) => categories.includes(category));
  const questions = [];
  for (const [category, make] of makers) {
    for (let i = 0; i < perCategory; i++) {
      const q = make();
      if (!q) throw new Error(`could not find ${perCategory} ${category} questions; found ${i}`);
      questions.push({ id: `kw${String(questions.length + 1).padStart(2, '0')}`, category, split: (i % 4 === 3) ? 'heldout' : 'development', query: q.query, expectedPages: q.expected });
    }
  }
  return questions;
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href) {
  const { values } = parseArgs({ options: { vault: { type: 'string' }, seed: { type: 'string' }, 'per-category': { type: 'string' }, out: { type: 'string' } } });
  const vaultPath = values.vault ?? resolveVault().path;
  const seed = Number(values.seed ?? 20261019);
  const corpus = loadCorpus(vaultPath);
  const questions = build(corpus, { seed, perCategory: Number(values['per-category'] ?? 14) });
  const dataset = {
    version: 1,
    description: 'Questions whose answers only the keyword channel can find: a rare identifier, a conjunction of common terms, and a three-word phrase. Ground truth is every page whose text contains the string(s), by case-insensitive substring match over the vault snapshot below. Generated by scripts/build-keyword-eval.mjs; frozen so runs are comparable.',
    generated: { seed, pages: corpus.length, vaultSnapshot: new Date().toISOString().slice(0, 10) },
    questions,
  };
  const json = `${JSON.stringify(dataset, null, 2)}\n`;
  if (values.out) writeFileSync(values.out, json, 'utf8'); else process.stdout.write(json);
}
