import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fsKeywordSearch } from '../scripts/lib/fs-keyword.mjs';

function vault(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'wm-fskw-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

test('ranks the exact phrase above all-terms above partial matches, and returns vault-relative paths', async (t) => {
  const vaultPath = vault(t, {
    'wiki/partial.md': '# Partial\nOnly offline here.\n',
    'wiki/all-terms.md': '# All\nThe mode is set while working offline.\n',
    'wiki/phrase.md': '# Phrase\nOffline mode keeps the app usable.\n',
    'wiki/none.md': '# None\nUnrelated.\n',
  });
  assert.deepEqual(await fsKeywordSearch('offline mode', { vaultPath }),
    ['wiki/phrase.md', 'wiki/all-terms.md', 'wiki/partial.md']);
});

test('a term in the filename outranks the same term only in the body', async (t) => {
  const vaultPath = vault(t, {
    'wiki/body.md': '# Body\nSemantic search is discussed.\n',
    'wiki/semantic-search.md': '# Other\nUnrelated body.\n\nsemantic mention.\n',
  });
  const hits = await fsKeywordSearch('semantic search', { vaultPath });
  assert.equal(hits[0], 'wiki/body.md', 'phrase in body beats filename-only partial');
  const named = await fsKeywordSearch('semantic', { vaultPath });
  assert.equal(named[0], 'wiki/semantic-search.md');
});

test('is case-insensitive, honors the limit and breaks ties by path', async (t) => {
  const vaultPath = vault(t, Object.fromEntries(['c', 'a', 'b'].map(n => [`wiki/${n}.md`, '# T\nQUERY text.\n'])));
  assert.deepEqual(await fsKeywordSearch('query', { vaultPath }), ['wiki/a.md', 'wiki/b.md', 'wiki/c.md']);
  assert.deepEqual(await fsKeywordSearch('query', { vaultPath, limit: 2 }), ['wiki/a.md', 'wiki/b.md']);
});

test('searches only the requested scope and skips dot folders, templates and non-markdown', async (t) => {
  const vaultPath = vault(t, {
    'wiki/a.md': 'needle\n', 'moc/m.md': 'needle\n', 'raw/clippings/r.md': 'needle\n',
    'wiki/.hidden/h.md': 'needle\n', 'wiki/_templates/t.md': 'needle\n', 'wiki/image.png': 'needle\n',
  });
  assert.deepEqual(await fsKeywordSearch('needle', { vaultPath, path: 'wiki' }), ['wiki/a.md']);
  assert.deepEqual(await fsKeywordSearch('needle', { vaultPath, path: 'moc' }), ['moc/m.md']);
  assert.deepEqual(await fsKeywordSearch('needle', { vaultPath, path: 'raw' }), ['raw/clippings/r.md']);
});

test('a missing scope folder is zero hits, an unknown scope is refused', async (t) => {
  const vaultPath = vault(t, { 'wiki/a.md': 'needle\n' });
  assert.deepEqual(await fsKeywordSearch('needle', { vaultPath, path: 'moc' }), []);
  for (const path of ['..', 'wiki/../raw', '.recycle', 'log']) {
    await assert.rejects(fsKeywordSearch('needle', { vaultPath, path }), /scope/i, path);
  }
});

test('a query of only stopwords falls back to its phrase; an empty query finds nothing', async (t) => {
  const vaultPath = vault(t, { 'wiki/a.md': 'What is the question?\n', 'wiki/b.md': 'Nothing relevant.\n' });
  assert.deepEqual(await fsKeywordSearch('what is the', { vaultPath }), ['wiki/a.md']);
  assert.deepEqual(await fsKeywordSearch('   ', { vaultPath }), []);
});

test('a file removed mid-scan is skipped, other read errors surface', async (t) => {
  const vaultPath = vault(t, { 'wiki/a.md': 'needle\n', 'wiki/b.md': 'needle\n' });
  const readFileImpl = async (file, enc) => {
    if (file.endsWith('b.md')) throw Object.assign(new Error('gone'), { code: 'ENOENT' });
    return 'needle\n';
  };
  assert.deepEqual(await fsKeywordSearch('needle', { vaultPath, readFileImpl }), ['wiki/a.md']);
  const broken = async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); };
  await assert.rejects(fsKeywordSearch('needle', { vaultPath, readFileImpl: broken }), /denied/);
});

test('a scan past its deadline fails loudly instead of returning a partial list', async (t) => {
  const vaultPath = vault(t, Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`wiki/${i}.md`, 'needle\n'])));
  const readFileImpl = async () => { await new Promise(r => setTimeout(r, 20)); return 'needle\n'; };
  await assert.rejects(fsKeywordSearch('needle', { vaultPath, readFileImpl, deadlineMs: 30, concurrency: 1 }),
    err => err.code === 'KEYWORD_SCAN_TIMEOUT' && /30ms/.test(err.message));
});
