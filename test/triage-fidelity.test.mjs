import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fidelityFlagged, scanClippings } from '../scripts/triage.mjs';

// `extraction:` records HOW text was read (ocr vs the text layer). That is a
// method, not a defect — surfacing it as a triage item asks a human to
// disposition a non-problem, and the queue inflates every time OCR escalation
// fires. Only a fidelity grade outside the healthy set is a quality problem.

function vaultWith(clippings) {
  const d = mkdtempSync(join(tmpdir(), 'wm-fid-'));
  const dir = join(d, 'raw', 'clippings');
  mkdirSync(dir, { recursive: true });
  for (const [name, fields] of Object.entries(clippings)) {
    writeFileSync(join(dir, `${name}.md`), `---\ntitle: "${name}"\nsource: "/x/${name}.pdf"\n${fields}\n---\n\nbody\n`);
  }
  return d;
}

test('extraction: ocr is a method, not a defect — never a triage flag', () => {
  assert.deepEqual(fidelityFlagged(vaultWith({ 'ocr-clean': 'extraction: ocr' })), []);
});

test('a healthy fidelity grade is not a flag', () => {
  assert.deepEqual(fidelityFlagged(vaultWith({ good: 'fidelity: high' })), []);
});

test('fidelity: degraded is flagged', () => {
  const f = fidelityFlagged(vaultWith({ bad: 'fidelity: degraded' }));
  assert.equal(f.length, 1);
  assert.match(f[0].reason, /degraded/);
  assert.equal(f[0].kind, 'fidelity');
});

test('an extraction line must not mask a real fidelity flag below it', () => {
  const f = fidelityFlagged(vaultWith({ 'ocr-bad': 'extraction: ocr\nfidelity: degraded' }));
  assert.equal(f.length, 1, 'the earlier extraction: line previously won the regex and hid this');
  assert.match(f[0].reason, /degraded/);
});

// --- topic extraction (2026-08-10 design spec) -------------------------------
// scanClippings answers two questions about the same 1,200 bytes of
// frontmatter, in one pass over a directory that holds 1,800+ files on the
// reference vault. Scanning it twice is waste the queue would pay per render.

test('a clipping declares its research topic under both identities a triage row can arrive as', () => {
  const v = vaultWith({ paper: 'topic: BPD Research\nfidelity: high' });
  const { topics } = scanClippings(v);
  assert.equal(topics.length, 1);
  assert.equal(topics[0].topic, 'BPD Research');
  assert.equal(topics[0].path, 'raw/clippings/paper.md', 'backlog rows arrive as this path');
  assert.equal(topics[0].url, '/x/paper.pdf', 'issues arrive as this URL');
});

test('a clipping with no topic contributes nothing rather than a null entry', () => {
  assert.deepEqual(scanClippings(vaultWith({ plain: 'fidelity: high' })).topics, []);
});

test('a flagged clipping carries its topic, so a fidelity row groups without a second lookup', () => {
  const { flagged } = scanClippings(vaultWith({ bad: 'topic: Audio DSP\nfidelity: degraded' }));
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].topic, 'Audio DSP');
});

test('a quoted topic value is unwrapped, as YAML-escaped frontmatter writes it that way', () => {
  const { topics } = scanClippings(vaultWith({ q: 'topic: "Goal Setting: A Review"\nfidelity: high' }));
  assert.equal(topics[0].topic, 'Goal Setting: A Review');
});

test('a vault with no clippings directory yields both lists empty rather than throwing', () => {
  const d = mkdtempSync(join(tmpdir(), 'wm-fid-none-'));
  assert.deepEqual(scanClippings(d), { flagged: [], topics: [] });
});
