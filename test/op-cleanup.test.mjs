import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanupOperations, main as cleanupMain } from '../scripts/op-cleanup.mjs';
import { listOperations } from '../scripts/lib/op-tokens.mjs';

// Operation tokens live in <vault>/.wiki-master/ops/<hex>.json. An operation that
// is abandoned (a crashed session, a failed close that kept its token) leaves one
// behind forever; the live vault had twelve, the oldest from 2026-09-06.
function vault() {
  const dir = mkdtempSync(join(tmpdir(), 'wm-cleanup-'));
  mkdirSync(join(dir, '.wiki-master', 'ops'), { recursive: true });
  return dir;
}

function token(dir, id, hoursAgo, extra = {}) {
  const startedAt = new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString();
  writeFileSync(join(dir, '.wiki-master', 'ops', `${id}.json`), JSON.stringify({ op: 'ingest', startedAt, dirty: ['a.md', 'b.md'], ...extra }));
}

const remaining = (dir) => readdirSync(join(dir, '.wiki-master', 'ops')).sort();

async function run(dir, argv) {
  const prev = process.env.WIKI_MASTER_VAULT;
  process.env.WIKI_MASTER_VAULT = dir;
  const logs = [];
  const errs = [];
  const [origLog, origErr] = [console.log, console.error];
  console.log = (...a) => logs.push(a.join(' '));
  console.error = (...a) => errs.push(a.join(' '));
  process.exitCode = undefined;
  let exitCode;
  try { await cleanupMain(argv); } finally {
    exitCode = process.exitCode;
    process.exitCode = undefined;
    console.log = origLog;
    console.error = origErr;
    if (prev === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = prev;
  }
  return { logs, errs, exitCode };
}

test('listOperations separates recent tokens from abandoned ones by age', () => {
  const dir = vault();
  try {
    token(dir, '069b07798a127734', 24 * 40);
    token(dir, 'fbb32b3279c474d7', 2);
    const ops = listOperations(dir);
    assert.deepEqual(ops.filter(o => o.stale).map(o => o.token), ['069b07798a127734']);
    assert.deepEqual(ops.filter(o => !o.stale).map(o => o.token), ['fbb32b3279c474d7']);
    assert.equal(Math.round(ops.find(o => o.stale).ageHours), 960);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('listOperations ignores files that are not operation tokens and a missing ops folder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wm-cleanup-'));
  try {
    assert.deepEqual(listOperations(dir), []);
    mkdirSync(join(dir, '.wiki-master', 'ops'), { recursive: true });
    writeFileSync(join(dir, '.wiki-master', 'ops', 'notes.txt'), 'x');
    writeFileSync(join(dir, '.wiki-master', 'ops', 'not-hex.json'), '{}');
    assert.deepEqual(listOperations(dir), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the default is a dry run: it lists abandoned tokens and removes nothing', () => {
  const dir = vault();
  try {
    token(dir, '069b07798a127734', 24 * 40);
    const r = cleanupOperations(dir);
    assert.equal(r.applied, false);
    assert.deepEqual(r.stale.map(o => o.token), ['069b07798a127734']);
    assert.deepEqual(r.removed, []);
    assert.deepEqual(remaining(dir), ['069b07798a127734.json']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('--apply removes only the abandoned tokens and leaves recent ones', () => {
  const dir = vault();
  try {
    token(dir, '069b07798a127734', 24 * 40);
    token(dir, '222a8fee3438dcad', 24 * 2);
    token(dir, 'fbb32b3279c474d7', 2);
    const r = cleanupOperations(dir, { apply: true, tokens: ['069b07798a127734', '222a8fee3438dcad', 'aaaaaaaaaaaaaaaa'] });
    assert.deepEqual(r.removed.sort(), ['069b07798a127734', '222a8fee3438dcad']);
    assert.deepEqual(r.kept, ['fbb32b3279c474d7']);
    assert.deepEqual(remaining(dir), ['fbb32b3279c474d7.json']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('--hours changes the cut-off in either direction', () => {
  const dir = vault();
  try {
    token(dir, '222a8fee3438dcad', 30);
    assert.deepEqual(cleanupOperations(dir, { hours: 48 }).stale, []);
    assert.deepEqual(cleanupOperations(dir, { hours: 12 }).stale.map(o => o.token), ['222a8fee3438dcad']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a cut-off that would remove a token from a running session is refused', async () => {
  const dir = vault();
  try {
    token(dir, 'fbb32b3279c474d7', 0.2);
    for (const bad of ['0', '-5', 'abc', '0.5', '']) {
      const r = await run(dir, ['--hours', bad, '--apply']);
      assert.equal(r.exitCode, 1, `--hours ${bad}`);
    }
    assert.deepEqual(remaining(dir), ['fbb32b3279c474d7.json']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a token with no readable start time is judged by its file time', () => {
  const dir = vault();
  try {
    writeFileSync(join(dir, '.wiki-master', 'ops', 'aaaaaaaaaaaaaaaa.json'), '{broken');
    const r = cleanupOperations(dir, { apply: true, tokens: ['069b07798a127734', '222a8fee3438dcad', 'aaaaaaaaaaaaaaaa'] });
    assert.deepEqual(r.removed, [], 'a file written just now is recent, even if unparsable');
    assert.deepEqual(remaining(dir), ['aaaaaaaaaaaaaaaa.json']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the CLI reports what it would do and what it did', async () => {
  const dir = vault();
  try {
    token(dir, '069b07798a127734', 24 * 40, { op: 'ingest' });
    token(dir, 'fbb32b3279c474d7', 2);
    const dry = await run(dir, []);
    assert.equal(dry.exitCode, undefined);
    assert.ok(dry.logs.some(l => /069b07798a127734/.test(l) && /ingest/.test(l)), dry.logs.join('|'));
    assert.ok(dry.logs.some(l => /dry run/i.test(l) && /--apply/.test(l)), dry.logs.join('|'));
    assert.equal(existsSync(join(dir, '.wiki-master', 'ops', '069b07798a127734.json')), true);

    const real = await run(dir, ['--apply', '--token', '069b07798a127734']);
    assert.equal(real.exitCode, undefined);
    assert.ok(real.logs.some(l => /removed 1/.test(l) && /kept 1/.test(l)), real.logs.join('|'));
    assert.equal(existsSync(join(dir, '.wiki-master', 'ops', '069b07798a127734.json')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the CLI rejects options it does not know before touching anything', async () => {
  const dir = vault();
  try {
    token(dir, '069b07798a127734', 24 * 40);
    const r = await run(dir, ['--force', '--apply']);
    assert.equal(r.exitCode, 1);
    assert.deepEqual(remaining(dir), ['069b07798a127734.json']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('nothing to clean says so', async () => {
  const dir = vault();
  try {
    const r = await run(dir, ['--apply', '--token', '069b07798a127734']);
    assert.equal(r.exitCode, undefined);
    assert.ok(r.logs.some(l => /no abandoned/i.test(l)), r.logs.join('|'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
