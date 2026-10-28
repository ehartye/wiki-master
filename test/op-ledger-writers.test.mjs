import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { beginOp } from '../scripts/op-begin.mjs';
import { readWritten, writtenLedgerFile } from '../scripts/lib/op-ledger.mjs';

// The catalog and log writers record what they write when given the operation token, so the log entry (whose name carries a
// timestamp, known only after the step before the commit) and the catalog files no longer have to be remembered by hand.

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DASH = String.fromCodePoint(0x2014);

function vault(t) {
  const dir = mkdtempSync(join(tmpdir(), 'wm-wr-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const project of ['alpha']) {
    mkdirSync(join(dir, 'wiki/authored', project, 'backlog'), { recursive: true });
    for (const [name, kind] of [['overview', 'overview'], ['shared', 'note'], ['backlog/task', 'backlog-item']]) {
      writeFileSync(join(dir, 'wiki/authored', project, `${name}.md`), `---\ntype: authored\nproject: ${project}\nkind: ${kind}\nbacklog-status: planned\nsources: []\n---\n# ${name}\n`);
    }
  }
  return dir;
}
const run = (script, dir, args, input) => spawnSync(process.execPath, [join(root, 'scripts', script), ...args], { env: { ...process.env, WIKI_MASTER_VAULT: dir }, encoding: 'utf8', input });

test('log-entry --since records the log file it created, under its timestamped name', (t) => {
  const v = vault(t);
  const token = beginOp(v, 'ingest');
  const r = run('log-entry.mjs', v, ['--op', 'ingest', '--title', `Fish ${DASH} a note`, '--since', token], 'body\n');
  assert.equal(r.status, 0, r.stderr);
  const printed = r.stdout.trim();
  assert.match(printed, /^log\/\d{4}-\d{2}-\d{2}-\d{6}-ingest-/);
  assert.deepEqual(readWritten(v, token), [printed]);
});

test('log-entry without --since records nothing; with a token that is not open it still writes and says what to run', (t) => {
  const v = vault(t);
  const token = beginOp(v, 'ingest');
  assert.equal(run('log-entry.mjs', v, ['--op', 'ingest', '--title', 'plain'], 'body\n').status, 0);
  assert.equal(existsSync(writtenLedgerFile(v, token)), false);
  const lost = run('log-entry.mjs', v, ['--op', 'ingest', '--title', 'lost'], 'body\n');
  assert.equal(lost.status, 0);
  const bad = run('log-entry.mjs', v, ['--op', 'ingest', '--title', 'orphan', '--since', 'bbbbbbbbbbbbbbbb'], 'body\n');
  assert.equal(bad.status, 0, 'the entry was written, so the command succeeds');
  assert.match(bad.stdout.trim(), /^log\//);
  assert.match(bad.stderr, /not recorded in the operation ledger.*op-ledger\.mjs add --since bbbbbbbbbbbbbbbb "log\//s);
});

test('refresh-catalogs --apply --since records exactly the files it changed; a dry run records nothing', (t) => {
  const v = vault(t);
  const token = beginOp(v, 'relink');
  const dry = run('refresh-catalogs.mjs', v, ['--project', 'alpha', '--since', token]);
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(existsSync(writtenLedgerFile(v, token)), false, 'a dry run wrote nothing, so it records nothing');
  const applied = run('refresh-catalogs.mjs', v, ['--project', 'alpha', '--apply', '--since', token]);
  assert.equal(applied.status, 0, applied.stderr);
  const changed = JSON.parse(applied.stdout).changed;
  assert.ok(changed.includes('index.md') && changed.includes('moc/alpha.md'));
  assert.deepEqual(readWritten(v, token), changed);
  const again = beginOp(v, 'relink');
  assert.equal(JSON.parse(run('refresh-catalogs.mjs', v, ['--project', 'alpha', '--apply', '--since', again]).stdout).changed.length, 0);
  assert.equal(existsSync(writtenLedgerFile(v, again)), false, 'a repeat changed nothing and records nothing');
});

test('the two generators refresh-catalogs batches still reject --since: they would accept it and record nothing', (t) => {
  const v = vault(t);
  const token = beginOp(v, 'relink');
  for (const script of ['backlog-gen.mjs', 'moc-authored-gen.mjs']) {
    const r = run(script, v, ['--project', 'alpha', '--since', token]);
    assert.notEqual(r.status, 0, script);
    assert.match(r.stderr, /since/, script);
  }
});

test('index-gen --since records index.md when it changed, and not when it did not', (t) => {
  const v = vault(t);
  const first = beginOp(v, 'ingest');
  assert.equal(run('index-gen.mjs', v, ['--since', first]).status, 0);
  assert.deepEqual(readWritten(v, first), ['index.md']);
  const second = beginOp(v, 'ingest');
  assert.equal(run('index-gen.mjs', v, ['--since', second]).status, 0);
  assert.equal(existsSync(writtenLedgerFile(v, second)), false);
});
