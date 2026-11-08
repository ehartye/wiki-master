import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, unlinkSync, utimesSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGraph, markdownPage, GRAPH_CACHE_FORMAT, GRAPH_CACHE_FILE } from '../scripts/lib/graph.mjs';
import { scanIntegrity, deriveIntegrity, INTEGRITY_DERIVE_ID } from '../scripts/lib/integrity.mjs';
import { readGraphCache } from '../scripts/lib/graph-cache-read.mjs';
import { writeGraphCache } from '../scripts/lib/graph-cache-write.mjs';
import { refreshCatalogs } from '../scripts/lib/catalogs.mjs';
import { validateAuthored } from '../scripts/validate-authored.mjs';
import { main as healthMain } from '../scripts/health.mjs';

// The graph record cache: refresh-index.mjs builds its graph cold and writes, for every Markdown file, the stat it
// read the file under and what markdownPage and the integrity derive made of the text. validate-authored.mjs and
// health.mjs read it and re-read only the files whose size or modification time changed. Read counts and
// equality only: a file open costs very different amounts on different machines, so no test here measures time.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fm = (fields) => `---\n${fields}\n---\n`;
const authored = (kind, extra = '') => fm(`type: authored\ncreated: 2026-01-01\nupdated: 2026-01-01\nstatus: draft\nsources: []\nai-generated: true\nproject: demo\nkind: ${kind}${extra}`);
const FILES = {
  'wiki/concepts/alpha.md': `${fm('type: concept\nstatus: maintained\nsources: ["[[raw/clippings/clip.md]]"]')}# Alpha\n\nAlpha cites [[raw/clippings/clip.md]] and links [[beta]] and [[topic]].\n`,
  'wiki/concepts/beta.md': `${fm('type: concept\nstatus: maintained\nsources: []')}# Beta\n\nBeta links [[alpha]].\n`,
  'wiki/concepts/gamma.md': `${fm('type: concept\nstatus: maintained\nsources: []\naliases: [other]')}# Gamma\n\nGamma has an alias nobody links.\n`,
  'wiki/sources/topic.md': `${fm('type: source\nstatus: maintained\nsources: ["[[raw/clippings/clip.md]]"]')}# Topic\n\nA source page about the topic, citing the clip.\n`,
  'wiki/authored/demo/overview.md': `${authored('overview')}# Demo\n\nSee [[wiki/authored/demo/guide.md|the guide]].\n`,
  'wiki/authored/demo/guide.md': `${authored('guide')}# Guide\n\nRead [[alpha]].\n`,
  'wiki/authored/demo/backlog/task.md': `${authored('backlog-item', '\nbacklog-status: planned')}# Task\n\nWork.\n`,
  'raw/clippings/clip.md': `${fm('source: "https://example.test/clip"\ntags: [clippings]')}Captured words.\n`,
  'raw/clippings/paper.pdf': 'not markdown',
  'log/2026-01-01-op.md': '# Log\n\nAn operation.\n',
};
const OLD = Date.now() / 1000 - 3600;

function fixture(t, files = FILES, { fresh = [] } = {}) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'wm-graph-cache-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, text, { old = true } = {}) => {
    const abs = join(root, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
    // Outside the writer's racy window, so an entry for it is stored.
    if (old) utimesSync(abs, OLD, OLD);
  };
  for (const [path, text] of Object.entries(files)) put(path, text, { old: !fresh.includes(path) });
  return { root, put };
}

const rel = (root, abs) => relative(root, abs).replaceAll('\\', '/');
function counter(root) {
  const reads = [];
  return { reads, readFile: (abs, encoding) => { reads.push(rel(root, abs)); return readFileSync(abs, encoding); } };
}
const markdownFiles = (root) => {
  const out = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.')) continue;
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (name.endsWith('.md')) out.push(rel(root, abs));
    }
  })(root);
  return out.sort();
};

// What a refresh does, without its prerequisites: a cold build with the integrity derive, then the writer.
function writeCache(root, options = {}) {
  const builtAtMs = Date.now();
  const graph = buildGraph(root, { derive: deriveIntegrity });
  return writeGraphCache(root, graph.records, { builtAtMs, ...options });
}
const cacheFile = (root) => join(root, GRAPH_CACHE_FILE);
const readCacheJson = (root) => JSON.parse(readFileSync(cacheFile(root), 'utf8'));
const warm = (root, extra = {}) => {
  const c = counter(root);
  const cache = readGraphCache(root);
  return { ...c, cache, scan: scanIntegrity(root, { cache, readFile: c.readFile, ...extra }) };
};
const cold = (root, extra = {}) => scanIntegrity(root, extra);
const json = (value) => JSON.parse(JSON.stringify(value));

// ------------------------------------------------------------------ reads --

test('a cold scan reads each Markdown file exactly once, content pages included, and no attachment', t => {
  const { root } = fixture(t);
  const c = counter(root);
  scanIntegrity(root, { readFile: c.readFile });
  assert.deepEqual([...c.reads].sort(), markdownFiles(root));
});

test('buildGraph records each Markdown file with the stat it was read under; the integrity derive only for content', t => {
  const { root } = fixture(t);
  const graph = buildGraph(root, { derive: deriveIntegrity });
  assert.deepEqual([...graph.records.keys()].sort(), markdownFiles(root));
  for (const [path, record] of graph.records) {
    const st = statSync(join(root, path));
    assert.deepEqual([record.size, record.mtimeMs], [st.size, st.mtimeMs], path);
    assert.deepEqual(record.page, markdownPage(path, readFileSync(join(root, path), 'utf8')), path);
    assert.equal('extra' in record, path.startsWith('wiki/'), path);
  }
  assert.equal(buildGraph(root).records.get('wiki/concepts/beta.md').extra, undefined, 'no derive, no extra');
  assert.deepEqual(graph.pages.map(p => p.path), buildGraph(root).pages.map(p => p.path), 'derive changes no page');
  assert.deepEqual(graph.pages.find(p => p.path === 'wiki/concepts/alpha.md'), buildGraph(root).pages.find(p => p.path === 'wiki/concepts/alpha.md'));
});

test('a warm scan reads no file and equals a cold one', t => {
  const { root } = fixture(t);
  assert.equal(writeCache(root).written, true);
  const w = warm(root);
  assert.ok(w.cache, 'the cache is valid');
  assert.deepEqual(w.reads, []);
  assert.deepEqual(w.scan, cold(root));
});

test('a changed size re-reads exactly that page, a new page is read, and a deleted page leaves no record', t => {
  const { root, put } = fixture(t);
  writeCache(root);
  put('wiki/concepts/beta.md', `${FILES['wiki/concepts/beta.md']}One more line, so the size changes.\n`);
  let w = warm(root);
  assert.deepEqual(w.reads, ['wiki/concepts/beta.md']);
  assert.deepEqual(w.scan, cold(root));
  put('wiki/concepts/delta.md', `${fm('type: concept\nstatus: maintained\nsources: []')}# Delta\n\nNew, and links [[Nowhere]].\n`);
  w = warm(root);
  assert.deepEqual([...w.reads].sort(), ['wiki/concepts/beta.md', 'wiki/concepts/delta.md']);
  assert.deepEqual(w.scan, cold(root));
  assert.ok(w.scan.forwardLinks.some(x => x.target === 'Nowhere'));
  unlinkSync(join(root, 'wiki/concepts/gamma.md'));
  const c = counter(root);
  const graph = buildGraph(root, { cache: readGraphCache(root), readFile: c.readFile, derive: deriveIntegrity });
  assert.equal(graph.records.has('wiki/concepts/gamma.md'), false);
  assert.equal(graph.pages.some(p => p.path === 'wiki/concepts/gamma.md'), false);
  assert.deepEqual(warm(root).scan, cold(root));
});

test('a page edited to the same size and time inside the racy window is re-read, because it was never stored', t => {
  const { root } = fixture(t, FILES, { fresh: ['wiki/concepts/beta.md'] });
  const abs = join(root, 'wiki/concepts/beta.md');
  writeCache(root);
  assert.equal('wiki/concepts/beta.md' in readCacheJson(root).entries, false, 'modified within 2,000 ms of the build');
  assert.ok('wiki/concepts/alpha.md' in readCacheJson(root).entries);
  const before = statSync(abs);
  const edited = FILES['wiki/concepts/beta.md'].replace('[[alpha]]', '[[gamma]]');
  assert.equal(edited.length, FILES['wiki/concepts/beta.md'].length);
  writeFileSync(abs, edited);
  utimesSync(abs, before.atime, before.mtime); // a clock too coarse to see the edit
  const w = warm(root);
  assert.deepEqual(w.reads, ['wiki/concepts/beta.md']);
  assert.deepEqual(w.scan, cold(root));
});

test('a title or alias edit on one page flips an ambiguous-link result in the same warm run', t => {
  const { root, put } = fixture(t);
  writeCache(root);
  const ambiguous = (scan) => scan.issues.filter(i => i.rule === 'ambiguous-link').map(i => i.target);
  assert.deepEqual(ambiguous(warm(root).scan), []);
  put('wiki/concepts/gamma.md', FILES['wiki/concepts/gamma.md'].replace('aliases: [other]', 'aliases: [beta]'));
  let w = warm(root);
  assert.deepEqual(w.reads, ['wiki/concepts/gamma.md']);
  assert.deepEqual(ambiguous(w.scan), ['beta']);
  assert.deepEqual(w.scan, cold(root));
  writeCache(root);
  put('wiki/concepts/gamma.md', FILES['wiki/concepts/gamma.md'].replace('aliases: [other]', 'title: Gamma page'));
  w = warm(root);
  assert.deepEqual(ambiguous(w.scan), []);
  assert.deepEqual(w.scan, cold(root));
});

// ----------------------------------------------------------------- guards --

test('another format, plugin version, derive id or vault root, an unreadable file and invalid JSON each mean no cache', t => {
  const { root } = fixture(t);
  writeCache(root);
  const good = readFileSync(cacheFile(root), 'utf8');
  const variants = {
    format: { ...JSON.parse(good), format: GRAPH_CACHE_FORMAT + 1 },
    plugin: { ...JSON.parse(good), plugin: '0.0.0-other' },
    derive: { ...JSON.parse(good), derive: `${INTEGRITY_DERIVE_ID}-other` },
    root: { ...JSON.parse(good), root: join(root, 'elsewhere') },
    entries: { ...JSON.parse(good), entries: [] },
  };
  const expected = cold(root);
  const fullBuild = (label) => {
    const c = counter(root);
    let cache, scan;
    assert.doesNotThrow(() => { cache = readGraphCache(root); scan = scanIntegrity(root, { cache, readFile: c.readFile }); }, label);
    assert.equal(cache, null, label);
    assert.deepEqual([...c.reads].sort(), markdownFiles(root), label);
    assert.deepEqual(scan, expected, label);
  };
  for (const [label, data] of Object.entries(variants)) { writeFileSync(cacheFile(root), JSON.stringify(data)); fullBuild(label); }
  writeFileSync(cacheFile(root), good.slice(0, good.length >> 1));
  fullBuild('invalid JSON');
  rmSync(cacheFile(root));
  fullBuild('missing');
  mkdirSync(cacheFile(root));
  fullBuild('unreadable (a directory)');
});

test('a cache copied from another vault is not used there', t => {
  const a = fixture(t), b = fixture(t);
  writeCache(a.root);
  mkdirSync(dirname(cacheFile(b.root)), { recursive: true });
  writeFileSync(cacheFile(b.root), readFileSync(cacheFile(a.root)));
  assert.equal(readGraphCache(b.root), null);
});

test('an entry of the wrong shape is a miss, read from disk, never an exception', t => {
  const { root } = fixture(t);
  writeCache(root);
  const data = readCacheJson(root);
  data.entries['wiki/concepts/alpha.md'].page = null;
  data.entries['wiki/concepts/beta.md'].extra = 'not an object';
  delete data.entries['wiki/concepts/gamma.md'].extra;
  data.entries['log/2026-01-01-op.md'] = 7;
  writeFileSync(cacheFile(root), JSON.stringify(data));
  const w = warm(root);
  assert.deepEqual([...w.reads].sort(), ['log/2026-01-01-op.md', 'wiki/concepts/alpha.md', 'wiki/concepts/beta.md', 'wiki/concepts/gamma.md']);
  assert.deepEqual(w.scan, cold(root));
});

// ----------------------------------------------------------------- writer --

test('the writer stores entries as a cold read gives them, and drops the paths it is told were written', t => {
  const { root } = fixture(t);
  writeCache(root, { exclude: ['wiki/concepts/beta.md'] });
  const data = readCacheJson(root);
  assert.deepEqual(Object.keys(data).sort(), ['builtAtMs', 'derive', 'entries', 'format', 'plugin', 'root']);
  assert.deepEqual([data.format, data.derive, data.root], [GRAPH_CACHE_FORMAT, INTEGRITY_DERIVE_ID, realpathSync.native(root)]);
  assert.equal(data.plugin, JSON.parse(readFileSync(join(ROOT, 'plugin.json'), 'utf8')).version);
  assert.deepEqual(Object.keys(data.entries).sort(), markdownFiles(root).filter(p => p !== 'wiki/concepts/beta.md'));
  for (const [path, entry] of Object.entries(data.entries)) {
    const text = readFileSync(join(root, path), 'utf8'), st = statSync(join(root, path));
    const page = markdownPage(path, text);
    assert.deepEqual(entry, json({ size: st.size, mtimeMs: st.mtimeMs, page, ...(path.startsWith('wiki/') ? { extra: deriveIntegrity(path, text, page) } : {}) }), path);
  }
});

test('the writer replaces the file through a rename: a failed rename leaves the old file, and an unchanged cache is not rewritten', t => {
  const { root, put } = fixture(t);
  writeCache(root);
  const before = readFileSync(cacheFile(root));
  const mtime = statSync(cacheFile(root)).mtimeMs;
  assert.equal(writeCache(root).written, false, 'nothing changed');
  assert.equal(statSync(cacheFile(root)).mtimeMs, mtime);
  put('wiki/concepts/beta.md', `${FILES['wiki/concepts/beta.md']}Changed.\n`);
  const failure = Object.assign(new Error('rename refused'), { code: 'EBUSY' });
  assert.throws(() => writeCache(root, { renameImpl: () => { throw failure; } }), failure);
  assert.deepEqual(readFileSync(cacheFile(root)), before);
  assert.deepEqual(readdirSync(dirname(cacheFile(root))).filter(n => n !== 'graph-cache.json'), [], 'no temp file is left');
});

// -------------------------------------------------- refresh never trusts it --

// validate-authored.test.mjs owns the other half: validate-authored and health import no writer.
test('refresh-index, the catalogs and the writer do not import the reader, and nothing the readers load imports the writer', () => {
  const imports = (file) => readFileSync(join(ROOT, file), 'utf8');
  for (const file of ['scripts/refresh-index.mjs', 'scripts/lib/catalogs.mjs', 'scripts/lib/graph-cache-write.mjs']) {
    assert.doesNotMatch(imports(file), /graph-cache-read/, file);
  }
  for (const file of ['scripts/lib/graph-cache-read.mjs', 'scripts/lib/integrity.mjs', 'scripts/lib/graph.mjs']) {
    assert.doesNotMatch(imports(file), /graph-cache-write/, file);
  }
  assert.match(imports('scripts/refresh-index.mjs'), /from '\.\/lib\/graph-cache-write\.mjs'/);
});

test('records captured before the catalog phases are unchanged after them, though the phases replace pages', t => {
  const { root } = fixture(t, { ...FILES, 'wiki/authored/demo/notes/n.md': `${authored('note')}# Note\n\nA note.\n` });
  let snapshot = null, graph = null;
  const result = refreshCatalogs(root, { derive: deriveIntegrity, buildGraphImpl: (path, options) => {
    graph = buildGraph(path, options);
    snapshot = structuredClone(graph.records);
    return graph;
  } });
  assert.ok(result.changed.length > 0, 'the phases wrote catalogs');
  assert.ok(result.changed.some(p => graph.pages.some(x => x.path === p)), 'and put them in the graph');
  assert.equal(result.records, graph.records);
  assert.deepEqual(result.records, snapshot);
  assert.equal(typeof result.builtAtMs, 'number');
});

// ---------------------------------------------------------- the readers --

function cli(root, script, args) {
  return spawnSync(process.execPath, [join(ROOT, 'scripts', script), ...args], { cwd: tmpdir(), encoding: 'utf8', env: { ...process.env, WIKI_MASTER_VAULT: root } });
}

// A poisoned entry: the right size and time, the wrong content. Only a reader that trusts the cache sees it.
function poison(root) {
  const data = readCacheJson(root);
  const entry = data.entries['wiki/authored/demo/guide.md'];
  entry.extra.bodyLinks.push({ target: 'Poison', malformed: true, line: 12, text: '[[Poison', factual: false });
  writeFileSync(cacheFile(root), JSON.stringify(data));
}

test('validate-authored and health read the cache; with --no-cache they read none of it and print what a cold run prints', t => {
  const { root } = fixture(t);
  const ledgerDir = mkdtempSync(join(realpathSync(tmpdir()), 'wm-graph-cache-ledger-'));
  t.after(() => rmSync(ledgerDir, { recursive: true, force: true }));
  const ledger = join(ledgerDir, 'ledger.json');
  writeFileSync(ledger, JSON.stringify(['wiki/authored/demo/guide.md', 'wiki/authored/demo/overview.md']));
  const runs = () => ({
    validate: cli(root, 'validate-authored.mjs', ['--paths-file', ledger, '--json']),
    validateNoCache: cli(root, 'validate-authored.mjs', ['--paths-file', ledger, '--json', '--no-cache']),
    health: cli(root, 'health.mjs', ['--json']),
    healthNoCache: cli(root, 'health.mjs', ['--json', '--no-cache']),
  });
  const coldRuns = runs();
  assert.equal(coldRuns.validate.status, 0, coldRuns.validate.stderr);
  assert.equal(coldRuns.health.status, 0, coldRuns.health.stderr);
  writeCache(root);
  const warmRuns = runs();
  for (const key of Object.keys(coldRuns)) assert.equal(warmRuns[key].stdout, coldRuns[key].stdout, `${key}: warm output is byte-identical to cold`);
  poison(root);
  const poisoned = runs();
  assert.notEqual(poisoned.validate.stdout, coldRuns.validate.stdout, 'validate-authored reads the cache');
  assert.notEqual(poisoned.health.stdout, coldRuns.health.stdout, 'health reads the cache');
  assert.equal(poisoned.validateNoCache.stdout, coldRuns.validate.stdout);
  assert.equal(poisoned.healthNoCache.stdout, coldRuns.health.stdout);
  for (const args of [['--legacy', '--no-cache'], ['--backlog', '--no-cache']]) {
    const r = cli(root, 'health.mjs', args);
    assert.equal(r.status, 0, `${args}: ${r.stderr}`);
    assert.equal(r.stdout, cli(root, 'health.mjs', [args[0]]).stdout, `${args}: --no-cache has no effect`);
  }

  // In process, with a read counter: --no-cache never opens the cache file.
  const opened = (c) => c.reads.filter(p => p === GRAPH_CACHE_FILE);
  const paths = ['wiki/authored/demo/guide.md'];
  let c = counter(root);
  const plain = validateAuthored(root, paths, { readFile: c.readFile });
  assert.deepEqual(opened(c), [GRAPH_CACHE_FILE]);
  c = counter(root);
  const bypass = validateAuthored(root, paths, { noCache: true, readFile: c.readFile });
  assert.deepEqual(opened(c), []);
  assert.notDeepEqual(plain, bypass, 'the poisoned entry shows only through the cache');
  const saved = process.env.WIKI_MASTER_VAULT;
  const log = console.log;
  process.env.WIKI_MASTER_VAULT = root;
  console.log = () => {};
  try {
    c = counter(root);
    healthMain(['--json', '--no-cache'], { readFile: c.readFile });
    assert.deepEqual(opened(c), []);
    c = counter(root);
    healthMain(['--json'], { readFile: c.readFile });
    assert.deepEqual(opened(c), [GRAPH_CACHE_FILE]);
  } finally {
    console.log = log;
    if (saved === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = saved;
  }
  assert.ok(existsSync(cacheFile(root)));
});

// ----------------------------------------------------------- property --

test('property: after any of these edits a warm scan deep-equals a cold one, scoped or not', t => {
  const { root, put } = fixture(t);
  const sources = new Set(['wiki/concepts/alpha.md', 'wiki/authored/demo/guide.md']);
  const check = (label) => {
    assert.deepEqual(warm(root).scan, cold(root), label);
    assert.deepEqual(warm(root, { sources }).scan, cold(root, { sources }), `${label} (scoped)`);
  };
  writeCache(root);
  check('unchanged');
  const edits = [
    ['body link', () => put('wiki/concepts/alpha.md', FILES['wiki/concepts/alpha.md'].replace('[[beta]]', '[[beta]] [[Unwritten]]'))],
    ['sources', () => put('wiki/sources/topic.md', FILES['wiki/sources/topic.md'].replace('sources: ["[[raw/clippings/clip.md]]"]', 'sources: ["[[raw/clippings/gone.md]]"]'))],
    ['crlf', () => put('wiki/concepts/beta.md', FILES['wiki/concepts/beta.md'].replaceAll('\n', '\r\n'))],
    ['frontmatter damage', () => put('wiki/authored/demo/guide.md', FILES['wiki/authored/demo/guide.md'].replace('status: draft\n', 'status: draft\r'))],
    ['alias', () => put('wiki/concepts/gamma.md', FILES['wiki/concepts/gamma.md'].replace('aliases: [other]', 'aliases: [alpha]'))],
    ['new page', () => put('wiki/concepts/alpha copy.md', FILES['wiki/concepts/alpha.md'])],
    ['deleted page', () => unlinkSync(join(root, 'wiki/concepts/beta.md'))],
    ['raw clipping', () => put('raw/clippings/clip.md', `${FILES['raw/clippings/clip.md']}More.\n`)],
  ];
  for (const [label, edit] of edits) {
    edit();
    check(label);
    writeCache(root);
    check(`${label}, after a rewrite`);
  }
});

// ----------------------------------------------------------- golden --

// Twelve fixed texts and what markdownPage and deriveIntegrity make of them. The cache stores those results, so a
// change to either function's output must bump GRAPH_CACHE_FORMAT or INTEGRITY_DERIVE_ID, or a cache written before
// the change would be read as if it were current. Regenerate with UPDATE_GOLDEN=1 in the same change as the bump.
const GOLDEN = join(ROOT, 'test', 'fixtures', 'graph-golden.json');
const GOLDEN_TEXTS = [
  ['wiki/concepts/plain.md', '# Plain\n\nNo frontmatter, one [[link]].\n'],
  ['wiki/concepts/fm.md', '---\ntype: concept\nstatus: maintained\ntitle: "A Title"\naliases: [one, "two words"]\n---\n# Body\n'],
  ['wiki/concepts/sources-inline.md', '---\ntype: concept\nsources: ["[[raw/clippings/a.md]]", "[[b]]"]\n---\nText citing [[raw/clippings/a.md]].\n'],
  ['wiki/concepts/sources-block.md', '---\ntype: concept\nsources:\n  - "[[raw/clippings/a.md]]"  # a comment\n  - "[[wiki/sources/s.md|alias]]"\n---\nBody.\n'],
  ['wiki/concepts/sources-empty.md', '---\ntype: concept\nsources: []\n---\nA derived page.\n'],
  ['wiki/concepts/links.md', '# Links\n\n[[a|alias]] [[b#heading]] [[c\\|table]] ![[embed.png]] \\[[escaped]] [[unclosed\nnext line]] [[]]\n'],
  ['wiki/concepts/code.md', '# Code\n\n`[[span]]` and\n\n```\n[[fenced]]\n```\n\n[[real]]\n'],
  ['wiki/concepts/crlf.md', '---\r\ntype: concept\r\nsources: []\r\n---\r\n# CRLF\r\n\r\nA [[crlf link]].\r\n'],
  ['wiki/concepts/bom.md', '﻿---\ntype: concept\nsources: []\n---\n# BOM\n\n[[bom link]]\n'],
  ['wiki/concepts/damaged.md', '---\ntype: concept\rstatus: draft\n---\nStray \r return.\n'],
  ['wiki/authored/demo/backlog/item.md', '---\ntype: authored\nproject: demo\nkind: backlog-item\nbacklog-status: planned\nsource-hash: ABCDEF12\n---\n# Item\n\n> [!update] one\n\nWork on [[raw/clippings/c.md]] per [[other]].\n'],
  ['raw/clippings/clip.md', '---\nsource: "https://example.test/x"\nsource-hash: "0123456789abcdef"\ntags: [clippings]\n---\nCaptured [[not a link to follow]].\n'],
];

test('golden: markdownPage and deriveIntegrity give the stored output for twelve fixed texts', () => {
  const now = GOLDEN_TEXTS.map(([path, text]) => {
    const page = markdownPage(path, text);
    return json({ path, text, page, extra: deriveIntegrity(path, text, page) });
  });
  const current = { format: GRAPH_CACHE_FORMAT, derive: INTEGRITY_DERIVE_ID, cases: now };
  const stored = existsSync(GOLDEN) ? JSON.parse(readFileSync(GOLDEN, 'utf8')) : null;
  const bump = 'markdownPage or deriveIntegrity output changed: bump GRAPH_CACHE_FORMAT (scripts/lib/graph.mjs) or INTEGRITY_DERIVE_ID (scripts/lib/integrity.mjs) and regenerate with UPDATE_GOLDEN=1';
  if (process.env.UPDATE_GOLDEN === '1') {
    const same = stored && JSON.stringify(stored.cases) === JSON.stringify(now);
    const bumped = !stored || stored.format !== GRAPH_CACHE_FORMAT || stored.derive !== INTEGRITY_DERIVE_ID;
    assert.ok(same || bumped, `${bump} (UPDATE_GOLDEN=1 refuses to store a new output under the old constants)`);
    writeFileSync(GOLDEN, `${JSON.stringify(current, null, 2)}\n`);
    return;
  }
  assert.ok(stored, `${GOLDEN} is missing; create it with UPDATE_GOLDEN=1`);
  assert.equal(stored.cases.length, 12);
  assert.deepEqual([stored.format, stored.derive], [GRAPH_CACHE_FORMAT, INTEGRITY_DERIVE_ID], 'the fixture was stored under other constants; regenerate it with UPDATE_GOLDEN=1');
  for (let i = 0; i < now.length; i++) assert.deepEqual(now[i], stored.cases[i], `${now[i].path}: ${bump}`);
});
