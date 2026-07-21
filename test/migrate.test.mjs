import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planBinaryMigration } from '../scripts/lib/migrate.mjs';

const att = (path, name) => ({ path, name, title: name, type: 'attachment', words: 0, outTargets: [], fmTargets: [] });
const clip = (path, name, extra = {}) => ({ path, name, title: name, words: 20, outTargets: [], fmTargets: [], ...extra });

// A binary leaves the vault only once its content is captured. Three buckets:
//  moveOnly — already has a .md twin (content captured) → just evict the binary.
//  extract  — no twin, an extractable doc type → extract → (repoint) → evict.
//  blocked  — no twin, no clean extractor → stays in the vault, goes to triage.

test('a binary with a .md twin is move-only (content already captured)', () => {
  const pages = [
    att('raw/proc-graphics/A_Survey_of_Procedural_Content_Generatio.pdf', 'a_survey_of_procedural_content_generatio.pdf'),
    clip('raw/clippings/A Survey of Procedural Content Generatio-b87e401.md', 'a survey of procedural content generatio-b87e401', { sourceHash: 'b87e401' }),
  ];
  const p = planBinaryMigration({ pages });
  assert.deepEqual(p.moveOnly.map((x) => x.binary), ['raw/proc-graphics/A_Survey_of_Procedural_Content_Generatio.pdf']);
  assert.equal(p.moveOnly[0].twin, 'raw/clippings/A Survey of Procedural Content Generatio-b87e401.md',
    'the plan carries the twin so its source: pointer can be refreshed after the move');
  assert.equal(p.extract.length, 0);
});

test('a pdf with no twin, cited by a source page, is an extract candidate carrying its citers', () => {
  const pages = [
    att('raw/Abdellatif_ML.pdf', 'abdellatif_ml.pdf'),
    { path: 'wiki/sources/Abdellatif Summary.md', name: 'abdellatif summary', title: 'x', words: 50, outTargets: [], fmTargets: ['Abdellatif_ML.pdf'] },
  ];
  const p = planBinaryMigration({ pages });
  assert.deepEqual(p.extract.map((x) => x.binary), ['raw/Abdellatif_ML.pdf']);
  assert.deepEqual(p.extract[0].citers.map((c) => c.page), ['wiki/sources/Abdellatif Summary.md']);
});

test('an xlsx/zip with no twin is blocked — no clean extractor, stays for triage', () => {
  const pages = [
    att('raw/KYTC_Prices.xlsx', 'kytc_prices.xlsx'),
    att('raw/clippings/ref-docs-staging/Bundle.zip', 'bundle.zip'),
  ];
  const p = planBinaryMigration({ pages });
  assert.deepEqual(p.blocked.map((x) => x.binary).sort(), ['raw/KYTC_Prices.xlsx', 'raw/clippings/ref-docs-staging/Bundle.zip']);
  assert.equal(p.extract.length, 0);
});

test('images are never migrated — they stay in the vault', () => {
  const pages = [att('raw/attachments/abc123.png', 'abc123.png')];
  const p = planBinaryMigration({ pages });
  assert.equal(p.moveOnly.length + p.extract.length + p.blocked.length, 0);
});
