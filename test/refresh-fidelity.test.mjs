import test from 'node:test';
import assert from 'node:assert/strict';
import { clearFidelityLine, splitBody } from '../scripts/refresh-fidelity.mjs';

// `fidelity:` is a cached verdict from clip time that nothing re-validates, so a
// stale "degraded" outlives the heuristic that produced it. Absent means healthy —
// the convention the clippers already write — so clearing the line is the repair.

test('clearFidelityLine removes the flag and preserves everything else', () => {
  const text = '---\ntitle: "T"\nfidelity: degraded\nsource-hash: abc1234\n---\n\nbody text\n';
  const out = clearFidelityLine(text);
  assert.ok(!/^fidelity:/m.test(out), 'flag gone');
  assert.match(out, /^title: "T"$/m);
  assert.match(out, /^source-hash: abc1234$/m);
  assert.ok(out.endsWith('---\n\nbody text\n'), 'body and fence intact');
});

test('clearFidelityLine handles the flag as the last frontmatter line', () => {
  const text = '---\ntitle: "T"\nfidelity: degraded\n---\nbody\n';
  const out = clearFidelityLine(text);
  assert.ok(!/^fidelity:/m.test(out));
  assert.ok(out.endsWith('---\nbody\n'), 'no dangling blank line before the fence');
});

test('clearFidelityLine is a no-op when there is no flag', () => {
  const text = '---\ntitle: "T"\n---\nbody\n';
  assert.equal(clearFidelityLine(text), text);
});

test('clearFidelityLine does not touch a similarly-named key', () => {
  const text = '---\nfidelity-note: keep me\n---\nbody\n';
  assert.match(clearFidelityLine(text), /fidelity-note: keep me/);
});

test('splitBody returns the markdown after the frontmatter', () => {
  assert.equal(splitBody('---\na: 1\n---\nhello\n'), 'hello\n');
  assert.equal(splitBody('no frontmatter\n'), 'no frontmatter\n');
});
