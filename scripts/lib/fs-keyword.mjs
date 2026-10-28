import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { terms, inScope } from './retrieval.mjs';

// Keyword candidates straight from the Markdown files, with no app, gate or cold start.
//
// This replaces Obsidian full-text search as search.mjs's keyword channel. Measured on the live
// vault (7,785 wiki/ files 52.7 MB, 83 moc/ files 0.2 MB, 6,256 raw/ files 238 MB), Obsidian took
// 29s on a cold wiki/ call, never finished raw/ in 90s, and returned a capped list in no relevance
// order. One pass here reads every file and ranks them: 16 concurrent reads took about 0.7s for
// wiki/, 10ms for moc/ and 1.6s for raw/ (plain sequential loop: 1.1s, 3.2s). The files are the
// source of truth, so results are never stale.
//
// Checked against the 40-question live set of the maintainer's vault (no longer in this repository) on 2026-10-18, this
// engine vs Obsidian keyword at 0.42.1: page recall@10 0.9375, precision@3 0.325 and reciprocal rank
// 0.809 identical with no per-question difference; all 40 questions hybrid; mean latency per
// question 8.7s -> 2.0s; keyword failures 1 -> 0. Identical metrics mean the set does not separate
// the two keyword engines (exact identity and semantic channels dominate it), so this shows no
// regression, not a ranking gain.
//
// Matching is case-insensitive substring, the same semantics lexicalScore applies downstream, so a
// candidate here is never one the ranking pass would discard on principle. Ranking, best first:
// the exact phrase, then more distinct query terms present, then terms in the path, then a capped
// occurrence count. Ties break by path so results are deterministic.

const SCOPES = new Set(['wiki', 'moc', 'raw']);
const MAX_PER_TERM = 10;
const failure = (message, code) => Object.assign(new Error(message), { code });

async function listMarkdown(vaultPath, scope) {
  const out = [];
  const visit = async (rel) => {
    let entries;
    try { entries = await readdir(join(vaultPath, rel), { withFileTypes: true }); }
    catch (err) { if (err.code === 'ENOENT' && rel === scope) return; throw err; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === '_templates') continue;
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) await visit(child);
      else if (inScope(child, true)) out.push(child);
    }
  };
  await visit(scope);
  return out;
}

function occurrences(text, word) {
  let count = 0;
  for (let at = text.indexOf(word); at !== -1 && count < MAX_PER_TERM; at = text.indexOf(word, at + word.length)) count++;
  return count;
}

export async function fsKeywordSearch(query, { vaultPath, path = 'wiki', limit = 100, deadlineMs = 30000,
  concurrency = 16, readFileImpl = readFile } = {}) {
  if (!SCOPES.has(path)) throw failure(`Unknown keyword scope "${path}"; use wiki, moc or raw`, 'KEYWORD_SCOPE');
  const phrase = String(query).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!phrase) return [];
  const words = terms(query);
  // Only stopwords: the phrase itself is the whole query.
  const needles = words.length ? words : [phrase];
  const files = await listMarkdown(vaultPath, path);
  const started = performance.now();
  const hits = [];
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      if (performance.now() - started > deadlineMs) throw failure(`Keyword scan of ${path}/ exceeded ${deadlineMs}ms`, 'KEYWORD_SCAN_TIMEOUT');
      const rel = files[next++];
      let text;
      try { text = (await readFileImpl(join(vaultPath, rel), 'utf8')).toLowerCase(); }
      catch (err) { if (err.code === 'ENOENT') continue; throw err; }
      const present = needles.filter(w => text.includes(w));
      const inPhrase = text.includes(phrase);
      if (!present.length && !inPhrase) continue;
      const lowerPath = rel.toLowerCase();
      const tf = present.reduce((sum, w) => sum + occurrences(text, w), 0);
      hits.push({ rel, score: (inPhrase ? 1000 : 0) + present.length * 100
        + needles.filter(w => lowerPath.includes(w)).length * 30 + Math.min(tf, 40) });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return hits.sort((a, b) => b.score - a.score || a.rel.localeCompare(b.rel)).slice(0, limit).map(h => h.rel);
}
