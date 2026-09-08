import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import * as retrieval from '../scripts/search.mjs';
import { resolveLinkTarget } from '../scripts/lib/graph.mjs';
import { refreshIndex, walkVault, statusReport } from '../scripts/index-embed.mjs';

const embedFn = async () => [1, 0];
async function fixture(t, files) {
  const vaultPath = mkdtempSync(join(tmpdir(), 'wm-retrieval-'));
  t.after(() => rmSync(vaultPath, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(vaultPath, path)), { recursive: true });
    writeFileSync(join(vaultPath, path), text);
  }
  const dir = join(vaultPath, '.wiki-master');
  await refreshIndex({ vaultPath, dir, embedFn, checkAvailable: async () => true, checkModel: async () => true });
  return { vaultPath, dir };
}
async function context(vaultPath, hits = [], extra = {}) {
  assert.equal(typeof retrieval.createSearchContext, 'function', 'search exposes reusable context');
  return retrieval.createSearchContext({ vaultPath, embedFn, checkAvailable: async () => true,
    keywordSearchFn: async () => hits, ...extra });
}

test('index includes MOCs and shared metadata while excluding system zones', async (t) => {
  const { vaultPath, dir } = await fixture(t, {
    'wiki/concepts/memory.md': '---\ntitle: Agent Memory\naliases: ["Persistent memory", "Memory systems"]\ntype: concept\n---\n# Agent Memory\nRetaining knowledge.\n',
    'moc/agents.md': '# Agent task map\nUse memory first.\n',
    'raw/clippings/private.md': '# Excluded\n', 'log/event.md': '# Excluded\n',
    'wiki/.hidden/private.md': '# Excluded\n',
  });
  assert.deepEqual(walkVault(vaultPath).map(x => x.path).sort(), ['moc/agents.md', 'wiki/concepts/memory.md']);
  const m = JSON.parse(readFileSync(join(dir, 'chunks.json'), 'utf8'));
  assert.equal(m['wiki/concepts/memory.md'].title, 'Agent Memory');
  assert.deepEqual(m['wiki/concepts/memory.md'].aliases, ['Persistent memory', 'Memory systems']);
});

test('exact title, filename and alias outrank semantic neighbors outside keyword top ten', async (t) => {
  const canonical = 'wiki/concepts/agent-memory.md';
  const files = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`wiki/concepts/a${i}.md`, `# Neighbor ${i}\nMemory neighbors.\n`]));
  files[canonical] = '---\ntitle: Agent Memory\naliases:\n  - "Persistent memory"\n---\n# Agent Memory\nRetain experiences across sessions.\n';
  const { vaultPath } = await fixture(t, files);
  const ctx = await context(vaultPath, Object.keys(files).slice(0, 10));
  for (const q of ['Agent Memory', 'agent-memory', 'Persistent memory', canonical]) {
    const result = await retrieval.main(q, { context: ctx, limit: 3 });
    assert.equal(result.results[0].path, canonical, q);
    assert.equal(result.results[0].match, 'exact');
    assert.equal(result.results.length, 3);
  }
});

test('ambiguous aliases remain separate and report all exact candidates', async (t) => {
  const { vaultPath } = await fixture(t, {
    'wiki/concepts/a.md': '---\naliases: [Shared identity]\n---\n# A\nAlpha.\n',
    'wiki/concepts/b.md': '---\naliases: [Shared identity]\n---\n# B\nBeta.\n',
  });
  const result = await retrieval.main('Shared identity', { context: await context(vaultPath) });
  assert.equal(result.results.length, 2);
  assert.ok(result.diagnostics.some(x => x.code === 'ambiguous-identity' && x.paths.length === 2));
});

test('scope filters use current metadata and return bounded metadata and provenance', async (t) => {
  const { vaultPath } = await fixture(t, {
    'wiki/authored/p/decision.md': '---\ntitle: Retrieval decision\ntype: authored\nkind: decision\nproject: wiki-master\nstatus: accepted\nreviewed: 2026-09-01\nupdated: 2026-09-02\nsources: ["[[wiki/sources/research]]"]\n---\n# Retrieval decision\nUse exact identities.\n',
    'wiki/concepts/other.md': '---\nproject: other\nstatus: draft\n---\n# Other\nUse exact identities.\n',
  });
  const result = await retrieval.main('identities', { context: await context(vaultPath), project: 'wiki-master', type: 'authored', status: 'accepted', limit: 1 });
  assert.equal(result.results.length, 1);
  const hit = result.results[0];
  assert.equal(hit.metadata.kind, 'decision');
  assert.equal(hit.metadata.reviewed, '2026-09-01');
  assert.ok(hit.provenance.length === 1);
  assert.ok(hit.passage.length <= 1200);
  assert.ok(hit.startLine > 0 && hit.endLine >= hit.startLine);
});

test('edited and deleted indexed candidates never expose stale passages or identity', async (t) => {
  const path = 'wiki/concepts/a.md';
  const { vaultPath } = await fixture(t, { [path]: '---\naliases: [Old identity]\n---\n# Previous heading\nOld passage.\n',
    'wiki/concepts/b.md': '# Deleted\nOld deleted passage.\n' });
  const ctx = await context(vaultPath, [path]);
  writeFileSync(join(vaultPath, path), '# Current heading\nCurrent replacement passage is longer.\n');
  unlinkSync(join(vaultPath, 'wiki/concepts/b.md'));
  const result = await retrieval.main('replacement', { context: ctx });
  assert.equal(result.results.length, 1);
  assert.match(result.results[0].passage, /Current replacement/);
  assert.equal(result.results[0].indexFreshness, 'modified');
  assert.equal(result.results[0].startLine, 2);
  assert.equal(result.index.removed, 1);
  const identity = await retrieval.main('Old identity', { context: ctx });
  assert.notEqual(identity.results[0]?.match, 'exact');
});

test('old manifest metadata upgrades without re-embedding unchanged content', async (t) => {
  const { vaultPath, dir } = await fixture(t, { 'wiki/concepts/a.md': '# Agent Memory\nRemember things.\n' });
  const file = join(dir, 'chunks.json');
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  for (const e of Object.values(manifest)) for (const key of ['metadataVersion', 'metadata', 'title', 'aliases', 'sources']) delete e[key];
  writeFileSync(file, JSON.stringify(manifest));
  const result = await refreshIndex({ vaultPath, dir, embedFn: async () => { throw new Error('should reuse vectors'); }, checkAvailable: async () => true, checkModel: async () => true });
  assert.equal(result.chunksEmbedded, 0);
  assert.equal(JSON.parse(readFileSync(file, 'utf8'))['wiki/concepts/a.md'].title, 'Agent Memory');
});

test('CLI flags reject invalid limits, missing filter values and unknown options', () => {
  assert.equal(typeof retrieval.parseArgs, 'function');
  for (const argv of [['q','--limit','0'], ['q','--limit=3x'], ['q','--project'], ['q','--wat']]) assert.throws(() => retrieval.parseArgs(argv));
  assert.deepEqual(retrieval.parseArgs(['Agent Memory','--json','--limit=3','--project','wiki-master','--type','concept','--status','active']),
    { query: 'Agent Memory', json: true, limit: 3, project: 'wiki-master', type: 'concept', status: 'active', includeRaw: false });
});

test('keyword backend failure reports degraded coverage while exact lookup still works', async (t) => {
  const { vaultPath } = await fixture(t, { 'wiki/concepts/agent-memory.md': '---\ntitle: Agent Memory\n---\n# Agent Memory\nRemember things.\n' });
  const ctx = await context(vaultPath, [], { keywordSearchFn: async () => { throw new Error('CLI timed out'); }, checkAvailable: async () => false });
  const result = await retrieval.main('Agent Memory', { context: ctx });
  assert.equal(result.results[0].match, 'exact');
  assert.ok(result.diagnostics.some(d => d.code === 'keyword-failed' && d.message.includes('timed out')));
  assert.equal(result.tier, 'identity-only');
});

test('bounded keyword adapter passes timeout and distinguishes zero hits from failures', async () => {
  assert.equal(typeof retrieval.boundedKeywordSearch, 'function');
  let opts;
  const execFileImpl = (cmd, args, options, callback) => { opts = options; callback(null, 'No matches found.'); };
  assert.deepEqual(await retrieval.boundedKeywordSearch('q', { execFileImpl }), []);
  assert.equal(opts.timeout, 10000);
  await assert.rejects(() => retrieval.boundedKeywordSearch('q', { execFileImpl: (cmd,args,opts,cb) => cb(new Error('timeout')) }), /timeout/);
});

test('MOC exact lookup works without semantic service', async (t) => {
  const { vaultPath } = await fixture(t, { 'moc/task-map.md': '# Agent task map\nPrerequisites and alternatives.\n' });
  const result = await retrieval.main('Agent task map', { context: await context(vaultPath, [], { checkAvailable: async () => false }) });
  assert.equal(result.results[0]?.path, 'moc/task-map.md');
});

test('unchanged-size restored-mtime edit is disclosed by candidate content validation', async (t) => {
  const { vaultPath } = await fixture(t, { 'wiki/concepts/a.md': '# Alpha\nOld text.\n' });
  const ctx = await context(vaultPath, ['wiki/concepts/a.md']);
  const stat = statSync(join(vaultPath, 'wiki/concepts/a.md'));
  writeFileSync(join(vaultPath, 'wiki/concepts/a.md'), '# Alpha\nNew text.\n');
  utimesSync(join(vaultPath, 'wiki/concepts/a.md'), stat.atime, stat.mtime);
  const result = await retrieval.main('Alpha', { context: ctx });
  assert.equal(result.results[0].indexFreshness, 'modified');
  assert.match(result.results[0].passage, /New text/);
});

test('filters apply before semantic candidate truncation', async (t) => {
  const files = Object.fromEntries(Array.from({ length: 110 }, (_, i) => [`wiki/concepts/a${i}.md`, '---\nproject: other\n---\n# Unrelated\nOther content.\n']));
  files['wiki/concepts/z.md'] = '---\nproject: wanted\n---\n# Target\nDesired content.\n';
  const { vaultPath } = await fixture(t, files);
  const result = await retrieval.main('unmentioned semantic question', { context: await context(vaultPath), project: 'wanted', limit: 1 });
  assert.equal(result.results[0]?.path, 'wiki/concepts/z.md');
});

test('identity manifest remains usable when vector artifacts are absent', async (t) => {
  const { vaultPath, dir } = await fixture(t, { 'wiki/concepts/a.md': '---\naliases: [Persistent memory]\n---\n# Agent Memory\nRemember.\n' });
  unlinkSync(join(dir, 'vectors.bin'));
  const result = await retrieval.main('Persistent memory', { context: await context(vaultPath) });
  assert.equal(result.results[0]?.path, 'wiki/concepts/a.md');
  assert.equal(result.index.available, false);
});

test('legacy metadata refresh reports pending upgrade and deleted paths accurately', async (t) => {
  const { vaultPath, dir } = await fixture(t, { 'wiki/a.md': '# A\nAlpha.\n', 'wiki/b.md': '# B\nBeta.\n' });
  const path = join(dir, 'chunks.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  for (const entry of Object.values(manifest)) delete entry.metadataVersion;
  writeFileSync(path, JSON.stringify(manifest));
  unlinkSync(join(vaultPath, 'wiki/b.md'));
  assert.equal(statusReport({ vaultPath, dir }).filesChanged, 1);
  const result = await refreshIndex({ vaultPath, dir, embedFn, checkAvailable: async () => true, checkModel: async () => true });
  assert.equal(result.filesRemoved, 1);
});

test('lexical filters prioritize in-scope exact identities before candidate bound', async (t) => {
  const files = Object.fromEntries(Array.from({ length: 110 }, (_, i) => [`wiki/concepts/a${i}.md`, '---\nproject: other\naliases: [Shared term]\n---\n# Other\nOther.\n']));
  files['wiki/concepts/z.md'] = '---\nproject: wanted\naliases: [Shared term]\n---\n# Target\nDesired.\n';
  const { vaultPath } = await fixture(t, files);
  const result = await retrieval.main('Shared term', { context: await context(vaultPath, [], { checkAvailable: async () => false }), project: 'wanted', limit: 1 });
  assert.equal(result.results[0]?.path, 'wiki/concepts/z.md');
  assert.ok(result.index.checked <= 100);
});

test('keyword-only hits are labelled lexical even when query has only stop words', async (t) => {
  const { vaultPath } = await fixture(t, { 'wiki/a.md': '# A\nThe first result.\n' });
  const result = await retrieval.main('the', { context: await context(vaultPath, ['wiki/a.md'], { checkAvailable: async () => false }) });
  assert.equal(result.results[0]?.match, 'lexical');
});

test('inline citation provenance includes sources and excludes concepts and Related links', async (t) => {
  const { vaultPath } = await fixture(t, {
    'wiki/concepts/a.md': '---\nsources: []\n---\n# A\nResearch: [[Paper]]. Context: [[Concept]].\n## Related\n[[wiki/sources/unrelated]]\n## Evidence\n[[wiki/sources/final]]\n',
    'wiki/sources/paper.md': '---\naliases: [Paper]\n---\n# Paper\nResearch.\n',
    'wiki/sources/unrelated.md': '# Unrelated\nLateral.\n',
    'wiki/sources/final.md': '# Final\nFinal evidence.\n',
    'wiki/concepts/Concept.md': '# Concept\nContext.\n',
  });
  const result = await retrieval.main('wiki/concepts/a.md', { context: await context(vaultPath), limit: 1 });
  assert.deepEqual(result.results[0].provenance.sort(), ['wiki/sources/final.md', 'wiki/sources/paper.md']);
  assert.equal(typeof result.results[0].provenanceStatus, 'string');
});

test('include-raw appends bounded raw results even when wiki fills the limit', async (t) => {
  const { vaultPath } = await fixture(t, { 'wiki/a.md': '# A\nQuery.\n', 'wiki/b.md': '# B\nQuery.\n',
    'raw/clippings/source.md': '# Source\nQuery raw evidence.\n' });
  const ctx = await context(vaultPath, [], { keywordSearchFn: async (q, options) => options.path === 'raw' ? ['raw/clippings/source.md'] : ['wiki/a.md', 'wiki/b.md'] });
  const result = await retrieval.main('Query', { context: ctx, limit: 1, includeRaw: true });
  assert.equal(result.results.length, 2);
  assert.equal(result.results[1].path, 'raw/clippings/source.md');
  assert.equal(result.results[1].zone, 'raw');
  assert.equal(result.rawCount, 1);
});

test('qualified paths preserve punctuation and cannot be claimed by aliases', async (t) => {
  const canonical = 'wiki/concepts/a-b.md';
  const { vaultPath } = await fixture(t, {
    [canonical]: '# A-B\nCanonical.\n',
    'wiki/concepts/a b.md': '# A B\nDifferent concept.\n',
    'wiki/concepts/alias.md': '---\naliases: ["wiki/concepts/a-b.md"]\n---\n# Alias claimant\nDifferent.\n',
  });
  const ctx = await context(vaultPath);
  for (const query of [canonical, 'WIKI/CONCEPTS/A-B', 'wiki\\concepts\\a-b.md']) {
    const result = await retrieval.main(query, { context: ctx });
    assert.equal(result.results[0].path, canonical);
    assert.deepEqual(result.results.filter(h => h.match === 'exact').map(h => h.path), [canonical]);
    assert.ok(!result.diagnostics.some(d => d.code === 'ambiguous-identity'));
  }
});

test('exact titles and aliases share graph punctuation and collision rules; H1 is display only', async (t) => {
  const { vaultPath } = await fixture(t, {
    'wiki/concepts/a.md': '---\naliases: [Agent Memory]\n---\n# Overview\nMemory.\n',
    'wiki/concepts/b.md': '---\ntitle: Agent Memory\n---\n# Overview\nMemory.\n',
    'wiki/concepts/c.md': '---\naliases: [Agent-Memory]\n---\n# Overview\nMemory.\n',
  });
  const ctx = await context(vaultPath);
  assert.equal(resolveLinkTarget(ctx.names, 'Agent Memory'), undefined);
  assert.equal(resolveLinkTarget(ctx.names, 'Agent-Memory'), 'wiki/concepts/c.md');
  const spaced = await retrieval.main(' Agent Memory ', { context: ctx });
  assert.deepEqual(spaced.results.filter(h => h.match === 'exact').map(h => h.path).sort(), ['wiki/concepts/a.md', 'wiki/concepts/b.md']);
  assert.ok(spaced.diagnostics.some(d => d.code === 'ambiguous-identity'));
  const hyphenated = await retrieval.main('Agent-Memory', { context: ctx });
  assert.deepEqual(hyphenated.results.filter(h => h.match === 'exact').map(h => h.path), ['wiki/concepts/c.md']);
  const heading = await retrieval.main('Overview', { context: ctx });
  assert.equal(heading.results.filter(h => h.match === 'exact').length, 0);
});

test('all keyword failures report semantic plus identity rather than hybrid', async (t) => {
  const { vaultPath } = await fixture(t, { 'wiki/a.md': '# A\nContent.\n' });
  const ctx = await context(vaultPath, [], { keywordSearchFn: async () => { throw new Error('unavailable'); } });
  const result = await retrieval.main('A', { context: ctx });
  assert.equal(result.tier, 'semantic+identity');
  const rendered = retrieval.renderResult(result, { tier: 'hybrid', gaps: [] });
  assert.ok(rendered.stderr[0].includes('semantic+identity'));
  assert.ok(rendered.stderr[0].includes('keyword'));
});
