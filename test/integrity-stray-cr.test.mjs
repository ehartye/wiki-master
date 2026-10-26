import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import * as health from '../scripts/health.mjs';
import { strayCarriageReturn } from '../scripts/lib/note.mjs';
import { integrityReport } from '../scripts/lib/integrity.mjs';

// A carriage return that is not half of a CRLF (a doubled one, `\r\r\n`, or one left behind by a tool that wrote
// `\r \r`) corrupted a page's frontmatter once, and the page then dropped out of its catalog for about two months.
// Frontmatter damage is a named defect (0.61.0). A stray return in the body leaves the page readable, so `health`
// now only reports it, unscored, so it is seen: it never changes the defect count or the status.

const BODY = 'This original page explains how the importer decides which of the two settings wins when they disagree.';
const FM = ['type: authored', 'created: 2026-01-01', 'updated: 2026-01-01', 'status: draft', 'sources: []'];
const CR = String.fromCharCode(13);
const page = (eol, body = BODY) => ['---', ...FM, '---', body, ''].join(eol);

function fixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'wiki-cr-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  return { root, scan: () => health.scanIntegrity(root) };
}

test('strayCarriageReturn finds a return that is not half of a CRLF, and gives its line', () => {
  assert.equal(strayCarriageReturn(`a${CR}${CR}\nb\n`), 1, 'a doubled return on line 1');
  assert.equal(strayCarriageReturn(`one\ntwo\nthree${CR} four\n`), 3);
  assert.equal(strayCarriageReturn(`one\r\ntwo\r\nthree${CR}${CR}\r\nfour\r\n`), 3, 'in an otherwise CRLF page');
  assert.equal(strayCarriageReturn('one\r\ntwo\r\nthree\r\n'), 0, 'a CRLF page has none');
  assert.equal(strayCarriageReturn('one\ntwo\n'), 0);
  assert.equal(strayCarriageReturn(`text${CR}`), 1, 'a lone return at the very end');
});

test('health lists a page with a stray return in its body, unscored, and its defect count does not move', (t) => {
  const stray = 'wiki/authored/proj/notes/stray.md';
  const clean = 'wiki/authored/proj/notes/clean.md';
  const withStray = fixture(t, { [stray]: page('\n', `${BODY}\nA paragraph${CR}${CR}\nthat has a doubled return.`), [clean]: page('\n') });
  const withoutStray = fixture(t, { [clean]: page('\n') });
  const a = withStray.scan(); const b = withoutStray.scan();
  assert.deepEqual(a.strayCarriageReturns, [{ page: stray, line: 9 }]);
  assert.deepEqual(b.strayCarriageReturns, []);
  assert.equal(a.defectCount, b.defectCount, 'the stray return is not a defect');
  assert.equal(a.status, b.status);
  assert.match(integrityReport(a), /Stray carriage returns: 1 page\(s\)/);
});

test('an all-CRLF page, and a raw or log file with a stray return, are not listed', (t) => {
  const r = fixture(t, {
    'wiki/authored/proj/notes/windows.md': page('\r\n'),
    'raw/clippings/captured.md': `captured text${CR}${CR}\nmore\n`,
    'log/2026-01-01-entry.md': `entry${CR}${CR}\ntext\n`,
  }).scan();
  assert.deepEqual(r.strayCarriageReturns, []);
});

test('the report says nothing about stray returns when there are none', (t) => {
  const r = fixture(t, { 'wiki/authored/proj/notes/clean.md': page('\n') }).scan();
  assert.doesNotMatch(integrityReport(r), /Stray carriage/);
});

test('a page whose frontmatter is damaged is both a defect and listed', (t) => {
  const path = 'wiki/authored/proj/guide.md';
  const r = fixture(t, { [path]: page(CR + CR + String.fromCharCode(10)) }).scan();
  assert.ok(r.issues.some((i) => i.source === path && i.rule === 'malformed-frontmatter'));
  assert.ok(r.strayCarriageReturns.some((x) => x.page === path));
});
