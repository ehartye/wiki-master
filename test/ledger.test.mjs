import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LedgerError, ledgerPathProblem, checkLedgerPaths, parseLedgerText, readLedger } from '../scripts/lib/ledger.mjs';
import { checkLedger } from '../scripts/validate-authored.mjs';

// A ledger (a JSON array of vault-relative paths) is what --paths-file takes on validate-authored, lint and
// lint-disposition. Copies of the path rule used to disagree (a colon, a byte-order mark), so one ledger could pass
// one script and fail another. They now share scripts/lib/ledger.mjs. lint-scope and lint-dispositions cover the two
// lint readers.

const BS = String.fromCharCode(92);

// [label, ledger, accepted]
const CASES = [
  ['a normal ledger', ['wiki/authored/demo/roadmap.md', 'log/2026-10-26-entry.md'], true],
  ['spaces, dots and non-ASCII in a name', ['raw/clippings/Name with spaces.v2 — d\u00e9j\u00e0.md'], true],
  ['a repeated path', ['a.md', 'a.md'], true],
  ['an empty array', [], false],
  ['an object', { 'a.md': 1 }, false],
  ['a string', 'a.md', false],
  ['null', null, false],
  ['a non-string entry', ['a.md', 7], false],
  ['an empty entry', ['a.md', ''], false],
  ['a parent segment', ['wiki/../a.md'], false],
  ['a current-directory segment', ['wiki/./a.md'], false],
  ['an empty segment', ['wiki//a.md'], false],
  ['a trailing slash', ['wiki/'], false],
  ['a leading slash', ['/a.md'], false],
  ['a backslash', [`wiki${BS}a.md`], false],
  ['a drive prefix', ['C:/a.md'], false],
  ['a colon inside a name', ['wiki/Title: subtitle.md'], false],
  ['a NUL', ['a\0b.md'], false],
];

const verdicts = (ledger) => {
  const viaLib = (() => { try { checkLedgerPaths(ledger); return true; } catch (e) { assert.ok(e instanceof LedgerError); return false; } })();
  const viaValidate = (() => { try { checkLedger(ledger); return true; } catch (e) { return false; } })();
  return { viaLib, viaValidate };
};

for (const [label, ledger, accepted] of CASES) {
  test(`the library and validate-authored give the same verdict on ${label}: ${accepted ? 'accepted' : 'refused'}`, () => {
    assert.deepEqual(verdicts(ledger), { viaLib: accepted, viaValidate: accepted });
  });
}

test('checkLedgerPaths removes repeats and keeps order; the message names the bad path', () => {
  assert.deepEqual(checkLedgerPaths(['b.md', 'a.md', 'b.md']), ['b.md', 'a.md']);
  assert.throws(() => checkLedgerPaths(['ok.md', 'wiki/../x.md']), /invalid ledger path "wiki\/\.\.\/x\.md"/);
  assert.equal(ledgerPathProblem('ok.md'), null);
  assert.match(ledgerPathProblem('a:b.md'), /colon/);
});

test('a ledger file written with a byte-order mark reads the same as one without', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'wm-ledger-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const text = JSON.stringify(['a.md', 'b/c.md']);
  writeFileSync(join(dir, 'plain.json'), text);
  writeFileSync(join(dir, 'bom.json'), String.fromCharCode(0xFEFF) + text);
  assert.deepEqual(readLedger(join(dir, 'plain.json')), ['a.md', 'b/c.md']);
  assert.deepEqual(readLedger(join(dir, 'bom.json')), ['a.md', 'b/c.md']);
  assert.deepEqual(parseLedgerText(String.fromCharCode(0xFEFF) + text), ['a.md', 'b/c.md']);
});

test('an unreadable, missing, directory or malformed ledger file is a LedgerError that names the file', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'wm-ledger-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'sub'));
  writeFileSync(join(dir, 'broken.json'), '{broken');
  for (const file of [join(dir, 'missing.json'), join(dir, 'sub'), join(dir, 'broken.json')]) {
    assert.throws(() => readLedger(file), (e) => e instanceof LedgerError && e.message.includes(file));
  }
});
