import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LedgerError, ledgerPathProblem, checkLedgerPaths, parseLedgerText, readLedger } from '../scripts/lib/ledger.mjs';
import { commitOp } from '../scripts/op-commit.mjs';
import { refreshCatalogs } from '../scripts/refresh-catalogs.mjs';
import { checkLedger } from '../scripts/validate-authored.mjs';

// The ownership ledger (a JSON array of vault-relative paths) is read by op-commit, refresh-catalogs and
// validate-authored. They used to carry three copies of the path rule that disagreed (a colon, a byte-order
// mark), so one ledger could pass one script and fail another. They now share scripts/lib/ledger.mjs.

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
  const viaOpCommit = commitOp('/no/such/vault', { op: 'relink', title: 't', token: 'abcdef12', paths: ledger }).reason?.startsWith('explicit operation scope') !== true;
  const viaRefresh = (() => { try { refreshCatalogs('/no/such/vault', { project: 'demo', ownedPaths: ledger }); return true; } catch (e) { return !/exact vault-relative paths/.test(e.message); } })();
  const viaValidate = (() => { try { checkLedger(ledger); return true; } catch (e) { return false; } })();
  return { viaLib, viaOpCommit, viaRefresh, viaValidate };
};

for (const [label, ledger, accepted] of CASES) {
  test(`all four readers give the same verdict on ${label}: ${accepted ? 'accepted' : 'refused'}`, () => {
    const v = verdicts(ledger);
    if (accepted) {
      // op-commit and refresh-catalogs go on to look at the vault, which does not exist here: accepted means the
      // shape check did not refuse them.
      assert.deepEqual(v, { viaLib: true, viaOpCommit: true, viaRefresh: true, viaValidate: true });
    } else {
      assert.deepEqual(v, { viaLib: false, viaOpCommit: false, viaRefresh: false, viaValidate: false });
    }
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
