import { test } from 'node:test';
import assert from 'node:assert/strict';
import { titleFromPptx, pptxClipContent, pickPython } from '../scripts/clip-pptx.mjs';

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

// Interpreter resolution. Windows never installs a `python3.exe` — the python.org
// installer ships `python.exe` only — while Windows itself ships a
// `WindowsApps\python3.exe` App Execution Alias that exits nonzero with "Python was
// not found" whenever real Python is absent from that store. So `python3` is
// simultaneously present on PATH and non-functional, and hardcoding it made a
// correctly-installed python-pptx report itself missing. Resolution therefore
// probes candidates by RUNNING them, never by testing for their existence.

test('pickPython falls through a present-but-broken python3 to a working python', () => {
  // The Windows shape: `python3` resolves (the Store alias) but fails to execute.
  const probe = (cmd) => cmd === 'python';
  assert.deepEqual(pickPython(['python3', 'python'], probe), { cmd: 'python', pptx: true });
});

test('pickPython prefers a candidate that can import pptx over one that merely runs', () => {
  // `python3` is a working interpreter without the library; `python` has it.
  const probe = (cmd, args) => args.includes('import pptx') ? cmd === 'python' : true;
  assert.deepEqual(pickPython(['python3', 'python'], probe), { cmd: 'python', pptx: true });
});

test('pickPython keeps candidate order when the first one already has pptx', () => {
  assert.deepEqual(pickPython(['python3', 'python'], () => true), { cmd: 'python3', pptx: true });
});

test('pickPython reports an interpreter found but pptx missing', () => {
  // Drives the honest error: the install is fine, the library is not.
  const probe = (cmd, args) => !args.includes('import pptx');
  assert.deepEqual(pickPython(['python3', 'python'], probe), { cmd: 'python3', pptx: false });
});

test('pickPython reports no interpreter at all', () => {
  assert.deepEqual(pickPython(['python3', 'python'], () => false), { cmd: null, pptx: false });
});
