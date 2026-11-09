import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { checkStyle } from '../scripts/lint.mjs';
import { buildGraph } from '../scripts/lib/graph.mjs';
import { DISPOSITIONS, DISPOSITIONS_FILE, findingId, contextHashOf, loadDispositions, reviewedBy } from '../scripts/lib/lint-dispositions.mjs';

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
  writeFileSync(join(root, 'raw/clippings/fox.md'), '---\ntitle: "Fox"\nsource: "https://example.test/fox"\ncreated: 2026-10-26\nquality: high\n---\nThe quick brown fox.\n');
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
});

// ---- Found in review of the first version: each of these failed on it, or passed only by accident. ----

const lintText = (root, args = []) => spawnSync(process.execPath, [join(SCRIPTS, 'lint.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, WIKI_MASTER_VAULT: root } }).stdout;
const crlf = (root, page, text) => writeFileSync(join(root, page), text.replace(/\r?\n/g, '\r\n'));

test('a citation in the contrast sentence itself covers it', (t) => {
  const v = vault(t);
  v.synth('self', 'It rose, but only slightly [[fox-page]].');
  assert.deepEqual(connective(v.root), []);
});

test('a list item, a heading and a table row each end the paragraph, so a later citation does not cover an earlier one', (t) => {
  const v = vault(t);
  v.synth('listy', '- It rose, but slowly.\n- A different claim is in [[fox-page]].');
  v.synth('headed', '## Rise\nIt rose, but slowly.\n\nElsewhere [[fox-page]].');
  v.synth('tabled', '| a | It rose, but slowly. |\n| b | cited [[fox-page]] |');
  const by = (page) => connective(v.root).filter((f) => f.page === `wiki/syntheses/${page}.md`).length;
  assert.equal(by('listy'), 1);
  assert.equal(by('headed'), 1);
  assert.equal(by('tabled'), 1);
});

test('the paragraph rules hold on a file with CRLF line endings', (t) => {
  const v = vault(t);
  const page = (name, body) => crlf(v.root, `wiki/syntheses/${name}.md`, `${FM('synthesis')}# ${name}\n${body}\n`);
  page('crlf-trailing', 'The score rose, but only slightly. Pay was flat.\n\nThe measurements are in [[fox-page]].\n\nIt rose, but slowly. See [[fox-page]].');
  page('crlf-split', 'The score rose, but only slightly.\n\nA different claim is in [[fox-page]].');
  const flagged = connective(v.root).map((f) => f.page);
  assert.equal(flagged.filter((p) => p.endsWith('crlf-trailing.md')).length, 1, 'only the first paragraph is uncovered: its citation is in a later paragraph, and the third paragraph cites after its own contrast');
  assert.equal(flagged.filter((p) => p.endsWith('crlf-split.md')).length, 1);
});

test('"as yet", "everyone but" and "yet another" are not contrasts, but "yet to" after a subject is still one', (t) => {
  const v = vault(t);
  v.synth('quiet', 'It is as yet unbuilt. Everyone but the owner agreed. Here is yet another example. It is yet to ship.');
  assert.deepEqual(connective(v.root), []);
  v.synth('loud', 'The tool is cheap, yet to many it is slow.\n\nYet to critics it failed.');
  assert.equal(connective(v.root).length, 2);
});

test('the id covers the page: the same sentence on two pages is two findings', (t) => {
  const v = vault(t);
  v.synth('one', 'It rose, but only slightly.');
  v.synth('two', 'It rose, but only slightly.');
  const ids = connective(v.root).map((f) => f.id);
  assert.equal(ids.length, 2);
  assert.notEqual(ids[0], ids[1]);
});

test('editing a neighbouring list item or a heading does not change the id of a flagged sentence', (t) => {
  const v = vault(t);
  v.concept('listed', '- alpha item\n- this is clearly wrong\n- gamma item');
  v.synth('headed', '## Exclusive power\nIt rose, but only slightly.');
  const ids = () => checkStyle(v.root, buildGraph(v.root)).map((f) => `${f.category}:${f.id}`).sort();
  const before = ids();
  v.concept('listed', '- alpha item, reworded\n- this is clearly wrong\n- gamma item also');
  v.synth('headed', '## A renamed heading\nIt rose, but only slightly.');
  assert.deepEqual(ids(), before);
});

test('a contrast-heavy page of tens of thousands of sentences is checked in linear time', (t) => {
  const v = vault(t);
  v.synth('huge', 'It rose, but slightly. '.repeat(40000));
  const started = Date.now();
  assert.equal(connective(v.root).length, 40000);
  assert.ok(Date.now() - started < 4000, `took ${Date.now() - started} ms`);
});

test('recording a style id outside the page scope fails cleanly and writes nothing', (t) => {
  const v = vault(t);
  v.synth('joint', 'It rose, but only slightly.');
  v.synth('other', 'Nothing here is contrasted.');
  const id = lintJson(v.root, ['--ids']).style[0].id;
  const out = record(v.root, [`--ids=${id}`, '--disposition=accepted', '--reviewer=tester', '--page=wiki/syntheses/other.md']);
  assert.equal(out.status, 2);
  assert.match(out.stderr, /outside the scope|flagged sentence/);
  assert.throws(() => readFileSync(v.file), /ENOENT/);
});

test('the text listing shows style ids on request, counts reviewed pointers, and lists their verdicts with --include-reviewed', (t) => {
  const v = vault(t);
  v.synth('joint', 'It rose, but only slightly.');
  v.synth('second', 'It fell, but only slightly.');
  const listed = lintText(v.root, ['--ids']);
  const ids = [...listed.matchAll(/\[([0-9a-f]{12})\]/g)].map((m) => m[1]);
  assert.equal(ids.length, 2, 'every id is shown, not only the first five of a category');
  assert.equal(record(v.root, [`--ids=${ids[0]}`, '--disposition=accepted', '--reviewer=tester', '--whole-vault']).status, 0);
  assert.match(lintText(v.root), /\(1 more with a recorded verdict, not listed\)/);
  assert.match(lintText(v.root, ['--include-reviewed']), /reviewed: accepted by tester/);
});

// ---- Found in review of the adopted version. ----

test('a page with CRLF line endings gives every style flag the same id as its LF copy', (t) => {
  const v = vault(t);
  // A line break inside the first 70 characters of the flagged sentence: those 70 characters are the recorded words.
  const synth = '# wrapped\nThe score rose sharply over the first quarter,\nbut only slightly across the whole long year.\n';
  const concept = '# wrapped-tone\nThis is clearly\nwrong for most readers. Some say\nit works.\n';
  const write = (eol) => {
    const to = (text) => (eol === 'crlf' ? text.replace(/\r?\n/g, '\r\n') : text);
    writeFileSync(join(v.root, 'wiki/syntheses/wrapped.md'), to(`${FM('synthesis')}${synth}`));
    writeFileSync(join(v.root, 'wiki/concepts/wrapped-tone.md'), to(`${FM('concept')}${concept}`));
  };
  const ids = () => checkStyle(v.root, buildGraph(v.root)).map((f) => `${f.page} ${f.category} ${f.id}`).sort();
  write('lf');
  const lf = ids();
  write('crlf');
  assert.deepEqual(ids(), lf, 'the line endings of a page do not change its style ids');
  // The LF ids as they were before line endings were normalized: existing verdicts keep matching.
  assert.deepEqual(lf, [
    'wiki/concepts/wrapped-tone.md editorializing 40f03bfbc736',
    'wiki/concepts/wrapped-tone.md weasel ff2a7400deff',
    'wiki/syntheses/wrapped.md connective 8546c7e5b9a4',
  ]);
});

test('a heading line ends the paragraph, so a citation under the heading does not cover the contrast above it', (t) => {
  const v = vault(t);
  v.synth('above', 'It rose, but slowly.\n## Next\nCited [[fox-page]].');
  assert.equal(connective(v.root).length, 1);
});

test('an excluded phrase changes only the tested copy: the id is built from the unedited sentence', (t) => {
  const v = vault(t);
  v.synth('mixed', 'The tool is not yet built, but it works.');
  const flagged = connective(v.root);
  assert.equal(flagged.length, 1, 'the real "but" is still flagged');
  const sentence = 'The tool is not yet built, but it works.';
  const page = 'wiki/syntheses/mixed.md';
  assert.equal(flagged[0].word, sentence.slice(0, 70));
  assert.equal(flagged[0].id, findingId({ page, quote: `connective: ${sentence.slice(0, 70)}`, evidenceHash: contextHashOf(sentence) }));
});

test('the count of reviewed style flags follows --page, as the listing above it does', (t) => {
  const v = vault(t);
  v.synth('joint', 'It rose, but only slightly.');
  v.synth('second', 'It fell, but only slightly.');
  const joint = lintJson(v.root, ['--ids']).style.find((f) => f.page === 'wiki/syntheses/joint.md');
  assert.equal(record(v.root, [`--ids=${joint.id}`, '--disposition=accepted', '--reviewer=tester', '--whole-vault']).status, 0);
  assert.equal(lintJson(v.root).tiers.styleReviewed, 1, 'without --page every reviewed flag is counted');
  assert.equal(lintJson(v.root, ['--page=joint']).tiers.styleReviewed, 1);
  assert.equal(lintJson(v.root, ['--page=second']).tiers.styleReviewed, 0);
  assert.match(lintText(v.root, ['--page=joint']), /\(1 more with a recorded verdict, not listed\)/);
  assert.doesNotMatch(lintText(v.root, ['--page=second']), /more with a recorded verdict/);
});

test('a lone carriage return is not a line break: paragraphs, flags and ids are as before line endings were normalized', (t) => {
  const v = vault(t);
  // A lone CR before a list marker or after a heading must not start a new paragraph: only CRLF is made LF.
  writeFileSync(join(v.root, 'wiki/syntheses/lone-cr.md'), `${FM('synthesis')}# lone-cr\nIt rose, but slowly.\r- item [[fox-page]].\n\n## H\rIt fell, but [[fox-page]] later.\n`);
  writeFileSync(join(v.root, 'wiki/concepts/lone-cr-tone.md'), `${FM('concept')}# lone-cr-tone\n- alpha\r- this is clearly wrong\r- gamma\n`);
  const flags = checkStyle(v.root, buildGraph(v.root)).map((f) => `${f.page} ${f.category} ${f.word} ${f.id}`);
  // The flags and ids the same pages gave before line endings were normalized.
  assert.deepEqual(flags, ['wiki/concepts/lone-cr-tone.md editorializing clearly 9c6bbe14781b']);
  assert.equal(flags[0].split(' ').pop(), findingId({ page: 'wiki/concepts/lone-cr-tone.md', quote: 'editorializing: clearly', evidenceHash: contextHashOf('- alpha\r- this is clearly wrong\r- gamma') }));
});

// ---- Word senses that are not the flagged use, and the source-wording verdict. ----

const flagsOf = (root, page) => checkStyle(root, buildGraph(root)).filter((f) => f.page === page).map((f) => `${f.category} ${f.word}`);

test('"of course" is flagged only as a discourse marker, not inside a noun phrase or "as a matter of course"', (t) => {
  const v = vault(t);
  v.concept('quiet-course', 'A list of course concepts follows.\n\nIt happened as a matter of course.');
  v.concept('loud-comma', 'This is, of course, wrong.');
  v.concept('loud-verb', 'It is of course wrong.');
  v.concept('loud-and', 'And of course it fails.');
  assert.deepEqual(flagsOf(v.root, 'wiki/concepts/quiet-course.md'), []);
  v.concept('loud-paren', '(of course)');
  v.concept('loud-dash', 'It works — of course — well.');
  for (const page of ['loud-comma', 'loud-verb', 'loud-and', 'loud-paren', 'loud-dash']) assert.deepEqual(flagsOf(v.root, `wiki/concepts/${page}.md`), ['editorializing of course'], page);
});

test('"of course" at the start of a Markdown line is a discourse marker after list, heading, quote and emphasis marks', (t) => {
  const v = vault(t);
  const loud = {
    'line-bullet': '- Of course it fails.',
    'line-heading': '## Of course',
    'line-quote': '> Of course it fails.',
    'line-strong': '**Of course**, it fails.',
    'line-em': '*Of course* it fails.',
    'line-numbered': '1. Of course it fails.',
    'line-paren-numbered': '1) Of course it fails.',
    'line-nested': '> - Of course it fails.',
    'line-indented': 'Text first.\n\n  - Of course it fails.',
  };
  for (const [name, body] of Object.entries(loud)) v.concept(name, body);
  v.concept('quiet-list', 'Here is a list of course concepts.');
  v.concept('quiet-name', 'Students of Course 101 passed.');
  for (const name of Object.keys(loud)) assert.deepEqual(flagsOf(v.root, `wiki/concepts/${name}.md`), ['editorializing of course'], name);
  for (const name of ['quiet-list', 'quiet-name']) assert.deepEqual(flagsOf(v.root, `wiki/concepts/${name}.md`), [], name);
});

test('"however" before a degree word is not a connective, and "However," before the same word still is', (t) => {
  const v = vault(t);
  v.synth('degree', 'It splits however many clauses it takes.');
  v.synth('contrast', 'However, many disagree.');
  // Only one space counts: across a line break "however" is read as a contrast again.
  v.synth('line-break', 'however\nmany clauses it takes.');
  assert.deepEqual(connective(v.root).map((f) => `${f.page} ${f.word}`), ['wiki/syntheses/contrast.md However, many disagree.', 'wiki/syntheses/line-break.md however\nmany clauses it takes.']);
});

test('the sense rules remove flags and change no other flag\'s id', (t) => {
  const v = vault(t);
  // Each page mixes removed phrases with flags that stay. The ids that stay are those the build before the rules gave.
  v.concept('mixed-tone', 'Of course, the rule is clearly simple. A list of course concepts follows. As a matter of course, it is notably fine.');
  v.concept('course-list', 'This is clearly a list of course concepts.');
  v.synth('mixed-joint', 'However many clauses it takes, the rule holds, but lists fail.\n\nHowever much it costs, it ships.\n\nThe tool works, but slowly.\n\nHowever, many disagree.');
  const flags = checkStyle(v.root, buildGraph(v.root)).map((f) => `${f.page} ${f.category} ${f.word} ${f.id}`);
  assert.deepEqual(flags, [
    'wiki/concepts/course-list.md editorializing clearly 12493312cb4a',
    'wiki/concepts/mixed-tone.md editorializing clearly 9c27e76e68c2',
    'wiki/concepts/mixed-tone.md editorializing notably 83e3929965d8',
    // Still a discourse marker in the first sentence: its id still covers every sentence holding the words.
    'wiki/concepts/mixed-tone.md editorializing of course 2583463cac2e',
    'wiki/syntheses/mixed-joint.md connective However many clauses it takes, the rule holds, but lists fail. b6579e5eb46e',
    'wiki/syntheses/mixed-joint.md connective The tool works, but slowly. e3ce1a536840',
    'wiki/syntheses/mixed-joint.md connective However, many disagree. 01a18c15cfbf',
  ]);
});

test('a sentence holding a removed phrase and a flag that stays keeps that flag, with the id of the unedited sentence', (t) => {
  const v = vault(t);
  const joint = 'However many clauses it takes, the rule holds, but lists fail.';
  const tone = 'This is clearly a list of course concepts.';
  v.synth('joint', joint);
  v.concept('tone', tone);
  const synthPage = 'wiki/syntheses/joint.md';
  const conceptPage = 'wiki/concepts/tone.md';
  const flags = checkStyle(v.root, buildGraph(v.root));
  const [c] = flags.filter((f) => f.page === synthPage);
  assert.equal(c.category, 'connective', 'the real "but" stays flagged');
  assert.equal(c.word, joint.slice(0, 70));
  assert.equal(c.id, findingId({ page: synthPage, quote: `connective: ${joint.slice(0, 70)}`, evidenceHash: contextHashOf(joint) }));
  assert.deepEqual(flags.filter((f) => f.page === conceptPage).map((f) => [f.word, f.id]), [
    ['clearly', findingId({ page: conceptPage, quote: 'editorializing: clearly', evidenceHash: contextHashOf(tone) })],
  ]);
});

test('source-wording is recorded for a style flag and hides it', (t) => {
  const v = vault(t);
  v.synth('joint', 'It rose, but only slightly.');
  const [flag] = lintJson(v.root, ['--ids']).style;
  const done = record(v.root, [`--ids=${flag.id}`, '--disposition=source-wording', '--reviewer=tester', '--page=wiki/syntheses/joint.md']);
  assert.equal(done.status, 0, done.stderr);
  const lines = readFileSync(v.file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].id, flag.id);
  assert.equal(lines[0].disposition, 'source-wording');
  assert.equal(lines[0].tier, 'style');
  const after = lintJson(v.root, ['--ids']);
  assert.deepEqual(after.style, []);
  assert.equal(after.tiers.styleReviewed, 1);
});

test('source-wording on a quote finding exits 2 and writes nothing', (t) => {
  const v = vault(t);
  v.concept('quoted', 'It says "a totally invented sentence about foxes and rivers" here.');
  const [quote] = lintJson(v.root, ['--ids']).findings;
  const out = record(v.root, [`--ids=${quote.id}`, '--disposition=source-wording', '--reviewer=tester', '--whole-vault']);
  assert.equal(out.status, 2);
  assert.match(out.stderr, new RegExp(`source-wording.*${quote.id}`));
  assert.throws(() => readFileSync(v.file), /ENOENT/);
});

test('a dispositions file holding a source-wording line is read, and the verdict hides its finding', (t) => {
  const v = vault(t);
  assert.ok(DISPOSITIONS.includes('source-wording'));
  writeFileSync(v.file, `${JSON.stringify({ v: 1, id: 'abcdef012345', page: 'wiki/syntheses/joint.md', quote: 'connective: It rose, but only slightly.', evidence: '0123456789abcdef', tier: 'style', disposition: 'source-wording', reviewer: 'tester', date: '2026-11-08' })}\n`);
  const read = loadDispositions(v.file);
  assert.equal(read.get('abcdef012345').disposition, 'source-wording');
  assert.equal(reviewedBy(read, { id: 'abcdef012345' }).disposition, 'source-wording');
});
