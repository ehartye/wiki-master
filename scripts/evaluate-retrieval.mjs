import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { buildGraph, buildNameIndex, evidencePaths, isEvidencePath, resolveLinkTarget } from './lib/graph.mjs';
import { resolveVault } from './lib/vault.mjs';

const normalize = value => String(value).trim().replace(/^\[\[|\]\]$/g, '').split(/[|#]/)[0].replace(/\\/g, '/');
const canonical = value => { const path = normalize(value); return path.endsWith('.md') ? path : `${path}.md`; };
const mean = values => values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : null;
const METRICS = ['pageRecallAt10', 'precisionAt3', 'reciprocalRank', 'passageHitRate', 'evidenceRecall', 'evidenceCorrectness'];

function validate(dataset, split) {
  if (!['all', 'development', 'heldout'].includes(split)) throw new Error('split must be all, development, or heldout');
  if (!Array.isArray(dataset.questions) || !dataset.questions.length) throw new Error('Question set is empty or missing questions');
  const ids = new Set();
  const validPath = path => typeof path === 'string' && /^(wiki|raw|moc)\/.+\.md$/.test(path) && !path.split('/').some(part => part.startsWith('.'));
  for (const q of dataset.questions) {
    if (!q.id || ids.has(q.id)) throw new Error('Every question needs a unique id');
    ids.add(q.id);
    if (typeof q.query !== 'string' || !q.query.trim()) throw new Error(`${q.id}: query is required`);
    if (!['development', 'heldout'].includes(q.split)) throw new Error(`${q.id}: split must be development or heldout`);
    if (!Array.isArray(q.expectedPages) || !q.expectedPages.length || !q.expectedPages.every(validPath)) throw new Error(`${q.id}: expectedPages must be nonempty canonical Markdown paths`);
    for (const field of ['expectedEvidence', 'forbiddenEvidence']) if (q[field] !== undefined && (!Array.isArray(q[field]) || !q[field].every(p => validPath(p) && isEvidencePath(p)))) throw new Error(`${q.id}: ${field} must contain source/raw paths`);
    if (q.expectedEvidence?.some(p => q.forbiddenEvidence?.includes(p))) throw new Error(`${q.id}: expected and forbidden evidence overlap`);
    if (q.expectedPassages !== undefined && (!Array.isArray(q.expectedPassages) || !q.expectedPassages.every(p => validPath(p.path) && typeof p.text === 'string' && p.text.trim()))) throw new Error(`${q.id}: expectedPassages must contain {path,text}`);
    if (q.options !== undefined && (!q.options || typeof q.options !== 'object' || Array.isArray(q.options) || Object.entries(q.options).some(([k, v]) => !['project', 'type', 'status', 'includeRaw'].includes(k) || (k === 'includeRaw' ? typeof v !== 'boolean' : typeof v !== 'string')))) throw new Error(`${q.id}: invalid search options`);
  }
  const selected = dataset.questions.filter(q => split === 'all' || q.split === split);
  if (!selected.length) throw new Error(`No questions selected for split ${split}`);
  return selected;
}

function summarize(rows) {
  const result = Object.fromEntries(METRICS.map(key => [key, mean(rows.map(r => r.metrics?.[key]).filter(n => typeof n === 'number'))]));
  result.latencyMs = mean(rows.map(r => r.latencyMs));
  result.outputCharacters = rows.reduce((sum, r) => sum + r.outputCharacters, 0);
  result.estimatedTokens = rows.reduce((sum, r) => sum + r.estimatedTokens, 0);
  return result;
}

/**
 * Fixed gold questions; this runner does no tuning. Only expected/forbidden
 * evidence is judged: other evidence is unjudged, not automatically incorrect.
 * A provenance route establishes citation reachability, never claim entailment.
 */
export async function evaluateRetrieval(dataset, { split = 'all', vaultRoot, vaultPath = vaultRoot, searchFn } = {}) {
  const selected = validate(dataset, split);
  if (typeof searchFn !== 'function') throw new Error('searchFn is required');
  const graph = vaultPath ? buildGraph(vaultPath) : null;
  const pages = new Map(graph?.pages.map(p => [p.path, p]) ?? []);
  const names = graph ? buildNameIndex(graph.pages) : null;
  const resolveEvidence = target => {
    const text = normalize(typeof target === 'object' ? target.path ?? target.target ?? '' : target);
    if (!text) return [];
    const path = names ? resolveLinkTarget(names, text) : canonical(text);
    if (!path || !isEvidencePath(path)) return [];
    const page = pages.get(path);
    return [path, ...(page ? evidencePaths(page, names, pages).filter(isEvidencePath) : [])];
  };
  const rows = [];
  for (const q of selected) {
    const expectedPages = [...new Set(q.expectedPages)];
    const missingExpectedPages = vaultPath ? expectedPages.filter(p => !existsSync(join(vaultPath, p))) : [];
    const missingExpectedData = vaultPath ? [...new Set([...(q.expectedEvidence ?? []), ...(q.expectedPassages ?? []).map(p => p.path)])].filter(p => !existsSync(join(vaultPath, p))) : [];
    const row = { id: q.id, query: q.query, split: q.split, category: q.category ?? 'uncategorized', options: q.options ?? {}, expectedPages, missingExpectedPages, missingExpectedData, diagnostics: [], metrics: Object.fromEntries(METRICS.map(k => [k, null])), outputCharacters: 0, estimatedTokens: 0, latencyMs: 0 };
    if (missingExpectedPages.length || missingExpectedData.length) row.diagnostics.push('Expected files are missing; benchmark ground truth needs repair.');
    const started = performance.now();
    try {
      const output = await searchFn(q.query, { ...q.options, vaultPath, limit: 10 });
      row.latencyMs = performance.now() - started;
      const results = Array.isArray(output) ? output : output?.results;
      if (!Array.isArray(results) || results.some(r => !r || typeof r.path !== 'string')) throw new Error('Search output must have a results array with paths');
      row.outputCharacters = JSON.stringify(output).length;
      row.estimatedTokens = Math.ceil(row.outputCharacters / 4);
      row.searchDiagnostics = output.diagnostics ?? [];
      row.tier = output.tier ?? null;
      row.index = output.index ?? null;
      const seen = new Set();
      const unique = results.filter(r => { const path = canonical(r.path); if (seen.has(path)) return false; seen.add(path); return true; }).slice(0, 10);
      row.returnedPages = unique.map(r => canonical(r.path));
      const expected = new Set(expectedPages);
      row.metrics.pageRecallAt10 = row.returnedPages.filter(p => expected.has(p)).length / expected.size;
      row.metrics.precisionAt3 = row.returnedPages.slice(0, 3).filter(p => expected.has(p)).length / 3;
      const first = row.returnedPages.findIndex(p => expected.has(p));
      row.metrics.reciprocalRank = first === -1 ? 0 : 1 / (first + 1);
      const passages = q.expectedPassages ?? [];
      if (passages.length) {
        if (unique.length && !unique.every(r => typeof r.passage === 'string')) row.diagnostics.push('Expected passage metric unavailable: search output omits passages.');
        else row.metrics.passageHitRate = passages.filter(p => unique.some(r => canonical(r.path) === p.path && r.passage.toLowerCase().includes(p.text.toLowerCase()))).length / passages.length;
      }
      const positive = new Set(q.expectedEvidence ?? []), negative = new Set(q.forbiddenEvidence ?? []);
      row.forbiddenEvidenceHits = [];
      if (positive.size || negative.size) {
        if (unique.length && !unique.every(r => Array.isArray(r.provenance) || Array.isArray(r.evidence))) row.diagnostics.push('Expected evidence metrics unavailable: search output omits provenance.');
        else {
          const targets = unique.flatMap(r => [...(r.provenance ?? []), ...(r.evidence ?? [])]);
          const claimed = new Set(targets.map(target => normalize(typeof target === 'object' ? target.path ?? target.target ?? '' : target)).filter(isEvidencePath).map(canonical));
          const observed = new Set(targets.flatMap(resolveEvidence));
          row.unresolvedEvidence = names ? [...claimed].filter(path => !pages.has(path)).sort() : [];
          if (row.unresolvedEvidence.length) row.diagnostics.push('Returned citations include unresolved evidence paths; explicitly forbidden citations still count as errors.');
          row.returnedEvidence = [...observed].sort();
          const hits = [...positive].filter(p => observed.has(p));
          row.forbiddenEvidenceHits = [...negative].filter(p => observed.has(p) || claimed.has(p));
          row.unjudgedEvidence = [...observed].filter(p => !positive.has(p) && !negative.has(p)).sort();
          if (positive.size) row.metrics.evidenceRecall = hits.length / positive.size;
          const judged = hits.length + row.forbiddenEvidenceHits.length;
          row.metrics.evidenceCorrectness = judged ? hits.length / judged : positive.size ? 0 : 1;
        }
      }
      row.status = 'evaluated';
    } catch (error) {
      row.latencyMs = performance.now() - started;
      row.status = 'failed';
      row.diagnostics.push(`Search failed: ${error.message}`);
    }
    rows.push(row);
  }
  const coverage = { total: dataset.questions.length, selected: selected.length, evaluated: rows.filter(r => r.status === 'evaluated').length, failed: rows.filter(r => r.status === 'failed').length,
    expectedFilesChecked: Boolean(vaultPath), missingExpectedPages: rows.reduce((sum, r) => sum + r.missingExpectedPages.length, 0), missingExpectedData: rows.reduce((sum, r) => sum + r.missingExpectedData.length, 0),
    passageExpected: selected.filter(q => q.expectedPassages?.length).length, passageEvaluated: rows.filter(r => r.metrics.passageHitRate !== null).length,
    evidenceExpected: selected.filter(q => q.expectedEvidence?.length || q.forbiddenEvidence?.length).length, evidenceEvaluated: rows.filter(r => r.metrics.evidenceCorrectness !== null).length };
  const group = key => Object.fromEntries([...new Set(rows.map(r => r[key]))].sort().map(label => { const matching = rows.filter(r => r[key] === label); return [label, { selected: matching.length, evaluated: matching.filter(r => r.status === 'evaluated').length, ...summarize(matching) }]; }));
  return { version: 1, datasetHash: createHash('sha256').update(JSON.stringify(dataset)).digest('hex'), split,
    status: coverage.failed || coverage.missingExpectedPages || coverage.missingExpectedData || coverage.passageEvaluated < coverage.passageExpected || coverage.evidenceEvaluated < coverage.evidenceExpected ? 'incomplete' : 'complete',
    coverage, summary: summarize(rows), byCategory: group('category'), bySplit: group('split'),
    cost: { tokenEstimateMethod: 'ceil(outputCharacters / 4); estimate, not tokenizer usage', latencyScope: 'Search invocation only; reusable context construction and evaluation excluded.' },
    definitions: { precisionAt3: 'Expected relevant pages among first three unique results, divided by 3.', passageHitRate: 'Expected literal substrings found in returned passages for the expected page (case-insensitive).', evidenceCorrectness: 'Expected evidence hits / (expected + forbidden evidence hits); other paths are unjudged. No entailment judgment.', evidenceResolution: 'Returned provenance resolved through source/raw citation routes when a vault is supplied. Legacy outputs without provenance are unavailable.', aggregation: 'Macro means over evaluated non-null metrics; inspect coverage, missing ground truth and per-question failures.' }, questions: rows };
}

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, options: { questions: { type: 'string' }, vault: { type: 'string' }, split: { type: 'string' }, 'search-module': { type: 'string' }, output: { type: 'string' }, json: { type: 'boolean' } } });
  if (!values.questions) throw new Error('--questions FILE is required');
  const dataset = JSON.parse(readFileSync(values.questions, 'utf8'));
  const vaultPath = values.vault ?? resolveVault().path;
  validate(dataset, values.split ?? 'all');
  // Legacy main() reads its corpus from the environment instead of options.
  const priorVault = process.env.WIKI_MASTER_VAULT;
  let report;
  try {
    process.env.WIKI_MASTER_VAULT = vaultPath;
    const search = await import(values['search-module'] ? pathToFileURL(resolve(values['search-module'])).href : new URL('./search.mjs', import.meta.url));
    if (typeof search.main !== 'function') throw new Error('Search module must export main(query, options)');
    const context = search.createSearchContext ? await search.createSearchContext({ vaultPath, limit: 10 }) : undefined;
    report = await evaluateRetrieval(dataset, { split: values.split ?? 'all', vaultPath, searchFn: (query, options) => search.main(query, { ...options, context }) });
  } finally {
    if (priorVault === undefined) delete process.env.WIKI_MASTER_VAULT;
    else process.env.WIKI_MASTER_VAULT = priorVault;
  }
  const json = JSON.stringify(report, null, 2);
  if (values.output) writeFileSync(values.output, `${json}\n`, 'utf8');
  console.log(json);
  if (report.status === 'incomplete') process.exitCode = 2;
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
