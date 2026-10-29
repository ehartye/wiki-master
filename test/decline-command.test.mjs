import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DECLINE_TTL_DAYS, loadDeclines, recordDecline, isDeclined, readDeclineLog, declineExpiry } from '../scripts/lib/decline.mjs';
import { declineGate } from '../scripts/lib/decline-gate.mjs';
import { main as clip } from '../scripts/clip.mjs';

// A decline could only be lifted from inside a clip, and the clip answers "duplicate" before it ever gets there when the
// page is already in the vault. Measured on 2026-10-29 with a declined, already clipped URL: `clip.mjs <url>
// --supersede-decline="r"` printed "duplicate (already clipped)" and the decline stayed active. decline.mjs lists,
// shows and supersedes entries of the log without clipping anything, and writes only the decline file.

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'decline.mjs');
const CLIP = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'clip.mjs');
const U = 'https://example.com/docs/guide';
const V = 'https://example.com/docs/other';
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);

function vault(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-declinecmd-'));
  mkdirSync(join(root, 'raw', 'clippings'), { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function run(root, ...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8', env: { ...process.env, WIKI_MASTER_VAULT: root, WIKI_MASTER_BROWSER: '/no/such/browser' },
  });
  return { status: r.status, out: r.stdout, err: r.stderr };
}
// Every file under the vault with its bytes, so "writes nothing" and "writes only the decline file" are checked, not assumed.
function snapshot(root) {
  const out = new Map();
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.set(full.slice(root.length).split(sep).join('/'), readFileSync(full).toString('base64'));
    }
  };
  walk(root);
  return out;
}
const changed = (a, b) => [...new Set([...a.keys(), ...b.keys()])].filter((k) => a.get(k) !== b.get(k)).sort();
const clipping = (root, name, url) => writeFileSync(join(root, 'raw', 'clippings', name), `---\ntitle: "Guide"\nsource: "${url}"\ncreated: 2026-10-01\nquality: medium\nsource-hash: abc\n---\nbody\n`);
const DECLINE_FILE = '/.wiki-master/declined.json';

test('the claim holds before the command: a declined, already clipped URL cannot be superseded by clipping it', (t) => {
  const root = vault(t);
  clipping(root, 'guide.md', U);
  recordDecline(root, U, 'off-topic');
  const r = spawnSync(process.execPath, [CLIP, U, '--supersede-decline=needed now'], {
    encoding: 'utf8', env: { ...process.env, WIKI_MASTER_VAULT: root, WIKI_MASTER_BROWSER: '/no/such/browser' },
  });
  assert.match(r.stdout, /^duplicate \(already clipped\)/);
  assert.equal(isDeclined(U, loadDeclines(root)), true, 'the decline is still active, and nothing else clears it');
});

test('list prints every entry with its reason, date, expiry and whether it is superseded', (t) => {
  const root = vault(t);
  recordDecline(root, U, 'off-topic');
  recordDecline(root, V, 'redundant with the vendor guide');
  const store = JSON.parse(readFileSync(join(root, '.wiki-master', 'declined.json'), 'utf8'));
  store[1].superseded = { reason: 'it covers the limits table', date: today() };
  writeFileSync(join(root, '.wiki-master', 'declined.json'), JSON.stringify(store));
  const r = run(root, 'list');
  assert.equal(r.status, 0);
  const lines = r.out.trim().split('\n');
  assert.equal(lines.length, 2);
  const expiry = declineExpiry({ date: today() });
  assert.match(lines[0], new RegExp(`^${U.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  for (const piece of ['off-topic', `declined ${today()}`, `expires ${expiry}`, 'active']) assert.ok(lines[0].includes(piece), `${piece} in ${lines[0]}`);
  for (const piece of ['redundant with the vendor guide', `superseded ${today()}`, 'it covers the limits table']) assert.ok(lines[1].includes(piece), `${piece} in ${lines[1]}`);
});

test('list --json is valid JSON with every entry, an expired one marked and a superseded one carrying its reason', (t) => {
  const root = vault(t);
  recordDecline(root, U, 'off-topic');
  recordDecline(root, V, 'old verdict');
  const store = JSON.parse(readFileSync(join(root, '.wiki-master', 'declined.json'), 'utf8'));
  store[1].date = daysAgo(DECLINE_TTL_DAYS + 5);
  writeFileSync(join(root, '.wiki-master', 'declined.json'), JSON.stringify(store));
  const r = run(root, 'list', '--json');
  assert.equal(r.status, 0);
  const rows = JSON.parse(r.out);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].url, U);
  assert.equal(rows[0].reason, 'off-topic');
  assert.equal(rows[0].date, today());
  assert.equal(rows[0].expires, declineExpiry({ date: today() }));
  assert.equal(rows[0].superseded, null);
  assert.equal(rows[0].active, true);
  assert.equal(rows[1].active, false, 'an expired entry is listed but not active');
  assert.equal(rows[1].expired, true);
});

test('list with no log prints nothing, and --json prints an empty array', (t) => {
  const root = vault(t);
  assert.deepEqual([run(root, 'list').status, run(root, 'list').out], [0, '']);
  assert.deepEqual(JSON.parse(run(root, 'list', '--json').out), []);
});

test('show prints the one entry for a URL, spelled as the clipper compares it, and exits 1 when there is none', (t) => {
  const root = vault(t);
  recordDecline(root, U, 'off-topic');
  const r = run(root, 'show', `${U}/?utm_source=x#frag`);
  assert.equal(r.status, 0);
  assert.ok(r.out.includes('off-topic') && r.out.includes(`declined ${today()}`) && r.out.includes('active'), r.out);
  assert.equal(r.out.trim().split('\n').length, 1);
  const none = run(root, 'show', V);
  assert.equal(none.status, 1);
  assert.equal(none.out, '');
  assert.match(none.err, /no decline/);
  assert.equal(run(root, 'show').status, 2, 'show needs a URL');
});

test('show prints a superseded entry as superseded, with the earlier decisions of its history', (t) => {
  const root = vault(t);
  recordDecline(root, U, 'first reason');
  run(root, 'supersede', U, '--reason', 'it was needed');
  recordDecline(root, U, 'second reason');
  const r = run(root, 'show', U);
  assert.equal(r.status, 0);
  assert.ok(r.out.includes('second reason'));
  assert.ok(r.out.includes('first reason') && r.out.includes('it was needed'), 'the history is shown: ' + r.out);
});

test('supersede marks the active entry superseded with the reason and the date, prints superseded, exits 0, and a clip is no longer blocked', (t) => {
  const root = vault(t);
  recordDecline(root, U, 'redundant with the vendor guide');
  const r = run(root, 'supersede', U, '--reason', 'the guide omits the limits table');
  assert.equal(r.status, 0);
  assert.equal(r.out.trim(), 'superseded');
  const [e] = JSON.parse(readFileSync(join(root, '.wiki-master', 'declined.json'), 'utf8'));
  assert.equal(e.reason, 'redundant with the vendor guide', 'the original reason stays');
  assert.deepEqual(e.superseded, { reason: 'the guide omits the limits table', date: today() });
  assert.equal(isDeclined(U, loadDeclines(root)), false);
  assert.equal(declineGate(root, U, [], { log: () => {} }).blocked, false, 'the decline gate no longer blocks');
  const prior = process.env.WIKI_MASTER_VAULT;
  process.env.WIKI_MASTER_VAULT = root;
  const log = console.log;
  console.log = () => {};
  try {
    const body = 'A substantive paragraph of document text that is long enough to count as content. '.repeat(30);
    assert.equal(clip([U], { extract: () => ({ title: 'Guide', contentMarkdown: body }) }).status, 'clipped');
  } finally { console.log = log; if (prior === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = prior; }
});

test('supersede accepts --reason=text, and works whether or not the URL is clipped', (t) => {
  const root = vault(t);
  clipping(root, 'guide.md', U);
  recordDecline(root, U, 'off-topic');
  recordDecline(root, V, 'off-topic');
  assert.equal(run(root, 'supersede', U, '--reason=already clipped, now wanted').status, 0, 'a clipped URL');
  assert.equal(run(root, 'supersede', V, '--reason', 'never clipped').status, 0, 'a URL that was never clipped');
  assert.deepEqual(loadDeclines(root), []);
});

test('supersede with no active decline exits 1 and the decline file is byte-identical, whatever the reason for there being none', (t) => {
  const root = vault(t);
  const file = join(root, '.wiki-master', 'declined.json');
  // no file at all
  let before = snapshot(root);
  let r = run(root, 'supersede', U, '--reason', 'r');
  assert.equal(r.status, 1);
  assert.match(r.err, /no active decline/);
  assert.deepEqual(changed(before, snapshot(root)), [], 'nothing is created when there is no log');
  assert.equal(existsSync(join(root, '.wiki-master')), false);
  // an entry for another URL, one already superseded, one expired
  recordDecline(root, V, 'off-topic');
  recordDecline(root, U, 'off-topic');
  run(root, 'supersede', U, '--reason', 'first');
  const store = JSON.parse(readFileSync(file, 'utf8'));
  store.push({ url: 'https://example.com/old', reason: 'old', date: daysAgo(DECLINE_TTL_DAYS + 1) });
  writeFileSync(file, JSON.stringify(store, null, 2));
  const bytes = readFileSync(file);
  before = snapshot(root);
  for (const url of [U, 'https://example.com/old', 'https://example.com/never-seen']) {
    r = run(root, 'supersede', url, '--reason', 'again');
    assert.equal(r.status, 1, url);
    assert.equal(r.out.includes('superseded'), false, url);
  }
  assert.ok(readFileSync(file).equals(bytes), 'the decline file is byte-identical');
  assert.deepEqual(changed(before, snapshot(root)), []);
});

test('supersede writes only the decline file', (t) => {
  const root = vault(t);
  clipping(root, 'guide.md', U);
  mkdirSync(join(root, 'wiki'), { recursive: true });
  writeFileSync(join(root, 'wiki', 'page.md'), 'x');
  recordDecline(root, U, 'off-topic');
  writeFileSync(join(root, '.wiki-master', 'triage.jsonl'), '');
  const before = snapshot(root);
  const r = run(root, 'supersede', U, '--reason', 'r');
  assert.equal(r.status, 0);
  assert.deepEqual(changed(before, snapshot(root)), [DECLINE_FILE]);
});

test('list, show and a refused supersede write nothing at all', (t) => {
  const root = vault(t);
  clipping(root, 'guide.md', U);
  recordDecline(root, U, 'off-topic');
  const before = snapshot(root);
  run(root, 'list'); run(root, 'list', '--json'); run(root, 'show', U); run(root, 'show', V); run(root, 'supersede', V, '--reason', 'r');
  assert.deepEqual(changed(before, snapshot(root)), []);
});

test('supersede needs a URL and a non-empty reason, and says so without touching the log', (t) => {
  const root = vault(t);
  recordDecline(root, U, 'off-topic');
  const before = snapshot(root);
  for (const args of [['supersede'], ['supersede', U], ['supersede', U, '--reason'], ['supersede', U, '--reason='], ['supersede', U, '--reason', '   ']]) {
    const r = run(root, ...args);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.err, /usage|reason/i);
  }
  assert.deepEqual(changed(before, snapshot(root)), []);
});

test('an unknown subcommand or option exits 2 with a line naming it, and --help exits 0 with the usage', (t) => {
  const root = vault(t);
  const bad = run(root, 'list', '--bogus-flag-zq');
  assert.equal(bad.status, 2);
  assert.match(bad.err, /decline: unknown option --bogus-flag-zq/);
  const sub = run(root, 'remove', U);
  assert.equal(sub.status, 2);
  assert.match(sub.err, /usage: node scripts\/decline\.mjs/);
  assert.equal(run(root, 'noop').status, 2);
  assert.equal(run(root).status, 2, 'no subcommand');
  for (const flag of ['--help', '-h']) {
    const h = run(root, flag);
    assert.equal(h.status, 0);
    assert.match(h.out, /^usage: node scripts\/decline\.mjs list/);
    assert.match(h.out, /supersede <url> --reason/);
  }
});

test('readDeclineLog reads every entry, valid or not, and declineExpiry is the date plus the TTL', (t) => {
  const root = vault(t);
  assert.deepEqual(readDeclineLog(root), []);
  recordDecline(root, U, 'x');
  assert.equal(readDeclineLog(root).length, 1);
  writeFileSync(join(root, '.wiki-master', 'declined.json'), 'not json');
  assert.deepEqual(readDeclineLog(root), []);
  assert.equal(declineExpiry({ date: '2026-01-01' }), new Date(Date.parse('2026-01-01') + DECLINE_TTL_DAYS * 86400_000).toISOString().slice(0, 10));
});
