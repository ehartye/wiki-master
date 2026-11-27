/** @lane merge
 * @subject scripts/source-stub.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { clippingHash, verifyClippingHash } from '../scripts/lib/clipping-hash.mjs';
import { markdownPage } from '../scripts/lib/graph.mjs';
import { parseNote } from '../scripts/lib/note.mjs';
import { localDate } from '../scripts/lib/local-date.mjs';
import { sourceStub } from '../scripts/source-stub.mjs';

// A source page's provenance block, printed from the clippings it summarizes. The ingest backlog joins a clipping to a
// source page on the clipping's RECORDED source-hash, so the block must carry the recorded values, and a page saved
// from it must take both clippings off the backlog. A clipping whose text is not the text its hash was recorded over
// must never be cited this way.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = join(ROOT, 'scripts');
const sha = (s) => createHash('sha256').update(s).digest('hex');
const body = (s) => `${s} is described here in enough plain words that the page reads as real content.\n\nA second paragraph about ${s}.`;
const clipping = (b, hash) => `---\ntitle: "T"\nsource: "https://example.test/${sha(b).slice(0, 8)}"\ncreated: 2026-10-01\nquality: high\n${hash === null ? '' : `source-hash: ${hash}\n`}---\n\n${b}\n`;

function vault(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-source-stub-'));
  mkdirSync(join(root, 'raw', 'clippings'), { recursive: true });
  mkdirSync(join(root, 'wiki', 'sources'), { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); return rel; };
  return {
    root,
    write,
    // The four kinds of clipping a stub meets. Each returns the recorded hash.
    match(rel, s) { const hash = clippingHash(clipping(body(s), null)); write(rel, clipping(body(s), hash)); return hash; },
    // Recorded by the old rule over CRLF text; the file has since been converted to LF.
    crlf(rel, s) { const hash = sha(body(s).replace(/\n/g, '\r\n')); write(rel, clipping(body(s), hash)); return hash; },
    // Recorded over the text with one more final line break.
    trailing(rel, s) { const hash = sha(`${body(s)}\n`); write(rel, clipping(body(s), hash)); return hash; },
    mismatch(rel, s) { const hash = sha(`other text than ${s}`); write(rel, clipping(body(s), hash)); return hash; },
    noHash(rel, s) { write(rel, clipping(body(s), null)); },
  };
}

function run(args, root, { cwd = ROOT } = {}) {
  const r = spawnSync(process.execPath, [join(SCRIPTS, 'source-stub.mjs'), ...args], { cwd, env: { ...process.env, WIKI_MASTER_VAULT: root }, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function backlog(root) {
  const r = spawnSync(process.execPath, [join(SCRIPTS, 'health.mjs'), '--backlog'], { cwd: ROOT, env: { ...process.env, WIKI_MASTER_VAULT: root }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const section = (heading) => {
    const at = r.stdout.indexOf(heading);
    assert.ok(at >= 0, `${heading} is in the report:\n${r.stdout}`);
    const rest = r.stdout.slice(at).split('\n').slice(1);
    const end = rest.findIndex((l) => !l.startsWith('    '));
    return rest.slice(0, end < 0 ? rest.length : end).map((l) => l.trim());
  };
  return { notIngested: section('not ingested (no summary records their hash)'), unparsed: section('unparsed raw sources (nothing cites them)') };
}

const block = (date, sources, hashes) => [
  '---',
  'type: source',
  `created: ${date}`,
  `updated: ${date}`,
  'status: draft',
  `sources: [${sources.map((s) => JSON.stringify(`[[${s}]]`)).join(', ')}]`,
  `source-hashes: [${hashes.join(', ')}]`,
  'ai-generated: true',
  '---',
  '',
].join('\n');

// ---------------------------------------------------------------- criterion 7: the block, and the backlog it clears
test('the block lists the clippings in the order given with their recorded hashes, and a page saved from it takes them off the backlog', (t) => {
  const v = vault(t);
  const hashA = v.match('raw/clippings/a.md', 'Alpha');
  const hashB = v.crlf('raw/clippings/b.md', 'Bravo');
  v.match('raw/clippings/c.md', 'Charlie'); // never cited: the control that the report still lists what is not ingested
  // The recorded value is what is printed, not a recomputed one: for b they differ.
  assert.notEqual(hashB, clippingHash(readFileSync(join(v.root, 'raw/clippings/b.md'), 'utf8')));
  const before = backlog(v.root);
  for (const rel of ['raw/clippings/a.md', 'raw/clippings/b.md', 'raw/clippings/c.md']) assert.ok(before.notIngested.includes(rel), `${rel} starts un-ingested`);

  const before0 = localDate();
  const r = run(['raw/clippings/b.md', 'raw/clippings/a.md'], v.root);
  assert.equal(r.code, 0, r.err);
  const date = r.out.match(/^created: (\S+)$/m)?.[1];
  assert.ok([before0, localDate()].includes(date), `created is today in local time: ${date}`);
  assert.equal(r.out, block(date, ['raw/clippings/b.md', 'raw/clippings/a.md'], [hashB, hashA]));
  assert.match(r.err, /raw\/clippings\/b\.md.*crlf-variant/, 'an equivalent status is a note on stderr');
  assert.doesNotMatch(r.err, /raw\/clippings\/a\.md/, 'a match needs no note');

  const page = `${r.out}# Alpha and Bravo\n\nA summary of both.\n`;
  const parsed = markdownPage('wiki/sources/Alpha and Bravo.md', page);
  assert.deepEqual(parsed.sourceHashes, [hashB, hashA], 'the graph reads the hashes in order');
  assert.deepEqual(parseNote(page).sources, ['[[raw/clippings/b.md]]', '[[raw/clippings/a.md]]'], 'sources parse as quoted strings');
  v.write('wiki/sources/Alpha and Bravo.md', page);

  const after = backlog(v.root);
  assert.deepEqual(after.notIngested, ['raw/clippings/c.md']);
  for (const rel of ['raw/clippings/a.md', 'raw/clippings/b.md']) assert.ok(!after.unparsed.includes(rel), `${rel} is cited`);
});

test('a trailing-newline clipping is allowed with a note, and match-raw and match clippings need none', (t) => {
  const v = vault(t);
  const hashT = v.trailing('raw/clippings/t.md', 'Tango');
  // match-raw: a clipping whose carriage returns survived, hashed by the old rule over its CRLF body.
  const crBody = body('Romeo').replace(/\n/g, '\r\n');
  const hashR = sha(crBody);
  v.write('raw/clippings/r.md', clipping(crBody, hashR));
  assert.equal(verifyClippingHash(readFileSync(join(v.root, 'raw/clippings/r.md'), 'utf8'), hashR), 'match-raw');
  const r = run(['raw/clippings/r.md', 'raw/clippings/t.md'], v.root);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, new RegExp(`^source-hashes: \\[${hashR}, ${hashT}\\]$`, 'm'));
  assert.match(r.err, /raw\/clippings\/t\.md.*trailing-newline/);
  assert.doesNotMatch(r.err, /r\.md/);
});

test('the same block comes from a --paths-file ledger, a path given twice is listed once, and an absolute path is cited vault-relative', (t) => {
  const v = vault(t);
  const hashA = v.match('raw/clippings/a.md', 'Alpha');
  const hashB = v.match('raw/clippings/sub/b.md', 'Bravo');
  const ledgerDir = mkdtempSync(join(tmpdir(), 'wm-source-stub-ledger-'));
  t.after(() => rmSync(ledgerDir, { recursive: true, force: true }));
  const ledger = join(ledgerDir, 'ledger.json');
  // Saved by Windows PowerShell, a ledger often starts with a byte-order mark.
  writeFileSync(ledger, `﻿${JSON.stringify(['raw/clippings/sub/b.md', 'raw/clippings/a.md', 'raw/clippings/sub/b.md'])}`);
  const fromLedger = run(['--paths-file', ledger], v.root);
  assert.equal(fromLedger.code, 0, fromLedger.err);
  const date = fromLedger.out.match(/^created: (\S+)$/m)?.[1];
  assert.equal(fromLedger.out, block(date, ['raw/clippings/sub/b.md', 'raw/clippings/a.md'], [hashB, hashA]));
  const positional = run([join(v.root, 'raw', 'clippings', 'sub', 'b.md'), 'raw/clippings/a.md', 'raw/clippings/a.md'], v.root);
  assert.equal(positional.code, 0, positional.err);
  assert.equal(positional.out, fromLedger.out);
  assert.equal(run([`--paths-file=${ledger}`], v.root).out, fromLedger.out, 'either option spelling');
});

test('a path relative to the working directory is the caller\'s own', (t) => {
  const v = vault(t);
  const hashA = v.match('raw/clippings/a.md', 'Alpha');
  const r = run(['a.md'], v.root, { cwd: join(v.root, 'raw', 'clippings') });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^sources: \["\[\[raw\/clippings\/a\.md\]\]"\]$/m);
  assert.match(r.out, new RegExp(`^source-hashes: \\[${hashA}\\]$`, 'm'));
});

// ---------------------------------------------------------------- refusals: exit 1, every one named, nothing on stdout
test('a mismatch, a path outside raw/clippings/, a clipping with no hash and a missing one are each refused with exit 1 and nothing on stdout', (t) => {
  const v = vault(t);
  v.match('raw/clippings/good.md', 'Good');
  v.mismatch('raw/clippings/m.md', 'Mike');
  v.noHash('raw/clippings/n.md', 'November');
  v.match('wiki/sources/page.md', 'Papa');
  v.match('raw/notes/o.md', 'Oscar');
  const outsideDir = mkdtempSync(join(tmpdir(), 'wm-source-stub-outside-'));
  t.after(() => rmSync(outsideDir, { recursive: true, force: true }));
  const outside = join(outsideDir, 'x.md');
  writeFileSync(outside, clipping(body('Xray'), sha('x')));
  const cases = [
    ['raw/clippings/m.md', /raw\/clippings\/m\.md.*mismatch/],
    ['raw/clippings/n.md', /raw\/clippings\/n\.md.*no source-hash/],
    ['wiki/sources/page.md', /wiki\/sources\/page\.md.*raw\/clippings\//],
    ['raw/notes/o.md', /raw\/notes\/o\.md.*raw\/clippings\//],
    [outside, /x\.md.*raw\/clippings\//],
    ['raw/clippings/gone.md', /raw\/clippings\/gone\.md.*no such file/],
  ];
  for (const [arg, why] of cases) {
    const r = run(['raw/clippings/good.md', arg], v.root);
    assert.equal(r.code, 1, `${arg}: ${r.err}`);
    assert.equal(r.out, '', `${arg}: nothing on stdout`);
    assert.match(r.err, why, arg);
    assert.doesNotMatch(r.err, /good\.md/, `${arg}: the good clipping is not named`);
  }
  // All at once: each refused clipping is named, not only the first.
  const all = run(['raw/clippings/good.md', ...cases.map(([arg]) => arg)], v.root);
  assert.equal(all.code, 1);
  assert.equal(all.out, '');
  for (const [arg, why] of cases) assert.match(all.err, why, `${arg} is named among the rest`);
});

test('a ledger naming a refused clipping is refused the same way', (t) => {
  const v = vault(t);
  v.match('raw/clippings/good.md', 'Good');
  v.mismatch('raw/clippings/m.md', 'Mike');
  const ledgerDir = mkdtempSync(join(tmpdir(), 'wm-source-stub-ledger-'));
  t.after(() => rmSync(ledgerDir, { recursive: true, force: true }));
  const ledger = join(ledgerDir, 'ledger.json');
  writeFileSync(ledger, JSON.stringify(['raw/clippings/good.md', 'raw/clippings/m.md']));
  const r = run(['--paths-file', ledger], v.root);
  assert.equal(r.code, 1);
  assert.equal(r.out, '');
  assert.match(r.err, /raw\/clippings\/m\.md.*mismatch/);
});

// ---------------------------------------------------------------- bad input: exit 2
test('bad input exits 2 with nothing on stdout', (t) => {
  const v = vault(t);
  v.match('raw/clippings/a.md', 'Alpha');
  const ledgerDir = mkdtempSync(join(tmpdir(), 'wm-source-stub-ledger-'));
  t.after(() => rmSync(ledgerDir, { recursive: true, force: true }));
  const file = (name, text) => { writeFileSync(join(ledgerDir, name), text); return join(ledgerDir, name); };
  const cases = [
    [[], /name at least one clipping/],
    [['raw/clippings/a.md', '--paths-file', file('ok.json', '["raw/clippings/a.md"]')], /not both/],
    [['--paths-file'], /--paths-file needs/],
    [['--paths-file', join(ledgerDir, 'absent.json')], /cannot read ledger/],
    [['--paths-file', file('bad.json', '{not json')], /not valid JSON/],
    [['--paths-file', file('empty.json', '[]')], /non-empty JSON array/],
    [['--paths-file', file('escape.json', '["raw/clippings/../../x.md"]')], /invalid ledger path/],
    [['--bogus-flag'], /unknown option --bogus-flag/],
  ];
  for (const [args, why] of cases) {
    const r = run(args, v.root);
    assert.equal(r.code, 2, `${args.join(' ')}: ${r.err}`);
    assert.equal(r.out, '', args.join(' '));
    assert.match(r.err, why, args.join(' '));
  }
});

test('--help prints the usage and exits 0', (t) => {
  const v = vault(t);
  const r = run(['--help'], v.root);
  assert.equal(r.code, 0);
  assert.match(r.out, /^usage: node scripts\/source-stub\.mjs <clipping>\.\.\. \| --paths-file <ledger>/);
});

test('the block is dated with the day it is given', (t) => {
  const v = vault(t);
  const hashA = v.match('raw/clippings/a.md', 'Alpha');
  const r = sourceStub(v.root, [{ arg: 'raw/clippings/a.md', file: join(v.root, 'raw', 'clippings', 'a.md') }], { today: '2026-01-02' });
  assert.deepEqual(r.refused, []);
  assert.equal(r.block, block('2026-01-02', ['raw/clippings/a.md'], [hashA]));
});

// ---------------------------------------------------------------- criterion 8: the template and the ingest reference
test('the source-note template has a source-hashes field, and the ingest reference names source-stub.mjs where it says to record them', () => {
  const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replaceAll('\r\n', '\n');
  const template = parseNote(read('templates/_templates/source-note.md'));
  assert.ok(Object.hasOwn(template.metadata, 'source-hashes'), 'source-note.md has source-hashes:');
  const keys = [...read('templates/_templates/source-note.md').split('\n---')[0].matchAll(/^([a-z-]+):/gm)].map((m) => m[1]);
  assert.equal(keys.indexOf('source-hashes'), keys.indexOf('sources') + 1, 'source-hashes follows sources, as the stub prints them');
  const ingest = read('skills/wiki-researcher/references/ingest.md');
  assert.ok(ingest.includes('node "<absolute-plugin-root>/scripts/source-stub.mjs"'), 'ingest.md gives the command');
  const step = ingest.slice(ingest.indexOf('2. Write/update `wiki/sources/'), ingest.indexOf('\n3. '));
  assert.match(step, /source-stub\.mjs/, 'step 2, where the hashes are recorded, names the helper');
});
