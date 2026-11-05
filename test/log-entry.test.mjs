import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugify, stamp, writeLogEntry } from '../scripts/log-entry.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'log-entry.mjs');

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
  // Forward-slash on every platform, not join()'s backslash on Windows: this is
  // a vault-relative path, the form every other vault path takes.
  assert.equal(rel, 'log/2026-07-19-224301-ingest-hello-world.md');
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
  assert.equal(b, 'log/2026-07-19-224301-ingest-dup-2.md');
  assert.ok(readFileSync(join(vault, a), 'utf8').includes('A'));
  assert.ok(readFileSync(join(vault, b), 'utf8').includes('B'));
});

// The command itself, spawned: the agent's last step before the refresh.
function runCli(t, args, input) {
  const vault = mkdtempSync(join(tmpdir(), 'wm-log-cli-'));
  t.after(() => rmSync(vault, { recursive: true, force: true }));
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', input, env: { ...process.env, WIKI_MASTER_VAULT: vault } });
  return { ...r, vault };
}

// A synchronous read of fd 0 throws EAGAIN on a non-blocking pipe, which is what PowerShell hands a spawned process.
test('no script reads stdin synchronously', () => {
  const scripts = dirname(SCRIPT);
  const sync = /readFileSync\(\s*(0|process\.stdin\.fd|['"]\/dev\/stdin['"])|readSync\(\s*(0|process\.stdin\.fd)\b/;
  const found = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(full); continue; }
      if (!entry.name.endsWith('.mjs')) continue;
      readFileSync(full, 'utf8').split(/\r?\n/).forEach((line, i) => {
        if (!line.trim().startsWith('//') && sync.test(line)) found.push(`${relative(scripts, full)}:${i + 1}`);
      });
    }
  })(scripts);
  assert.deepEqual(found, []);
});

test('a body that arrives late and in pieces is read whole, even split inside a character', async (t) => {
  const vault = mkdtempSync(join(tmpdir(), 'wm-log-cli-'));
  t.after(() => rmSync(vault, { recursive: true, force: true }));
  const body = Buffer.from('Repointed — one citation.\n');
  const cut = body.indexOf(Buffer.from('—')) + 1;
  const child = spawn(process.execPath, [SCRIPT, '--op', 'relink', '--title', 'Late body'], { env: { ...process.env, WIKI_MASTER_VAULT: vault }, stdio: ['pipe', 'pipe', 'inherit'] });
  let printed = '';
  child.stdout.on('data', (chunk) => { printed += chunk; });
  const closed = new Promise((resolve) => child.on('close', resolve));
  child.stdin.write(body.subarray(0, cut));
  await new Promise((resolve) => setTimeout(resolve, 150));
  child.stdin.end(body.subarray(cut));
  assert.equal(await closed, 0);
  assert.match(readFileSync(join(vault, printed.trim()), 'utf8'), /\n\nRepointed — one citation\.\n$/);
});

test('no stdin at all writes an entry with an empty body', (t) => {
  const vault = mkdtempSync(join(tmpdir(), 'wm-log-cli-'));
  t.after(() => rmSync(vault, { recursive: true, force: true }));
  const r = spawnSync(process.execPath, [SCRIPT, '--op', 'relink', '--title', 'No body'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WIKI_MASTER_VAULT: vault } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(join(vault, r.stdout.trim()), 'utf8'), /\| No body\n\n\n$/);
});

test('the command exits 0, prints the path it wrote, and takes its body on stdin', (t) => {
  const r = runCli(t, ['--op', 'relink', '--title', 'Fixed a link'], 'Repointed one citation.\n');
  assert.equal(r.status, 0, r.stderr);
  const printed = r.stdout.trim();
  assert.match(printed, /^log\/\d{4}-\d{2}-\d{2}-\d{6}-relink-fixed-a-link\.md$/);
  assert.match(readFileSync(join(r.vault, printed), 'utf8'), /\| Fixed a link\n\nRepointed one citation\.\n$/);
});

test('the command rejects --since as an unknown option and writes nothing', (t) => {
  for (const since of [['--since', 'aaaaaaaaaaaaaaaa'], ['--since=aaaaaaaaaaaaaaaa']]) {
    const r = runCli(t, ['--op', 'relink', '--title', 'Fixed a link', ...since], 'body\n');
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /unknown option --since/);
    assert.equal(existsSync(join(r.vault, 'log')), false);
  }
});

test('the command\'s help names its options and does not offer --since', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /--op <op> --title/);
  assert.doesNotMatch(r.stdout, /--since|ledger/);
});
