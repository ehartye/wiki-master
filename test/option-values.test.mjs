import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { optionValue, optionValues } from '../scripts/lib/cli-guard.mjs';

// The guard counts `--name=value` and `--name value` as the same option, so a script that lists an option accepts
// both spellings. Three scripts read their values with `startsWith('--name=')`, which finds only the first: the second
// spelling passed the guard and was silently ignored (a scoped lint ran on the whole vault). One reader now serves all
// of them, and a contract test keeps a fourth copy of the old pattern from appearing.

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('optionValues reads the equals and the space spelling, in order', () => {
  assert.deepEqual(optionValues(['--tier=gapped'], 'tier'), ['gapped']);
  assert.deepEqual(optionValues(['--tier', 'gapped'], 'tier'), ['gapped']);
  assert.deepEqual(optionValues(['--exclude=a/', '--exclude', 'b/', '--json'], 'exclude'), ['a/', 'b/']);
  assert.deepEqual(optionValues(['--json'], 'tier'), []);
});

test('a value that looks like an option is not a value, and a value-less option is the empty string', () => {
  assert.deepEqual(optionValues(['--paths-file', '--json'], 'paths-file'), ['']);
  assert.deepEqual(optionValues(['--paths-file'], 'paths-file'), ['']);
  assert.deepEqual(optionValues(['--paths-file='], 'paths-file'), ['']);
});

test('only whole option names match, and nothing after a bare -- is read', () => {
  assert.deepEqual(optionValues(['--paths-file-extra=x', '--paths-file=y'], 'paths-file'), ['y']);
  assert.deepEqual(optionValues(['--', '--tier=gapped'], 'tier'), []);
  assert.deepEqual(optionValues(['--tier=a=b'], 'tier'), ['a=b'], 'a value may contain an equals sign');
});

test('optionValue is the first value, or undefined when the option is absent', () => {
  assert.equal(optionValue(['--page', 'x.md', '--page=y.md'], 'page'), 'x.md');
  assert.equal(optionValue(['--json'], 'page'), undefined);
});

const page = (project, body = '') => `---\ntype: authored\nstatus: draft\nsources: []\nai-generated: true\nproject: ${project}\nkind: note\nupdated: 2026-01-01\n---\n\n${body}\n`;
function vault(t) {
  const dir = mkdtempSync(join(tmpdir(), 'wm-optvalues-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const p of ['p1', 'p2']) mkdirSync(join(dir, 'wiki', 'authored', p, 'notes'), { recursive: true });
  writeFileSync(join(dir, 'wiki/authored/p1/notes/a.md'), page('p1', 'See [[shared]] for the details of this note about the matter at hand and more words here to count.'));
  writeFileSync(join(dir, 'wiki/authored/p2/notes/b.md'), page('p2', 'See [[shared]] for the details of this other note about the matter at hand and more words here too.'));
  for (const p of ['p1', 'p2']) writeFileSync(join(dir, `wiki/authored/${p}/notes/shared.md`), page(p, `The shared page of project ${p} with enough words in it to be substantive for the integrity scan.`));
  return dir;
}
const run = (script, dir, args) => spawnSync(process.execPath, [join(root, 'scripts', script), ...args], { env: { ...process.env, WIKI_MASTER_VAULT: dir }, encoding: 'utf8' });

test('lint: --paths-file with a space scopes the run exactly as the equals spelling does', (t) => {
  const dir = vault(t);
  const ledger = join(dir, 'ledger.json');
  writeFileSync(ledger, JSON.stringify(['wiki/authored/p1/notes/a.md']));
  const equals = run('lint.mjs', dir, [`--paths-file=${ledger}`]);
  const space = run('lint.mjs', dir, ['--paths-file', ledger]);
  assert.equal(equals.status, 0, equals.stderr);
  assert.equal(space.status, 0, space.stderr);
  assert.match(equals.stdout, /1 of 1 named page\(s\) examined \(paths-file\)/);
  assert.equal(space.stdout, equals.stdout);
});

test('lint: --updated-since and --tier take a space-separated value too', (t) => {
  const dir = vault(t);
  const equals = run('lint.mjs', dir, ['--updated-since=2099-01-01', '--tier=all']);
  const space = run('lint.mjs', dir, ['--updated-since', '2099-01-01', '--tier', 'all']);
  assert.match(equals.stdout, /page\(s\) updated on or after 2099-01-01/);
  assert.equal(space.stdout, equals.stdout);
});

test('lint: an option given with no value is still the existing error', (t) => {
  const r = run('lint.mjs', vault(t), ['--paths-file']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /paths-file needs a file/);
});

test('repair-ambiguous-links: --project, --exclude and --mapping with a space behave as the equals spelling', (t) => {
  const dir = vault(t);
  const json = (args) => JSON.parse(run('repair-ambiguous-links.mjs', dir, [...args, '--json']).stdout);
  const forms = [
    [['--project=p2'], ['--project', 'p2']],
    [['--exclude=wiki/authored/p1/'], ['--exclude', 'wiki/authored/p1/']],
    [['--exclude=wiki/authored/p1/', '--exclude=wiki/authored/p2/'], ['--exclude', 'wiki/authored/p1/', '--exclude', 'wiki/authored/p2/']],
  ];
  for (const [equals, space] of forms) assert.deepEqual(json(space), json(equals), space.join(' '));
  assert.deepEqual(json(['--project', 'p2']).planned.map((p) => p.page), ['wiki/authored/p2/notes/b.md'], 'the filter is applied');
  assert.equal(json(['--exclude', 'wiki/authored/p1/']).excluded.length, 1, 'the exclusion is applied');
  const mapping = join(dir, 'map.json');
  writeFileSync(mapping, JSON.stringify([]));
  assert.deepEqual(json(['--mapping', mapping]), json([`--mapping=${mapping}`]));
});

test('clip-and-repoint: --from and --limit with a space behave as the equals spelling', (t) => {
  const dir = vault(t);
  const from = join(dir, 'binaries');
  mkdirSync(from);
  const equals = run('clip-and-repoint.mjs', dir, [`--from=${from}`, '--limit=1']);
  const space = run('clip-and-repoint.mjs', dir, ['--from', from, '--limit', '1']);
  assert.equal(equals.status, 0, equals.stderr);
  assert.equal(space.status, 0, space.stderr);
  assert.equal(space.stdout, equals.stdout);
});

test('contract: no script reads an option value with the equals-only pattern', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, e.name);
      if (e.isDirectory()) walk(path);
      else if (e.name.endsWith('.mjs') && !path.endsWith(join('lib', 'cli-guard.mjs'))) {
        if (/startsWith\(`--\$\{[A-Za-z_]+\}=`\)/.test(readFileSync(path, 'utf8'))) offenders.push(path.slice(root.length + 1));
      }
    }
  };
  walk(join(root, 'scripts'));
  assert.deepEqual(offenders, [], 'read option values with optionValue/optionValues from lib/cli-guard.mjs');
});
