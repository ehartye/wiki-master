import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as catalogs from '../scripts/lib/catalogs.mjs';
import * as embedding from '../scripts/lib/embedding.mjs';
import * as indexGen from '../scripts/index-gen.mjs';
import * as backlogGen from '../scripts/backlog-gen.mjs';
import * as mocGen from '../scripts/moc-authored-gen.mjs';
import * as refreshCatalogsCli from '../scripts/refresh-catalogs.mjs';
import * as indexEmbed from '../scripts/index-embed.mjs';

// The catalog and embedding logic lives under lib/. The commands that used to hold it stay as thin wrappers until a
// later change removes them, so the behavior tests that import through them still exercise this same code.

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');

for (const [label, wrapper, home, names] of [
  ['index-gen', indexGen, catalogs, ['renderCatalog', 'regenerateIndex', 'BEGIN_MARK', 'END_MARK']],
  ['backlog-gen', backlogGen, catalogs, ['renderBacklogCatalog', 'renderShippedCatalog', 'roadmapStub', 'shippedStub', 'planBacklogRoadmaps', 'regenerateBacklogRoadmaps', 'BEGIN_MARK', 'END_MARK']],
  ['moc-authored-gen', mocGen, catalogs, ['renderProjectCatalog', 'projectSlug', 'planAuthoredMocs', 'regenerateAuthoredMocs', 'MIN_PAGES', 'BEGIN_MARK', 'END_MARK']],
  ['refresh-catalogs', refreshCatalogsCli, catalogs, ['refreshCatalogs', 'lineDiff', 'staleCatalogLinks']],
  ['index-embed', indexEmbed, embedding, ['walkVault', 'readManifestFile', 'readVectorStore', 'persistIndex', 'statusReport', 'refreshIndex']],
]) {
  test(`${label} re-exports the same objects from their new home`, () => {
    for (const name of names) {
      assert.notEqual(home[name], undefined, `${name} is missing from its new home`);
      assert.equal(wrapper[name], home[name], `${label}.${name} is not the new home's`);
    }
  });
}

test('the five old commands are thin: each keeps its command line and holds no catalog or embedding logic', () => {
  for (const script of ['index-gen', 'backlog-gen', 'moc-authored-gen', 'refresh-catalogs', 'index-embed']) {
    const source = readFileSync(join(SCRIPTS, `${script}.mjs`), 'utf8');
    assert.match(source, /export (async )?function main\(/, `${script} has no main`);
    assert.doesNotMatch(source, /function (render|plan|regenerate|refresh|persist|walk|read|status|staleCatalog|lineDiff)/, `${script} still holds logic`);
    assert.ok(source.split('\n').length < 90, `${script} is ${source.split('\n').length} lines long`);
  }
});

test('the new homes depend on nothing above lib/, so importing them never loads a command', () => {
  for (const file of ['catalogs.mjs', 'embedding.mjs', 'index-fence.mjs']) {
    const source = readFileSync(join(SCRIPTS, 'lib', file), 'utf8');
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    assert.ok(imports.every((path) => !path.startsWith('..')), `${file} imports ${imports.join(', ')}`);
    assert.doesNotMatch(source, /cliGuard|process\.argv/, `${file} acts like a command`);
  }
  assert.ok(readdirSync(join(SCRIPTS, 'lib')).includes('catalogs.mjs'));
});
