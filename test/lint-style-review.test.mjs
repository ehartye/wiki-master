import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { checkStyle } from '../scripts/lint.mjs';
import { buildGraph } from '../scripts/lib/graph.mjs';
import { DISPOSITIONS_FILE } from '../scripts/lib/lint-dispositions.mjs';

// Style flags are review pointers. Two things made them useless to review: most connective flags were sentences whose
// paragraph ends in the citation (the trailing-citation convention), and a pointer someone had read came back on every
// run because it had no id to record a verdict against.

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const FM = (type, extra = '') => `---\ntype: ${type}\ncreated: 2026-10-01\nupdated: 2026-10-20\nstatus: maintained\nsources: ["[[fox-page]]"]\nai-generated: true\n${extra}---\n`;

function vault(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-lint-style-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const d of ['raw/clippings', 'wiki/concepts', 'wiki/sources', 'wiki/syntheses']) mkdirSync(join(root, d), { recursive: true });
  writeFileSync(join(root, 'index.md'), '---\ntype: synthesis\n---\n# Index\n');
  writeFileSync(join(root, 'raw/clippings/fox.md'), '---\ntitle: "Fox"\nsource: "https://example.com/fox"\ncreated: 2026-10-26\nquality: high\n---\nThe quick brown fox.\n');
  writeFileSync(join(root, 'wiki/sources/fox-page.md'), '---\ntype: source\ncreated: 2026-10-26\nstatus: maintained\nsources: ["[[fox]]"]\nai-generated: true\n---\n# Fox page\nA summary.\n');
  const synth = (name, body) => writeFileSync(join(root, `wiki/syntheses/${name}.md`), `${FM('synthesis')}# ${name}\n${body}\n`);
  const concept = (name, body) => writeFileSync(join(root, `wiki/concepts/${name}.md`), `${FM('concept')}# ${name}\n${body}\n`);
  return { root, synth, concept, file: join(root, DISPOSITIONS_FILE) };
}
const connective = (root) => checkStyle(root, buildGraph(root)).filter((f) => f.category === 'connective');
const lintJson = (root, args = []) => JSON.parse(spawnSync(process.execPath, [join(SCRIPTS, 'lint.mjs'), '--json', ...args], { encoding: 'utf8', env: { ...process.env, WIKI_MASTER_VAULT: root } }).stdout);
const record = (root, args) => spawnSync(process.execPath, [join(SCRIPTS, 'lint-disposition.mjs'), 'record', ...args], { encoding: 'utf8', env: { ...process.env, WIKI_MASTER_VAULT: root } });

test('a citation later in the paragraph covers an earlier contrast sentence (the trailing-citation convention)', (t) => {
  const v = vault(t);
  v.synth('trailing', 'The score rose, but only slightly. Pay was flat. The measurements are in [[fox-page]].');
  assert.deepEqual(connective(v.root), []);
});

test('a citation only before the contrast sentence does not cover it', (t) => {
  const v = vault(t);
  v.synth('leading', 'The trial showed improvement per [[fox-page]]. However the program failed despite the numbers.');
  assert.equal(connective(v.root).length, 1);
});

test('a paragraph with no citation is flagged, and a citation in the next paragraph does not cover it', (t) => {
  const v = vault(t);
  v.synth('uncited', 'The score rose, but only slightly.\n\nA different claim is in [[fox-page]].');
  assert.equal(connective(v.root).length, 1);
});

test('"not yet", "yet to" and "nothing but" are not contrast connectives, and a real "but" still is', (t) => {
  const v = vault(t);
  v.synth('senses', 'The tool is not yet built. It is yet to ship. Nothing but a stub exists.\n\nThe tool works, but badly.');
  const flagged = connective(v.root);
  assert.equal(flagged.length, 1);
  assert.match(flagged[0].word, /works, but badly/);
});

test('every style finding carries a 12-hex id that is stable and follows the flagged text', (t) => {
  const v = vault(t);
  v.concept('tone', 'This is clearly wrong. A second sentence follows.');
  v.synth('joint', 'It rose, but only slightly.');
  const first = checkStyle(v.root, buildGraph(v.root));
  assert.ok(first.length >= 2);
  for (const f of first) assert.match(f.id, /^[0-9a-f]{12}$/);
  assert.deepEqual(checkStyle(v.root, buildGraph(v.root)).map((f) => f.id), first.map((f) => f.id), 'the same page gives the same ids');
  const toneId = first.find((f) => f.category === 'editorializing').id;
  const jointId = first.find((f) => f.category === 'connective').id;
  v.concept('tone', 'This is clearly and completely wrong. A second sentence follows.');
  v.synth('joint', 'It rose, but only slightly, and then fell.');
  const second = checkStyle(v.root, buildGraph(v.root));
  assert.notEqual(second.find((f) => f.category === 'editorializing').id, toneId, 'rewording the flagged sentence is a new finding');
  assert.notEqual(second.find((f) => f.category === 'connective').id, jointId, 'the id covers the whole sentence, not its first 70 characters');
});

test('lint --json shows a style id only with --ids', (t) => {
  const v = vault(t);
  v.synth('joint', 'It rose, but only slightly.');
  assert.equal(lintJson(v.root).style[0].id, undefined);
  assert.match(lintJson(v.root, ['--ids']).style[0].id, /^[0-9a-f]{12}$/);
});

test('a recorded verdict hides a style pointer, --include-reviewed lists it, and rewording brings it back', (t) => {
  const v = vault(t);
  v.concept('tone', 'This is clearly wrong.');
  v.synth('joint', 'It rose, but only slightly.');
  const before = lintJson(v.root, ['--ids']).style;
  assert.equal(before.length, 2);
  const joint = before.find((f) => f.category === 'connective');
  const done = record(v.root, [`--ids=${joint.id}`, '--disposition=accepted', '--reviewer=tester', '--note=plain contrast, one source', '--page=wiki/syntheses/joint.md']);
  assert.equal(done.status, 0, done.stderr);
  const after = lintJson(v.root, ['--ids']);
  assert.deepEqual(after.style.map((f) => f.category), ['editorializing'], 'the reviewed pointer is not listed');
  assert.equal(after.tiers.styleReviewed, 1);
  const withReviewed = lintJson(v.root, ['--ids', '--include-reviewed']).style.find((f) => f.category === 'connective');
  assert.equal(withReviewed.reviewed.disposition, 'accepted');
  assert.equal(withReviewed.reviewed.reviewer, 'tester');
  v.synth('joint', 'It rose, but only slightly, and then fell.');
  assert.equal(lintJson(v.root, ['--ids']).style.length, 2, 'a reworded sentence is read again');
});

test('recording a style id that matches nothing names it and writes nothing', (t) => {
  const v = vault(t);
  v.synth('joint', 'It rose, but only slightly.');
  const bad = record(v.root, ['--ids=000000000000', '--disposition=accepted', '--reviewer=tester', '--whole-vault']);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /000000000000/);
  assert.throws(() => readFileSync(v.file), /ENOENT/);
});

test('a style record leaves quote verdicts alone, and an older reader that only matches quote ids ignores it', (t) => {
  const v = vault(t);
  v.concept('quoted', 'It says "a totally invented sentence about foxes and rivers" here, clearly.');
  const quoteId = lintJson(v.root, ['--ids']).findings[0].id;
  const styleId = lintJson(v.root, ['--ids']).style[0].id;
  assert.equal(record(v.root, [`--ids=${quoteId}`, '--disposition=own-wording', '--reviewer=tester', '--whole-vault']).status, 0);
  assert.equal(record(v.root, [`--ids=${styleId}`, '--disposition=accepted', '--reviewer=tester', '--whole-vault']).status, 0);
  const lines = readFileSync(v.file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 2);
  assert.ok(lines.every((r) => r.v === 1 && typeof r.id === 'string' && r.page && r.disposition), 'both records have the shape the existing reader requires');
  assert.equal(lintJson(v.root, ['--ids']).findings.length, 0, 'the quote verdict still hides its finding');
  appendFileSync(v.file, '');
});
