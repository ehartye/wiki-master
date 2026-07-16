import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadDeclines, recordDecline, isDeclined, DECLINE_TTL_DAYS,
} from '../scripts/lib/decline.mjs';

function tempVault() {
  return mkdtempSync(join(tmpdir(), 'wm-decline-'));
}

test('recordDecline persists and loadDeclines returns it', () => {
  const v = tempVault();
  recordDecline(v, 'https://example.com/paywalled', 'paywalled; thin extraction');
  const d = loadDeclines(v);
  assert.equal(d.length, 1);
  assert.equal(d[0].url, 'https://example.com/paywalled');
  assert.equal(d[0].reason, 'paywalled; thin extraction');
  assert.ok(d[0].date, 'decline carries its date');
  assert.ok(existsSync(join(v, '.wiki-master', 'declined.json')));
});

test('isDeclined matches on normalized URL (fragment, trailing slash, case)', () => {
  const v = tempVault();
  recordDecline(v, 'https://example.com/Article/', 'off-topic');
  const d = loadDeclines(v);
  assert.ok(isDeclined('https://example.com/Article#section', d));
  assert.ok(isDeclined('https://EXAMPLE.com/article', d));
  assert.ok(!isDeclined('https://example.com/other', d));
});

test('declines expire after TTL and are re-litigated, not permanent (RFC 2308)', () => {
  const v = tempVault();
  recordDecline(v, 'https://example.com/old', 'was thin in 2024');
  // Backdate the entry past the TTL by rewriting the file.
  const f = join(v, '.wiki-master', 'declined.json');
  const raw = JSON.parse(readFileSync(f, 'utf8'));
  const past = new Date(Date.now() - (DECLINE_TTL_DAYS + 1) * 86400_000);
  raw[0].date = past.toISOString().slice(0, 10);
  recordDecline(v, 'https://example.com/fresh', 'recent decline');
  // Manually restore the backdated entry (recordDecline rewrote the file).
  const now = JSON.parse(readFileSync(f, 'utf8'));
  const merged = [raw[0], ...now.filter((e) => e.url !== raw[0].url)];
  require_write(f, merged);
  const d = loadDeclines(v);
  assert.ok(!isDeclined('https://example.com/old', d), 'expired decline is dropped on load');
  assert.ok(isDeclined('https://example.com/fresh', d), 'fresh decline still active');
});

test('recording the same URL twice updates rather than duplicates', () => {
  const v = tempVault();
  recordDecline(v, 'https://example.com/x', 'first reason');
  recordDecline(v, 'https://example.com/x/', 'second reason');
  const d = loadDeclines(v);
  assert.equal(d.length, 1);
  assert.equal(d[0].reason, 'second reason');
});

// Small helper so the backdating test can rewrite the store.
import { writeFileSync } from 'node:fs';
function require_write(f, data) {
  writeFileSync(f, JSON.stringify(data, null, 2));
}

// Integration: clip.mjs consults the decline log before fetching anything.
import { main as clipMain } from '../scripts/clip.mjs';

test('clip.mjs --decline records without fetching; subsequent clip is skipped', () => {
  const v = tempVault();
  process.env.WIKI_MASTER_VAULT = v;
  try {
    const r1 = clipMain(['https://example.com/rejected', '--decline=scored below rubric floor']);
    assert.equal(r1.status, 'declined');
    // Second call without --decline: must skip via the log, never reach defuddle.
    const r2 = clipMain(['https://example.com/rejected/', '--quality=high']);
    assert.equal(r2.status, 'declined');
  } finally {
    delete process.env.WIKI_MASTER_VAULT;
  }
});
