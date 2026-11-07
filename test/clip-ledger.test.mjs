import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, statSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../scripts/clip.mjs';
import { extractHtml } from '../scripts/lib/html-extract.mjs';
import { ledgerFileProblem } from '../scripts/lib/clip-ledger.mjs';

// `--ledger <file>` appends one JSON line per address, with the same sixteen fields for every outcome `clip.mjs` can end in.
// Fetching, extraction and the browser are injected.

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const FIELDS = ['url', 'status', 'path', 'sourceHash', 'quality', 'topic', 'extraction', 'fidelity', 'reason', 'twinUrl', 'documentLink', 'expandCoverage', 'unexpandedTabs', 'extractionRetry', 'visibleWords', 'extractedWords'];
const PAGE = 'https://docs.example.test/guide/setup';
const words = (n) => Array.from({ length: n }, (_, i) => `word${i % 50}`).join(' ');
const article = (extra = {}) => ({ title: 'Setup guide', contentMarkdown: `# Setup guide\n\n${words(150)}`, ...extra });
const NO_BROWSER = () => ({ ok: false, kind: 'failed', unavailable: true, reason: 'No browser' });
const NO_TWIN = () => ({ ok: false, reason: 'status 404' });
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-clip-ledger-'));
  const clippings = join(root, 'raw', 'clippings');
  mkdirSync(clippings, { recursive: true });
  const prior = process.env.WIKI_MASTER_VAULT;
  process.env.WIKI_MASTER_VAULT = root;
  t.after(() => { if (prior === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = prior; rmSync(root, { recursive: true, force: true }); });
  const ledger = join(root, 'ledger.jsonl');
  return {
    root, ledger, clippings,
    rows: () => (existsSync(ledger) ? readFileSync(ledger, 'utf8') : '').split('\n').filter(Boolean).map((line) => JSON.parse(line)),
    state: (name) => { const f = join(root, '.wiki-master', name); return existsSync(f) ? readFileSync(f, 'utf8') : ''; },
    names: () => readdirSync(clippings),
  };
}

function clip(argv, deps = {}) {
  const lines = [];
  const log = console.log, err = console.error, code = process.exitCode;
  console.log = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  process.exitCode = undefined;
  try {
    const result = main(argv, { extract: () => article(), fetchTwin: NO_TWIN, render: NO_BROWSER, today: () => '2026-11-06', runtimeAvailable: () => true, sleep: () => {}, ...deps });
    return { result, lines, exitCode: process.exitCode ?? 0 };
  } finally { console.log = log; console.error = err; process.exitCode = code; }
}

// A single run with a ledger appends exactly one row, with every field present.
function row(v, url, extra, deps) {
  const run = clip([url, '--ledger', v.ledger, ...extra], deps);
  const rows = v.rows();
  assert.equal(rows.length, 1, run.lines.join('\n'));
  assert.deepEqual(Object.keys(rows[0]), FIELDS);
  assert.equal(rows[0].url, url);
  return { ...run, row: rows[0] };
}
// What is not named in `want` does not apply to that outcome.
const NONE = Object.fromEntries(FIELDS.map((f) => [f, null]));
const expectRow = (actual, want) => assert.deepEqual(actual, { ...NONE, ...want });

const seed = (v, name, source, extra = '') => writeFileSync(join(v.clippings, `${name}.md`), `---\ntitle: "${name}"\nsource: "${source}"\ncreated: 2026-01-01\ntags: [clippings]\nquality: medium\n${extra}source-hash: ${sha256(name)}\n---\n\n${words(150)}\n`);

// ---------------------------------------------------------------- one row for each outcome

test('clipped: the written file, its hash, quality, topic and extraction', (t) => {
  const v = setup(t);
  const { row: r, result } = row(v, PAGE, ['--topic=Docs', '--quality=high']);
  assert.equal(result.status, 'clipped');
  const text = readFileSync(join(v.clippings, `${result.slug}.md`), 'utf8');
  const hash = text.match(/^source-hash: (\w+)$/m)[1];
  expectRow(r, { url: PAGE, status: 'clipped', path: `raw/clippings/${result.slug}.md`, sourceHash: hash, quality: 'high', topic: 'Docs', extraction: 'text', fidelity: 'high' });
});

test('clipped: a retried extraction, its word counts and a partial fidelity warning', (t) => {
  const v = setup(t);
  const { row: r } = row(v, PAGE, [], { extract: () => article({ extractionRetry: 'unwrap-inline', visibleWords: 900, fidelityWarnings: [{ kind: 'heading', label: 'Install' }] }) });
  assert.equal(r.status, 'clipped');
  assert.equal(r.extractionRetry, 'unwrap-inline');
  assert.equal(r.visibleWords, 900);
  assert.equal(r.extractedWords, 153);
  assert.equal(r.fidelity, 'partial');
});

test('clipped by --expand: rendered, with its coverage line', (t) => {
  const v = setup(t);
  const coverage = { tabs: 2, panels: 2, details: 0, tables: 0, code: 0, truncated: false };
  const { row: r } = row(v, PAGE, ['--expand'], { render: () => ({ ok: true, data: article(), coverage }) });
  assert.equal(r.status, 'clipped');
  assert.equal(r.extraction, 'rendered');
  assert.equal(r.expandCoverage, 'tabs=2 panels=2 details=0 tables=0 code=0 truncated=false');
});

test('clipped as the plain-text twin of a thin page', (t) => {
  const v = setup(t);
  const twin = `${PAGE}.md.txt`;
  const text = `# Setup guide\n\n${words(150)}\n`;
  const { row: r } = row(v, PAGE, [], { extract: () => ({ title: 'Setup', contentMarkdown: 'Back to top' }), fetchTwin: (url) => (url === twin ? { ok: true, type: 'text/markdown', text, finalUrl: url } : NO_TWIN()) });
  assert.equal(r.status, 'clipped');
  assert.equal(r.extraction, 'plaintext-twin');
  assert.equal(r.twinUrl, twin);
});

test('clipped as a landing page: the document it points to', (t) => {
  const v = setup(t);
  const pdf = 'https://docs.example.test/files/guide.pdf';
  const { row: r } = row(v, PAGE, [], { extract: () => ({ title: 'Guide download', contentMarkdown: words(40), pageSignals: { tabControls: 0, pdfLinks: [pdf], markdownLinks: [] } }) });
  assert.equal(r.status, 'clipped');
  assert.equal(r.documentLink, pdf);
});

test('clipped with tabs the page showed no panel for: unexpandedTabs above 0, from the real extractor', async (t) => {
  const v = setup(t);
  const tabs = ['Alpha', 'Beta', 'Gamma'].map((label, i) => `<button role="tab" aria-controls="p${i}">${label}</button>`).join('');
  const panels = [0, 1, 2].map((i) => `<div role="tabpanel" id="p${i}" hidden> </div>`).join('');
  const prose = `<p>${'The guide explains how the service behaves in plain words so that the extractor has an article to keep. '.repeat(8)}</p>`;
  const data = await extractHtml(`<!doctype html><html><head><title>Guide</title></head><body><main><h1>Guide</h1>${prose}<div role="tablist">${tabs}</div>${panels}</main></body></html>`, PAGE);
  const { row: r } = row(v, PAGE, [], { extract: () => data });
  assert.equal(r.status, 'clipped');
  assert.equal(r.unexpandedTabs, 3);
});

test('unchanged: --recapture of identical text names the capture it matched', (t) => {
  const v = setup(t);
  const first = clip([PAGE]).result;
  const { row: r } = row(v, PAGE, ['--recapture']);
  assert.equal(r.status, 'unchanged');
  assert.equal(r.path, `raw/clippings/${first.slug}.md`);
  assert.equal(r.sourceHash, readFileSync(join(v.clippings, `${first.slug}.md`), 'utf8').match(/^source-hash: (\w+)$/m)[1]);
  assert.equal(r.extraction, 'text');
});

test('clash: a --slug already taken', (t) => {
  const v = setup(t);
  seed(v, 'chosen', 'https://docs.example.test/other');
  const { row: r } = row(v, PAGE, ['--slug', 'chosen']);
  expectRow(r, { url: PAGE, status: 'clash', path: 'raw/clippings/chosen.md', reason: r.reason });
  assert.match(r.reason, /already exists/);
});

test('duplicate: the address is already clipped', (t) => {
  const v = setup(t);
  seed(v, 'Held', PAGE);
  expectRow(row(v, PAGE, []).row, { url: PAGE, status: 'duplicate' });
});

test('blocked: an unreliable domain', (t) => {
  const v = setup(t);
  const url = 'https://answers.com/question/1';
  expectRow(row(v, url, []).row, { url, status: 'blocked' });
});

test('declined: --decline records the decision, and a later clip meets it', (t) => {
  const v = setup(t);
  expectRow(row(v, PAGE, ['--decline=not relevant']).row, { url: PAGE, status: 'declined', reason: 'not relevant' });
  const second = clip([PAGE, '--ledger', v.ledger]);
  assert.equal(second.result.status, 'declined');
  const last = v.rows().at(-1);
  assert.equal(last.status, 'declined');
  assert.match(last.reason, /declined previously.*not relevant/);
});

test('thin: a stub the browser could not improve', (t) => {
  const v = setup(t);
  const { row: r } = row(v, PAGE, ['--topic=Docs'], { extract: () => ({ title: 'Stub', contentMarkdown: 'Too short to keep.' }) });
  expectRow(r, { url: PAGE, status: 'thin', topic: 'Docs', reason: 'thin content (SPA/paywall shell)' });
});

test('failed: the browser could not read the page either', (t) => {
  const v = setup(t);
  const { row: r } = row(v, PAGE, [], { extract: () => { throw new Error('no page'); }, render: () => ({ ok: false, kind: 'failed', reason: 'navigation timed out' }) });
  expectRow(r, { url: PAGE, status: 'failed', reason: 'navigation timed out' });
});

test('failed: a page that is gone', (t) => {
  const v = setup(t);
  const { row: r } = row(v, PAGE, [], { extract: () => ({ title: 'Stub', contentMarkdown: 'Too short to keep.' }), render: () => ({ ok: false, kind: 'gone', reason: 'HTTP 404' }) });
  expectRow(r, { url: PAGE, status: 'failed', reason: 'HTTP 404' });
});

test('error: a refused combination, with the exit code it leaves', (t) => {
  const v = setup(t);
  const url = 'https://docs.example.test/files/guide.pdf';
  const { row: r, exitCode } = row(v, url, ['--expand']);
  assert.equal(exitCode, 2);
  assert.equal(r.status, 'error');
  assert.match(r.reason, /--expand opens a page in a browser/);
});

test('--find-twin: skipped, no twin and twin', (t) => {
  const v = setup(t);
  assert.equal(clip([PAGE]).result.status, 'clipped');
  expectRow(row(v, PAGE, ['--find-twin']).row, { url: PAGE, status: 'skipped', reason: 'no clipping of it carries a partial fidelity warning' });
  rmSync(v.ledger);
  const partial = 'https://docs.example.test/guide/partial';
  clip([partial], { extract: () => article({ fidelityWarnings: [{ kind: 'heading', label: 'Install' }] }) });
  expectRow(row(v, partial, ['--find-twin']).row, { url: partial, status: 'no-twin' });
  rmSync(v.ledger);
  const twin = `${partial}.md.txt`;
  const { row: r } = row(v, partial, ['--find-twin'], { fetchTwin: (url) => (url === twin ? { ok: true, type: 'text/markdown', text: `# T\n\n${words(150)}`, finalUrl: url } : NO_TWIN()) });
  expectRow(r, { url: partial, status: 'twin', twinUrl: twin });
});

// ---------------------------------------------------------------- the list, the path and the credential

test('--list appends one row per address in order, a bad line with its address redacted', (t) => {
  const v = setup(t);
  const list = join(v.root, 'urls.txt');
  writeFileSync(list, ['https://one.example.test/a', 'https://reader:s3cretpw@docs.example.test/page?x=1', 'not a url', 'https://two.example.test/b'].join('\n'));
  const { exitCode } = clip(['--list', list, '--ledger', v.ledger]);
  assert.equal(exitCode, 0);
  const rows = v.rows();
  assert.deepEqual(rows.map((r) => [r.status, r.url]), [
    ['clipped', 'https://one.example.test/a'],
    ['error', 'https://docs.example.test/page?x=1'],
    ['error', null],
    ['clipped', 'https://two.example.test/b'],
  ]);
  for (const r of rows) assert.deepEqual(Object.keys(r), FIELDS);
  assert.ok(!readFileSync(v.ledger, 'utf8').includes('s3cretpw'));
});

for (const inside of ['raw', 'wiki']) {
  test(`a ledger inside ${inside}/ of the vault exits 2 before any clipping, alone or with --list`, (t) => {
    const v = setup(t);
    mkdirSync(join(v.root, inside, 'sub'), { recursive: true });
    const file = join(v.root, inside, 'sub', 'ledger.jsonl');
    const list = join(v.root, 'urls.txt');
    writeFileSync(list, 'https://one.example.test/a\n');
    for (const argv of [[PAGE, '--ledger', file], ['--list', list, '--ledger', file]]) {
      const r = clip(argv, { extract: () => assert.fail('nothing may be read') });
      assert.equal(r.exitCode, 2, argv.join(' '));
      assert.equal(r.result.status, 'error');
      assert.ok(!existsSync(file));
    }
    assert.deepEqual(v.names(), []);
  });
}

test('a credentialed address with a ledger: exit 2, a redacted row, and the credential nowhere', (t) => {
  const v = setup(t);
  const r = spawnSync(process.execPath, [join(SCRIPTS, 'clip.mjs'), 'https://reader:s3cretpw@docs.example.test/page', '--ledger', v.ledger, '--topic=Docs'], { encoding: 'utf8', timeout: 60000, env: { ...process.env, WIKI_MASTER_VAULT: v.root } });
  assert.equal(r.status, 2, r.stderr);
  expectRow(v.rows()[0], { url: 'https://docs.example.test/page', status: 'error', topic: 'Docs', reason: v.rows()[0].reason });
  assert.match(v.rows()[0].reason, /carries a username or password/);
  const everything = [r.stdout, r.stderr, readFileSync(v.ledger, 'utf8'), v.state('triage.jsonl'), v.state('declined.json')].join('\n');
  assert.ok(!everything.includes('s3cretpw') && !everything.includes('reader:'));
});

// ---------------------------------------------------------------- a missing extraction runtime

// Like clip(), but process.exit throws so the exit code an unrecoverable outcome asks for is seen.
function clipExiting(argv, deps = {}) {
  const exit = process.exit;
  process.exit = (c) => { throw Object.assign(new Error(`process.exit(${c})`), { exitCode: c }); };
  try {
    const run = clip(argv, deps);
    return { ...run, exited: null };
  } catch (e) {
    if (e.exitCode === undefined) throw e;
    return { result: null, lines: [], exitCode: e.exitCode, exited: e.exitCode };
  } finally { process.exit = exit; }
}
const NO_RUNTIME = { extract: () => { throw new Error('no runtime'); }, runtimeAvailable: () => false };

test('a missing extraction runtime leaves an error row naming it, then stops with exit 1', (t) => {
  const v = setup(t);
  const r = clipExiting([PAGE, '--ledger', v.ledger, '--topic=Docs'], NO_RUNTIME);
  assert.equal(r.exited, 1);
  const rows = v.rows();
  assert.equal(rows.length, 1);
  expectRow(rows[0], { url: PAGE, status: 'error', topic: 'Docs', reason: rows[0].reason });
  assert.match(rows[0].reason, /extraction runtime unavailable/);
  assert.deepEqual(v.names(), []);
});

test('--list: a missing extraction runtime records the address it stopped at, after the rows before it, and exits 1', (t) => {
  const v = setup(t);
  const list = join(v.root, 'urls.txt');
  writeFileSync(list, ['https://one.example.test/a', 'https://two.example.test/b', 'https://three.example.test/c'].join('\n'));
  const r = clip(['--list', list, '--ledger', v.ledger], { extract: (url) => { if (url.includes('two')) throw new Error('no runtime'); return article(); }, runtimeAvailable: () => false });
  assert.equal(r.exitCode, 1);
  const rows = v.rows();
  assert.deepEqual(rows.map((x) => [x.status, x.url]), [['clipped', 'https://one.example.test/a'], ['error', 'https://two.example.test/b']]);
  assert.match(rows[1].reason, /extraction runtime unavailable/);
  for (const x of rows) assert.deepEqual(Object.keys(x), FIELDS);
});

// ---------------------------------------------------------------- a ledger that cannot be appended to

// A mode bit stops nobody on a POSIX system when the tests run as root.
const ENFORCES_MODES = process.platform === 'win32' || typeof process.getuid !== 'function' || process.getuid() !== 0;

const UNWRITABLE = [
  ['its parent is a file', (v) => { const f = join(v.root, 'afile'); writeFileSync(f, 'x'); return join(f, 'e.jsonl'); }, true],
  ['the path is a directory', (v) => { const d = join(v.root, 'adir'); mkdirSync(d); return d; }, true],
  ['its parent folder does not exist (no folder is created for it)', (v) => join(v.root, 'nope', 'e.jsonl'), true],
  ['it is a read-only file', (v) => { const f = join(v.root, 'ro.jsonl'); writeFileSync(f, ''); chmodSync(f, 0o444); return f; }, ENFORCES_MODES],
];
for (const [name, make, enforced] of UNWRITABLE) {
  test(`a ledger that cannot be appended to (${name}) exits 2 with one line before any clipping, alone or with --list`, { skip: enforced ? false : 'modes are not enforced for root' }, (t) => {
    const v = setup(t);
    const file = make(v);
    t.after(() => { try { chmodSync(file, 0o666); } catch { /* not a file of ours any more */ } });
    const list = join(v.root, 'urls.txt');
    writeFileSync(list, 'https://one.example.test/a\n');
    for (const argv of [[PAGE, '--ledger', file], ['--list', list, '--ledger', file]]) {
      const r = clip(argv, { extract: () => assert.fail('nothing may be read') });
      assert.equal(r.exitCode, 2, argv.join(' '));
      assert.equal(r.result.status, 'error');
      assert.equal(r.lines.length, 1, r.lines.join('\n'));
      assert.match(r.lines[0], /^--ledger: .*cannot be appended to/);
    }
    assert.deepEqual(v.names(), []);
    assert.ok(!existsSync(join(v.root, 'nope')));
  });
}

test('a ledger whose folder exists is created empty by the probe and then appended to', (t) => {
  const v = setup(t);
  const dir = join(v.root, 'out');
  mkdirSync(dir);
  const file = join(dir, 'e.jsonl');
  const r = clip([PAGE, '--ledger', file]);
  assert.equal(r.exitCode, 0);
  assert.equal(readFileSync(file, 'utf8').split('\n').filter(Boolean).length, 1);
});

// A run that is refused for another reason must not leave the ledger the probe would have created behind.
const REFUSED_LATER = [
  ['--list names a file that is not there', (v) => ['--list', join(v.root, 'missing.txt')], /--list: cannot read/],
  ['--list names no file', () => ['--list'], /--list needs a file/],
  ['--list is given --slug', (v) => { const l = join(v.root, 'urls.txt'); writeFileSync(l, 'https://one.example.test/a\n'); return ['--list', l, '--slug=x']; }, /--list cannot be used with --slug/],
];
for (const [name, make, message] of REFUSED_LATER) {
  test(`a refused run (${name}) leaves no new ledger behind`, (t) => {
    const v = setup(t);
    const args = make(v);
    const r = clip([...args, '--ledger', v.ledger], { extract: () => assert.fail('nothing may be read') });
    assert.equal(r.exitCode, 2, r.lines.join('\n'));
    assert.match(r.lines.join('\n'), message);
    assert.ok(!existsSync(v.ledger), 'no empty ledger was created');
    assert.deepEqual(v.names(), []);
  });
}

test('a refused run leaves a ledger that already existed with its content and its modification time', (t) => {
  const v = setup(t);
  const held = '{"url":"https://held.example.test/","status":"clipped"}\n';
  writeFileSync(v.ledger, held);
  const past = new Date('2026-01-02T03:04:05Z');
  utimesSync(v.ledger, past, past);
  const before = statSync(v.ledger).mtimeMs;
  for (const [, make] of REFUSED_LATER) {
    const r = clip([...make(v), '--ledger', v.ledger], { extract: () => assert.fail('nothing may be read') });
    assert.equal(r.exitCode, 2);
  }
  assert.equal(readFileSync(v.ledger, 'utf8'), held);
  assert.equal(statSync(v.ledger).mtimeMs, before);
});

// The ledger turns unwritable after the probe passed: the first extraction swaps the file for a directory.
function breakLedgerOnce(v, then = () => article()) {
  let broken = false;
  return (url) => {
    if (!broken) { broken = true; rmSync(v.ledger, { force: true }); mkdirSync(v.ledger); }
    return then(url);
  };
}

test('a ledger that fails to write after the clipping is reported once, the run carries on without rows, and the exit code is 2', (t) => {
  const v = setup(t);
  const list = join(v.root, 'urls.txt');
  writeFileSync(list, ['https://one.example.test/a', 'https://two.example.test/b', 'https://three.example.test/c'].join('\n'));
  const r = clip(['--list', list, '--ledger', v.ledger], { extract: breakLedgerOnce(v) });
  assert.equal(r.exitCode, 2);
  assert.equal(v.names().length, 3, 'every address was still clipped');
  assert.equal(r.lines.filter((l) => /--ledger/.test(l)).length, 1, r.lines.join('\n'));
  assert.ok(r.lines.some((l) => /^--ledger: .*cannot be appended to .*no more rows/.test(l)), r.lines.join('\n'));
  assert.ok(r.lines.includes('list: 3 URLs: clipped 3'), r.lines.join('\n'));
});

test('a ledger that fails to write after a single clipping is reported, the clipping stays, and the exit code is 2', (t) => {
  const v = setup(t);
  const r = clip([PAGE, '--ledger', v.ledger], { extract: breakLedgerOnce(v) });
  assert.equal(r.exitCode, 2);
  assert.equal(r.result.status, 'clipped');
  assert.equal(v.names().length, 1);
  assert.equal(r.lines.filter((l) => /--ledger/.test(l)).length, 1, r.lines.join('\n'));
});

// ---------------------------------------------------------------- a ledger path is judged by where it lands, not how it is spelled

// A directory link, made as a junction on Windows (which needs no privilege) and a symlink elsewhere; skipped only when the platform refuses.
function dirLink(t, target, name = 'lnk') {
  const outside = mkdtempSync(join(tmpdir(), 'wm-clip-ledger-link-'));
  const link = join(outside, name);
  let made = true;
  try { symlinkSync(target, link, 'junction'); } catch (e) { made = false; t.skip(`this platform refuses a directory link (${e.code})`); }
  t.after(() => {
    // Remove the link itself, never what it points at.
    try { unlinkSync(link); } catch { try { rmdirSync(link); } catch { /* already gone */ } }
    rmSync(outside, { recursive: true, force: true });
  });
  return made ? link : null;
}

function refusedInside(v, file, zone) {
  const list = join(v.root, 'urls.txt');
  writeFileSync(list, 'https://one.example.test/a\n');
  for (const argv of [[PAGE, '--ledger', file], ['--list', list, '--ledger', file]]) {
    const r = clip(argv, { extract: () => assert.fail('nothing may be read') });
    assert.equal(r.exitCode, 2, argv.join(' '));
    assert.equal(r.result.status, 'error');
    assert.match(r.lines.join('\n'), new RegExp(`inside ${zone}/ of the vault`));
  }
  assert.deepEqual(v.names(), []);
}

for (const zone of ['raw', 'wiki']) {
  test(`a ledger reached through a directory link into ${zone}/ exits 2 and writes nothing`, (t) => {
    const v = setup(t);
    mkdirSync(join(v.root, zone), { recursive: true });
    const link = dirLink(t, join(v.root, zone));
    if (!link) return;
    refusedInside(v, join(link, 'e.jsonl'), zone);
    assert.deepEqual(readdirSync(join(v.root, zone)).filter((n) => n !== 'clippings'), []);
  });

  test(`a ledger in a new folder under a directory link into ${zone}/ exits 2`, (t) => {
    const v = setup(t);
    mkdirSync(join(v.root, zone, 'sub'), { recursive: true });
    const link = dirLink(t, join(v.root, zone));
    if (!link) return;
    refusedInside(v, join(link, 'sub', 'e.jsonl'), zone);
  });
}

test('a ledger that is a link to a file under raw/ exits 2, whether or not the file exists yet', (t) => {
  const v = setup(t);
  const outside = mkdtempSync(join(tmpdir(), 'wm-clip-ledger-link-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  for (const exists of [true, false]) {
    const target = join(v.root, 'raw', exists ? 'held.jsonl' : 'later.jsonl');
    if (exists) writeFileSync(target, '');
    const link = join(outside, exists ? 'held-link' : 'later-link');
    try { symlinkSync(target, link, 'file'); } catch (e) { t.skip(`this platform refuses a file link (${e.code})`); return; }
    refusedInside(v, link, 'raw');
    assert.equal(existsSync(join(v.root, 'raw', 'later.jsonl')), false);
  }
});

test('a ledger spelled with .. into raw/ or wiki/ exits 2', (t) => {
  const v = setup(t);
  mkdirSync(join(v.root, 'sub'));
  mkdirSync(join(v.root, 'wiki'), { recursive: true });
  refusedInside(v, `${v.root}${sep}sub${sep}..${sep}raw${sep}e.jsonl`, 'raw');
  refusedInside(v, `${v.root}${sep}sub${sep}..${sep}wiki${sep}e.jsonl`, 'wiki');
});

test('a ledger whose .. follows a directory link that leads into raw/ exits 2', { skip: process.platform === 'win32' ? 'Windows resolves .. in the text before the file system sees the path' : false }, (t) => {
  const v = setup(t);
  mkdirSync(join(v.root, 'raw', 'sub'));
  const link = dirLink(t, join(v.root, 'raw', 'sub'));
  if (!link) return;
  // lnk/.. is raw/, so this is raw/e.jsonl, though the text reads as a file beside the link.
  refusedInside(v, `${link}${sep}..${sep}e.jsonl`, 'raw');
});

test('a ledger spelled in another case into raw/ exits 2 where the file system ignores case', { skip: process.platform === 'win32' || process.platform === 'darwin' ? false : 'this file system is case sensitive' }, (t) => {
  const v = setup(t);
  mkdirSync(join(v.root, 'raw', 'sub'));
  refusedInside(v, join(v.root, 'raw', 'sub', 'e.jsonl').toUpperCase(), 'raw');
  refusedInside(v, join(v.root, 'RAW', 'Sub', 'new.jsonl'), 'raw');
});

// ---------------------------------------------------------------- a UNC spelling of the same folder is the same folder

// On Windows the vault is also reachable as \\localhost\C$\..., which realpath keeps as a \\localhost\... string that never matches
// C:\...; the folder is the same one, so its device and inode say so. Skipped where the machine has no administrative share.
const WINDOWS_ONLY = process.platform === 'win32' ? false : 'UNC paths exist only on Windows';

function uncSpellings(t, path) {
  const rest = path.slice(3);
  const share = `${path[0]}$`;
  const spellings = [
    ['localhost', `\\\\localhost\\${share}\\${rest}`],
    ['127.0.0.1', `\\\\127.0.0.1\\${share}\\${rest}`],
    ['the computer name', `\\\\${hostname()}\\${share}\\${rest}`],
    ['the \\\\?\\UNC\\ form', `\\\\?\\UNC\\localhost\\${share}\\${rest}`],
  ];
  try { statSync(spellings[0][1]); } catch (e) { t.skip(`the administrative share ${share} is not reachable here (${e.code})`); return null; }
  return spellings;
}

for (const zone of ['raw', 'wiki']) {
  test(`a ledger in ${zone}/ spelled as a UNC path exits 2 and writes nothing`, { skip: WINDOWS_ONLY }, (t) => {
    const v = setup(t);
    mkdirSync(join(v.root, zone), { recursive: true });
    const spellings = uncSpellings(t, join(v.root, zone));
    if (!spellings) return;
    for (const [name, unc] of spellings) {
      refusedInside(v, `${unc}\\e.jsonl`, zone);
      assert.deepEqual(readdirSync(join(v.root, zone)).filter((n) => n !== 'clippings'), [], name);
    }
  });
}

test('a ledger in a new folder of raw/ spelled as a UNC path exits 2', { skip: WINDOWS_ONLY }, (t) => {
  const v = setup(t);
  mkdirSync(join(v.root, 'raw', 'sub'), { recursive: true });
  const spellings = uncSpellings(t, join(v.root, 'raw', 'sub'));
  if (!spellings) return;
  for (const [, unc] of spellings) refusedInside(v, `${unc}\\deeper\\e.jsonl`, 'raw');
});

test('a ledger reached as a UNC path through a directory link into raw/ exits 2', { skip: WINDOWS_ONLY }, (t) => {
  const v = setup(t);
  mkdirSync(join(v.root, 'raw'), { recursive: true });
  const link = dirLink(t, join(v.root, 'raw'));
  if (!link) return;
  const spellings = uncSpellings(t, link);
  if (!spellings) return;
  for (const [, unc] of spellings) refusedInside(v, `${unc}\\e.jsonl`, 'raw');
  assert.deepEqual(readdirSync(join(v.root, 'raw')).filter((n) => n !== 'clippings'), []);
});

test('a ledger in a folder that only shares the raw prefix is accepted, spelled locally or as a UNC path', (t) => {
  const v = setup(t);
  const notes = join(v.root, 'raw-notes');
  mkdirSync(notes);
  const file = join(notes, 'e.jsonl');
  assert.equal(ledgerFileProblem(file, v.root), null);
  assert.equal(clip([PAGE, '--ledger', file]).exitCode, 0);
  assert.equal(readFileSync(file, 'utf8').split('\n').filter(Boolean).length, 1);
  if (process.platform !== 'win32') return;
  const spellings = uncSpellings(t, notes);
  if (!spellings) return;
  for (const [name, unc] of spellings) assert.equal(ledgerFileProblem(`${unc}\\other.jsonl`, v.root), null, name);
});

test('an inode of 0 says nothing about identity, so the identity check is skipped', (t) => {
  const v = setup(t);
  mkdirSync(join(v.root, 'wiki'), { recursive: true });
  const unreliable = () => ({ dev: 7n, ino: 0n });
  assert.equal(ledgerFileProblem(join(v.root, 'out', 'e.jsonl'), v.root, { stat: unreliable }), null);
  // The reliable answer is still refused, and the spelling in text still decides without any identity.
  assert.match(ledgerFileProblem(join(v.root, 'wiki', 'e.jsonl'), v.root, { stat: unreliable }), /inside wiki\//);
});

test('a ledger outside raw/ and wiki/ through a link is accepted', (t) => {
  const v = setup(t);
  const dest = join(v.root, 'out');
  mkdirSync(dest);
  const link = dirLink(t, dest);
  if (!link) return;
  const r = clip([PAGE, '--ledger', join(link, 'e.jsonl')]);
  assert.equal(r.exitCode, 0, r.lines.join('\n'));
  assert.equal(readFileSync(join(dest, 'e.jsonl'), 'utf8').split('\n').filter(Boolean).length, 1);
});
