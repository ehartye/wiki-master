import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { recordDecline, supersedeDecline } from '../scripts/lib/decline.mjs';
import { recordIssue, disposeIssue } from '../scripts/lib/triage.mjs';

// Discovery needs the clipper's own answer to "is this page already in the vault", for one URL or a list, and a count of
// what a topic holds. known-urls.mjs reads the clippings the way the clipper does (the first source: line of each file
// directly under raw/clippings) and changes nothing.

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'known-urls.mjs');
const A = 'https://example.com/docs/alpha';
const B = 'https://example.com/docs/beta';
const C = 'https://example.com/docs/gamma';

function vault(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-knownurls-'));
  mkdirSync(join(root, 'raw', 'clippings'), { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function clipping(root, name, { url, created = '2026-10-01', quality = 'medium', topic, recaptureOf, title = name } = {}) {
  const lines = ['---', `title: "${title}"`, `source: "${url}"`, `created: ${created}`, 'tags: [clippings]', `quality: ${quality}`];
  if (topic) lines.push(`topic: "${topic}"`);
  if (recaptureOf) lines.push(`recapture-of: "${recaptureOf}"`);
  lines.push('source-hash: abc', '---', 'body', '');
  writeFileSync(join(root, 'raw', 'clippings', `${name}.md`), lines.join('\n'));
}
function run(root, ...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8', env: { ...process.env, WIKI_MASTER_VAULT: root, WIKI_MASTER_BROWSER: '/no/such/browser' },
  });
  return { status: r.status, out: r.stdout, err: r.stderr };
}
function snapshot(root) {
  const out = new Map();
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (name === '.git') continue;
      if (statSync(full).isDirectory()) walk(full);
      else out.set(full.slice(root.length).split(sep).join('/'), readFileSync(full).toString('base64'));
    }
  };
  walk(root);
  return out;
}
function git(root, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}
function initGit(root) {
  git(root, 'init', '-q');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'fixture');
}
const lines = (s) => s.split('\n').filter(Boolean);

test('with no option it prints the known source URLs one per line, normalized as the clipper does, and --count prints the number', (t) => {
  const root = vault(t);
  clipping(root, 'alpha', { url: `${A}/?utm_source=news#intro` });
  clipping(root, 'beta', { url: B });
  clipping(root, 'beta again', { url: 'https://EXAMPLE.com/docs/beta/' });
  mkdirSync(join(root, 'raw', 'clippings', 'nested'));
  clipping(root, 'nested/skipped', { url: C });
  const r = run(root);
  assert.equal(r.status, 0);
  assert.deepEqual(lines(r.out), [A, B], 'tracking parameters, the fragment and a trailing slash are dropped; a host-case twin is one URL; a nested file is not read');
  const n = run(root, '--count');
  assert.equal(n.status, 0);
  assert.equal(n.out.trim(), '2');
});

test('an empty vault prints nothing, and a count of 0', (t) => {
  const root = vault(t);
  assert.deepEqual([run(root).status, run(root).out], [0, '']);
  assert.equal(run(root, '--count').out.trim(), '0');
  rmSync(join(root, 'raw'), { recursive: true });
  assert.equal(run(root, '--count').out.trim(), '0', 'a vault with no clippings folder');
});

test('--check says new, clipped with the file, or declined with the reason, one line per URL in the order given', (t) => {
  const root = vault(t);
  clipping(root, 'alpha page', { url: A });
  recordDecline(root, B, 'redundant with the vendor guide');
  const r = run(root, '--check', A, B, C);
  assert.equal(r.status, 0);
  assert.deepEqual(lines(r.out), ['clipped raw/clippings/alpha page.md', 'declined: redundant with the vendor guide', 'new']);
});

test('--check compares as the clipper does: a tracking parameter or a trailing slash is the same page', (t) => {
  const root = vault(t);
  clipping(root, 'alpha', { url: A });
  recordDecline(root, B, 'off-topic');
  assert.deepEqual(lines(run(root, '--check', `${A}/?utm_campaign=x#top`, `${B}/`).out), ['clipped raw/clippings/alpha.md', 'declined: off-topic']);
});

test('a clipped URL is clipped even if a decline exists (the clipper answers duplicate first), and a superseded or expired decline is not declined', (t) => {
  const root = vault(t);
  clipping(root, 'alpha', { url: A });
  recordDecline(root, A, 'off-topic');
  recordDecline(root, B, 'off-topic');
  supersedeDecline(root, B, 'wanted after all');
  recordDecline(root, C, 'old');
  const file = join(root, '.wiki-master', 'declined.json');
  const store = JSON.parse(readFileSync(file, 'utf8'));
  store.find((e) => e.url === C).date = '2020-01-01';
  writeFileSync(file, JSON.stringify(store));
  assert.deepEqual(lines(run(root, '--check', A, B, C).out), ['clipped raw/clippings/alpha.md', 'new', 'new']);
});

test('--check counts the recaptures: clippings whose recapture-of names another clipping holding the same URL', (t) => {
  const root = vault(t);
  clipping(root, 'alpha', { url: A, created: '2026-09-01' });
  clipping(root, 'alpha (recaptured 2026-10-01)', { url: A, created: '2026-10-01', recaptureOf: 'raw/clippings/alpha.md' });
  clipping(root, 'beta', { url: B });
  clipping(root, 'beta (recaptured 2026-10-02)', { url: B, created: '2026-10-02', recaptureOf: 'raw/clippings/beta.md' });
  clipping(root, 'beta (recaptured 2026-10-09)', { url: B, created: '2026-10-09', recaptureOf: 'raw/clippings/beta (recaptured 2026-10-02).md' });
  clipping(root, 'gamma', { url: C });
  const r = run(root, '--check', A, B, C);
  assert.deepEqual(lines(r.out), [
    'clipped raw/clippings/alpha.md (+1 recapture)',
    'clipped raw/clippings/beta.md (+2 recapture)',
    'clipped raw/clippings/gamma.md',
  ]);
  assert.deepEqual(lines(run(root).out), [A, B, C], 'a recapture does not add a URL');
  assert.equal(run(root, '--count').out.trim(), '3');
});

test('a recapture-of that names a missing file, or a clipping of another URL, is not a recapture', (t) => {
  const root = vault(t);
  clipping(root, 'alpha', { url: A });
  clipping(root, 'alpha stray', { url: A, created: '2026-10-05', recaptureOf: 'raw/clippings/missing.md' });
  clipping(root, 'beta', { url: B });
  clipping(root, 'beta stray', { url: B, created: '2026-10-05', recaptureOf: 'raw/clippings/alpha.md' });
  assert.deepEqual(lines(run(root, '--check', A, B).out), ['clipped raw/clippings/alpha.md', 'clipped raw/clippings/beta.md']);
});

test('--summary --topic prints the clipped count, the count per quality tier, the open triage rows by kind, and that declines are not per topic', (t) => {
  const root = vault(t);
  clipping(root, 'one', { url: A, topic: 'Widget Research', quality: 'high' });
  clipping(root, 'two', { url: B, topic: 'widget  research', quality: 'medium' });
  clipping(root, 'three', { url: C, topic: 'Widget Research', quality: 'medium' });
  clipping(root, 'other', { url: 'https://example.com/other', topic: 'Something Else', quality: 'low' });
  recordIssue(root, { url: 'https://example.com/f1', kind: 'failed', reason: '403', topic: 'Widget Research' });
  recordIssue(root, { url: 'https://example.com/f2', kind: 'failed', reason: '403', topic: 'widget research' });
  recordIssue(root, { url: 'https://example.com/t1', kind: 'thin', reason: 'thin', topic: 'Widget Research' });
  recordIssue(root, { url: 'https://example.com/closed', kind: 'gone', reason: '404', topic: 'Widget Research' });
  disposeIssue(root, { url: 'https://example.com/closed', kind: 'gone', disposition: 'dropped' });
  recordIssue(root, { url: 'https://example.com/elsewhere', kind: 'blocked', reason: 'x', topic: 'Something Else' });
  recordIssue(root, { url: B, kind: 'fidelity', reason: 'gibberish' });
  const r = run(root, '--summary', '--topic', 'Widget Research');
  assert.equal(r.status, 0);
  const out = r.out;
  assert.match(out, /^clipped: 3$/m);
  assert.match(out, /^quality high: 1$/m);
  assert.match(out, /^quality medium: 2$/m);
  assert.match(out, /^quality low: 0$/m);
  assert.match(out, /^open triage rows: 4$/m, 'a row with no topic of its own takes the topic of the clipping holding its URL');
  assert.match(out, /^ {2}failed: 2$/m);
  assert.match(out, /^ {2}thin: 1$/m);
  assert.match(out, /^ {2}fidelity: 1$/m);
  assert.doesNotMatch(out, /gone|blocked/, 'a closed row and another topic\'s row are not counted');
  assert.match(out, /^Declines are not recorded per topic\.$/m);
});

test('the summary counts a URL once, under the topic of its newest capture, and a topic with nothing reads zero', (t) => {
  const root = vault(t);
  clipping(root, 'alpha', { url: A, topic: 'Old Topic', quality: 'low', created: '2026-09-01' });
  clipping(root, 'omega newer capture', { url: A, topic: 'New Topic', quality: 'high', created: '2026-10-01', recaptureOf: 'raw/clippings/alpha.md' });
  const old = run(root, '--summary', '--topic', 'Old Topic').out;
  assert.match(old, /^clipped: 0$/m);
  assert.match(old, /^open triage rows: 0$/m);
  const fresh = run(root, '--summary', '--topic', 'new topic').out;
  assert.match(fresh, /^clipped: 1$/m);
  assert.match(fresh, /^quality high: 1$/m);
  assert.match(fresh, /^quality low: 0$/m);
});

test('every mode is read-only: a git-initialized vault is unchanged and no file or folder is created', (t) => {
  const root = vault(t);
  clipping(root, 'alpha', { url: A, topic: 'T' });
  clipping(root, 'alpha (recaptured 2026-10-01)', { url: A, topic: 'T', created: '2026-10-01', recaptureOf: 'raw/clippings/alpha.md' });
  recordDecline(root, B, 'off-topic');
  recordIssue(root, { url: C, kind: 'failed', reason: '403', topic: 'T' });
  initGit(root);
  const before = snapshot(root);
  assert.equal(git(root, 'status', '--porcelain'), '');
  for (const args of [[], ['--count'], ['--check', A, B, C], ['--summary', '--topic', 'T'], ['--summary', '--topic', 'No Such Topic'], ['--help'], ['--bogus-flag-zq']]) run(root, ...args);
  assert.equal(git(root, 'status', '--porcelain'), '', 'git status --porcelain is unchanged');
  assert.deepEqual([...snapshot(root).keys()].sort(), [...before.keys()].sort(), 'no file was created or removed');
  assert.deepEqual([...snapshot(root)], [...before], 'no file changed');
});

test('a vault with no .wiki-master folder is not given one', (t) => {
  const root = vault(t);
  clipping(root, 'alpha', { url: A });
  run(root, '--check', A, B);
  run(root, '--summary', '--topic', 'T');
  assert.deepEqual(readdirSync(root).sort(), ['raw']);
});

test('usage errors exit 2 with a line that says what to give', (t) => {
  const root = vault(t);
  const cases = [
    [['--check'], /--check needs/],
    [['--summary'], /--summary needs --topic/],
    [['--summary', '--topic'], /--topic needs/],
    [['--topic', 'T'], /--topic is for --summary/],
    [['--count', '--check', A], /one of/],
    [['--summary', '--topic', 'T', '--count'], /one of/],
    [['stray'], /usage/],
  ];
  for (const [args, pattern] of cases) {
    const r = run(root, ...args);
    assert.equal(r.status, 2, args.join(' '));
    assert.equal(r.out, '', args.join(' '));
    assert.match(r.err, pattern, args.join(' '));
  }
});

test('an unknown option exits 2 and names it, and --help exits 0 with the usage', (t) => {
  const root = vault(t);
  const bad = run(root, '--bogus-flag-zq');
  assert.equal(bad.status, 2);
  assert.match(bad.err, /known-urls: unknown option --bogus-flag-zq/);
  for (const flag of ['--help', '-h']) {
    const h = run(root, flag);
    assert.equal(h.status, 0);
    assert.match(h.out, /^usage: node scripts\/known-urls\.mjs/);
    assert.match(h.out, /--check/);
  }
});
