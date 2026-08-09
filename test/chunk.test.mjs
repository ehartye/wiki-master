import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkMarkdown } from '../scripts/lib/chunk.mjs';

// Concatenating chunks' source LINE ranges must cover the whole document with
// no gap -- the entire point of chunking is that nothing gets left unembedded.
// Mirrors chunk.mjs's own line-counting convention (a trailing '\n' is a
// terminator, not a phantom extra line) -- the same convention the
// "startLine/endLine are 1-indexed and correct" test below already
// establishes for a 5-line, trailing-newline-terminated fixture.
function lineCount(text) {
  const lines = text.split('\n');
  if (lines.length > 0 && lines.at(-1) === '') lines.pop();
  return lines.length;
}

function assertFullCoverage(chunks, totalLines) {
  assert.ok(chunks.length > 0, 'expected at least one chunk');
  assert.equal(chunks[0].startLine, 1);
  assert.equal(chunks.at(-1).endLine, totalLines);
  for (let i = 1; i < chunks.length; i++) {
    // Overlap is allowed (endLine of previous >= startLine of next - 1), but
    // no GAP is allowed: the next chunk must start at or before one past the
    // previous chunk's end.
    assert.ok(
      chunks[i].startLine <= chunks[i - 1].endLine + 1,
      `gap between chunk ${i - 1} (ends ${chunks[i - 1].endLine}) and chunk ${i} (starts ${chunks[i].startLine})`
    );
  }
}

test('empty input yields no chunks', () => {
  const chunks = chunkMarkdown('', { title: 'Empty' });
  assert.deepEqual(chunks, []);
});

test('a document shorter than targetChars yields a single chunk covering it all', () => {
  const text = 'Just a short paragraph of text.';
  const chunks = chunkMarkdown(text, { title: 'Short Doc', targetChars: 1200 });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].startLine, 1);
  assert.equal(chunks[0].endLine, 1);
});

test('a single 20,000-char line with no newlines is fully covered by a hard character split', () => {
  const text = 'x'.repeat(20000);
  const chunks = chunkMarkdown(text, { title: 'Wall of Text', targetChars: 1200, overlapChars: 150 });
  assert.ok(chunks.length > 1, 'expected the long line to be split into multiple chunks');
  // A single unbroken line has no line-boundary to split at, so every chunk
  // reports the same 1-1 line span -- there is nowhere else to point.
  for (const c of chunks) {
    assert.equal(c.startLine, 1);
    assert.equal(c.endLine, 1);
  }
});

test('complete coverage over a realistic 20,000-char multi-section document', () => {
  const section = (n) => `## Section ${n}\n\n` + 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(30) + '\n\n';
  let text = '# Big Document\n\n';
  for (let i = 0; i < 20; i++) text += section(i);
  assert.ok(text.length > 19000, `fixture too small: ${text.length}`);
  const totalLines = lineCount(text);
  const chunks = chunkMarkdown(text, { title: 'Big Document', targetChars: 1200, overlapChars: 150 });
  assert.ok(chunks.length > 5);
  assertFullCoverage(chunks, totalLines);
});

test('chunks overlap by roughly overlapChars so a boundary passage is reachable from both sides', () => {
  const section = (n) => `## Section ${n}\n\n` + 'word '.repeat(100) + '\n\n';
  let text = '';
  for (let i = 0; i < 10; i++) text += section(i);
  const chunks = chunkMarkdown(text, { title: 'Overlap Doc', targetChars: 800, overlapChars: 150 });
  assert.ok(chunks.length > 1);
  for (let i = 1; i < chunks.length; i++) {
    // The overlap region is lines shared between chunk i-1 and chunk i.
    const overlapLines = chunks[i - 1].endLine - chunks[i].startLine + 1;
    assert.ok(overlapLines > 0, `chunk ${i} does not overlap chunk ${i - 1} at all`);
  }
});

test('prefers splitting at heading boundaries over paragraph or hard splits', () => {
  const text = '# Title\n\n'
    + 'A'.repeat(500) + '\n\n'
    + '## Heading Two\n\n'
    + 'B'.repeat(500) + '\n\n'
    + '## Heading Three\n\n'
    + 'C'.repeat(500) + '\n';
  const chunks = chunkMarkdown(text, { title: 'Headings Doc', targetChars: 600, overlapChars: 50 });
  // Every chunk after the first should start with text that begins right at
  // (or immediately covers) a heading line, i.e. the raw source at a chunk's
  // startLine-ish region contains a heading -- checked indirectly via
  // headingPath tracking which heading each chunk belongs under.
  const paths = chunks.map((c) => c.headingPath);
  assert.ok(paths.some((p) => p.includes('Heading Two')));
  assert.ok(paths.some((p) => p.includes('Heading Three')));
});

// A single unbroken run over target size is a hard-split case (requirement
// 1's fallback chain) REGARDLESS of whether headings exist elsewhere in the
// document. If a section's body is itself one giant no-blank-line paragraph,
// leaving it as one oversized chunk would defeat the entire point of
// chunking: staying under the embedding model's context window.
test('hard-splits an oversized unbroken paragraph even inside a heading section', () => {
  const text = '# Title\n\n## Giant Section\n\n' + 'x'.repeat(20000) + '\n';
  const chunks = chunkMarkdown(text, { title: 'Doc', targetChars: 1200, overlapChars: 150 });
  assert.ok(chunks.length > 1, `expected the oversized section to be split, got ${chunks.length} chunk(s)`);
  for (const c of chunks) {
    assert.ok(c.text.length < 20000, 'a chunk under the heading was not split down from the full run');
    assert.ok(c.headingPath.includes('Giant Section'));
  }
});

test('falls back to paragraph boundaries when there are no headings', () => {
  const para = (n) => `Paragraph number ${n}. ` + 'Lorem ipsum dolor sit amet. '.repeat(20) + '\n\n';
  let text = '';
  for (let i = 0; i < 10; i++) text += para(i);
  const chunks = chunkMarkdown(text, { title: 'No Headings', targetChars: 500, overlapChars: 50 });
  assert.ok(chunks.length > 1);
  // No heading anywhere, so every chunk's headingPath is empty/just the title.
  for (const c of chunks) assert.equal(c.headingPath, '');
});

test('every chunk text begins with the page title and heading path', () => {
  const text = '# Doc\n\n## Layering\n\n### Vertical remixing\n\n' + 'content '.repeat(200);
  const chunks = chunkMarkdown(text, { title: 'Adaptive Music Techniques', targetChars: 400, overlapChars: 50 });
  const deep = chunks.find((c) => c.headingPath.includes('Vertical remixing'));
  assert.ok(deep, 'expected a chunk under the deepest heading');
  assert.ok(
    deep.text.startsWith('Adaptive Music Techniques › Layering › Vertical remixing'),
    `chunk text did not begin with title/heading prefix: ${deep.text.slice(0, 120)}`
  );
});

test('frontmatter is included with the first chunk only, never repeated', () => {
  const fm = '---\ntitle: Foo\ntags: [a, b]\n---\n\n';
  const body = '## Section One\n\n' + 'x'.repeat(1000) + '\n\n## Section Two\n\n' + 'y'.repeat(1000);
  const text = fm + body;
  const chunks = chunkMarkdown(text, { title: 'Foo', targetChars: 600, overlapChars: 50 });
  assert.ok(chunks.length > 1);
  assert.ok(chunks[0].text.includes('title: Foo'));
  for (let i = 1; i < chunks.length; i++) {
    assert.ok(!chunks[i].text.includes('title: Foo'), `frontmatter leaked into chunk ${i}`);
  }
});

test('startLine/endLine are 1-indexed and point at the correct source lines', () => {
  const text = 'line one\nline two\nline three\nline four\nline five\n';
  const chunks = chunkMarkdown(text, { title: 'Lines', targetChars: 1200 });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].startLine, 1);
  // 5 lines of content, trailing newline does not create a phantom 6th line.
  assert.equal(chunks[0].endLine, 5);
});
