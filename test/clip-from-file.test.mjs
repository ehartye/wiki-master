import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { main } from '../scripts/clip.mjs';
import { CLIP_SPECS, checkClipArgs } from '../scripts/lib/clip-args.mjs';
import { MAX_PLAIN_BYTES, readSuppliedFile, suppliedKind } from '../scripts/lib/plain-text.mjs';
import { openIssues, loadIssueLog, recordIssue } from '../scripts/lib/triage.mjs';
import { recordDecline, loadDeclines, readDeclineLog } from '../scripts/lib/decline.mjs';
import { collectTriage } from '../scripts/triage.mjs';
import { scanIntegrity } from '../scripts/lib/integrity.mjs';

// `clip.mjs <url> --from-file <path>` records a page a person saved from a signed-in browser. The URL is the page's real
// address and nothing is fetched: every test here injects a fetch and an extractor that throw (or record) so a request
// would fail the test. Vaults and supplied files live in disposable directories; nothing touches the network or the real vault.

const URL_A = 'https://docs.example.test/guide/setup-guide';
const GATE_URL = 'https://sounds.example.org/people/someone/sounds/heavy-machine-gun';
const sentence = (s) => `${s} is described here in enough plain words that the page counts as real content. `;
const text = (s) => sentence(s).repeat(30);
// A login form long enough to clear the thin floor, none of the page title in it (the same shape test/interstitial.test.mjs uses).
const LOGIN_SHELL = `#### Log in to ExampleSound
Don't have an account? Join now #### Problems logging in? Enter your email or username below and we'll send you a link to help you login into your account. #### Almost there! We've sent a verification link by email. Didn't receive the email? Check your Spam folder, it may have been caught by a filter. If you still don't see it, you can resend the verification email. #### Default title In our website we only use our own technical cookies for allowing you to access and use the platform (necessary cookies). Click here for more information about the cookie policy. Sign up to join the community, or log in with your account to continue.`;
const sha = (s) => createHash('sha256').update(s).digest('hex');
const day = (d) => ({ today: () => d });
const field = (md, name) => (md.match(new RegExp(`^${name}: (.*)$`, 'm')) || [])[1];
const bodyOf = (md) => md.replace(/^---\n[\s\S]*?\n---\n\n/, '');

// Nothing may be fetched, and nothing may be extracted unless a test says it will be.
const NO_NETWORK = {
  fetchText: () => { throw new Error('fetchText must not be called: nothing is fetched'); },
  extract: () => { throw new Error('extract must not be called for supplied text'); },
};

function vault(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-fromfile-'));
  mkdirSync(join(root, 'raw', 'clippings'), { recursive: true });
  const supplied = mkdtempSync(join(tmpdir(), 'wm-supplied-'));
  const prior = process.env.WIKI_MASTER_VAULT;
  process.env.WIKI_MASTER_VAULT = root;
  t.after(() => {
    if (prior === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = prior;
    rmSync(root, { recursive: true, force: true });
    rmSync(supplied, { recursive: true, force: true });
  });
  const dir = join(root, 'raw', 'clippings');
  return {
    root, dir, supplied,
    // a file a person saved, outside the vault
    save: (name, content) => { const p = join(supplied, name); writeFileSync(p, content); return p; },
    files: () => readdirSync(dir).sort(),
    read: (name) => readFileSync(join(dir, name), 'utf8'),
    snapshot: () => Object.fromEntries(readdirSync(dir).sort().map((f) => [f, readFileSync(join(dir, f), 'utf8')])),
    issues: () => openIssues(loadIssueLog(root)),
  };
}

// Runs main with console output captured; returns the result, the printed lines and the exit code it set.
function run(argv, deps) {
  const lines = [];
  const log = console.log, err = console.error;
  console.log = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  const code = process.exitCode;
  process.exitCode = undefined;
  try { const result = main(argv, deps); return { result, lines, exitCode: process.exitCode }; }
  finally { console.log = log; console.error = err; process.exitCode = code; }
}
const fromFile = (url, path, extra = [], deps = NO_NETWORK) => run([url, '--from-file', path, ...extra], deps);
const page = (title, body) => () => ({ title, contentMarkdown: body });

// ---------------------------------------------------------------- the option is declared
test('--from-file is an option of clip.mjs only, with its value as the next argument or after =', () => {
  const spec = CLIP_SPECS['clip'];
  assert.deepEqual(checkClipArgs(['https://x.test/a', '--from-file', 'page.md'], spec), { ok: true });
  assert.deepEqual(checkClipArgs(['https://x.test/a', '--from-file=page.md'], spec), { ok: true });
  assert.deepEqual(checkClipArgs(['https://x.test/a', '--from-file', 'page.md', '--recapture'], spec), { ok: true });
  assert.match(checkClipArgs(['https://x.test/a', '--from-file'], spec).error, /--from-file needs a value/);
  assert.match(checkClipArgs(['https://x.test/a', '--from-file', '--recapture'], spec).error, /--from-file needs a value/);
  assert.match(checkClipArgs(['f.pdf', '--from-file', 'page.md'], CLIP_SPECS['clip-pdf']).error, /unknown option --from-file/);
  assert.ok(spec.usage.some((l) => l.includes('--from-file')));
});

// ---------------------------------------------------------------- the file rules
test('the extension picks the route: .md .markdown .txt are text, .html .htm are a page, anything else is neither', () => {
  for (const f of ['a.md', 'A.MD', 'a.markdown', 'a.txt', 'dir.v2/a.TXT']) assert.equal(suppliedKind(f), 'text', f);
  for (const f of ['a.html', 'a.htm', 'A.HTML']) assert.equal(suppliedKind(f), 'html', f);
  for (const f of ['a.pdf', 'a.docx', 'a', 'a.md.bak', 'a.json', 'a.rtf']) assert.equal(suppliedKind(f), null, f);
});

test('readSuppliedFile: the bytes, their hash, and the refusals', (t) => {
  const v = vault(t);
  const ok = readSuppliedFile(v.save('a.md', 'plain words\n'));
  assert.equal(ok.ok, true);
  assert.equal(ok.sha256, sha('plain words\n'));
  assert.equal(ok.text, 'plain words\n');
  assert.equal(readSuppliedFile(join(v.supplied, 'nope.md')).missing, true);
  assert.equal(readSuppliedFile(v.supplied).missing, true, 'a directory is not a file');
  assert.equal(readSuppliedFile(v.save('big.md', Buffer.alloc(MAX_PLAIN_BYTES + 1, 97))).refused, true);
  assert.equal(readSuppliedFile(v.save('edge.md', Buffer.alloc(MAX_PLAIN_BYTES, 97))).ok, true, 'exactly 1 MiB is allowed');
  assert.equal(readSuppliedFile(v.save('nul.md', Buffer.from([104, 105, 0, 104, 105]))).refused, true);
});

// ---------------------------------------------------------------- criterion 5
test('a .md file is the page text unchanged: source is the URL, extraction manual, supplied-sha256 the bytes, source-hash the stored text', (t) => {
  const v = vault(t);
  const content = `# Setup guide\n\n${text('The saved text')}\n`;
  const path = v.save('saved-from-signed-in-browser.md', content);
  const r = fromFile(URL_A, path, [], { ...NO_NETWORK, ...day('2026-10-29') });
  assert.equal(r.result.status, 'clipped', r.lines.join('\n'));
  assert.deepEqual(v.files(), ['Setup guide.md']);
  const md = v.read('Setup guide.md');
  assert.equal(field(md, 'source'), JSON.stringify(URL_A));
  assert.equal(field(md, 'extraction'), 'manual');
  assert.equal(field(md, 'supplied-sha256'), sha(content), 'the hash of the supplied bytes');
  assert.equal(field(md, 'source-hash'), sha(content.trimEnd()), 'the hash of the stored text');
  assert.equal(field(md, 'created'), '2026-10-29');
  assert.equal(field(md, 'title'), JSON.stringify('Setup guide'));
  assert.equal(field(md, 'recapture-of'), undefined);
  assert.equal(bodyOf(md), `${content.trimEnd()}\n`, 'the text is stored as supplied, not fenced and not rewritten');
  assert.ok(r.lines.includes('clipped: raw/clippings/Setup guide.md (quality=medium)'), r.lines.join('\n'));
  assert.deepEqual(v.issues(), []);
});

test('supplied-sha256 and source-hash are two different hashes when the stored text is not the file byte for byte', (t) => {
  const v = vault(t);
  const content = `${text('Windows line endings')}\r\n`;
  const r = fromFile(URL_A, v.save('page.txt', content), [], NO_NETWORK);
  assert.equal(r.result.status, 'clipped', r.lines.join('\n'));
  const md = v.read(`${r.result.slug}.md`);
  assert.equal(field(md, 'supplied-sha256'), sha(content));
  assert.equal(field(md, 'source-hash'), sha(content.trimEnd()));
  assert.notEqual(field(md, 'supplied-sha256'), field(md, 'source-hash'));
});

test('the supplied file\'s name and folder are not recorded anywhere in the clipping', (t) => {
  const v = vault(t);
  const path = v.save('private-download-3f9a.md', `# Setup guide\n\n${text('Saved')}`);
  const r = fromFile(URL_A, path, [], NO_NETWORK);
  assert.equal(r.result.status, 'clipped');
  const md = v.read(`${r.result.slug}.md`);
  assert.ok(!md.includes('private-download'), 'the file name is not in the clipping');
  assert.ok(!md.includes(v.supplied), 'the folder is not in the clipping');
  assert.ok(!r.lines.join('\n').includes('private-download'), 'nor in what is printed');
});

test('.markdown and .txt are text too; a .txt is not put in a fence; the extension is not case sensitive', (t) => {
  const v = vault(t);
  const body = text('Plain text page');
  const a = fromFile('https://docs.example.test/a/first-page', v.save('one.markdown', body), [], NO_NETWORK);
  const b = fromFile('https://docs.example.test/a/second-page', v.save('two.TXT', body + 'x'), [], NO_NETWORK);
  assert.equal(a.result.status, 'clipped', a.lines.join('\n'));
  assert.equal(b.result.status, 'clipped', b.lines.join('\n'));
  for (const r of [a, b]) {
    const md = v.read(`${r.result.slug}.md`);
    assert.equal(field(md, 'extraction'), 'manual');
    assert.ok(!bodyOf(md).startsWith('```'), 'the text is the page, not a code block');
  }
  assert.equal(bodyOf(v.read(`${b.result.slug}.md`)).trimEnd(), body + 'x');
});

test('the title of a text file is its first heading, else the last part of the URL', (t) => {
  const v = vault(t);
  const a = fromFile(URL_A, v.save('a.md', `${text('No heading')}`), [], NO_NETWORK);
  assert.equal(field(v.read(`${a.result.slug}.md`), 'title'), JSON.stringify('setup-guide'));
  const b = fromFile('https://docs.example.test/other', v.save('b.md', `## A named page\n\n${text('Heading')}`), [], NO_NETWORK);
  assert.equal(field(v.read(`${b.result.slug}.md`), 'title'), JSON.stringify('A named page'));
});

test('--from-file=<path> and --topic, --quality and --slug work with it', (t) => {
  const v = vault(t);
  const path = v.save('a.md', `# Setup guide\n\n${text('Saved')}`);
  const r = run([URL_A, `--from-file=${path}`, '--topic=build tools', '--quality=high', '--slug=setup-by-hand'], NO_NETWORK);
  assert.equal(r.result.status, 'clipped', r.lines.join('\n'));
  const md = v.read('setup-by-hand.md');
  assert.equal(field(md, 'topic'), JSON.stringify('build tools'));
  assert.equal(field(md, 'quality'), 'high');
  assert.equal(field(md, 'extraction'), 'manual');
});

// ---------------------------------------------------------------- criterion 6
test('a .html file goes through the extractor on the local file, with the URL as the page address; nothing is fetched', (t) => {
  const v = vault(t);
  const html = `<html><head><title>Setup guide</title></head><body><article>${text('The saved page')}</article></body></html>\n`;
  const path = v.save('saved.html', html);
  const calls = [];
  const extract = (source, options) => { calls.push({ source, options }); return { title: 'Setup guide', contentMarkdown: text('The extracted page'), author: 'A. Writer' }; };
  const r = fromFile(URL_A, path, [], { fetchText: NO_NETWORK.fetchText, extract });
  assert.equal(r.result.status, 'clipped', r.lines.join('\n'));
  assert.equal(calls.length, 1, 'the extractor ran once');
  assert.equal(readFileSync(calls[0].source, 'utf8'), html, 'on the supplied file, not on the URL');
  assert.notEqual(calls[0].source, URL_A);
  assert.equal(calls[0].options?.sourceUrl, URL_A, 'relative links resolve against the real address');
  const md = v.read('Setup guide.md');
  assert.equal(field(md, 'source'), JSON.stringify(URL_A));
  assert.equal(field(md, 'extraction'), 'manual');
  assert.equal(field(md, 'supplied-sha256'), sha(html), 'the hash of the HTML bytes');
  assert.equal(field(md, 'source-hash'), sha(text('The extracted page')), 'the hash of the extracted text');
  assert.equal(field(md, 'author'), JSON.stringify('A. Writer'));
});

test('.htm is a page too', (t) => {
  const v = vault(t);
  const r = fromFile(URL_A, v.save('saved.htm', '<html><body>x</body></html>'), [], { fetchText: NO_NETWORK.fetchText, extract: page('Setup guide', text('Extracted')) });
  assert.equal(r.result.status, 'clipped', r.lines.join('\n'));
  assert.equal(field(v.read('Setup guide.md'), 'extraction'), 'manual');
});

test('.md text is never given to the extractor', (t) => {
  const v = vault(t);
  let called = 0;
  const r = fromFile(URL_A, v.save('a.md', text('Plain')), [], { fetchText: NO_NETWORK.fetchText, extract: () => { called++; return { title: 'x', contentMarkdown: 'x' }; } });
  assert.equal(r.result.status, 'clipped');
  assert.equal(called, 0);
});

test('a supplied page the extractor cannot read is queued for attention; nothing is fetched or written', (t) => {
  const v = vault(t);
  const r = fromFile(URL_A, v.save('saved.html', '<html></html>'), [], NO_NETWORK);
  assert.equal(r.result.status, 'failed');
  assert.deepEqual(v.files(), []);
  const rows = v.issues();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'attention');
  assert.equal(rows[0].url, URL_A);
  assert.match(rows[0].reason, /supplied/);
  assert.ok(!r.lines.some((l) => /render|browser/i.test(l)), 'no browser fallback was tried');
});

test('without --recapture a URL already clipped is a duplicate; the file is not even read for text', (t) => {
  const v = vault(t);
  fromFile(URL_A, v.save('a.md', text('First')), [], NO_NETWORK);
  const before = v.snapshot();
  const r = fromFile(URL_A, v.save('b.md', text('Second')), [], NO_NETWORK);
  assert.equal(r.result.status, 'duplicate');
  assert.deepEqual(r.lines, [`duplicate (already clipped): ${URL_A}`]);
  assert.deepEqual(v.snapshot(), before);
});

test('with --recapture a supplied file is written as a dated recapture; the first clipping is byte-identical', (t) => {
  const v = vault(t);
  const first = run([URL_A], { extract: page('Setup guide', text('Fetched text')), ...day('2026-10-01') });
  assert.equal(first.result.status, 'clipped');
  const firstBytes = v.read('Setup guide.md');
  const content = `# Setup guide\n\n${text('Text saved from a signed-in browser')}`;
  const r = fromFile(URL_A, v.save('a.md', content), ['--recapture'], { ...NO_NETWORK, ...day('2026-10-29') });
  assert.equal(r.result.status, 'clipped', r.lines.join('\n'));
  assert.deepEqual(v.files(), ['Setup guide (recaptured 2026-10-29).md', 'Setup guide.md']);
  const second = v.read('Setup guide (recaptured 2026-10-29).md');
  assert.equal(field(second, 'recapture-of'), JSON.stringify('raw/clippings/Setup guide.md'));
  assert.equal(field(second, 'title'), JSON.stringify('Setup guide (recaptured 2026-10-29)'));
  assert.equal(field(second, 'extraction'), 'manual');
  assert.equal(field(second, 'supplied-sha256'), sha(content));
  assert.equal(field(second, 'source-hash'), sha(content.trimEnd()));
  assert.equal(v.read('Setup guide.md'), firstBytes, 'the older clipping is never edited');
});

test('with --recapture a supplied file whose text is already a capture of the URL writes nothing', (t) => {
  const v = vault(t);
  const content = `# Setup guide\n\n${text('Same text')}`;
  fromFile(URL_A, v.save('a.md', content), [], NO_NETWORK);
  const before = v.snapshot();
  const r = fromFile(URL_A, v.save('b.md', content), ['--recapture'], { ...NO_NETWORK, ...day('2026-10-29') });
  assert.equal(r.result.status, 'unchanged');
  assert.deepEqual(r.lines, ['unchanged (same text as raw/clippings/Setup guide.md); nothing written']);
  assert.deepEqual(v.snapshot(), before);
});

test('with --recapture a URL not yet clipped is clipped normally from the file', (t) => {
  const v = vault(t);
  const r = fromFile(URL_A, v.save('a.md', `# Setup guide\n\n${text('First')}`), ['--recapture'], NO_NETWORK);
  assert.equal(r.result.status, 'clipped');
  assert.deepEqual(v.files(), ['Setup guide.md']);
  assert.equal(field(v.read('Setup guide.md'), 'recapture-of'), undefined);
});

// ---------------------------------------------------------------- criterion 7: the checks a supplied file still passes
test('a login form supplied as text is not written; a wrong-node row is queued; there is no decline and no override', (t) => {
  const v = vault(t);
  const r = fromFile(GATE_URL, v.save('login.md', LOGIN_SHELL), [], { ...NO_NETWORK, writeClipping: () => assert.fail('nothing may be written') });
  assert.equal(r.result.status, 'thin');
  assert.match(r.result.reason, /login|consent|age-gate/);
  assert.deepEqual(v.files(), []);
  const rows = v.issues();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'wrong-node');
  assert.equal(rows[0].url, GATE_URL);
  assert.deepEqual(loadDeclines(v.root), [], 'a wall is not a verdict on the source');
  assert.ok(r.lines.some((l) => /supplied/.test(l) && l.includes(GATE_URL)), r.lines.join('\n'));
  // no flag lifts the gate check: the same file with every override is still refused
  const again = fromFile(GATE_URL, v.save('login2.md', LOGIN_SHELL), ['--override-decline'], NO_NETWORK);
  assert.equal(again.result.status, 'thin');
  assert.deepEqual(v.files(), []);
});

test('a login form supplied as a .html page is not written either', (t) => {
  const v = vault(t);
  const seen = [];
  const extract = (source) => { seen.push(source); return { title: 'Heavy Machine Gun by Someone', contentMarkdown: LOGIN_SHELL }; };
  const r = fromFile(GATE_URL, v.save('login.html', '<html><body>login</body></html>'), [], { fetchText: NO_NETWORK.fetchText, extract });
  assert.equal(seen.length, 1, 'the extractor read the supplied page');
  assert.equal(r.result.status, 'thin');
  assert.deepEqual(v.files(), []);
  assert.equal(v.issues()[0]?.kind, 'wrong-node');
});

test('a file under 100 words is refused as thin: not written, a thin row, no decline', (t) => {
  const v = vault(t);
  const r = fromFile(URL_A, v.save('short.md', 'A short note that is nowhere near a whole page.'), [], { ...NO_NETWORK, writeClipping: () => assert.fail('nothing may be written') });
  assert.equal(r.result.status, 'thin');
  assert.deepEqual(v.files(), []);
  const rows = v.issues();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'thin');
  assert.equal(rows[0].url, URL_A);
  assert.match(rows[0].reason, /100/);
  assert.deepEqual(loadDeclines(v.root), [], 'the person supplied this file; it is not declined');
  assert.ok(r.lines.some((l) => /thin/.test(l) && l.includes(URL_A)), r.lines.join('\n'));
});

test('99 words is thin and 100 words is a page', (t) => {
  const v = vault(t);
  const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
  assert.equal(fromFile(URL_A, v.save('n99.md', words(99)), [], NO_NETWORK).result.status, 'thin');
  assert.equal(fromFile(URL_A, v.save('n100.md', words(100)), [], NO_NETWORK).result.status, 'clipped');
});

test('a binary file (a NUL byte) is refused and queued as attention; nothing is written', (t) => {
  const v = vault(t);
  const bytes = Buffer.concat([Buffer.from(text('Looks like text')), Buffer.from([0, 1, 2, 0]), Buffer.from(text('more'))]);
  const r = fromFile(URL_A, v.save('model.md', bytes), [], { ...NO_NETWORK, writeClipping: () => assert.fail('nothing may be written') });
  assert.equal(r.result.status, 'thin');
  assert.deepEqual(v.files(), []);
  const rows = v.issues();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'attention');
  assert.equal(rows[0].url, URL_A);
  assert.match(rows[0].reason, /binary/);
  assert.deepEqual(loadDeclines(v.root), []);
});

test('a file that is not decodable text is refused and queued as attention', (t) => {
  const v = vault(t);
  const r = fromFile(URL_A, v.save('bytes.txt', Buffer.alloc(4000, 0xff)), [], NO_NETWORK);
  assert.equal(r.result.status, 'thin');
  assert.deepEqual(v.files(), []);
  assert.equal(v.issues()[0]?.kind, 'attention');
  assert.match(v.issues()[0].reason, /binary/);
});

test('a file over 1 MiB is refused and queued as attention; nothing is written', (t) => {
  const v = vault(t);
  const r = fromFile(URL_A, v.save('big.md', Buffer.alloc(MAX_PLAIN_BYTES + 1, 97)), [], NO_NETWORK);
  assert.equal(r.result.status, 'thin');
  assert.deepEqual(v.files(), []);
  const rows = v.issues();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'attention');
  assert.match(rows[0].reason, /larger|1 MiB|size/i);
});

test('a missing file exits 2 with a message; nothing is queued or written', (t) => {
  const v = vault(t);
  const r = fromFile(URL_A, join(v.supplied, 'not-there.md'), [], NO_NETWORK);
  assert.equal(r.exitCode, 2);
  assert.equal(r.result.status, 'error');
  assert.ok(r.lines.some((l) => /not-there\.md/.test(l) && /(no such|not found|does not exist|cannot)/i.test(l)), r.lines.join('\n'));
  assert.deepEqual(v.files(), []);
  assert.deepEqual(v.issues(), []);
});

test('a missing file exits 2 even when the URL is already clipped', (t) => {
  const v = vault(t);
  fromFile(URL_A, v.save('a.md', text('First')), [], NO_NETWORK);
  const r = fromFile(URL_A, join(v.supplied, 'not-there.md'), [], NO_NETWORK);
  assert.equal(r.exitCode, 2);
  assert.equal(r.result.status, 'error');
});

test('a folder, an empty path and an extension that is neither text nor a page exit 2', (t) => {
  const v = vault(t);
  for (const path of [v.supplied, '', v.save('paper.pdf', '%PDF-1.4 words'), v.save('notes.docx', 'x'), v.save('noext', 'x')]) {
    const r = fromFile(URL_A, path, [], NO_NETWORK);
    assert.equal(r.exitCode, 2, `exit code for "${path}"`);
    assert.equal(r.result.status, 'error');
  }
  assert.deepEqual(v.files(), []);
  assert.deepEqual(v.issues(), []);
});

test('a bare --from-file with no value exits 2', (t) => {
  const v = vault(t);
  const r = run([URL_A, '--from-file'], NO_NETWORK);
  assert.equal(r.exitCode, 2);
  assert.deepEqual(v.files(), []);
});

// ---------------------------------------------------------------- the decline gate
test('a URL with an active decline prints declined and writes nothing', (t) => {
  const v = vault(t);
  recordDecline(v.root, URL_A, 'not wanted');
  const r = fromFile(URL_A, v.save('a.md', text('Saved')), [], NO_NETWORK);
  assert.equal(r.result.status, 'declined');
  assert.ok(r.lines.some((l) => l.startsWith('declined previously')), r.lines.join('\n'));
  assert.deepEqual(v.files(), []);
});

test('--supersede-decline="r" clips the supplied file and supersedes the decline', (t) => {
  const v = vault(t);
  recordDecline(v.root, URL_A, 'not wanted');
  const r = fromFile(URL_A, v.save('a.md', `# Setup guide\n\n${text('Saved')}`), ['--supersede-decline=now saved by hand'], NO_NETWORK);
  assert.equal(r.result.status, 'clipped', r.lines.join('\n'));
  assert.deepEqual(v.files(), ['Setup guide.md']);
  const entry = readDeclineLog(v.root).find((e) => e.url === URL_A);
  assert.equal(entry.superseded.reason, 'now saved by hand');
  assert.deepEqual(loadDeclines(v.root), []);
});

test('--override-decline lifts an automatic decline once the supplied file is written, and a deliberate one is not lifted', (t) => {
  const v = vault(t);
  recordDecline(v.root, URL_A, 'thin content (SPA/paywall shell)');
  const ok = fromFile(URL_A, v.save('a.md', `# Setup guide\n\n${text('Saved')}`), ['--override-decline'], NO_NETWORK);
  assert.equal(ok.result.status, 'clipped', ok.lines.join('\n'));
  assert.deepEqual(loadDeclines(v.root), []);
  const B = 'https://docs.example.test/guide/other-page';
  recordDecline(v.root, B, 'not wanted');
  const no = fromFile(B, v.save('b.md', text('Other')), ['--override-decline'], NO_NETWORK);
  assert.equal(no.result.status, 'declined');
  assert.equal(v.files().length, 1);
});

test('a refused supplied file leaves the decline in place', (t) => {
  const v = vault(t);
  recordDecline(v.root, URL_A, 'not wanted');
  const r = fromFile(URL_A, v.save('short.md', 'too short'), ['--supersede-decline=because'], NO_NETWORK);
  assert.equal(r.result.status, 'thin');
  assert.equal(loadDeclines(v.root).length, 1);
});

// ---------------------------------------------------------------- the triage rows a capture settles
test('a wrong-node row for the URL is closed when a manual capture lands', (t) => {
  const v = vault(t);
  const first = run([GATE_URL], { extract: page('Heavy Machine Gun by Someone', LOGIN_SHELL), fetchText: NO_NETWORK.fetchText });
  assert.equal(first.result.status, 'thin');
  assert.equal(v.issues().length, 1);
  const r = fromFile(GATE_URL, v.save('real.md', `# Heavy Machine Gun\n\n${text('The saved page')}`), [], NO_NETWORK);
  assert.equal(r.result.status, 'clipped', r.lines.join('\n'));
  assert.deepEqual(v.issues(), [], 'the row described a source that is now on disk');
});

test('an unrelated row for another URL stays open', (t) => {
  const v = vault(t);
  recordIssue(v.root, { url: 'https://other.example.test/x', kind: 'wrong-node', reason: 'r' });
  fromFile(URL_A, v.save('a.md', text('Saved')), [], NO_NETWORK);
  assert.equal(v.issues().length, 1);
});

// ---------------------------------------------------------------- criterion 8
test('triage and health raise no row and no defect for a clipping with extraction: manual', (t) => {
  const v = vault(t);
  const a = fromFile(URL_A, v.save('a.md', `# Setup guide\n\n${text('Saved text')}`), [], NO_NETWORK);
  const b = fromFile('https://docs.example.test/guide/page-two', v.save('b.html', '<html></html>'), [], { fetchText: NO_NETWORK.fetchText, extract: page('Page two', text('Saved page')) });
  assert.equal(a.result.status, 'clipped');
  assert.equal(b.result.status, 'clipped');
  for (const slug of [a.result.slug, b.result.slug]) assert.equal(field(v.read(`${slug}.md`), 'extraction'), 'manual');
  const triage = collectTriage(v.root);
  assert.deepEqual(triage.clipFailures, []);
  assert.deepEqual(triage.attention, []);
  assert.deepEqual(triage.fidelity, []);
  assert.deepEqual(triage.expiring, []);
  // the only thing triage says about them is that they are waiting to be ingested, as for any clipping
  assert.equal(triage.backlogTotal, 2);
  const health = scanIntegrity(v.root);
  assert.equal(health.defectCount, 0, JSON.stringify(health.issues));
  assert.deepEqual(health.issues, []);
});

test('a URL that looks like a text file is not fetched for its bytes when a file is supplied', (t) => {
  const v = vault(t);
  const r = fromFile('https://docs.example.test/dist/SHASUMS256.txt', v.save('sums.txt', text('Checksums')), [], NO_NETWORK);
  assert.equal(r.result.status, 'clipped', r.lines.join('\n'));
  assert.equal(field(v.read(`${r.result.slug}.md`), 'extraction'), 'manual', 'manual, not plaintext');
  assert.ok(!bodyOf(v.read(`${r.result.slug}.md`)).startsWith('```'));
});
