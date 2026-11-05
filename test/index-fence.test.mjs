import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { BEGIN_MARK, END_MARK, LEGACY_BEGIN_MARKS, fenceSpans, writeFence } from '../scripts/lib/index-fence.mjs';
import { regenerateIndex, regenerateBacklogRoadmaps, regenerateAuthoredMocs } from '../scripts/lib/catalogs.mjs';

// The exact bytes of the new marker, em dash included, spelled out so a change to the constant fails instead of quietly
// appending a second fence to every generated file. The old markers name commands that are gone, and lib/index-fence.mjs
// is the only place allowed to spell them, so they are pinned below by a hash of their bytes.
const NEW = '%% BEGIN GENERATED CATALOG — edits inside this fence are overwritten; run scripts/refresh-index.mjs %%';
const OLD = [...LEGACY_BEGIN_MARKS];
const OLD_MARKS_SHA256 = '6a8c34ce10b19bf891dd67ec50b33e3a06960a08c9a5937bf04be7f66f4161c2';
const END = '%% END GENERATED CATALOG %%';
const fence = (begin, body = '- [[stale]]') => `${begin}\n${body}\n${END}`;
const FRESH = fence(NEW, '- [[fresh]]');
const countBegins = (text) => text.split('%% BEGIN GENERATED CATALOG').length - 1;
const countEnds = (text) => text.split(END).length - 1;

test('the markers are byte-exact, and the three old ones are all accepted', () => {
  assert.equal(BEGIN_MARK, NEW);
  assert.equal(END_MARK, END);
  assert.equal(OLD.length, 3);
  assert.equal(createHash('sha256').update(OLD.join('\n')).digest('hex'), OLD_MARKS_SHA256, 'a vault still holds these exact bytes');
  for (const old of OLD) assert.match(old, /^%% BEGIN GENERATED CATALOG — edits inside this fence are overwritten; run scripts\/[a-z-]+\.mjs %%$/);
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

// ---- a marker counts only as a whole line outside code ----

const block = (...lines) => ['```', ...lines, '```'].join('\n');

test('a marker quoted in a code block above the real fence keeps everything between them', () => {
  const head = `# Hand\n\nThe fence looks like this:\n\n${block(OLD[0])}\n\nProse that must survive.\n\n`;
  const out = writeFence(`${head}${fence(OLD[1])}\n\nBelow.\n`, FRESH);
  assert.equal(out, `${head}${FRESH}\n\nBelow.\n`);
  assert.equal(writeFence(out, FRESH), out);
});

test('a marker quoted inline, above or below the real fence, is plain text', () => {
  const inline = (m) => `The line \`${m}\` opens a fence.`;
  const above = `${inline(OLD[0])}\n\nProse.\n\n${fence(NEW)}\n`;
  assert.equal(writeFence(above, FRESH), `${inline(OLD[0])}\n\nProse.\n\n${FRESH}\n`);
  const below = `${fence(NEW)}\n\nProse.\n\n${inline(OLD[2])} And ${END} closes it.\n`;
  assert.equal(writeFence(below, FRESH), `${FRESH}\n\nProse.\n\n${inline(OLD[2])} And ${END} closes it.\n`);
  const unquoted = `${fence(NEW)}\n\nProse naming ${OLD[1]} mid-sentence.\n`;
  assert.equal(writeFence(unquoted, FRESH), `${FRESH}\n\nProse naming ${OLD[1]} mid-sentence.\n`);
});

test('a complete fence shown as a code-block example is left whole, beside the real one', () => {
  const example = `${block(OLD[0], '- [[example]]', END)}\n\n`;
  const out = writeFence(`${example}${fence(NEW)}\n`, FRESH);
  assert.equal(out, `${example}${FRESH}\n`);
  assert.equal(fenceSpans(example).length, 0);
});

test('a quoted pair with no real fence gets the catalog appended outside the code block, and stays stable', () => {
  const text = `# Hand\n\n${block(OLD[0], '- [[example]]', END)}\n\nAfter.\n`;
  const out = writeFence(text, FRESH);
  assert.equal(out, `${text.trimEnd()}\n\n${FRESH}\n`);
  assert.equal(writeFence(out, FRESH), out);
});

test('tilde blocks, longer closers, info strings and indentation all count as code', () => {
  for (const code of [
    `~~~\n${fence(OLD[0])}\n~~~`,
    `\`\`\`\`markdown\n${fence(OLD[0])}\n\`\`\`\n\`\`\`\``,
    `   \`\`\`\n${fence(OLD[0])}\n   \`\`\``,
    `    ${OLD[0]}\n    - [[x]]\n    ${END}`,
    `> ${OLD[0]}\n> ${END}`,
  ]) {
    assert.deepEqual(fenceSpans(code), [], code);
  }
});

test('an opener that nothing closes is not code, so a fence appended after it is found on the next run', () => {
  const once = writeFence('# Hand\n\n```\nnever closed\n', FRESH);
  assert.equal(once, `# Hand\n\n\`\`\`\nnever closed\n\n${FRESH}\n`);
  assert.equal(writeFence(once, FRESH), once);
});

test('a marker line with trailing spaces or a carriage return is still a whole line, and those bytes stay', () => {
  assert.equal(writeFence(`a\n\n${OLD[0]}  \n- x\n${END}  \nb\n`, FRESH), `a\n\n${FRESH}  \nb\n`);
  assert.equal(writeFence(`a\r\n${OLD[0]}\r\n- x\r\n${END}\r\nb\r\n`, FRESH), `a\r\n${FRESH}\r\nb\r\n`);
});

test('duplicates from a line-union merge are whole lines, so they still collapse beside quoted markers', () => {
  const quote = block(OLD[0]);
  const out = writeFence(`${quote}\n\n${NEW}\n- [[a]]\n${OLD[0]}\n- [[b]]\n${END}\n\n${NEW}\n- [[c]]\n${END}\n`, FRESH);
  assert.equal(out, `${quote}\n\n${FRESH}\n`);
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
  ['index.md', 'index.md', OLD[0], (root) => regenerateIndex(root, { apply: true })],
  ['roadmap', 'wiki/authored/alpha/roadmap.md', OLD[1], (root) => regenerateBacklogRoadmaps(root, { apply: true })],
  ['project map', 'moc/alpha.md', OLD[2], (root) => regenerateAuthoredMocs(root, { apply: true })],
];

for (const [label, path, old, write] of WRITERS) {
  test(`${label}: its old fence becomes one new fence with the framing kept, and a second run changes nothing`, (t) => {
    const root = vault(t, { ...PAGES, [path]: framed(old) });
    write(root);
    const text = readFileSync(join(root, path), 'utf8');
    assertMigrated(text);
    write(root);
    assert.equal(readFileSync(join(root, path), 'utf8'), text);
  });

  test(`${label}: an old fence appended beside a new one collapses`, (t) => {
    const root = vault(t, { ...PAGES, [path]: `${framed(NEW)}\n${fence(old, '- [[appended]]')}\n` });
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
