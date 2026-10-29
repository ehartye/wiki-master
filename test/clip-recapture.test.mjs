import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { main, knownSourceUrls } from '../scripts/clip.mjs';
import { knownUrlIndex, clippingsForUrl, newestCapture } from '../scripts/lib/known-urls.mjs';
import { CLIP_SPECS, checkClipArgs } from '../scripts/lib/clip-args.mjs';
import { openIssues, loadIssueLog } from '../scripts/lib/triage.mjs';
import { recordDecline } from '../scripts/lib/decline.mjs';

// `clip.mjs <url> --recapture` writes a dated second capture of a page that is already clipped, beside the old one, and
// never edits the old one. Without the flag a second clip of the same URL is still `duplicate`. Everything is injected:
// the extractor, the date, the vault; nothing touches the network or the real vault.

const URL_A = 'https://docs.example.test/guide/setup';
const sentence = (s) => `${s} is described here in enough plain words that the page counts as real content. `;
const text = (s) => sentence(s).repeat(30);
// A login form long enough to clear the thin floor, none of the page title in it (the same shape test/interstitial.test.mjs uses).
const LOGIN_SHELL = `#### Log in to ExampleSound
Don't have an account? Join now #### Problems logging in? Enter your email or username below and we'll send you a link to help you login into your account. #### Almost there! We've sent a verification link by email. Didn't receive the email? Check your Spam folder, it may have been caught by a filter. If you still don't see it, you can resend the verification email. #### Default title In our website we only use our own technical cookies for allowing you to access and use the platform (necessary cookies). Click here for more information about the cookie policy. Sign up to join the community, or log in with your account to continue.`;
const page = (title, body) => () => ({ title, contentMarkdown: body });
const sha = (s) => createHash('sha256').update(s).digest('hex');
const day = (d) => ({ today: () => d });

function vault(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-recap-'));
  mkdirSync(join(root, 'raw', 'clippings'), { recursive: true });
  const prior = process.env.WIKI_MASTER_VAULT;
  process.env.WIKI_MASTER_VAULT = root;
  t.after(() => { if (prior === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = prior; rmSync(root, { recursive: true, force: true }); });
  const dir = join(root, 'raw', 'clippings');
  return {
    root, dir,
    files: () => readdirSync(dir).sort(),
    read: (name) => readFileSync(join(dir, name), 'utf8'),
    snapshot: () => Object.fromEntries(readdirSync(dir).sort().map((f) => [f, readFileSync(join(dir, f), 'utf8')])),
    issues: () => openIssues(loadIssueLog(root)),
  };
}
const field = (md, name) => (md.match(new RegExp(`^${name}: (.*)$`, 'm')) || [])[1];

// Runs main with console output captured; returns the result and the printed lines.
function run(argv, deps) {
  const lines = [];
  const log = console.log, err = console.error;
  console.log = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  const code = process.exitCode;
  try { const result = main(argv, deps); return { result, lines, exitCode: process.exitCode }; }
  finally { console.log = log; console.error = err; process.exitCode = code; }
}
const clip = (url, extract, extra = [], deps = {}) => run([url, ...extra], { extract, ...deps });

// ---------------------------------------------------------------- criterion 1
test('without --recapture a second clip of a clipped URL is a duplicate and writes nothing', (t) => {
  const v = vault(t);
  const first = clip(URL_A, page('Setup guide', text('The first text')), [], day('2026-10-01'));
  assert.equal(first.result.status, 'clipped');
  assert.deepEqual(v.files(), ['Setup guide.md']);
  const before = v.snapshot();
  const second = clip(URL_A, page('Setup guide', text('A different text')), [], day('2026-10-29'));
  assert.equal(second.result.status, 'duplicate');
  assert.deepEqual(second.lines, [`duplicate (already clipped): ${URL_A}`]);
  assert.deepEqual(v.snapshot(), before);
});

test('a recapture already in the vault does not make a plain second clip anything but a duplicate', (t) => {
  const v = vault(t);
  clip(URL_A, page('Setup guide', text('One')), [], day('2026-10-01'));
  clip(URL_A, page('Setup guide', text('Two')), ['--recapture'], day('2026-10-02'));
  const before = v.snapshot();
  const again = clip(URL_A, page('Setup guide', text('Three')), [], day('2026-10-03'));
  assert.equal(again.result.status, 'duplicate');
  assert.deepEqual(v.snapshot(), before);
});

// ---------------------------------------------------------------- criterion 2
test('--recapture with different text writes a dated second file linked to the first; the first is byte-identical', (t) => {
  const v = vault(t);
  clip(URL_A, page('Setup guide', text('The first text')), [], day('2026-10-01'));
  const firstBytes = v.read('Setup guide.md');
  const r = clip(URL_A, page('Setup guide', text('A different text')), ['--recapture'], day('2026-10-29'));
  assert.equal(r.result.status, 'clipped');
  assert.deepEqual(v.files(), ['Setup guide (recaptured 2026-10-29).md', 'Setup guide.md']);
  assert.equal(r.result.slug, 'Setup guide (recaptured 2026-10-29)');
  assert.ok(r.lines.includes('clipped: raw/clippings/Setup guide (recaptured 2026-10-29).md (quality=medium)'), r.lines.join('\n'));
  const second = v.read('Setup guide (recaptured 2026-10-29).md');
  assert.equal(field(second, 'source'), JSON.stringify(URL_A));
  assert.equal(field(second, 'title'), JSON.stringify('Setup guide (recaptured 2026-10-29)'));
  assert.equal(field(second, 'created'), '2026-10-29');
  assert.equal(field(second, 'recapture-of'), JSON.stringify('raw/clippings/Setup guide.md'));
  assert.notEqual(field(second, 'source-hash'), field(v.read('Setup guide.md'), 'source-hash'));
  assert.equal(field(second, 'source-hash'), sha(text('A different text')));
  assert.equal(v.read('Setup guide.md'), firstBytes, 'the older clipping is never edited');
  assert.deepEqual(v.issues(), []);
});

test('a clipping that is not a recapture has no recapture-of line', (t) => {
  const v = vault(t);
  clip(URL_A, page('Setup guide', text('The first text')), [], day('2026-10-01'));
  assert.equal(field(v.read('Setup guide.md'), 'recapture-of'), undefined);
});

test('recapture-of names the newest existing capture, so a chain reads in order; the dates are in the names', (t) => {
  const v = vault(t);
  clip(URL_A, page('Setup guide', text('One')), [], day('2026-10-01'));
  clip(URL_A, page('Setup guide', text('Two')), ['--recapture'], day('2026-10-10'));
  const snap = v.snapshot();
  const r = clip(URL_A, page('Setup guide', text('Three')), ['--recapture'], day('2026-10-20'));
  assert.equal(r.result.status, 'clipped');
  assert.deepEqual(v.files(), ['Setup guide (recaptured 2026-10-10).md', 'Setup guide (recaptured 2026-10-20).md', 'Setup guide.md']);
  const third = v.read('Setup guide (recaptured 2026-10-20).md');
  assert.equal(field(third, 'recapture-of'), JSON.stringify('raw/clippings/Setup guide (recaptured 2026-10-10).md'));
  for (const [name, bytes] of Object.entries(snap)) assert.equal(v.read(name), bytes, `${name} untouched`);
});

test('the newest capture is the one with the latest created date, whatever the order of the file names', (t) => {
  const v = vault(t);
  writeFileSync(join(v.dir, 'Zed.md'), `---\ntitle: "Zed"\nsource: ${JSON.stringify(URL_A)}\ncreated: 2026-01-01\nsource-hash: aaa\n---\nold\n`);
  writeFileSync(join(v.dir, 'Alpha (recaptured 2026-02-02).md'), `---\ntitle: "Alpha"\nsource: ${JSON.stringify(URL_A)}\ncreated: 2026-02-02\nsource-hash: bbb\nrecapture-of: "raw/clippings/Zed.md"\n---\nnew\n`);
  const r = clip(URL_A, page('Setup guide', text('Fresh')), ['--recapture'], day('2026-03-03'));
  assert.equal(r.result.status, 'clipped');
  assert.equal(field(v.read(`${r.result.slug}.md`), 'recapture-of'), JSON.stringify('raw/clippings/Alpha (recaptured 2026-02-02).md'));
});

test('the recapture name is the first capture\'s own name and the suffix, even when that name was a later candidate or the page title has changed', (t) => {
  const v = vault(t);
  writeFileSync(join(v.dir, 'Setup guide.md'), `---\ntitle: "Setup guide"\nsource: "https://other.test/x"\ncreated: 2026-01-01\n---\nother document\n`);
  const first = clip(URL_A, page('Setup guide', text('One')), [], day('2026-10-01'));
  assert.equal(first.result.status, 'clipped');
  assert.notEqual(first.result.slug, 'Setup guide');
  const r = clip(URL_A, page('Setup guide, revised', text('Two')), ['--recapture'], day('2026-10-02'));
  assert.equal(r.result.status, 'clipped');
  assert.equal(r.result.slug, `${first.result.slug} (recaptured 2026-10-02)`);
  assert.equal(field(v.read(`${r.result.slug}.md`), 'title'), JSON.stringify('Setup guide, revised (recaptured 2026-10-02)'));
  assert.equal(field(v.read(`${r.result.slug}.md`), 'recapture-of'), JSON.stringify(`raw/clippings/${first.result.slug}.md`));
});

test('a recapture whose name another document holds moves on to the next candidate; that document is left alone', (t) => {
  const v = vault(t);
  clip(URL_A, page('Setup guide', text('One')), [], day('2026-10-01'));
  writeFileSync(join(v.dir, 'Setup guide (recaptured 2026-10-02).md'), `---\ntitle: "Not a capture"\nsource: "https://other.test/y"\ncreated: 2026-10-02\n---\nother document\n`);
  const other = v.read('Setup guide (recaptured 2026-10-02).md');
  const r = clip(URL_A, page('Setup guide', text('Two')), ['--recapture'], day('2026-10-02'));
  assert.equal(r.result.status, 'clipped');
  assert.notEqual(r.result.slug, 'Setup guide (recaptured 2026-10-02)');
  assert.match(r.result.slug, / \(recaptured 2026-10-02\)$/);
  assert.equal(v.read('Setup guide (recaptured 2026-10-02).md'), other);
});

test('the recapture title takes the suffix and stays unique when another page has the same title', (t) => {
  const v = vault(t);
  const B = 'https://docs.example.test/guide/other';
  clip(URL_A, page('Setup guide', text('One')), [], day('2026-10-01'));
  clip(B, page('Setup guide', text('Uno')), [], day('2026-10-01'));
  const a = clip(URL_A, page('Setup guide', text('Two')), ['--recapture'], day('2026-10-02'));
  const b = clip(B, page('Setup guide', text('Dos')), ['--recapture'], day('2026-10-02'));
  assert.equal(a.result.status, 'clipped');
  assert.equal(b.result.status, 'clipped');
  const titleA = JSON.parse(field(v.read(`${a.result.slug}.md`), 'title'));
  const titleB = JSON.parse(field(v.read(`${b.result.slug}.md`), 'title'));
  assert.match(titleA, /^Setup guide \(recaptured 2026-10-02\)$/);
  assert.match(titleB, / \(recaptured 2026-10-02\)/);
  assert.notEqual(titleA.toLowerCase(), titleB.toLowerCase());
});

// ---------------------------------------------------------------- criterion 3
test('--recapture with the same text writes nothing and says which clipping holds it; exit code unchanged', (t) => {
  const v = vault(t);
  clip(URL_A, page('Setup guide', text('The first text')), [], day('2026-10-01'));
  const before = v.snapshot();
  const r = clip(URL_A, page('Setup guide', text('The first text')), ['--recapture'], day('2026-10-29'));
  assert.equal(r.result.status, 'unchanged');
  assert.deepEqual(r.lines, ['unchanged (same text as raw/clippings/Setup guide.md); nothing written']);
  assert.ok(r.exitCode === undefined || r.exitCode === 0);
  assert.deepEqual(v.snapshot(), before);
  assert.deepEqual(v.issues(), []);
});

test('text identical to ANY existing capture of the URL is unchanged, not only the newest', (t) => {
  const v = vault(t);
  clip(URL_A, page('Setup guide', text('Old text')), [], day('2026-10-01'));
  clip(URL_A, page('Setup guide', text('New text')), ['--recapture'], day('2026-10-02'));
  const before = v.snapshot();
  const r = clip(URL_A, page('Setup guide', text('Old text')), ['--recapture'], day('2026-10-03'));
  assert.equal(r.result.status, 'unchanged');
  assert.deepEqual(r.lines, ['unchanged (same text as raw/clippings/Setup guide.md); nothing written']);
  assert.deepEqual(v.snapshot(), before);
});

test('--recapture on a URL not yet clipped clips it normally and says so', (t) => {
  const v = vault(t);
  const r = clip(URL_A, page('Setup guide', text('The first text')), ['--recapture'], day('2026-10-29'));
  assert.equal(r.result.status, 'clipped');
  assert.deepEqual(v.files(), ['Setup guide.md'], 'an ordinary first clip: no suffix');
  assert.equal(field(v.read('Setup guide.md'), 'recapture-of'), undefined);
  assert.equal(field(v.read('Setup guide.md'), 'title'), JSON.stringify('Setup guide'));
  assert.ok(r.lines.some((l) => /not clipped yet/.test(l) && l.includes(URL_A)), r.lines.join('\n'));
  assert.ok(r.lines.includes('clipped: raw/clippings/Setup guide.md (quality=medium)'));
});

test('a second recapture the same day with different text is a clash: nothing written, one attention row', (t) => {
  const v = vault(t);
  clip(URL_A, page('Setup guide', text('One')), [], day('2026-10-01'));
  clip(URL_A, page('Setup guide', text('Two')), ['--recapture'], day('2026-10-29'));
  const before = v.snapshot();
  const r = clip(URL_A, page('Setup guide', text('Three')), ['--recapture'], day('2026-10-29'));
  assert.equal(r.result.status, 'clash');
  assert.equal(r.result.existing, 'Setup guide (recaptured 2026-10-29)');
  assert.ok(r.lines.some((l) => l.startsWith('clash:')), r.lines.join('\n'));
  assert.deepEqual(v.snapshot(), before);
  const rows = v.issues();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'attention');
  assert.equal(rows[0].url, URL_A);
  assert.match(rows[0].reason, /raw\/clippings\/Setup guide \(recaptured 2026-10-29\)\.md already exists/);
});

test('a same-day second recapture with the same text as the first recapture is unchanged, not a clash', (t) => {
  const v = vault(t);
  clip(URL_A, page('Setup guide', text('One')), [], day('2026-10-01'));
  clip(URL_A, page('Setup guide', text('Two')), ['--recapture'], day('2026-10-29'));
  const r = clip(URL_A, page('Setup guide', text('Two')), ['--recapture'], day('2026-10-29'));
  assert.equal(r.result.status, 'unchanged');
  assert.deepEqual(r.lines, ['unchanged (same text as raw/clippings/Setup guide (recaptured 2026-10-29).md); nothing written']);
});

// ---------------------------------------------------------------- the checks a recapture still passes
test('a recapture still runs the thin check: a short page is not written and the clipping stays alone', (t) => {
  const v = vault(t);
  clip(URL_A, page('Setup guide', text('One')), [], day('2026-10-01'));
  const before = v.snapshot();
  const r = clip(URL_A, page('Setup guide', 'Too short to be a page.'), ['--recapture'], { ...day('2026-10-29'), writeClipping: () => assert.fail('nothing may be written') });
  assert.equal(r.result.status, 'thin');
  assert.deepEqual(v.snapshot(), before);
});

test('a recapture still runs the gate check: a login form is not written', (t) => {
  const v = vault(t);
  clip(URL_A, page('Setup guide', text('One')), [], day('2026-10-01'));
  const before = v.snapshot();
  const login = LOGIN_SHELL;
  const r = clip(URL_A, page('Setup guide', login), ['--recapture'], day('2026-10-29'));
  assert.equal(r.result.status, 'thin');
  assert.deepEqual(v.snapshot(), before);
  assert.equal(v.issues()[0]?.kind, 'wrong-node');
});

test('a recapture of a declined URL is declined like any clip', (t) => {
  const v = vault(t);
  clip(URL_A, page('Setup guide', text('One')), [], day('2026-10-01'));
  recordDecline(v.root, URL_A, 'not wanted');
  const before = v.snapshot();
  const r = clip(URL_A, page('Setup guide', text('Two')), ['--recapture'], day('2026-10-29'));
  assert.equal(r.result.status, 'declined');
  assert.deepEqual(v.snapshot(), before);
});

test('--slug on a recapture is the exact name given', (t) => {
  const v = vault(t);
  clip(URL_A, page('Setup guide', text('One')), [], day('2026-10-01'));
  const r = clip(URL_A, page('Setup guide', text('Two')), ['--recapture', '--slug=setup-guide-v2'], day('2026-10-29'));
  assert.equal(r.result.status, 'clipped');
  assert.ok(v.files().includes('setup-guide-v2.md'));
  assert.equal(field(v.read('setup-guide-v2.md'), 'recapture-of'), JSON.stringify('raw/clippings/Setup guide.md'));
});

test('a lost write race that leaves a clipping of the same text is unchanged, not a second capture', (t) => {
  const v = vault(t);
  clip(URL_A, page('Setup guide', text('One')), [], day('2026-10-01'));
  const body = text('Two');
  const winner = (dir, slug) => {
    writeFileSync(join(dir, `${slug}.md`), `---\ntitle: "x"\nsource: ${JSON.stringify(URL_A)}\ncreated: 2026-10-29\nsource-hash: ${sha(body)}\nrecapture-of: "raw/clippings/Setup guide.md"\n---\nwinner\n`);
    return false;
  };
  const r = clip(URL_A, page('Setup guide', body), ['--recapture'], { ...day('2026-10-29'), writeClipping: winner });
  assert.equal(r.result.status, 'unchanged');
  assert.deepEqual(v.files(), ['Setup guide (recaptured 2026-10-29).md', 'Setup guide.md']);
});

// ---------------------------------------------------------------- the shared known-URL reading
test('knownUrlIndex groups clippings by normalized URL with file, created, source-hash and recapture-of', (t) => {
  const v = vault(t);
  writeFileSync(join(v.dir, 'One.md'), `---\ntitle: "One"\nsource: "https://Docs.Example.test/a/?utm_source=x"\ncreated: 2026-01-01\nsource-hash: h1\n---\nbody\n`);
  writeFileSync(join(v.dir, 'One (recaptured 2026-02-02).md'), `---\ntitle: "One (recaptured 2026-02-02)"\nsource: https://docs.example.test/a\ncreated: 2026-02-02\nsource-hash: h2\nrecapture-of: "raw/clippings/One.md"\n---\nbody\n`);
  writeFileSync(join(v.dir, 'Two.md'), `---\ntitle: "Two"\nsource: "https://docs.example.test/b"\n---\nbody\n`);
  writeFileSync(join(v.dir, 'notes.txt'), 'source: "https://docs.example.test/ignored"\n');
  const index = knownUrlIndex(v.root);
  assert.deepEqual([...index.keys()].sort(), ['https://docs.example.test/a', 'https://docs.example.test/b']);
  const a = index.get('https://docs.example.test/a');
  assert.deepEqual(a.map((e) => e.file).sort(), ['One (recaptured 2026-02-02).md', 'One.md']);
  const one = a.find((e) => e.file === 'One.md');
  assert.equal(one.name, 'One');
  assert.equal(one.created, '2026-01-01');
  assert.equal(one.sourceHash, 'h1');
  assert.equal(one.recaptureOf, null);
  const re = a.find((e) => e.file !== 'One.md');
  assert.equal(re.sourceHash, 'h2');
  assert.equal(re.recaptureOf, 'raw/clippings/One.md');
  assert.equal(index.get('https://docs.example.test/b')[0].created, null);
  assert.equal(index.get('https://docs.example.test/b')[0].sourceHash, null);
  assert.deepEqual(clippingsForUrl(v.root, 'https://DOCS.example.test/a/').map((e) => e.file).sort(), ['One (recaptured 2026-02-02).md', 'One.md']);
  assert.equal(newestCapture(a).file, 'One (recaptured 2026-02-02).md');
  assert.equal(newestCapture([]), null);
});

test('newestCapture breaks a created tie by name, comparing the names without .md', () => {
  const a = { file: 'Guide.md', name: 'Guide', created: '2026-01-01' };
  const b = { file: 'Guide (recaptured 2026-01-01).md', name: 'Guide (recaptured 2026-01-01)', created: '2026-01-01' };
  assert.equal(newestCapture([a, b]).file, b.file);
  assert.equal(newestCapture([b, a]).file, b.file);
});

test('knownSourceUrls still lists one source per clipping file, as the document clippers read it', (t) => {
  const v = vault(t);
  assert.deepEqual(knownSourceUrls(join(v.root, 'nowhere')), []);
  writeFileSync(join(v.dir, 'a.md'), '---\nsource: "https://x.test/a"\n---\n');
  writeFileSync(join(v.dir, 'b.md'), '---\nsource: https://x.test/b\n---\n');
  writeFileSync(join(v.dir, 'c.md'), '---\ntitle: none\n---\n');
  assert.deepEqual(knownSourceUrls(v.root).sort(), ['https://x.test/a', 'https://x.test/b']);
});

// ---------------------------------------------------------------- the option is declared
test('--recapture is a flag of clip.mjs only', () => {
  assert.deepEqual(checkClipArgs(['https://x.test/a', '--recapture'], CLIP_SPECS['clip']), { ok: true });
  assert.match(checkClipArgs(['f.pdf', '--recapture'], CLIP_SPECS['clip-pdf']).error, /unknown option --recapture/);
  assert.match(checkClipArgs(['https://x.test/a', '--recapture=1'], CLIP_SPECS['clip']).error, /unknown option --recapture/);
  assert.ok(CLIP_SPECS['clip'].usage.some((l) => l.includes('--recapture')));
});
