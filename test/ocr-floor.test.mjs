import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { pdfClipContent, ocrFidelityFloor, buildOcrClip } from '../scripts/clip-pdf.mjs';
import { fidelityIsExtractionDerived, ocrFloorBackfill } from '../scripts/refresh-fidelity.mjs';
import { fidelityFlagged } from '../scripts/triage.mjs';

// Recognised text is well-formed UTF-8 whose words may simply be the wrong words, and nothing in the characters
// shows it, so an OCR'd clipping used to be stamped as healthy as a clean text layer. The extraction path is the
// only code that knows OCR ran, so it declares a floor: `ocr`. Precedence: degraded > ocr > tabular.

const PROSE = 'The quick brown fox jumps over the lazy dog and keeps running through the field. '.repeat(40);
const base = { title: 'Scan', source: '/x/scan.pdf', text: PROSE, quality: 'medium', created: '2026-01-01' };
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('ocrFidelityFloor: OCR outranks a tabular floor and yields to a degraded one', () => {
  assert.equal(ocrFidelityFloor(undefined), 'ocr');
  assert.equal(ocrFidelityFloor('tabular'), 'ocr');
  assert.equal(ocrFidelityFloor('degraded'), 'degraded');
});

test('buildOcrClip: clean recognised text is stamped ocr, and the extraction says how', () => {
  const clip = buildOcrClip({ ...base, ocrText: PROSE });
  assert.equal(clip.fidelity, 'ocr');
  assert.equal(clip.assessed, 'high');
  assert.match(clip.body, /^fidelity: ocr$/m);
  assert.match(clip.body, /^extraction: ocr$/m);
});

test('buildOcrClip: a table-aware mode floor does not survive OCR (the text came from recognition)', () => {
  assert.equal(buildOcrClip({ ...base, ocrText: PROSE, modeFloor: 'tabular' }).fidelity, 'ocr');
});

test('buildOcrClip: a table-flattened mode floor stays degraded', () => {
  assert.equal(buildOcrClip({ ...base, ocrText: PROSE, modeFloor: 'degraded' }).fidelity, 'degraded');
});

test('buildOcrClip: OCR that also trips a character check is degraded, not ocr', () => {
  const bad = PROSE + ' �'.repeat(60);
  const clip = buildOcrClip({ ...base, ocrText: bad });
  assert.equal(clip.assessed, 'degraded');
  assert.equal(clip.fidelity, 'degraded');
});

test('a clean text layer still omits the field', () => {
  const clip = pdfClipContent({ ...base, extraction: undefined });
  assert.equal(clip.fidelity, 'high');
  assert.doesNotMatch(clip.body, /^fidelity:/m);
});

test('both first-clip OCR paths (--ocr and the automatic fallback) build their clipping through buildOcrClip', () => {
  const src = readFileSync(join(root, 'scripts', 'clip-pdf.mjs'), 'utf8');
  assert.match(src, /clip = buildOcrClip\(\{ title, source, ocrText: pdfToTextOcr\(pdfPath, \{ lang \}\), quality, topic \}\)/);
  assert.match(src, /clip = preferBetterExtraction\(clip, buildOcrClip\(/);
  // The fallback runs after a reading mode was chosen, so it hands that mode's floor down; a table-flattened
  // document must not come out of OCR better than its mode said.
  assert.match(src, /buildOcrClip\(\{ title, source, ocrText: pdfToTextOcr\(pdfPath, \{ lang \}\), quality, topic, modeFloor: mode\.fidelityFloor \}\)/);
  // The helper is the only place that names the extraction, so no path can build an OCR clipping without a floor.
  assert.equal(src.split("extraction: 'ocr'").length - 1, 1);
});

test('refresh-fidelity treats an ocr extraction as the basis of its flag, so a refresh cannot clear the floor', () => {
  assert.equal(fidelityIsExtractionDerived('extraction: ocr\nfidelity: ocr'), true);
  assert.equal(fidelityIsExtractionDerived('extraction: "ocr"\nfidelity: ocr'), true);
  assert.equal(fidelityIsExtractionDerived('extraction: pdftotext\nfidelity: degraded'), false);
});

test('ocrFloorBackfill: sets fidelity: ocr after the extraction line, and only when it is missing', () => {
  const text = '---\ntitle: "T"\nextraction: ocr\nsource-hash: abc1234\n---\n\nbody\n';
  assert.equal(ocrFloorBackfill(text), '---\ntitle: "T"\nextraction: ocr\nfidelity: ocr\nsource-hash: abc1234\n---\n\nbody\n');
  assert.equal(ocrFloorBackfill('---\nextraction: "ocr"\n---\nb\n'), '---\nextraction: "ocr"\nfidelity: ocr\n---\nb\n');
  assert.equal(ocrFloorBackfill('---\nextraction: ocr\nfidelity: degraded\n---\nb\n'), null, 'an existing grade is never replaced');
  assert.equal(ocrFloorBackfill('---\nextraction: ocr\nfidelity: ocr\n---\nb\n'), null, 'already set');
  assert.equal(ocrFloorBackfill('---\nextraction: table-aware\n---\nb\n'), null, 'another extraction');
  assert.equal(ocrFloorBackfill('---\ntitle: "T"\n---\nextraction: ocr\n'), null, 'only the frontmatter counts');
  assert.equal(ocrFloorBackfill('no frontmatter\n'), null);
});

test('ocrFloorBackfill keeps CRLF line endings', () => {
  const text = '---\r\ntitle: "T"\r\nextraction: ocr\r\n---\r\n\r\nbody\r\n';
  assert.equal(ocrFloorBackfill(text), '---\r\ntitle: "T"\r\nextraction: ocr\r\nfidelity: ocr\r\n---\r\n\r\nbody\r\n');
});

function vaultWith(clippings) {
  const d = mkdtempSync(join(tmpdir(), 'wm-ocrfloor-'));
  mkdirSync(join(d, 'raw', 'clippings'), { recursive: true });
  for (const [name, fields] of Object.entries(clippings)) {
    writeFileSync(join(d, 'raw', 'clippings', `${name}.md`), `---\ntitle: "${name}"\nsource: "/x/${name}.pdf"\n${fields}\n---\n\nbody\n`);
  }
  return d;
}
const run = (vault, ...args) => spawnSync(process.execPath, [join(root, 'scripts', 'refresh-fidelity.mjs'), ...args], {
  env: { ...process.env, WIKI_MASTER_VAULT: vault }, encoding: 'utf8',
});

test('refresh-fidelity --ocr-floor: a dry run lists and writes nothing; --apply writes only the unmarked OCR clippings; a rerun does nothing', (t) => {
  const vault = vaultWith({
    unmarked: 'extraction: ocr',
    graded: 'extraction: ocr\nfidelity: degraded',
    marked: 'extraction: ocr\nfidelity: ocr',
    layer: 'extraction: table-aware\nfidelity: tabular',
    plain: 'quality: medium',
  });
  t.after(() => rmSync(vault, { recursive: true, force: true }));
  const read = (n) => readFileSync(join(vault, 'raw', 'clippings', `${n}.md`), 'utf8');
  const before = Object.fromEntries(['unmarked', 'graded', 'marked', 'layer', 'plain'].map((n) => [n, read(n)]));

  const dry = run(vault, '--ocr-floor');
  assert.equal(dry.status, 0, dry.stderr);
  const dryOut = JSON.parse(dry.stdout.split('\n')[0]);
  assert.deepEqual([dryOut.mode, dryOut.applied, dryOut.count], ['ocr-floor', false, 1]);
  assert.deepEqual(dryOut.paths, ['raw/clippings/unmarked.md']);
  for (const n of Object.keys(before)) assert.equal(read(n), before[n], `${n} untouched by a dry run`);

  const applied = run(vault, '--ocr-floor', '--apply');
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(read('unmarked'), /^extraction: ocr\nfidelity: ocr$/m);
  for (const n of ['graded', 'marked', 'layer', 'plain']) assert.equal(read(n), before[n], `${n} untouched by --apply`);

  const again = JSON.parse(run(vault, '--ocr-floor').stdout.split('\n')[0]);
  assert.equal(again.count, 0);
});

test('refresh-fidelity (the default pass) leaves an ocr floor in place', (t) => {
  const vault = vaultWith({ marked: 'extraction: ocr\nfidelity: ocr' });
  t.after(() => rmSync(vault, { recursive: true, force: true }));
  const r = run(vault, '--apply');
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(join(vault, 'raw', 'clippings', 'marked.md'), 'utf8'), /^fidelity: ocr$/m);
  assert.equal(JSON.parse(r.stdout.split('\n')[0]).preserved, 1);
});

test('triage: fidelity: ocr is a flag, like tabular (it affects what may be quoted); extraction: ocr alone is not', () => {
  const flagged = fidelityFlagged(vaultWith({ floored: 'extraction: ocr\nfidelity: ocr' }));
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].reason, 'fidelity: ocr');
  assert.deepEqual(fidelityFlagged(vaultWith({ method: 'extraction: ocr' })), []);
});
