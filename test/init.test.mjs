import { test, mock } from 'node:test';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scaffold } from '../scripts/init.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-init-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'source');
  const vault = join(root, 'vault');
  fs.mkdirSync(join(source, '_templates', 'nested'), { recursive: true });
  fs.mkdirSync(vault);
  for (const name of ['vault-schema.md', 'stale.base', 'log.base', '_templates/a.md', '_templates/nested/b.md']) {
    writeFileSync(join(source, name), `distributed ${name}`);
  }
  return { source, vault, root };
}

function replaceFs(t, name, fn) {
  const original = fs[name];
  mock.method(fs, name, fn(original));
  syncBuiltinESMExports();
  const patched = fs[name];
  t.after(() => { patched.mock.restore(); syncBuiltinESMExports(); });
}

test('preserves customized, identical, nested, user-only and root files including times', t => {
  const { source, vault } = fixture(t);
  scaffold(vault, source);
  const names = ['index.md', 'log.md', '.gitignore', 'vault-schema.md', 'stale.base', 'log.base', '_templates/a.md', '_templates/nested/b.md', '_templates/user.md'];
  for (const name of names.filter(n => n !== '_templates/a.md')) writeFileSync(join(vault, name), `private ${name}`);
  const snapshot = () => names.map(name => [name, readFileSync(join(vault, name), 'utf8'), fs.statSync(join(vault, name)).mtimeMs]);
  const before = snapshot();
  writeFileSync(join(source, '_templates/nested/new.md'), 'new');
  const report = scaffold(vault, source);
  assert.deepEqual(snapshot(), before);
  assert.deepEqual(report.created, ['_templates/nested/new.md']);
  assert.ok(report.differing.includes('_templates/nested/b.md'));
  assert.ok(!report.differing.includes('_templates/a.md'));
  assert.deepEqual(report.preserved, [...report.preserved].sort());
  const again = scaffold(vault, source);
  assert.deepEqual(again.created, []);
  assert.deepEqual(snapshot(), before);
});

test('new scaffold copies every distributed file byte for byte', t => {
  const { source, vault } = fixture(t);
  scaffold(vault, source);
  for (const name of ['vault-schema.md', 'stale.base', 'log.base', '_templates/a.md', '_templates/nested/b.md']) {
    assert.deepEqual(readFileSync(join(vault, name)), readFileSync(join(source, name)));
  }
  assert.equal(existsSync(join(vault, '.git')), false);
});

for (const target of ['index.md', '_templates/a.md']) test(`competing creation of ${target} is preserved`, t => {
  const { source, vault } = fixture(t);
  const destination = join(vault, target);
  replaceFs(t, 'openSync', original => (path, flags, ...args) => {
    if (path === destination && flags === 'wx') writeFileSync(destination, 'competing writer');
    return original(path, flags, ...args);
  });
  const report = scaffold(vault, source);
  assert.equal(readFileSync(destination, 'utf8'), 'competing writer');
  assert.ok(report.preserved.includes(target));
});

for (const target of ['index.md', '_templates/a.md', '_templates/nested']) test(`type conflict at ${target} is preserved and reported`, t => {
  const { source, vault } = fixture(t);
  fs.mkdirSync(join(vault, '_templates'), { recursive: true });
  if (target.endsWith('.md')) fs.mkdirSync(join(vault, target));
  else writeFileSync(join(vault, target), 'obstruction');
  assert.throws(() => scaffold(vault, source), error => {
    assert.ok(error.report.errors.some(e => e.path === target));
    return true;
  });
});

for (const side of ['source', 'vault']) test(`does not follow ${side} directory links`, t => {
  const { source, vault, root } = fixture(t);
  const outside = join(root, 'outside');
  fs.mkdirSync(outside);
  writeFileSync(join(outside, 'private.md'), 'private');
  const linked = join(side === 'source' ? source : vault, '_templates', 'linked');
  fs.mkdirSync(join(vault, '_templates'), { recursive: true });
  if (side === 'vault') fs.mkdirSync(join(source, '_templates', 'linked'));
  fs.symlinkSync(outside, linked, 'junction');
  assert.throws(() => scaffold(vault, source), error => {
    assert.ok(error.report.errors.some(e => e.path === '_templates/linked'));
    return true;
  });
  assert.deepEqual(fs.readdirSync(outside), ['private.md']);
});

for (const side of ['source', 'vault']) test(`does not follow ${side} file links`, t => {
  const { source, vault, root } = fixture(t);
  const outside = join(root, 'private.md');
  writeFileSync(outside, 'private');
  fs.mkdirSync(join(vault, '_templates'), { recursive: true });
  const linked = join(side === 'source' ? source : vault, '_templates', 'a.md');
  if (side === 'source') fs.unlinkSync(linked);
  try { fs.symlinkSync(outside, linked, 'file'); }
  catch (error) { if (error.code === 'EPERM') return t.skip('file symlink creation requires platform permission'); throw error; }
  assert.throws(() => scaffold(vault, source), error => error.report.errors.some(e => e.path === '_templates/a.md'));
  assert.equal(readFileSync(outside, 'utf8'), 'private');
});

test('does not traverse a linked vault root', t => {
  const { source, vault, root } = fixture(t);
  const linked = join(root, 'linked-vault');
  fs.symlinkSync(vault, linked, 'junction');
  assert.throws(() => scaffold(linked, source), error => error.report.errors.length > 0);
  assert.deepEqual(fs.readdirSync(vault), []);
});

test('ordinary vault and source roots under a parent alias remain supported', t => {
  const { source, vault, root } = fixture(t);
  const alias = join(root, 'parent-alias');
  fs.symlinkSync(root, alias, 'junction');
  const report = scaffold(join(alias, 'vault'), join(alias, 'source'));
  assert.ok(report.created.includes('_templates/a.md'));
  assert.deepEqual(readFileSync(join(vault, '_templates/a.md')), readFileSync(join(source, '_templates/a.md')));
  assert.deepEqual(scaffold(join(alias, 'vault'), join(alias, 'source')).created, []);
  // A missing root can also be created beneath the platform alias.
  assert.ok(scaffold(join(alias, 'new', 'vault'), join(alias, 'source')).created.includes('index.md'));
});

test('does not traverse a linked source root', t => {
  const { source, vault, root } = fixture(t);
  const linked = join(root, 'linked-source');
  fs.symlinkSync(source, linked, 'junction');
  assert.throws(() => scaffold(vault, linked), error => error.report.errors.some(e => e.path === '_templates'));
  assert.equal(existsSync(join(vault, '_templates/a.md')), false);
});

test('partial write failure reports retained creations and incomplete file; retry fills missing files', t => {
  const { source, vault } = fixture(t);
  replaceFs(t, 'writeFileSync', original => (path, data, ...args) => {
    if (typeof path === 'number' && String(data).includes('distributed _templates/a.md')) {
      fs.writeSync(path, 'partial');
      throw Object.assign(new Error('injected write failure'), { code: 'EIO' });
    }
    return original(path, data, ...args);
  });
  assert.throws(() => scaffold(vault, source), error => {
    assert.ok(error.report.created.includes('index.md'));
    assert.ok(error.report.incomplete.includes('_templates/a.md'));
    assert.ok(error.report.errors.some(e => e.path === '_templates/a.md'));
    return true;
  });
  assert.equal(readFileSync(join(vault, '_templates/a.md'), 'utf8'), 'partial');
  fs.writeFileSync.mock.restore(); syncBuiltinESMExports();
  fs.unlinkSync(join(vault, '_templates/nested/b.md'));
  assert.ok(scaffold(vault, source).created.includes('_templates/nested/b.md'));
  assert.equal(readFileSync(join(vault, '_templates/a.md'), 'utf8'), 'partial');
});

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
