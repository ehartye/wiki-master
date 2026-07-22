import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scaffold } from '../scripts/init.mjs';

const templatesDir = join(process.cwd(), 'templates');

test('scaffold creates the vault contract folders and starter files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wm-'));
  scaffold(dir, templatesDir);
  for (const d of ['raw/clippings', 'wiki/sources', 'wiki/entities', 'wiki/concepts',
                   'wiki/syntheses', 'wiki/authored', 'moc', '_templates', '.wiki-master']) {
    assert.ok(existsSync(join(dir, d)), `missing ${d}`);
  }
  assert.ok(existsSync(join(dir, 'index.md')));
  assert.ok(existsSync(join(dir, 'log.md')));
  assert.ok(existsSync(join(dir, 'vault-schema.md')));
  assert.ok(existsSync(join(dir, 'stale.base')));
  assert.match(readFileSync(join(dir, '.gitignore'), 'utf8'), /\.wiki-master\//);
});

test('scaffold is idempotent (does not clobber existing index.md)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wm-'));
  scaffold(dir, templatesDir);
  writeFileSync(join(dir, 'index.md'), '# Custom');
  scaffold(dir, templatesDir);
  assert.equal(readFileSync(join(dir, 'index.md'), 'utf8'), '# Custom');
});

test('scaffold creates the log/ folder + log.base, and log.md is a pointer stub', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wm-'));
  scaffold(dir, templatesDir);
  assert.ok(existsSync(join(dir, 'log')), 'log/ folder created');
  assert.ok(existsSync(join(dir, 'log.base')), 'log.base created');
  assert.match(readFileSync(join(dir, 'log.md'), 'utf8'), /log\.base/, 'log.md is a pointer stub');
});
