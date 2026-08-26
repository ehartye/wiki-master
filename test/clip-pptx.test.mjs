import { test } from 'node:test';
import assert from 'node:assert/strict';
import { titleFromPptx, pptxClipContent } from '../scripts/clip-pptx.mjs';

// A slide deck's content is its slides — bullets, tables, speaker notes. The
// binary .pptx itself never enters the vault — the markdown produced by the
// bundled python-pptx helper is the canonical representation, so the data stays
// greppable and a `[[note]]` citation resolves to real markdown.

test('titleFromPptx derives a human title from the filename', () => {
  assert.equal(titleFromPptx('/x/DA1008_DAC_AI_Tool_System_Compare_Overview_V1.pptx'), 'DA1008 DAC AI Tool System Compare Overview V1');
  assert.equal(titleFromPptx('C:\\x\\Quarterly_Review_2026.pptx'), 'Quarterly Review 2026');
  assert.equal(titleFromPptx('/x/legacy.ppt'), 'legacy');
});

test('pptxClipContent stamps a sha256 source-hash and keeps slide/table body', () => {
  const text = '## Slide 1\nTitle Slide\n\n## Slide 2\n| A | B |\n|---|---|\n| 1 | 2 |\n';
  const c = pptxClipContent({ title: 'Deck', source: '/x/d.pptx', text, created: '2026-08-26' });
  assert.match(c.body, /^---\n/);
  assert.match(c.body, /^source-hash: [0-9a-f]{64}$/m);
  assert.ok(c.body.includes('## Slide 1'), 'slide headings survive into the clipping');
  assert.ok(c.body.includes('| 1 | 2 |'), 'table rows survive into the clipping');
  assert.equal(c.hash.length, 64);
});

test('pptxClipContent normalizes CRLF and collapses blank-line runs', () => {
  const c = pptxClipContent({ title: 'T', source: 's', text: 'a\r\n\r\n\r\n\r\nb   \n', created: '2026-08-26' });
  assert.ok(!c.md.includes('\r'), 'no carriage returns');
  assert.ok(!/\n{3,}/.test(c.md), 'no runs of blank lines');
  assert.ok(c.md.endsWith('b'), 'trailing whitespace trimmed');
});

test('pptxClipContent counts words for the thin-content gate', () => {
  assert.equal(pptxClipContent({ title: 'T', source: 's', text: 'one two three' }).wordCount, 3);
});
