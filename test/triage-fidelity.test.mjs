import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fidelityFlagged } from '../scripts/triage.mjs';

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
