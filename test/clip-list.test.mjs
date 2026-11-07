import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../scripts/clip.mjs';

// `--list <file>` clips each address in turn through the same per-URL work as a single clip. Fetching, extraction, the browser
// and the wait between requests are all injected: nothing here reaches the network.

const words = (n) => Array.from({ length: n }, (_, i) => `word${i % 50}`).join(' ');
const article = (title) => ({ title, contentMarkdown: `# ${title}\n\n${words(150)}` });
const NO_BROWSER = () => ({ ok: false, kind: 'failed', unavailable: true, reason: 'No browser' });
const NO_TWIN = () => ({ ok: false, reason: 'status 404' });

function setup(t, lines) {
  const root = mkdtempSync(join(tmpdir(), 'wm-clip-list-'));
  mkdirSync(join(root, 'raw', 'clippings'), { recursive: true });
  const prior = process.env.WIKI_MASTER_VAULT;
  process.env.WIKI_MASTER_VAULT = root;
  t.after(() => { if (prior === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = prior; rmSync(root, { recursive: true, force: true }); });
  const listFile = join(root, 'urls.txt');
  if (lines) writeFileSync(listFile, Array.isArray(lines) ? lines.join('\n') : lines);
  const state = (name) => { const f = join(root, '.wiki-master', name); return existsSync(f) ? readFileSync(f, 'utf8') : ''; };
  return {
    root, listFile,
    clippings: () => readdirSync(join(root, 'raw', 'clippings')),
    read: (name) => readFileSync(join(root, 'raw', 'clippings', name), 'utf8'),
    state,
  };
}

// Runs main with the given dependencies; returns what it returned, what it printed and the exit code it left.
function run(argv, deps = {}) {
  const out = [], err = [];
  const log = console.log, error = console.error, exit = process.exit, code = process.exitCode;
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => err.push(a.join(' '));
  process.exit = (c) => { throw new Error(`process.exit(${c})`); };
  process.exitCode = undefined;
  try {
    const sleeps = [];
    const result = main(argv, { fetchTwin: NO_TWIN, render: NO_BROWSER, sleep: (ms) => sleeps.push(ms), runtimeAvailable: () => true, ...deps });
    return { result, out, err, sleeps, exitCode: process.exitCode ?? 0 };
  } finally { console.log = log; console.error = error; process.exit = exit; process.exitCode = code; }
}

test('urls are clipped in order, one at a time, skipping blank lines and comments, with the other options applied to each', (t) => {
  const v = setup(t, ['# the research set', '', 'https://one.example.test/a', '   ', '  # another note', 'https://two.example.test/b  ', 'https://three.example.test/c']);
  const seen = [];
  const r = run(['--list', v.listFile, '--topic=Docs', '--quality=high'], { extract: (url) => { seen.push(url); return article(`Page ${seen.length}`); } });
  assert.deepEqual(seen, ['https://one.example.test/a', 'https://two.example.test/b', 'https://three.example.test/c']);
  assert.equal(r.exitCode, 0);
  assert.equal(v.clippings().length, 3);
  for (const name of v.clippings()) {
    assert.match(v.read(name), /^quality: high$/m);
    assert.match(v.read(name), /^topic: "Docs"$/m);
  }
  assert.ok(r.out.includes('list: 3 URLs: clipped 3'), r.out.join('\n'));
});

test('a second request to a host waits one second through sleep; other hosts and a pass that made no request do not', (t) => {
  const v = setup(t, ['https://a.example.test/1', 'https://b.example.test/1', 'https://a.example.test/2', 'https://a.example.test/1', 'https://a.example.test/3']);
  // The fourth address is the first again: a duplicate makes no request, so the wait before it already covered the fifth.
  const r = run(['--list', v.listFile], { extract: (url) => article(`Title of ${url}`) });
  assert.deepEqual(r.sleeps, [1000, 1000]);
  assert.ok(r.out.includes('list: 5 URLs: clipped 4, duplicate 1'), r.out.join('\n'));
});

test('a line that is not an http or https address is an error outcome and the run goes on; thin and failed outcomes still exit 0', (t) => {
  const v = setup(t, ['not a url', 'ftp://files.example.test/x', 'https://ok.example.test/good', 'https://thin.example.test/stub']);
  const r = run(['--list', v.listFile], { extract: (url) => (url.includes('stub') ? { title: 'Stub', contentMarkdown: 'Too short to keep.' } : article('Good page')) });
  assert.equal(r.exitCode, 0);
  assert.equal(v.clippings().length, 1);
  assert.ok(r.out.includes('list: 4 URLs: clipped 1, thin 1, error 2'), r.out.join('\n'));
  assert.match(r.err.join('\n'), /line 1: not an http or https address/);
  assert.match(r.err.join('\n'), /line 2: not an http or https address/);
});

// Each is refused in the list path before any URL is read: nothing is extracted, written, queued or declined.
const REFUSED = [
  ['a positional URL', ['https://one.example.test/a']],
  ['--from-file', ['--from-file', 'saved.html']],
  ['--from-file=', ['--from-file=saved.html']],
  ['--slug', ['--slug', 'name']],
  ['--slug=', ['--slug=name']],
  ['--decline=', ['--decline=no']],
  ['--override-decline', ['--override-decline']],
  ['--supersede-decline=', ['--supersede-decline=reason']],
];
for (const [name, extra] of REFUSED) {
  test(`--list with ${name} exits 2 and reads nothing`, (t) => {
    const v = setup(t, ['https://one.example.test/a']);
    const r = run(['--list', v.listFile, ...extra], { extract: () => assert.fail('nothing may be read') });
    assert.equal(r.exitCode, 2);
    assert.equal(r.result.status, 'error');
    assert.deepEqual(v.clippings(), []);
    assert.equal(v.state('triage.jsonl'), '');
    assert.equal(v.state('declined.json'), '');
  });
}

test('--list must be the first argument, and needs a file it can read', (t) => {
  const v = setup(t, ['https://one.example.test/a']);
  const refuse = (argv) => { const r = run(argv, { extract: () => assert.fail('nothing may be read') }); assert.equal(r.exitCode, 2, argv.join(' ')); assert.equal(r.result.status, 'error'); };
  refuse(['https://one.example.test/a', '--list', v.listFile]);
  refuse(['--list']);
  refuse(['--list', join(v.root, 'missing.txt')]);
  assert.deepEqual(v.clippings(), []);
});

test('a missing extraction runtime stops the run with exit 1, before the addresses after it', (t) => {
  const v = setup(t, ['https://one.example.test/a', 'https://two.example.test/b']);
  const seen = [];
  const r = run(['--list', v.listFile], { extract: (url) => { seen.push(url); throw new Error('no runtime'); }, runtimeAvailable: () => false });
  assert.equal(r.exitCode, 1);
  assert.deepEqual(seen, ['https://one.example.test/a']);
  assert.match(r.err.join('\n'), /HTML extraction runtime unavailable/);
  assert.deepEqual(v.clippings(), []);
});

test('--expand on a PDF or plain-text line is an error outcome and the run goes on', (t) => {
  const v = setup(t, ['https://docs.example.test/guide.pdf', 'https://docs.example.test/notes.txt', 'https://docs.example.test/page']);
  const rendered = [];
  const r = run(['--list', v.listFile, '--expand'], { render: (url, opts) => { rendered.push([url, opts]); return { ok: true, data: article('Tabbed page') }; } });
  assert.deepEqual(rendered, [['https://docs.example.test/page', { expand: true }]]);
  assert.equal(r.exitCode, 0);
  assert.ok(r.out.includes('list: 3 URLs: clipped 1, error 2'), r.out.join('\n'));
});

test('a line with a username or password is an error outcome that repeats it nowhere, and the run goes on', (t) => {
  const v = setup(t, ['https://reader:s3cretpw@docs.example.test/page', 'https://ok.example.test/good']);
  const r = run(['--list', v.listFile, '--topic=Docs'], { extract: () => article('Good page') });
  assert.equal(r.exitCode, 0);
  assert.equal(v.clippings().length, 1);
  assert.ok(r.out.includes('list: 2 URLs: clipped 1, error 1'), r.out.join('\n'));
  assert.match(r.err.join('\n'), /line 1: refused: the address carries a username or password/);
  const everything = [r.out, r.err, v.state('triage.jsonl'), v.state('declined.json'), v.clippings().map((n) => v.read(n))].flat().join('\n');
  assert.ok(!everything.includes('s3cretpw') && !everything.includes('reader:'), 'the credential was repeated');
});
