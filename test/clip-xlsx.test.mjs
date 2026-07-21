import { test } from 'node:test';
import assert from 'node:assert/strict';
import { titleFromXlsx, xlsxClipContent } from '../scripts/clip-xlsx.mjs';

// A spreadsheet's content is its tables. The workbook itself never enters the
// vault — the markdown table is the canonical representation, so the data stays
// greppable and a `[[note]]` citation resolves to real markdown.

test('titleFromXlsx derives a human title from the filename', () => {
  assert.equal(titleFromXlsx('/x/INDOT_CY2024_Unit_Price_Summary.xlsx'), 'INDOT CY2024 Unit Price Summary');
  assert.equal(titleFromXlsx('C:\\x\\KYTC_Average_Unit_Bid_Prices_2025.xlsx'), 'KYTC Average Unit Bid Prices 2025');
  assert.equal(titleFromXlsx('/x/legacy.xls'), 'legacy');
});

test('xlsxClipContent stamps a sha256 source-hash and keeps the table body', () => {
  const text = '| Item | Unit | Price |\n|---|---|---|\n| Asphalt | ton | 92.50 |\n';
  const c = xlsxClipContent({ title: 'Prices', source: '/x/p.xlsx', text, created: '2026-07-21' });
  assert.match(c.body, /^---\n/);
  assert.match(c.body, /^source-hash: [0-9a-f]{64}$/m);
  assert.ok(c.body.includes('| Asphalt | ton | 92.50 |'), 'table rows survive into the clipping');
  assert.equal(c.hash.length, 64);
});

test('xlsxClipContent normalizes CRLF and collapses blank-line runs', () => {
  const c = xlsxClipContent({ title: 'T', source: 's', text: 'a\r\n\r\n\r\n\r\nb   \n', created: '2026-07-21' });
  assert.ok(!c.md.includes('\r'), 'no carriage returns');
  assert.ok(!/\n{3,}/.test(c.md), 'no runs of blank lines');
  assert.ok(c.md.endsWith('b'), 'trailing whitespace trimmed');
});

test('xlsxClipContent counts words for the thin-content gate', () => {
  assert.equal(xlsxClipContent({ title: 'T', source: 's', text: 'one two three' }).wordCount, 3);
});
