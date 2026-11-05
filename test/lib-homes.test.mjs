import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The catalog and embedding logic lives under lib/, and refresh-index.mjs is the only command over it.

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');

test('the catalog and embedding homes depend on nothing above lib/, so importing them never loads a command', () => {
  for (const file of ['catalogs.mjs', 'embedding.mjs', 'index-fence.mjs']) {
    const source = readFileSync(join(SCRIPTS, 'lib', file), 'utf8');
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    assert.ok(imports.every((path) => !path.startsWith('..')), `${file} imports ${imports.join(', ')}`);
    assert.doesNotMatch(source, /cliGuard|process\.argv/, `${file} acts like a command`);
  }
});

