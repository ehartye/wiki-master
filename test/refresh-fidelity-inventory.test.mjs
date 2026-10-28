import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Clippings made before the letter inventory existed were stamped healthy. `refresh-fidelity --inventory` lists the PDF
// clippings that now assess as suspect and are not already marked, so the owner can look at them. It only lists: a
// grade on evidence is the owner's call, and the mode refuses --apply.

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const corpus = join(root, 'eval', 'plugin-docs-vault', 'wiki', 'authored', 'plugin-docs');
const prose = readFileSync(join(corpus, 'readme.md'), 'utf8').replace(/\r\n/g, '\n').replace(/^---\n[\s\S]*?\n---\n/, '');
const shift = (text, by) => text.replace(/[a-z]/gi, (c) => {
  const base = c <= 'Z' ? 65 : 97;
  return String.fromCharCode(base + ((c.charCodeAt(0) - base + by) % 26));
});
const clipping = (fields, body) => `---\ntitle: "T"\nsource: "${fields.source}"\n${fields.extra ?? ''}source-hash: abc1234\n---\n\n${body}\n`;

function vault(t) {
  const dir = mkdtempSync(join(tmpdir(), 'wm-inventory-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'raw', 'clippings'), { recursive: true });
  const files = {
    'clean-pdf': clipping({ source: 'C:/x/clean.pdf' }, prose),
    'shifted-unmarked': clipping({ source: 'C:/x/shifted.pdf' }, shift(prose, 3)),
    'shifted-marked': clipping({ source: 'C:/x/marked.pdf', extra: 'fidelity: degraded\n' }, shift(prose, 3)),
    'shifted-page': clipping({ source: 'https://example.org/page' }, shift(prose, 3)),
    'shifted-short': clipping({ source: 'C:/x/short.pdf' }, shift(prose, 3).slice(0, 1500)),
  };
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, 'raw', 'clippings', `${name}.md`), text);
  return dir;
}
const run = (dir, ...args) => spawnSync(process.execPath, [join(root, 'scripts', 'refresh-fidelity.mjs'), ...args], { env: { ...process.env, WIKI_MASTER_VAULT: dir }, encoding: 'utf8' });
const snapshot = (dir) => Object.fromEntries(readdirSync(join(dir, 'raw', 'clippings')).map((f) => [f, readFileSync(join(dir, 'raw', 'clippings', f), 'utf8')]));

test('--inventory lists only the unmarked PDF clippings that now assess as suspect, and writes nothing', (t) => {
  const dir = vault(t);
  const before = snapshot(dir);
  const r = run(dir, '--inventory');
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.split('\n')[0]);
  assert.deepEqual([out.type, out.mode, out.applied], ['refresh-fidelity', 'inventory', false]);
  assert.deepEqual(out.suspects.map((s) => s.path), ['raw/clippings/shifted-unmarked.md']);
  assert.equal(out.count, 1);
  assert.ok(out.suspects[0].low.length >= 3 && out.suspects[0].low.every((x) => x.letter && x.share < x.floor));
  assert.equal(out.tested, 3, 'the clean, the unmarked and the already-marked PDF clippings were judged; the page and the short one were not');
  assert.deepEqual(snapshot(dir), before);
});

test('--inventory has no apply mode', (t) => {
  const dir = vault(t);
  const before = snapshot(dir);
  const r = run(dir, '--inventory', '--apply');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /inventory/i);
  assert.deepEqual(snapshot(dir), before);
});

test('--inventory and --ocr-floor are separate modes', (t) => {
  const r = run(vault(t), '--inventory', '--ocr-floor');
  assert.notEqual(r.status, 0);
});
