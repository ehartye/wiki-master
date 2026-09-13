import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as health from '../scripts/health.mjs';

const note = (body, fm = 'type: concept\nstatus: maintained\nsources: []') => `---\n${fm}\n---\n${body}\n`;
function fixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'wiki-integrity-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, text) => { const file = join(root, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };
  for (const [path, text] of Object.entries(files)) put(path, text);
  return { root, put, scan: () => { assert.equal(typeof health.scanIntegrity, 'function'); return health.scanIntegrity(root); } };
}

test('unwritten navigation is unscored regardless of age, demand or fuzzy similarity', t => {
  const f = fixture(t, {
    'wiki/authored/overview.md': note('[[Federalist No. 45]] [[Future Topic]] [[Future Topic]]', 'type: authored\ncreated: 2000-01-01\nsources: []'),
    'wiki/concepts/Federalist No. 10.md': note('A deliberate unwritten stub.', 'type: concept\nstatus: stub'),
  });
  const r = f.scan();
  assert.equal(r.defectCount, 0);
  assert.equal(r.forwardLinks.length, 2);
  assert.equal(r.forwardLinks.find(x => x.target === 'Future Topic').lines.length, 1);
});

test('required citations fail even on stubs; a broken citation is not also a same-page trail issue', t => {
  const f = fixture(t, {
    'wiki/sources/Study.md': note('A substantive summary of the experimental design and all observed results.', 'type: source\nstatus: maintained\nsources: ["[[raw/clippings/missing.md]]"]'),
    'wiki/concepts/Stub.md': note('Unwritten.', 'type: concept\nstatus: stub\nsources:\n  - "[[missing evidence]]"'),
  });
  const r = f.scan();
  assert.equal(r.defectCount, 2);
  assert.ok(r.issues.every(x => x.rule === 'unresolved-citation'));
  assert.equal(r.issues.find(x => x.source.endsWith('Stub.md')).line, 5);
  assert.ok(r.issues.every(x => x.id && x.evidence && x.verification));
});

test('examples, escaped openers, embeds and comments do not become navigation defects or evidence', t => {
  const f = fixture(t, {
    'wiki/authored/guide.md': note('`[[Example]]`\n```md\n[[Bad\nExample]]\n```\n~~~\n[[Other]]\n~~~\n<!-- [[Hidden]] -->\n%% [[Hidden2]] %%\n\\[[Literal]]\n![[image.png]]\n[[Future]]', 'type: authored\nsources: []'),
    '_templates/example.md': note('[[Broken\nTemplate]]'),
    '.recycle/removed.md': note('[[Broken\nRecycled]]'),
  });
  const r = f.scan();
  assert.equal(r.defectCount, 0);
  assert.deepEqual(r.forwardLinks.map(x => x.target), ['Future']);
  assert.equal(r.coverage.contentPages, 1);
});

test('real malformed links have exact locations; valid table aliases and local anchors are accepted', t => {
  const f = fixture(t, {
    'wiki/authored/guide.md': note('[[Real\nPage]]\n| [[Real Page\\|label]] |\n[[#Local heading]]\n[[Unclosed', 'type: authored\nsources: []'),
    'wiki/authored/Real Page.md': note('An original page.', 'type: authored\nsources: []'),
  });
  const r = f.scan();
  assert.equal(r.defectCount, 2);
  assert.ok(r.issues.every(x => x.rule === 'malformed-link'));
  assert.equal(r.issues.find(x => x.target.includes('\n')).line, 5);
  assert.equal(r.forwardLinks.length, 0);
});

test('substantive derived pages require evidence; stubs and original authored disclosures are exempt', t => {
  const body = 'This substantive page describes a factual claim in enough detail to exceed the stub floor.';
  const f = fixture(t, {
    'wiki/concepts/unsupported.md': note(body),
    'wiki/sources/unsupported.md': note(body, 'type: source\nsources: []'),
    'wiki/authored/original.md': note(body, 'type: authored\nsources: []'),
    'wiki/concepts/stub.md': note(body, 'type: concept\nstatus: stub'),
    'wiki/concepts/empty.md': note(''),
  });
  const r = f.scan();
  assert.equal(r.defectCount, 2);
  assert.ok(r.issues.every(x => x.rule === 'missing-evidence'));
  assert.equal(r.coverage.stubs, 2);
});

test('only actual citations establish evidence; navigation and code examples do not', t => {
  const body = 'This substantive page describes a factual claim in enough detail to exceed the stub floor.';
  const f = fixture(t, {
    'wiki/concepts/code.md': note(body + '\n`[[raw/clippings/proof.md]]`'),
    'wiki/concepts/related.md': note(body + '\n## Related\n[[raw/clippings/proof.md]]'),
    'wiki/concepts/cited.md': note(body + '\n[[wiki/sources/proof.md]]'),
    'wiki/sources/proof.md': note(body, 'type: source\nsources: ["[[raw/clippings/proof.md]]"]'),
    'raw/clippings/proof.md': 'Evidence.',
  });
  assert.deepEqual(f.scan().issues.map(x => x.source).sort(), ['wiki/concepts/code.md', 'wiki/concepts/related.md']);
});

test('ambiguous bare links require disambiguation while full paths resolve exactly', t => {
  const f = fixture(t, {
    'wiki/authored/a/overview.md': note('An original page.', 'type: authored\nsources: []'),
    'wiki/authored/b/overview.md': note('Another original page.', 'type: authored\nsources: []'),
    'wiki/authored/entry.md': note('[[overview]] [[wiki/authored/a/overview.md]]', 'type: authored\nsources: []'),
  });
  const r = f.scan();
  assert.equal(r.defectCount, 1);
  assert.equal(r.issues[0].rule, 'ambiguous-link');
  assert.equal(r.issues[0].candidates.length, 2);
});

test('stable issue IDs survive line shifts; duplicate occurrences count once and actual repair reduces count', t => {
  const body = '[[raw/clippings/missing.md]]\n[[raw/clippings/missing.md]]';
  const f = fixture(t, { 'wiki/authored/a.md': note(body, 'type: authored\nsources: []') });
  const before = f.scan();
  assert.equal(before.defectCount, 1);
  assert.equal(before.issues[0].lines.length, 2);
  f.put('wiki/authored/a.md', note('\n' + body, 'type: authored\nsources: []'));
  assert.equal(f.scan().issues[0].id, before.issues[0].id);
  f.put('raw/clippings/missing.md', 'Actual evidence restored.');
  assert.equal(f.scan().defectCount, 0);
});

test('CLI emits complete JSON and read-only text, preserves backlog and explicit legacy modes', t => {
  const f = fixture(t, { 'wiki/authored/a.md': note('[[Future]]', 'type: authored\nsources: []') });
  const script = fileURLToPath(new URL('../scripts/health.mjs', import.meta.url));
  const run = args => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, WIKI_MASTER_VAULT: f.root } });
  const original = readFileSync(join(f.root, 'wiki/authored/a.md'), 'utf8');
  const json = run(['--json']);
  assert.equal(json.status, 0, json.stderr);
  const r = JSON.parse(json.stdout);
  assert.equal(r.version, 1);
  assert.equal(r.defectCount, r.issues.length);
  assert.match(run([]).stdout, /Open integrity defects: 0/);
  assert.match(run(['--backlog']).stdout, /Ingest backlog/);
  assert.match(run(['--legacy']).stdout, /Wiki health: \d+\/100/);
  assert.notEqual(run(['--json', '--legacy']).status, 0);
  assert.notEqual(run(['--unknown']).status, 0);
  assert.equal(readFileSync(join(f.root, 'wiki/authored/a.md'), 'utf8'), original);
});

test('empty scan reports its coverage rather than claiming a healthy wiki', t => {
  const r = fixture(t, {}).scan();
  assert.equal(r.defectCount, 0);
  assert.equal(r.coverage.contentPages, 0);
  assert.equal(r.status, 'empty');
});

test('YAML comments neither create citation findings nor establish evidence', t => {
  const f = fixture(t, {
    'wiki/concepts/a.md': note('This substantive derived page makes a factual claim without providing a supporting source.', 'type: concept\nsources: [] # [[raw/clippings/proof.md]] [[raw/clippings/missing.md]]'),
    'raw/clippings/proof.md': 'Evidence.',
  });
  const r = f.scan();
  assert.equal(r.defectCount, 1);
  assert.equal(r.issues[0].rule, 'missing-evidence');
});

test('body links to concepts cannot borrow provenance from a same-name raw clipping', t => {
  const f = fixture(t, {
    'wiki/concepts/a.md': note('This substantive derived page makes a factual claim without providing a supporting source. [[Proof]]'),
    'wiki/concepts/Proof.md': note('Unwritten', 'type: concept\nstatus: stub'),
    'raw/clippings/Proof.md': 'Evidence.',
  });
  assert.deepEqual(f.scan().issues.map(x => x.source), ['wiki/concepts/a.md']);
});

test('duplicate citation occurrences report the earliest line in source order', t => {
  const f = fixture(t, {
    'wiki/authored/a.md': note('[[raw/clippings/missing.md]]', 'type: authored\nsources: ["[[raw/clippings/missing.md]]"]'),
  });
  const issue = f.scan().issues[0];
  assert.equal(issue.line, 3);
  assert.deepEqual(issue.lines, [3, 5]);
});

test('code spans require matching delimiter lengths and quoted fences remain examples', t => {
  const f = fixture(t, {
    'wiki/authored/a.md': note('`code `` [[raw/clippings/example.md]] end`\n> ~~~md\n> [[raw/clippings/quoted.md]]\n> ~~~', 'type: authored\nsources: []'),
  });
  assert.equal(f.scan().defectCount, 0);
});

test('Related sections preserve forward links even when the future page is a source summary', t => {
  const f = fixture(t, {
    'wiki/authored/a.md': note('## Related\n[[wiki/sources/Future summary]]', 'type: authored\nsources: []'),
  });
  const r = f.scan();
  assert.equal(r.defectCount, 0);
  assert.equal(r.forwardLinks.length, 1);
});

test('the same target in Related and later factual prose retains each occurrence context', t => {
  const f = fixture(t, {
    'wiki/authored/a.md': note('## Related\n[[raw/clippings/missing.md]]\n## Evidence\n[[raw/clippings/missing.md]]', 'type: authored\nsources: []'),
  });
  const r = f.scan();
  assert.equal(r.issues[0].line, 8);
  assert.equal(r.forwardLinks[0].line, 6);
});

test('authored empty-source disclosure tolerates YAML comments', t => {
  const f = fixture(t, {
    'wiki/authored/a.md': note('This original authored document has substantive advice and deliberately has no external evidence counterpart.', 'type: authored\nsources: [] # original work'),
  });
  assert.equal(f.scan().defectCount, 0);
});
