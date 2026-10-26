import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import * as health from '../scripts/health.mjs';
import { frontmatterDamage } from '../scripts/lib/note.mjs';

// A page whose frontmatter fence carries a doubled carriage return (`---\r\r\n`) parses with no metadata
// at all. health used to report that as `missing-evidence` on a page that declares `sources: []`, which
// sent the reader to the wrong place. The damage is now its own named issue.

const BODY = 'This original page explains how the importer decides which of the two settings wins when they disagree.';
const FM = ['type: authored', 'created: 2026-01-01', 'updated: 2026-01-01', 'status: draft', 'sources: []'];
const page = (eol, { open = '---', close = '---', fm = FM, body = BODY } = {}) => [open, ...fm, close, body, ''].join(eol);

function fixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'wiki-fm-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  return { root, scan: () => health.scanIntegrity(root) };
}
const ruleOf = (scan, path) => scan.issues.filter(i => i.source === path).map(i => i.rule);

test('a doubled carriage return on the fence is one named issue, not a missing-evidence on the wrong page', t => {
  const path = 'wiki/authored/proj/guide.md';
  const r = fixture(t, { [path]: page('\r\r\n') }).scan();
  assert.deepEqual(ruleOf(r, path), ['malformed-frontmatter']);
  const issue = r.issues[0];
  assert.equal(issue.line, 1);
  assert.match(issue.evidence, /carriage return/i);
  assert.ok(issue.verification, 'the worklist tells the reader how to verify the repair');
  assert.equal(r.defectCount, 1);
  assert.ok(r.coverage.checks.includes('malformed-frontmatter'));
});

test('the same page written with plain LF, plain CRLF or a BOM is clean', t => {
  const r = fixture(t, {
    'wiki/authored/proj/lf.md': page('\n'),
    'wiki/authored/proj/crlf.md': page('\r\n'),
    'wiki/authored/proj/bom.md': `﻿${page('\n')}`,
  }).scan();
  assert.deepEqual(r.issues, []);
});

test('a lone carriage return inside the frontmatter is named at its own line even though the block still parses', t => {
  const path = 'wiki/authored/proj/lone.md';
  const text = ['---', 'type: authored', 'status: draft', 'sources: []\rcreated: 2026-01-01', '---', BODY, ''].join('\n');
  const r = fixture(t, { [path]: text }).scan();
  const hit = r.issues.filter(i => i.source === path);
  assert.deepEqual(hit.map(i => i.rule), ['malformed-frontmatter']);
  assert.equal(hit[0].line, 4);
});

test('damage elsewhere in the page is not frontmatter damage: a stray CR in the body parses correctly', t => {
  const path = 'wiki/authored/proj/body.md';
  const r = fixture(t, { [path]: page('\r\n', { body: `${BODY}\r\r\nA second paragraph.` }) }).scan();
  assert.deepEqual(r.issues, []);
});

test('a page that does not start with a fence has no frontmatter to damage', t => {
  const r = fixture(t, {
    'wiki/authored/proj/plain.md': `# Heading\n\n${BODY}\n`,
    'wiki/authored/proj/rule.md': `# Heading\n\n---\n\n${BODY}\n`,
  }).scan();
  assert.deepEqual(r.issues.filter(i => i.rule === 'malformed-frontmatter'), []);
});

test('an opening fence that is never closed is named, because no metadata is read', t => {
  const path = 'wiki/authored/proj/open.md';
  const r = fixture(t, { [path]: ['---', ...FM, '', BODY, ''].join('\n') }).scan();
  const hit = r.issues.find(i => i.source === path && i.rule === 'malformed-frontmatter');
  assert.ok(hit, `rules: ${ruleOf(r, path)}`);
  assert.match(hit.evidence, /not closed|no metadata|not read/i);
});

test('the other checks still run on a damaged page: a broken citation is reported beside it', t => {
  const path = 'wiki/sources/damaged.md';
  const text = page('\r\r\n', { fm: ['type: source', 'status: maintained', 'sources: ["[[raw/clippings/absent.md]]"]'] });
  const r = fixture(t, { [path]: text }).scan();
  assert.ok(ruleOf(r, path).includes('malformed-frontmatter'));
  assert.ok(!ruleOf(r, path).includes('missing-evidence'), 'the damage explains the missing trail; it is not a second defect');
});

test('many stray carriage returns in one page are one issue with a stable id', t => {
  const path = 'wiki/authored/proj/many.md';
  const files = { [path]: page('\r\r\n') };
  const a = fixture(t, files).scan();
  const b = fixture(t, files).scan();
  assert.equal(a.issues.filter(i => i.source === path).length, 1);
  assert.equal(a.issues[0].id, b.issues[0].id);
});

test('frontmatterDamage: the pure check, on the shapes that matter', () => {
  assert.equal(frontmatterDamage(page('\n')), null);
  assert.equal(frontmatterDamage(page('\r\n')), null);
  assert.equal(frontmatterDamage('no fence at all\n'), null);
  assert.equal(frontmatterDamage(''), null);
  assert.equal(frontmatterDamage(page('\r\r\n')).line, 1);
  assert.equal(frontmatterDamage('---\ntype: x\nsources: []\r\n---\nbody\n'), null, 'a CRLF inside an LF block is a mixed ending, not a stray CR');
  assert.equal(frontmatterDamage('---\ntype: x\ra: b\n---\nbody\n').line, 2, 'lines are counted by LF, so the CR is on the line it sits in');
});
