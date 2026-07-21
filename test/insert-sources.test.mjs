import { test } from 'node:test';
import assert from 'node:assert/strict';
import { insertSources } from '../scripts/lib/backfill.mjs';

// Guardrail #2 says every wiki page carries `sources:`. Many concept pages quote a
// clipping verbatim while declaring no provenance at all, so the quote cannot be
// walked back to raw/. Recording the source it already rests on is the repair.

test('adds a sources: line to a page that declares none', () => {
  const t = '---\ntype: concept\nstatus: maintained\nai-generated: true\n---\nbody\n';
  const out = insertSources(t, ['Collins — Game Sound']);
  assert.match(out, /^sources: \["\[\[Collins — Game Sound\]\]"\]$/m);
  assert.ok(out.endsWith('---\nbody\n'), 'body untouched');
});

test('merges into an existing list without dropping what is there', () => {
  const t = '---\nsources: ["[[A]]"]\n---\nbody\n';
  const out = insertSources(t, ['B']);
  assert.match(out, /sources: \["\[\[A\]\]", "\[\[B\]\]"\]/);
});

test('is a no-op when every link is already recorded', () => {
  const t = '---\nsources: ["[[A]]", "[[B]]"]\n---\nbody\n';
  assert.equal(insertSources(t, ['B', 'A']), t);
});

test('does not duplicate a link already present', () => {
  const t = '---\nsources: ["[[A]]"]\n---\nbody\n';
  const out = insertSources(t, ['A', 'B']);
  assert.equal((out.match(/\[\[A\]\]/g) || []).length, 1);
});

test('leaves a page with no frontmatter alone — nothing to anchor to', () => {
  const t = '# just a body\n';
  assert.equal(insertSources(t, ['A']), t);
});

test('an empty link list changes nothing', () => {
  const t = '---\ntype: concept\n---\nbody\n';
  assert.equal(insertSources(t, []), t);
});

test('preserves a piped display link already recorded', () => {
  const t = '---\nsources: ["[[wiki/sources/X|X]]"]\n---\nbody\n';
  const out = insertSources(t, ['Y']);
  assert.ok(out.includes('[[wiki/sources/X|X]]'), 'existing alias form survives');
  assert.ok(out.includes('[[Y]]'));
});
