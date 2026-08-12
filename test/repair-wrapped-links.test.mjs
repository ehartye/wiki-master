import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repairWrappedLinks } from '../scripts/repair-wrapped-links.mjs';

// Integration coverage for the CLI wiring itself (buildGraph -> isContent filter ->
// the real page-name index -> dewrapText -> write-back). dewrapText/resolveDewrap's
// own decision logic is exhaustively covered in dewrap-links.test.mjs; this file only
// needs to prove the script assembles those pieces correctly against real files.

function tempVault() {
  const v = mkdtempSync(join(tmpdir(), 'wm-dewrap-'));
  mkdirSync(join(v, 'wiki', 'concepts'), { recursive: true });
  mkdirSync(join(v, 'raw', 'clippings'), { recursive: true });
  return v;
}

function writeNote(vault, relPath, body) {
  const abs = join(vault, relPath);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, body);
}

test('dry run reports what would change without writing anything', () => {
  const v = tempVault();
  writeNote(v, 'wiki/concepts/Real Page.md', '---\ntype: concept\nsources: []\n---\n# Real Page\n');
  writeNote(v, 'wiki/concepts/citer.md',
    '---\ntype: concept\nsources: []\n---\n# Citer\n\nSee [[Real\nPage]] for details.\n');
  const before = readFileSync(join(v, 'wiki/concepts/citer.md'), 'utf8');

  const r = repairWrappedLinks(v, { apply: false });
  assert.equal(r.filesTouched, 1);
  assert.equal(r.fixed, 1);
  assert.equal(r.skipped.length, 0);
  assert.equal(readFileSync(join(v, 'wiki/concepts/citer.md'), 'utf8'), before, 'dry run never writes');
});

test('--apply rewrites the wrapped link in place, verified against the real page index', () => {
  const v = tempVault();
  writeNote(v, 'wiki/concepts/Real Page.md', '---\ntype: concept\nsources: []\n---\n# Real Page\n');
  writeNote(v, 'wiki/concepts/citer.md',
    '---\ntype: concept\nsources: []\n---\n# Citer\n\nSee [[Real\nPage]] for details.\n');

  const r = repairWrappedLinks(v, { apply: true });
  assert.equal(r.fixed, 1);
  const out = readFileSync(join(v, 'wiki/concepts/citer.md'), 'utf8');
  assert.ok(out.includes('[[Real Page]]'));
  assert.ok(!out.includes('[[Real\nPage]]'));
});

// An ORDINARY (non-hyphen-adjacent) wrap is always fixed even with no matching page
// anywhere — collapsing whitespace is a lossless mechanical undo, correct whether or
// not the target page exists yet (it is not a guess at content, only a reversal of a
// known transformation). Only a HYPHEN-ADJACENT wrap is genuinely ambiguous (two
// plausible readings — see dewrap-links.test.mjs) and needs a resolving page before
// it is safe to pick one; with none, it is left untouched and reported.
test('an ordinary wrap with no matching page anywhere is still fixed — a lossless undo, not a guess', () => {
  const v = tempVault();
  writeNote(v, 'wiki/concepts/citer.md',
    '---\ntype: concept\nsources: []\n---\n# Citer\n\nSee [[Nothing\nLike This]] for details.\n');

  const r = repairWrappedLinks(v, { apply: true });
  assert.equal(r.fixed, 1);
  assert.equal(r.skipped.length, 0);
  const out = readFileSync(join(v, 'wiki/concepts/citer.md'), 'utf8');
  assert.ok(out.includes('[[Nothing Like This]]'));
});

test('a hyphen-adjacent wrap with no resolving page anywhere is left untouched and reported', () => {
  const v = tempVault();
  writeNote(v, 'wiki/concepts/citer.md',
    '---\ntype: concept\nsources: []\n---\n# Citer\n\nSee [[Diagno-\nstics]] for details.\n');
  const before = readFileSync(join(v, 'wiki/concepts/citer.md'), 'utf8');

  const r = repairWrappedLinks(v, { apply: true }); // apply: true, but neither candidate resolves — must still be a no-op
  assert.equal(r.fixed, 0);
  assert.equal(r.skipped.length, 1);
  assert.equal(r.skipped[0].page, 'wiki/concepts/citer.md');
  assert.equal(readFileSync(join(v, 'wiki/concepts/citer.md'), 'utf8'), before);
});

test('raw/ clippings are never scanned or rewritten, even if they somehow contain a wrapped-looking span', () => {
  const v = tempVault();
  writeNote(v, 'wiki/concepts/Real Page.md', '---\ntype: concept\nsources: []\n---\n# Real Page\n');
  writeNote(v, 'raw/clippings/weird.md', 'Some clipped text mentioning [[Real\nPage]] verbatim.\n');
  const before = readFileSync(join(v, 'raw/clippings/weird.md'), 'utf8');

  const r = repairWrappedLinks(v, { apply: true });
  assert.equal(r.filesTouched, 0, 'the only wrapped span lives under raw/, which is never touched');
  assert.equal(readFileSync(join(v, 'raw/clippings/weird.md'), 'utf8'), before);
});

test('resolves a hyphen-adjacent wrap correctly against the real page index (the Diagno-/Wizards- ambiguity)', () => {
  const v = tempVault();
  writeNote(v, 'wiki/concepts/Diagnostics.md', '---\ntype: concept\nsources: []\n---\n# Diagnostics\n');
  writeNote(v, 'wiki/concepts/citer.md',
    '---\ntype: concept\nsources: []\n---\n# Citer\n\nSee [[Diagno-\nstics]] for details.\n');

  const r = repairWrappedLinks(v, { apply: true });
  assert.equal(r.fixed, 1);
  const out = readFileSync(join(v, 'wiki/concepts/citer.md'), 'utf8');
  assert.ok(out.includes('[[Diagnostics]]'));
});

test('a page with no wrapped links at all is reported untouched', () => {
  const v = tempVault();
  writeNote(v, 'wiki/concepts/plain.md', '---\ntype: concept\nsources: []\n---\n# Plain\n\nSee [[Real Page]].\n');
  const r = repairWrappedLinks(v, { apply: true });
  assert.equal(r.filesTouched, 0);
  assert.equal(r.fixed, 0);
  assert.equal(r.skipped.length, 0);
});
