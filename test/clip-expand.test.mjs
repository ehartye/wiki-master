import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, renderAttempt } from '../scripts/clip.mjs';
import { checkClipArgs, CLIP_SPECS } from '../scripts/lib/clip-args.mjs';
import { markdownCounts } from '../scripts/lib/expand.mjs';
import { extractHtml } from '../scripts/lib/html-extract.mjs';
import { runReclips } from '../scripts/lib/reclip.mjs';
import { disposeIssue } from '../scripts/lib/triage.mjs';

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');

// What --expand does around the browser. The render is injected: test/browser/expand.test.mjs owns the browser itself.

const URL_A = 'https://docs.example.test/guide/pricing';
const WORDS = 'The expanded page explains the plans in plain words for the reader. '.repeat(20);
const TABLE = '| A |\n| --- |\n| 1 |';
const CODE = '```\nsample()\n```';
const notCalled = (name) => () => assert.fail(`${name} must not run under --expand`);

function vault(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-clip-expand-'));
  const clippings = join(root, 'raw', 'clippings');
  mkdirSync(clippings, { recursive: true });
  const prior = process.env.WIKI_MASTER_VAULT;
  process.env.WIKI_MASTER_VAULT = root;
  t.after(() => { if (prior === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = prior; rmSync(root, { recursive: true, force: true }); });
  const read = (name) => { const f = join(root, '.wiki-master', name); return existsSync(f) ? readFileSync(f, 'utf8') : null; };
  return {
    root,
    names: () => readdirSync(clippings),
    clipping: (name) => readFileSync(join(clippings, `${name}.md`), 'utf8'),
    declines: () => JSON.parse(read('declined.json') ?? '[]'),
    rows: () => (read('triage.jsonl') ?? '').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.t === 'issue'),
  };
}

function clip(argv, render) {
  const lines = [];
  const log = console.log, err = console.error, code = process.exitCode;
  console.log = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  try {
    const result = main(argv, { extract: notCalled('static extraction'), fetchText: notCalled('the text fetch'), render });
    return { result, lines, exitCode: process.exitCode };
  } finally { console.log = log; console.error = err; process.exitCode = code; }
}
const rendered = (contentMarkdown, coverage, extra = {}) => ({
  ok: true,
  data: { title: 'Pricing', contentMarkdown, ...extra },
  coverage: { tabs: 2, panels: 2, details: 1, tables: 1, code: 1, truncated: false, ...coverage },
});

test('--expand goes straight to the browser and records its coverage on one quoted line', (t) => {
  const v = vault(t);
  let asked;
  const { result, lines } = clip([URL_A, '--expand'], (url, options) => {
    asked = { url, options };
    return rendered(`${WORDS}\n\n${TABLE}\n\n${CODE}`, {}, { pageSignals: { tabControls: 4, pdfLinks: [], markdownLinks: [] } });
  });
  assert.deepEqual(asked, { url: URL_A, options: { expand: true } });
  assert.equal(result.status, 'clipped');
  assert.equal(result.expandCoverage, 'tabs=2 panels=2 details=1 tables=1 code=1 truncated=false');
  const text = v.clipping(result.slug);
  assert.match(text, /^expand-coverage: "tabs=2 panels=2 details=1 tables=1 code=1 truncated=false"$/m);
  assert.match(text, /^extraction: rendered$/m);
  assert.doesNotMatch(text, /^fidelity: /m);
  assert.deepEqual(v.rows(), []);
  assert.ok(!result.unexpandedTabs, 'tabs that an expanded read left closed are its coverage, not a note');
  assert.doesNotMatch(lines.join('\n'), /^note:/m);
});

const SHORTFALLS = [
  ['fewer tables', `${WORDS}\n\n${CODE}`, {}, /0 of 1 tables/],
  ['fewer code blocks', `${WORDS}\n\n${TABLE}`, {}, /0 of 1 code blocks/],
  ['a table only inside a code block', `${WORDS}\n\n\`\`\`\n${TABLE}\n\`\`\``, { code: 1 }, /0 of 1 tables/],
  ['a limit hit, with every count met', `${WORDS}\n\n${TABLE}\n\n${CODE}`, { truncated: true }, /limit/],
];
for (const [name, markdown, coverage, label] of SHORTFALLS) {
  test(`${name} gives fidelity: partial and a warning that reaches triage`, (t) => {
    const v = vault(t);
    const { result } = clip([URL_A, '--expand'], () => rendered(markdown, coverage));
    assert.equal(result.status, 'clipped');
    assert.match(v.clipping(result.slug), /^fidelity: partial$/m);
    const [row, ...others] = v.rows();
    assert.equal(others.length, 0);
    assert.equal(row.kind, 'fidelity');
    assert.match(row.reason, /expand-coverage/);
    assert.match(row.reason, label);
  });
}

const FAILURES = [
  ['blocked', { ok: false, kind: 'blocked', reason: 'access denied (HTTP 403)' }, 'blocked'],
  ['gone', { ok: false, kind: 'gone', reason: 'page not found (HTTP 404)' }, 'gone'],
  ['failed', { ok: false, kind: 'failed', reason: 'render failed: timeout' }, 'failed'],
  ['unavailable', { ok: false, kind: 'failed', unavailable: true, reason: 'No browser' }, 'failed'],
];
for (const [name, outcome, kind] of FAILURES) {
  test(`a ${name} render is queued and not declined, with no static text in its place`, (t) => {
    const v = vault(t);
    const { result } = clip([URL_A, '--expand'], () => outcome);
    assert.equal(result.status, 'failed');
    assert.deepEqual(v.names(), []);
    assert.deepEqual(v.declines(), []);
    assert.deepEqual(v.rows().map((row) => [row.url, row.kind]), [[URL_A, kind]]);
  });
}

test('an expanded read that is still thin is queued, not declined', (t) => {
  const v = vault(t);
  const { result, lines } = clip([URL_A, '--expand'], () => rendered('Back to top', { tabs: 0, panels: 0, tables: 0, code: 0 }));
  assert.equal(result.status, 'thin');
  assert.deepEqual(v.names(), []);
  assert.deepEqual(v.declines(), []);
  assert.deepEqual(v.rows().map((row) => row.kind), ['thin']);
  assert.doesNotMatch(lines.join('\n'), /browser render unavailable/);
});

const REFUSED = [
  ['--from-file', [URL_A, '--expand', '--from-file', 'saved.md']],
  ['a .pdf URL', ['https://docs.example.test/paper.pdf', '--expand']],
  ['a /pdf/ URL', ['https://docs.example.test/pdf/2404.03337', '--expand']],
  ['a plain-text URL', ['https://docs.example.test/notes.txt', '--expand']],
];
for (const [name, argv] of REFUSED) {
  test(`--expand with ${name} exits 2 and touches nothing`, (t) => {
    const v = vault(t);
    const { result, exitCode, lines } = clip(argv, notCalled('the render'));
    assert.equal(exitCode, 2);
    assert.equal(result.status, 'error');
    assert.match(lines.join('\n'), /--expand/);
    assert.deepEqual(v.names(), []);
    assert.deepEqual(v.rows(), []);
  });
}

test('the clipper accepts --expand, and passes it to the render subprocess on both launchers', () => {
  assert.deepEqual(checkClipArgs([URL_A, '--expand'], CLIP_SPECS.clip), { ok: true });
  const tmp = mkdtempSync(join(tmpdir(), 'wm-clip-expand-run-'));
  try {
    const commands = [];
    const run = (cmd) => {
      commands.push(cmd);
      if (cmd.includes('extract-page.mjs')) return JSON.stringify({ title: 'Pricing', contentMarkdown: WORDS, pageCounts: { tables: 3, code: 2 } });
      if (commands.length === 1) throw Object.assign(new Error('exit 3'), { stderr: JSON.stringify({ unavailable: true, missing: 'playwright-core' }) });
      return JSON.stringify({ htmlFile: 'x', finalUrl: URL_A, status: 200, title: 'Pricing', words: 200, expansion: { tabs: 4, panels: 3, details: 1, truncated: false } });
    };
    const outcome = renderAttempt(URL_A, { run, tmp, expand: true });
    assert.equal(outcome.ok, true);
    assert.deepEqual(outcome.coverage, { tabs: 4, panels: 3, details: 1, tables: 3, code: 2, truncated: false });
    const renders = commands.filter((cmd) => cmd.includes('render-page.mjs'));
    assert.equal(renders.length, 2);
    for (const cmd of renders) assert.match(cmd, /--expand$/);
    assert.equal(renderAttempt(URL_A, { run: (cmd) => (cmd.includes('extract-page.mjs') ? run(cmd) : JSON.stringify({ finalUrl: URL_A, status: 200, title: 'P', words: 200 })), tmp }).coverage, undefined);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('tables and code blocks are counted in the region pageSignals reads, and hidden or layout ones are not', async () => {
  const data = await extractHtml(`<!doctype html><html><body>
    <nav><table><tr><td>nav</td></tr></table></nav>
    <main><h1>Guide</h1><p>${WORDS}</p>
      <table><tr><td>one<table><tr><td>nested</td></tr></table></td></tr></table>
      <table><tr><td>two</td></tr></table>
      <table class="highlight"><tr><td><pre>line_numbered()</pre></td></tr></table>
      <pre>block()</pre>
      <p>Some <code>inline</code> code.</p>
      <pre hidden>hidden_source()</pre>
      <footer><pre>footer()</pre></footer>
    </main>
    <aside><table><tr><td>sidebar</td></tr></table><pre>sidebar()</pre></aside></body></html>`, URL_A);
  assert.deepEqual(data.pageCounts, { tables: 2, code: 2 });
});

test('markdownCounts reads tables and fenced code, and takes neither from inside the other', () => {
  const markdown = [
    'Prose with a | pipe.', '', '| A | B |', '|---|:--:|', '| 1 | 2 |', '',
    'A | B', '--- | ---', '1 | 2', '',
    '<table><tr><td colspan="2">kept as HTML</td></tr></table>', '',
    '```js', '| not | table |', '|---|---|', '```', '',
    '~~~~', '```', 'still the same block', '~~~~', '',
    '  ```', '  indented()', '  ```', '',
    '---', '', 'Above is a rule.',
  ].join('\n');
  assert.deepEqual(markdownCounts(markdown), { tables: 3, code: 3 });
});

// ---------------------------------------------------------------- the repair tools leave an expanded clip alone
const EXPANDED_BODY = Array.from({ length: 30 }, (_, i) => `Panel ${i} lists the plan details a reader compares before choosing one.`).join('\n\n');
const expanded = (coverageLine) => `---\ntitle: "Pricing"\nsource: "${URL_A}"\ncreated: 2026-11-01\ntags: [clippings]\nquality: medium\nextraction: rendered\nfidelity: partial\nfidelity-checks: 4\n${coverageLine ? 'expand-coverage: "tabs=4 panels=4 details=0 tables=4 code=0 truncated=true"\n' : ''}source-hash: ${'a'.repeat(64)}\n---\n\n${EXPANDED_BODY}\n`;

for (const coverageLine of [false, true]) {
  test(`${coverageLine ? '' : 'control: '}a re-clip ${coverageLine ? 'refuses' : 'plans'} a requested page ${coverageLine ? 'with' : 'without'} expand-coverage`, async (t) => {
    const v = vault(t);
    const file = join(v.root, 'raw', 'clippings', 'Pricing.md');
    writeFileSync(file, expanded(coverageLine));
    disposeIssue(v.root, { url: URL_A, kind: 'fidelity', disposition: 'reclip' });
    const readPage = () => assert.fail('nothing is read for an expanded clipping');
    const report = await runReclips({ vaultPath: v.root, readPage });
    if (!coverageLine) { assert.deepEqual(report.results.map((r) => r.status), ['planned']); return; }
    assert.equal(report.selected, 0);
    assert.equal(report.refused.length, 1);
    assert.match(report.refused[0].reason, /--recapture --expand/);
    const applied = await runReclips({ vaultPath: v.root, apply: true, readPage, obtain: readPage });
    assert.equal(applied.reclipped, 0);
    assert.equal(readFileSync(file, 'utf8'), expanded(true));
  });
}

test('refresh-fidelity --apply keeps an expanded clip partial, and still clears a plain one', (t) => {
  const v = vault(t);
  const kept = join(v.root, 'raw', 'clippings', 'Pricing.md'), cleared = join(v.root, 'raw', 'clippings', 'Plain.md');
  writeFileSync(kept, expanded(true));
  writeFileSync(cleared, expanded(false).replace('title: "Pricing"', 'title: "Plain"'));
  const r = spawnSync(process.execPath, [join(SCRIPTS, 'refresh-fidelity.mjs'), '--apply'], { env: { ...process.env, WIKI_MASTER_VAULT: v.root }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(kept, 'utf8'), expanded(true));
  assert.doesNotMatch(readFileSync(cleared, 'utf8'), /^fidelity:/m);
});
