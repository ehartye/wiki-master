import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNameIndex, evidencePaths } from '../scripts/lib/graph.mjs';

// Quote verification reads a page's evidence trail: frontmatter sources: and body
// wikilinks toward wiki/sources/ and raw/, followed transitively to a depth cap.
//
// Depth-FIRST with one shared `seen` set silently loses evidence. A source page
// reached late down a long chain is marked seen at the depth limit; when the
// SHORTER, direct route to that same page comes up, the walk bails on `seen` and
// never expands it — so its clipping is never read, and quotes taken straight
// from it report as unverifiable. The walk must reach every page by its shortest
// route, which is breadth-first.

// `name` is what buildNameIndex keys on: the basename, lowercased, .md stripped.
const mk = (path, links = []) => ({
  path,
  name: (path.split('/').pop() ?? '').replace(/\.md$/i, '').toLowerCase(),
  fmTargets: [],
  outTargets: links,
});

function fixture() {
  const pages = [
    // C cites A first, then S directly. S's clipping is what holds the quote.
    mk('wiki/concepts/C.md', ['A', 'S']),
    mk('wiki/sources/A.md', ['a-clip']),
    mk('raw/clippings/a-clip.md', ['S']), // the long way round to S
    mk('wiki/sources/S.md', ['s-clip']),
    mk('raw/clippings/s-clip.md'),
  ];
  return { pages: new Map(pages.map((p) => [p.path, p])), byName: buildNameIndex(pages), start: pages[0] };
}

test('a directly-cited source page is expanded even when a longer chain reaches it first', () => {
  const { pages, byName, start } = fixture();
  const got = evidencePaths(start, byName, pages);
  assert.ok(got.includes('wiki/sources/S.md'), 'the directly-cited source page is evidence');
  assert.ok(
    got.includes('raw/clippings/s-clip.md'),
    'its clipping must be read — it is two hops from the page, and holds the quote'
  );
});

test('the walk still refuses to step sideways into non-evidence pages', () => {
  const pages = [mk('wiki/concepts/C.md', ['D']), mk('wiki/concepts/D.md', ['d-clip']), mk('raw/clippings/d-clip.md')];
  const map = new Map(pages.map((p) => [p.path, p]));
  const got = evidencePaths(pages[0], buildNameIndex(pages), map);
  assert.deepEqual(got, [], 'a concept is not evidence, and nothing behind it counts');
});

test('the page itself is never its own evidence', () => {
  const { pages, byName, start } = fixture();
  assert.ok(!evidencePaths(start, byName, pages).includes(start.path));
});

test('a citation cycle terminates', () => {
  const pages = [mk('wiki/concepts/C.md', ['A']), mk('wiki/sources/A.md', ['B']), mk('wiki/sources/B.md', ['A'])];
  const map = new Map(pages.map((p) => [p.path, p]));
  const got = evidencePaths(pages[0], buildNameIndex(pages), map);
  assert.deepEqual(got.sort(), ['wiki/sources/A.md', 'wiki/sources/B.md']);
});

test('the depth cap still holds', () => {
  // C -> s1 -> s2 -> s3 -> s4 : s4 sits at depth 4, beyond the cap.
  const pages = [
    mk('wiki/concepts/C.md', ['s1']),
    mk('wiki/sources/s1.md', ['s2']),
    mk('wiki/sources/s2.md', ['s3']),
    mk('wiki/sources/s3.md', ['s4']),
    mk('wiki/sources/s4.md'),
  ];
  const map = new Map(pages.map((p) => [p.path, p]));
  const got = evidencePaths(pages[0], buildNameIndex(pages), map);
  assert.ok(got.includes('wiki/sources/s3.md'), 'depth 3 is within the cap');
  assert.ok(!got.includes('wiki/sources/s4.md'), 'depth 4 is beyond it');
});
