import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { slugify, stamp, writeLogEntry } from '../scripts/log-entry.mjs';

test('slugify lowercases, replaces punctuation, drops edge dashes', () => {
  assert.equal(slugify('State DOT: Estimating Practices!'), 'state-dot-estimating-practices');
  assert.equal(slugify(''), 'entry');
});

test('stamp formats day and zero-padded time (local clock)', () => {
  const d = new Date(2026, 6, 19, 9, 3, 5); // month is 0-based: 6 => July
  assert.deepEqual(stamp(d), { day: '2026-07-19', time: '090305' });
});

test('writeLogEntry writes a uniquely-named file with frontmatter + heading', () => {
  const vault = mkdtempSync(join(tmpdir(), 'wm-log-'));
  const now = new Date(2026, 6, 19, 22, 43, 1);
  const rel = writeLogEntry({ vaultPath: vault, op: 'ingest', title: 'Hello: World', body: 'the body', now });
  assert.equal(rel, join('log', '2026-07-19-224301-ingest-hello-world.md'));
  const txt = readFileSync(join(vault, rel), 'utf8');
  assert.match(txt, /^---\ndate: 2026-07-19\nop: ingest\ntitle: "Hello: World"\n---\n/);
  assert.match(txt, /## \[2026-07-19\] ingest \| Hello: World\n\nthe body\n$/);
});

test('writeLogEntry never overwrites: a collision gets a numeric suffix', () => {
  const vault = mkdtempSync(join(tmpdir(), 'wm-log-'));
  const now = new Date(2026, 6, 19, 22, 43, 1);
  const a = writeLogEntry({ vaultPath: vault, op: 'ingest', title: 'Dup', body: 'A', now });
  const b = writeLogEntry({ vaultPath: vault, op: 'ingest', title: 'Dup', body: 'B', now });
  assert.notEqual(a, b);
  assert.equal(b, join('log', '2026-07-19-224301-ingest-dup-2.md'));
  assert.ok(readFileSync(join(vault, a), 'utf8').includes('A'));
  assert.ok(readFileSync(join(vault, b), 'utf8').includes('B'));
});
