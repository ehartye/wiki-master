import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { notesDue, REPEAT_HOURS } from '../scripts/lib/sync-notes.mjs';

// A note about other writers' operations is said once for a set of tokens, again when the set changes, and again once a day
// while it stays true. The memory is local and best effort: if it cannot be read or written the note is said.

const HOUR = 3600 * 1000;
const T0 = Date.parse('2026-10-28T12:00:00Z');
function vault(t) {
  const dir = mkdtempSync(join(tmpdir(), 'wm-sync-notes-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const sets = (open = [], stale = []) => ({ open, stale });

test('the first time a note is true it is due; the same set a moment later is not', (t) => {
  const v = vault(t);
  assert.deepEqual(notesDue(v, sets(['a', 'b'], ['a']), { now: T0 }), { open: true, stale: true });
  assert.deepEqual(notesDue(v, sets(['a', 'b'], ['a']), { now: T0 + 5 * 60 * 1000 }), { open: false, stale: false });
});

test('the order of the tokens does not matter, and a different set is due again', (t) => {
  const v = vault(t);
  notesDue(v, sets(['a', 'b']), { now: T0 });
  assert.equal(notesDue(v, sets(['b', 'a']), { now: T0 + HOUR }).open, false);
  assert.equal(notesDue(v, sets(['a', 'b', 'c']), { now: T0 + 2 * HOUR }).open, true);
  assert.equal(notesDue(v, sets(['a', 'b', 'c']), { now: T0 + 3 * HOUR }).open, false);
  assert.equal(notesDue(v, sets(['a', 'c']), { now: T0 + 4 * HOUR }).open, true, 'a token that went away changes the set too');
});

test('the same set is due again exactly when a day has passed', (t) => {
  const v = vault(t);
  notesDue(v, sets(['a'], ['a']), { now: T0 });
  assert.equal(REPEAT_HOURS, 24);
  assert.equal(notesDue(v, sets(['a'], ['a']), { now: T0 + 23 * HOUR + 59 * 60 * 1000 }).stale, false);
  assert.equal(notesDue(v, sets(['a'], ['a']), { now: T0 + 24 * HOUR }).stale, true);
  assert.equal(notesDue(v, sets(['a'], ['a']), { now: T0 + 24 * HOUR + 60 * 1000 }).stale, false, 'and then quiet again');
});

test('the two notes are remembered separately', (t) => {
  const v = vault(t);
  notesDue(v, sets(['a'], []), { now: T0 });
  assert.deepEqual(notesDue(v, sets(['a'], ['a']), { now: T0 + HOUR }), { open: false, stale: true });
});

test('an empty set clears its memory, so the next time it is true it is said', (t) => {
  const v = vault(t);
  notesDue(v, sets(['a']), { now: T0 });
  assert.equal(notesDue(v, sets([]), { now: T0 + HOUR }).open, false);
  assert.equal(notesDue(v, sets(['a']), { now: T0 + 2 * HOUR }).open, true);
});

test('an empty set writes nothing when nothing was remembered', (t) => {
  const v = vault(t);
  assert.deepEqual(notesDue(v, sets([], []), { now: T0 }), { open: false, stale: false });
  assert.equal(existsSync(join(v, '.wiki-master', 'sync-notes.json')), false);
});

test('a memory that is not valid, or has no usable time, never hides a note', (t) => {
  const v = vault(t);
  mkdirSync(join(v, '.wiki-master'), { recursive: true });
  for (const bad of ['{broken', '[]', '"text"', JSON.stringify({ open: { tokens: 'a', at: 'not a date' } }), JSON.stringify({ open: 'a' })]) {
    writeFileSync(join(v, '.wiki-master', 'sync-notes.json'), bad);
    assert.equal(notesDue(v, sets(['a']), { now: T0 }).open, true, bad);
  }
});

test('a memory that cannot be written never hides a note, and does not throw', (t) => {
  const v = vault(t);
  mkdirSync(join(v, '.wiki-master', 'sync-notes.json'), { recursive: true }); // a directory where the file should be
  assert.equal(notesDue(v, sets(['a']), { now: T0 }).open, true);
  assert.equal(notesDue(v, sets(['a']), { now: T0 + 1000 }).open, true, 'it cannot be remembered, so it is said again');
});

test('what is remembered is only tokens and a time, in a local file under .wiki-master', (t) => {
  const v = vault(t);
  notesDue(v, sets(['b', 'a']), { now: T0 });
  assert.deepEqual(JSON.parse(readFileSync(join(v, '.wiki-master', 'sync-notes.json'), 'utf8')), { open: { tokens: 'a,b', at: new Date(T0).toISOString() } });
});
