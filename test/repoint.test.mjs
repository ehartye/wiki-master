import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repointCitation } from '../scripts/lib/repoint.mjs';

// After extracting a binary to a .md clipping, the summary's citation must move
// from the binary to the new clipping — inside the frontmatter `sources:` only,
// leaving body and other citations untouched. Pure string transform (no regex on
// the target, which may contain '.', '(', etc.).

test('repointCitation swaps [[binary]] → [[clipping]] inside the sources line', () => {
  const text = '---\ntype: source\nsources: ["[[Abdellatif_X.pdf]]"]\nquality: high\n---\nbody\n';
  const out = repointCitation(text, 'Abdellatif_X.pdf', 'raw/clippings/Abdellatif-abc1234.md');
  assert.match(out, /sources: \["\[\[raw\/clippings\/Abdellatif-abc1234\.md\]\]"\]/);
  assert.ok(out.endsWith('---\nbody\n'), 'body and fence preserved');
});

test('repointCitation leaves the page unchanged when the target is absent', () => {
  const text = '---\nsources: ["[[Other.pdf]]"]\n---\nbody\n';
  assert.equal(repointCitation(text, 'Missing.pdf', 'raw/clippings/x.md'), text);
});

test('repointCitation in a multi-source list repoints only the matching entry', () => {
  const text = '---\nsources: ["[[A.pdf]]", "[[B-9990000.md]]"]\n---\nx\n';
  const out = repointCitation(text, 'A.pdf', 'raw/clippings/A-abc1234.md');
  assert.ok(out.includes('[[raw/clippings/A-abc1234.md]]'), 'matching entry repointed');
  assert.ok(out.includes('[[B-9990000.md]]'), 'the other citation is preserved');
});

test('repointCitation only touches frontmatter, not a body mention of the same token', () => {
  const text = '---\nsources: ["[[A.pdf]]"]\n---\nSee [[A.pdf]] in the body.\n';
  const out = repointCitation(text, 'A.pdf', 'raw/clippings/A-abc.md');
  assert.ok(out.includes('sources: ["[[raw/clippings/A-abc.md]]"]'), 'frontmatter repointed');
  assert.ok(out.includes('See [[A.pdf]] in the body.'), 'body mention untouched');
});
