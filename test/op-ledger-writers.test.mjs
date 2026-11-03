import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { beginOp } from '../scripts/op-begin.mjs';
import { readWritten, recordWritten, writtenLedgerFile } from '../scripts/lib/op-ledger.mjs';
import { refreshCatalogs } from '../scripts/refresh-catalogs.mjs';
import { commitOp } from '../scripts/op-commit.mjs';
import { syncVault } from '../scripts/wiki-sync.mjs';

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

test('project-only ledger publishes only owned pages, project catalogs and log to a real remote', async t => {
  const v = vault(t);
  const remoteRoot = mkdtempSync(join(tmpdir(), 'wm-catalog-remote-'));
  t.after(() => rmSync(remoteRoot, { recursive: true, force: true }));
  const remote = join(remoteRoot, 'remote.git');
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(v, 'init', '-q', '-b', 'main');
  git(v, 'config', 'user.name', 'Fixture'); git(v, 'config', 'user.email', 'fixture@example.com');
  git(v, 'config', 'core.autocrlf', 'false');
  writeFileSync(join(v, '.gitignore'), '.wiki-master/\n');
  refreshCatalogs(v, { apply: true });
  git(v, 'add', '.'); git(v, 'commit', '-qm', 'baseline');
  git(remoteRoot, 'init', '-q', '--bare', '-b', 'main', remote);
  git(v, 'remote', 'add', 'origin', remote); git(v, 'push', '-qu', 'origin', 'main');
  const baseline = git(v, 'rev-parse', 'HEAD');
  const foreign = ['wiki/authored/alpha/foreign-staged.md', 'wiki/authored/alpha/foreign-untracked.md'];
  const note = name => `---\ntype: authored\nproject: alpha\nkind: note\nsources: []\n---\n# ${name}\n`;
  for (const path of foreign) writeFileSync(join(v, path), note(path));
  git(v, 'add', foreign[0]);
  writeFileSync(join(v, 'index.md'), `${readFileSync(join(v, 'index.md'), 'utf8')}\nForeign work: [[foreign-untracked]]\n`);
  utimesSync(join(v, 'index.md'), new Date('2020-01-01'), new Date('2020-01-01'));
  const untouched = ['index.md', ...foreign].map(path => ({ path, bytes: readFileSync(join(v, path), 'utf8'), mtime: statSync(join(v, path)).mtimeMs }));
  const token = beginOp(v, 'relink');
  const owned = ['wiki/authored/alpha/owned.md', 'wiki/authored/alpha/backlog/owned-task.md'];
  writeFileSync(join(v, owned[0]), note('Owned'));
  writeFileSync(join(v, owned[1]), note('Owned task').replace('kind: note', 'kind: backlog-item\nbacklog-status: planned'));
  recordWritten(v, token, owned);
  const ledger = join(v, '.wiki-master', 'catalog-ledger.json');
  writeFileSync(ledger, JSON.stringify(owned));
  const args = ['--project', 'alpha', '--project-only', '--paths-file', ledger, '--since', token, '--diff'];
  const beforeLedger = readFileSync(writtenLedgerFile(v, token));
  const dry = run('refresh-catalogs.mjs', v, args);
  assert.equal(dry.status, 0, dry.stderr);
  const predicted = JSON.parse(dry.stdout).changed;
  assert.deepEqual(readFileSync(writtenLedgerFile(v, token)), beforeLedger);
  assert.deepEqual(predicted, ['wiki/authored/alpha/roadmap.md', 'moc/alpha.md']);
  const applied = run('refresh-catalogs.mjs', v, [...args, '--apply']);
  assert.equal(applied.status, 0, applied.stderr);
  assert.deepEqual(JSON.parse(applied.stdout).changed, predicted);
  assert.deepEqual(readWritten(v, token), [...owned, ...predicted]);
  const afterLedger = readFileSync(writtenLedgerFile(v, token));
  const repeated = run('refresh-catalogs.mjs', v, [...args, '--apply']);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.deepEqual(JSON.parse(repeated.stdout).changed, []);
  assert.deepEqual(readFileSync(writtenLedgerFile(v, token)), afterLedger, 'repeat must not append ledger paths');
  for (const name of ['foreign-staged', 'foreign-untracked']) assert.ok(!readFileSync(join(v, 'moc/alpha.md'), 'utf8').includes(name));
  const logged = run('log-entry.mjs', v, ['--op', 'relink', '--title', 'Project only fixture', '--since', token], 'Verified project-only scope.\n');
  assert.equal(logged.status, 0, logged.stderr);
  const expected = [...owned, ...predicted, logged.stdout.trim()].sort();
  const result = commitOp(v, { op: 'relink', title: 'Project only fixture', token, paths: readWritten(v, token) });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.committed, true);
  const committed = git(v, 'diff-tree', '--no-commit-id', '--name-only', '-r', '-z', 'HEAD').split('\0').filter(Boolean).sort();
  assert.deepEqual(committed, expected, 'inspect actual commit membership, not reported counts');
  const published = await syncVault(v);
  assert.equal(published.ok, true, JSON.stringify(published));
  assert.equal(published.inSync, true);
  assert.equal(git(remote, 'rev-parse', 'main'), git(v, 'rev-parse', 'HEAD'));
  assert.equal(git(remote, 'merge-base', '--is-ancestor', baseline, 'main'), '');
  assert.deepEqual(git(remote, 'diff-tree', '--no-commit-id', '--name-only', '-r', '-z', 'main').split('\0').filter(Boolean).sort(), expected);
  assert.equal(existsSync(join(v, '.wiki-master', 'ops', `${token}.json`)), false);
  assert.deepEqual(git(v, 'diff', '--cached', '--name-only', '-z').split('\0').filter(Boolean), [foreign[0]], 'foreign staged page stays staged');
  for (const item of untouched) {
    assert.equal(readFileSync(join(v, item.path), 'utf8'), item.bytes);
    assert.equal(statSync(join(v, item.path)).mtimeMs, item.mtime);
  }
  assert.ok(git(v, 'status', '--porcelain').includes(foreign[1]));
});
