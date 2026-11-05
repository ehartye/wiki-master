import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assessTiers, shouldAnnounceFull, statusLine, fullReport, setupPlan,
} from '../scripts/lib/search-health.mjs';
import { refreshIndex } from '../scripts/lib/embedding.mjs';

const SEARCH = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'search.mjs');

// The remaining channels post-qmd (design spec section 4/5.4): Obsidian
// keyword (always available) and Ollama-backed chunk-semantic. `tier` is
// `hybrid` or `lexical`, matching search()'s own ladder in scripts/search.mjs
// -- except for the one case (model not pulled) where naive reachability
// would misreport; see the dedicated test below for why.
const HEALTHY = {
  ollama: { reachable: true, modelPresent: true, model: 'nomic-embed-text' },
  index: { available: true, coverage: { chunks: 5515, embedded: 5515, missing: 0 }, filesChanged: 0 },
};

test('a damaged vector store is a gap with the rebuild as its fix, an honest tier, and shows even with Ollama down', () => {
  const damaged = { ...HEALTHY.index, damaged: 'vectors.bin has 3 unusable vector(s) of 3' };
  const up = assessTiers({ ollama: HEALTHY.ollama, index: damaged });
  assert.equal(up.tier, 'lexical');
  assert.equal(up.gaps.length, 1);
  assert.equal(up.gaps[0].channel, 'index');
  assert.match(up.gaps[0].state, /damaged.*3 unusable/);
  assert.equal(up.gaps[0].fix, 'node scripts/refresh-index.mjs --rebuild');
  assert.match(setupPlan(up), /refresh-index\.mjs --rebuild/);
  const down = assessTiers({ ollama: { reachable: false }, index: damaged });
  assert.deepEqual(down.gaps.map((g) => g.channel), ['ollama', 'index'], 'Ollama comes first, since the rebuild needs it');
});

// The real command against a stub Ollama and a real store, because "all channels healthy" needs Ollama to answer.
async function healthOf(t, harm) {
  const vault = mkdtempSync(join(tmpdir(), 'wm-health-'));
  t.after(() => rmSync(vault, { recursive: true, force: true }));
  mkdirSync(join(vault, 'wiki', 'concepts'), { recursive: true });
  for (const name of ['a', 'b', 'c']) writeFileSync(join(vault, 'wiki', 'concepts', `${name}.md`), `# ${name}\n\nAbout ${name}, at some length.\n`);
  const dir = join(vault, '.wiki-master');
  await refreshIndex({ vaultPath: vault, dir, embedFn: async (text) => [text.length, 1, 1, 1], checkAvailable: async () => true, checkModel: async () => true });
  harm?.(dir);
  const server = createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ models: [{ name: 'test-embedder:latest' }] })); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const child = spawn(process.execPath, [SEARCH, '--health'], { env: { ...process.env, WIKI_MASTER_VAULT: vault, OLLAMA_HOST: `http://127.0.0.1:${server.address().port}`, WIKI_MASTER_EMBED_MODEL: 'test-embedder' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  const code = await new Promise((resolve) => child.on('close', resolve));
  return { code, output };
}
const cut = (dir, size) => { const bin = join(dir, 'vectors.bin'); writeFileSync(bin, readFileSync(bin).subarray(0, size)); };
const fileWide = (dir) => { const bin = join(dir, 'vectors.bin'); writeFileSync(bin, Buffer.alloc(statSync(bin).size, 0xff)); };
const dimTwo = (dir) => { const file = join(dir, 'vectors.idx.json'); writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), dim: 2 })); };

test('search --health says all channels are healthy on a sound store', async (t) => {
  const { code, output } = await healthOf(t);
  assert.equal(code, 0, output);
  assert.match(output, /all channels healthy/);
  assert.match(output, /tier: hybrid/);
});

for (const [label, harm] of [
  ['all-0xFF', fileWide],
  ['empty', (dir) => cut(dir, 0)],
  ['truncated', (dir) => cut(dir, 16)],
  ['cut mid-number', (dir) => cut(dir, 18)],
  ['dim 2', dimTwo],
]) {
  test(`search --health on a ${label} store shows the damage and the rebuild`, async (t) => {
    const { code, output } = await healthOf(t, harm);
    assert.equal(code, 0, output);
    assert.doesNotMatch(output, /all channels healthy/);
    assert.match(output, /damaged/);
    assert.match(output, /refresh-index\.mjs --rebuild/);
  });
}

test('1. all channels healthy resolves to hybrid with no gaps', () => {
  const r = assessTiers(HEALTHY);
  assert.equal(r.tier, 'hybrid');
  assert.deepEqual(r.gaps, []);
});

test('2. Ollama not running resolves to lexical, and the gap names Ollama with an actionable fix', () => {
  const r = assessTiers({ ollama: { reachable: false, modelPresent: false, model: 'nomic-embed-text' }, index: HEALTHY.index });
  assert.equal(r.tier, 'lexical');
  assert.equal(r.gaps.length, 1);
  const g = r.gaps[0];
  assert.equal(g.channel, 'ollama');
  assert.match(g.state, /not running/);
  assert.equal(g.fix, 'ollama serve');
});

// The whole reason modelPresent() exists (embed.mjs): isAvailable() proves
// only that the server answers, not that the model was pulled. Without this
// check, every embed 404s and semantic contributes nothing while a naive
// check would still call it hybrid -- the one state where a tier label is
// actively false, not merely weak.
test('3. Ollama up but the model is not pulled is flagged with misreports: true', () => {
  const r = assessTiers({
    ollama: { reachable: true, modelPresent: false, model: 'nomic-embed-text' },
    index: HEALTHY.index,
  });
  assert.equal(r.tier, 'lexical', 'semantic cannot honestly contribute without the model');
  const g = r.gaps.find((x) => x.channel === 'ollama');
  assert.equal(g.misreports, true);
  assert.match(g.fix, /ollama pull nomic-embed-text/);
});

test('4. index missing resolves to lexical even with Ollama fully healthy, fix names index-embed', () => {
  const r = assessTiers({
    ollama: { reachable: true, modelPresent: true, model: 'nomic-embed-text' },
    index: { available: false, coverage: { chunks: 0, embedded: 0, missing: 0 }, filesChanged: 0 },
  });
  assert.equal(r.tier, 'lexical');
  const g = r.gaps.find((x) => x.channel === 'index');
  assert.ok(g, 'a gap must name the index');
  assert.match(g.fix, /index-embed\.mjs/);
  assert.notEqual(g.misreports, true, 'a missing index does not misreport -- search() itself already degrades correctly');
});

// The asymmetry that shapes the chunk-hash design (spec section 5.2): the
// index is content-hash keyed and can only ever be INCOMPLETE, never wrong.
// Staleness is therefore a coverage gap, not a misreport.
test('5. a stale index still answers hybrid, but a gap reports how many files changed', () => {
  const r = assessTiers({
    ollama: { reachable: true, modelPresent: true, model: 'nomic-embed-text' },
    index: { available: true, coverage: { chunks: 5515, embedded: 5515, missing: 0 }, filesChanged: 12 },
  });
  assert.equal(r.tier, 'hybrid', 'incomplete coverage is still usable, unlike a missing index');
  const g = r.gaps.find((x) => x.channel === 'index');
  assert.match(g.state, /12 file\(s\) changed/);
  assert.notEqual(g.misreports, true);
  assert.match(g.fix, /index-embed\.mjs/);
});

test('index partially embedded reports a gap naming the missing chunk count', () => {
  const r = assessTiers({
    ollama: { reachable: true, modelPresent: true, model: 'nomic-embed-text' },
    index: { available: true, coverage: { chunks: 5515, embedded: 5000, missing: 515 }, filesChanged: 0 },
  });
  assert.equal(r.tier, 'hybrid');
  const g = r.gaps.find((x) => x.channel === 'index');
  assert.match(g.state, /515 chunk\(s\) not yet embedded/);
});

test('index gaps are not evaluated while Ollama itself is down -- fixing Ollama comes first', () => {
  const r = assessTiers({
    ollama: { reachable: false, modelPresent: false, model: 'nomic-embed-text' },
    index: { available: false, coverage: { chunks: 0, embedded: 0, missing: 0 }, filesChanged: 99 },
  });
  assert.equal(r.gaps.length, 1, 'only the ollama gap should surface until ollama is healthy');
  assert.equal(r.gaps[0].channel, 'ollama');
});

// 6. Anti-nag: the full block is worth reading once, then becomes noise.
test('6. shouldAnnounceFull is true the first time, false inside the window, true again after it elapses', () => {
  assert.equal(shouldAnnounceFull(null, Date.now()), true, 'never announced before');
  const now = Date.parse('2026-08-09T12:00:00Z');
  assert.equal(shouldAnnounceFull('2026-08-09T11:00:00Z', now), false, 'one hour later: still quiet');
  assert.equal(shouldAnnounceFull('2026-08-09T07:00:00Z', now), true, 'five hours later: re-armed');
});

// 7. Never silent, even in the one-liner form.
test('7. statusLine always names the tier, and never omits an active gap', () => {
  assert.equal(statusLine(assessTiers(HEALTHY), { chunks: 5515 }), '(hybrid · 5515 chunks)');
  const degraded = assessTiers({ ollama: { reachable: false, modelPresent: false, model: 'nomic-embed-text' }, index: HEALTHY.index });
  const line = statusLine(degraded);
  assert.match(line, /^\(lexical — /);
  assert.match(line, /ollama not running/);
  assert.match(line, /--health/);
});

test('statusLine names every active gap, not just the first', () => {
  const assessed = {
    tier: 'hybrid',
    gaps: [
      { channel: 'index', state: '3 file(s) changed since last refresh', fix: 'x' },
      { channel: 'index', state: '10 chunk(s) not yet embedded', fix: 'x' },
    ],
  };
  const line = statusLine(assessed);
  assert.match(line, /3 file\(s\) changed/);
  assert.match(line, /10 chunk\(s\) not yet embedded/);
});

test('fullReport lists each gap with its cost and its exact fix command', () => {
  const assessed = assessTiers({
    ollama: { reachable: false, modelPresent: false, model: 'nomic-embed-text' },
    index: HEALTHY.index,
  });
  const report = fullReport(assessed, { chunks: 5515 });
  assert.match(report, /ollama serve/);
  assert.match(report, /not running/);
});

test('fullReport on a fully healthy assessment says so without any gap lines', () => {
  const report = fullReport(assessTiers(HEALTHY), { chunks: 5515 });
  assert.match(report, /hybrid/);
  assert.match(report, /5515/);
  assert.doesNotMatch(report, /fix:/);
});

test('setupPlan prints the exact fix commands in order and de-duplicates a repeated fix', () => {
  const assessed = {
    tier: 'hybrid',
    gaps: [
      { channel: 'index', state: 'a', fix: 'node scripts/index-embed.mjs' },
      { channel: 'index', state: 'b', fix: 'node scripts/index-embed.mjs' },
    ],
  };
  const plan = setupPlan(assessed);
  const occurrences = plan.split('node scripts/index-embed.mjs').length - 1;
  assert.equal(occurrences, 1, 'the same remediation command must not repeat');
});

test('setupPlan on a fully healthy assessment says there is nothing to do', () => {
  const plan = setupPlan(assessTiers(HEALTHY));
  assert.match(plan, /nothing to set up/i);
});
