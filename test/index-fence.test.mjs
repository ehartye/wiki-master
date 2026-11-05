import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { BEGIN_MARK, END_MARK, LEGACY_BEGIN_MARKS, fenceSpans, writeFence } from '../scripts/lib/index-fence.mjs';
import { regenerateIndex } from '../scripts/index-gen.mjs';
import { regenerateBacklogRoadmaps } from '../scripts/backlog-gen.mjs';
import { regenerateAuthoredMocs } from '../scripts/moc-authored-gen.mjs';

// The exact bytes a vault holds today, em dash included. They are spelled out here so a change to the constants
// fails instead of quietly appending a second fence to every generated file.
const named = (script) => `%% BEGIN GENERATED CATALOG — edits inside this fence are overwritten; run scripts/${script}.mjs %%`;
const NEW = named('refresh-index');
const OLD = ['index-gen', 'backlog-gen', 'moc-authored-gen'].map(named);
const END = '%% END GENERATED CATALOG %%';
const fence = (begin, body = '- [[stale]]') => `${begin}\n${body}\n${END}`;
const FRESH = fence(NEW, '- [[fresh]]');
const countBegins = (text) => text.split('%% BEGIN GENERATED CATALOG').length - 1;
const countEnds = (text) => text.split(END).length - 1;

test('the markers are byte-exact, and the three old ones are all accepted', () => {
  assert.equal(BEGIN_MARK, NEW);
  assert.equal(END_MARK, END);
  assert.deepEqual([...LEGACY_BEGIN_MARKS].sort(), [...OLD].sort());
});

test('fenceSpans finds old and new fences in order, and nothing in a file without one', () => {
  const text = `intro\n${fence(OLD[0])}\nmiddle\n${fence(NEW)}\ntail\n`;
  const spans = fenceSpans(text);
  assert.equal(spans.length, 2);
  assert.equal(text.slice(spans[0].start, spans[0].end), fence(OLD[0]));
  assert.equal(text.slice(spans[1].start, spans[1].end), fence(NEW));
  assert.equal(spans[0].closed, true);
  assert.deepEqual(fenceSpans('no fence here\n'), []);
});

for (const begin of [NEW, ...OLD]) {
  test(`writeFence replaces one fence and keeps its framing: ${begin.slice(-30)}`, () => {
    const out = writeFence(`---\ntype: moc\n---\n# Hand\n\nabove\n\n${fence(begin)}\n\nbelow\n`, FRESH);
    assert.equal(out, `---\ntype: moc\n---\n# Hand\n\nabove\n\n${FRESH}\n\nbelow\n`);
    assert.equal(writeFence(out, FRESH), out, 'a second write changes nothing');
  });
}

for (const [label, first, second] of [
  ['old then new', OLD[1], NEW],
  ['new then old', NEW, OLD[2]],
  ['two old', OLD[0], OLD[0]],
  ['two different old', OLD[1], OLD[2]],
  ['two new', NEW, NEW],
]) {
  test(`writeFence collapses ${label} into one new fence and keeps every word of the framing`, () => {
    const out = writeFence(`# Hand\n\nabove\n\n${fence(first)}\n\nmiddle\n\n${fence(second, '- [[other]]')}\n\nbelow\n`, FRESH);
    assert.equal(out, `# Hand\n\nabove\n\n${FRESH}\n\nmiddle\n\nbelow\n`);
    assert.equal(countBegins(out), 1);
    assert.equal(writeFence(out, FRESH), out);
  });
}

test('writeFence collapses three fences, one of them right after another, and leaves no blank-line debris', () => {
  const out = writeFence(`above\n\n${fence(OLD[0])}\n\n${fence(NEW)}\n\n${fence(OLD[1])}\n`, FRESH);
  assert.equal(out, `above\n\n${FRESH}\n`);
});

test('a fence a line-union merge produced, with both begin lines inside it, ends as one fence', () => {
  const out = writeFence(`above\n\n${NEW}\n- [[a]]\n${OLD[0]}\n- [[b]]\n${END}\n\nbelow\n`, FRESH);
  assert.equal(out, `above\n\n${FRESH}\n\nbelow\n`);
});

test('with no fence one is appended and the existing text is untouched', () => {
  assert.equal(writeFence('# Hand\n\nprose\n', FRESH), `# Hand\n\nprose\n\n${FRESH}\n`);
  assert.equal(writeFence('', FRESH), `\n\n${FRESH}\n`);
});

test('a begin marker with no end is replaced in place, so the prose after it survives and the next run is stable', () => {
  const once = writeFence(`above\n\n${OLD[0]}\n\nprose after\n`, FRESH);
  assert.equal(once, `above\n\n${FRESH}\n\nprose after\n`);
  assert.equal(writeFence(once, FRESH), once);
  const trailing = writeFence(`${fence(NEW)}\n\nprose\n\n${OLD[1]}\n\nmore\n`, FRESH);
  assert.equal(trailing, `${FRESH}\n\nprose\n\nmore\n`);
});

test('an end marker with no begin is framing: a fence is still placed and the text stays', () => {
  const out = writeFence(`${END}\n\nprose\n`, FRESH);
  assert.equal(out, `${END}\n\nprose\n\n${FRESH}\n`);
  assert.equal(writeFence(out, FRESH), out);
  assert.equal(writeFence(`${END}\nprose\n\n${fence(OLD[0])}\n`, FRESH), `${END}\nprose\n\n${FRESH}\n`);
});

test('CRLF framing is kept byte for byte', () => {
  const out = writeFence(`above\r\n\r\n${fence(OLD[0])}\r\n\r\nmiddle\r\n\r\n${fence(NEW)}\r\n\r\nbelow\r\n`, FRESH);
  assert.equal(out, `above\r\n\r\n${FRESH}\r\n\r\nmiddle\r\n\r\nbelow\r\n`);
});

// ---- the three writers ----

function vault(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'wm-fence-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  return root;
}
const page = (kind, status = '') => `---\ntype: authored\nproject: alpha\nkind: ${kind}\n${status}sources: []\n---\n# A page\n`;
const PAGES = {
  'wiki/authored/alpha/overview.md': page('overview'),
  'wiki/authored/alpha/guide.md': page('guide'),
  'wiki/authored/alpha/backlog/task.md': page('backlog-item', 'backlog-status: planned\n'),
};
const framed = (begin) => `---\ntype: x\n---\n# Hand-written\n\nAbove the fence.\n\n${fence(begin)}\n\nBelow the fence.\n`;
const assertMigrated = (text) => {
  assert.equal(countBegins(text), 1, text);
  assert.equal(countEnds(text), 1, text);
  assert.ok(text.includes(NEW), text);
  for (const old of OLD) assert.ok(!text.includes(old), text);
  assert.match(text, /# Hand-written\n\nAbove the fence\.\n\n%% BEGIN/);
  assert.match(text, /%% END GENERATED CATALOG %%\n\nBelow the fence\.\n$/);
};

const WRITERS = [
  ['index.md', 'index.md', 'index-gen', (root) => regenerateIndex(root, { apply: true })],
  ['roadmap', 'wiki/authored/alpha/roadmap.md', 'backlog-gen', (root) => regenerateBacklogRoadmaps(root, { apply: true })],
  ['project map', 'moc/alpha.md', 'moc-authored-gen', (root) => regenerateAuthoredMocs(root, { apply: true })],
];

for (const [label, path, script, write] of WRITERS) {
  test(`${label}: its old fence becomes one new fence with the framing kept, and a second run changes nothing`, (t) => {
    const root = vault(t, { ...PAGES, [path]: framed(named(script)) });
    write(root);
    const text = readFileSync(join(root, path), 'utf8');
    assertMigrated(text);
    write(root);
    assert.equal(readFileSync(join(root, path), 'utf8'), text);
  });

  test(`${label}: an old fence appended beside a new one collapses`, (t) => {
    const root = vault(t, { ...PAGES, [path]: `${framed(NEW)}\n${fence(named(script), '- [[appended]]')}\n` });
    write(root);
    const text = readFileSync(join(root, path), 'utf8');
    assert.equal(countBegins(text), 1, text);
    assert.ok(text.includes(NEW));
    assert.ok(!text.includes('appended'));
    assert.match(text, /Below the fence\.\n$/);
  });

  test(`${label}: a fresh file gets the new marker`, (t) => {
    const root = vault(t, PAGES);
    write(root);
    const text = readFileSync(join(root, path), 'utf8');
    assert.equal(countBegins(text), 1, text);
    assert.ok(text.includes(NEW));
  });
}
