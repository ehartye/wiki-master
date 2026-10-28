import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import {
  writtenLedgerFile, openOperationProblem, recordWritten, readWritten, removeWritten, writtenRecorder,
} from '../scripts/lib/op-ledger.mjs';
import { listOperations } from '../scripts/lib/op-tokens.mjs';

// The paths one operation wrote, recorded by the writers at the moment they write them. The set used to be rebuilt afterwards
// from git output, which escapes a non-ASCII name unless told not to, so one em-dash clipping was silently left out of a list
// of 24. A ledger entry is the exact path, as UTF-8, one JSON string per line.

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = 'aaaaaaaaaaaaaaaa';
const DASH = String.fromCodePoint(0x2014);

function vault(t, { open = TOKEN } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wm-written-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  if (open) {
    mkdirSync(join(dir, '.wiki-master', 'ops'), { recursive: true });
    writeFileSync(join(dir, '.wiki-master', 'ops', `${open}.json`), JSON.stringify({ op: 'discover', startedAt: new Date().toISOString(), dirty: [] }));
  }
  return dir;
}
const quietWarn = () => { const lines = []; return { warn: (m) => lines.push(m), lines }; };

test('a non-ASCII name is recorded exactly, as UTF-8, one JSON string per line', (t) => {
  const v = vault(t);
  const name = `raw/clippings/Fish ${DASH} a note.md`;
  recordWritten(v, TOKEN, [name]);
  assert.equal(readFileSync(writtenLedgerFile(v, TOKEN), 'utf8'), `${JSON.stringify(name)}\n`);
  assert.ok(readFileSync(writtenLedgerFile(v, TOKEN), 'utf8').includes(DASH), 'the dash is stored as itself, not as an escape');
  assert.deepEqual(readWritten(v, TOKEN), [name]);
});

test('an absolute path is stored vault-relative with / separators; a relative backslash path is mended', (t) => {
  const v = vault(t);
  recordWritten(v, TOKEN, [join(v, 'raw', 'clippings', 'a.md'), 'raw\\clippings\\b.md']);
  assert.deepEqual(readWritten(v, TOKEN), ['raw/clippings/a.md', 'raw/clippings/b.md']);
});

test('a repeat is read once, in first-seen order', (t) => {
  const v = vault(t);
  recordWritten(v, TOKEN, ['raw/clippings/b.md', 'raw/clippings/a.md']);
  recordWritten(v, TOKEN, ['raw/clippings/b.md', 'log/x.md']);
  assert.deepEqual(readWritten(v, TOKEN), ['raw/clippings/b.md', 'raw/clippings/a.md', 'log/x.md']);
});

test('a bad path refuses the whole call and appends nothing', (t) => {
  const v = vault(t);
  recordWritten(v, TOKEN, ['raw/clippings/keep.md']);
  const outside = join(dirname(v), 'elsewhere.md');
  for (const bad of ['', '../x.md', 'raw/../x.md', '/abs.md', 'raw/a:b.md', outside]) {
    assert.throws(() => recordWritten(v, TOKEN, ['raw/clippings/ok.md', bad]), /ledger|outside the vault|vault-relative/i, JSON.stringify(bad));
  }
  assert.throws(() => recordWritten(v, TOKEN, []), /no path/i);
  assert.deepEqual(readWritten(v, TOKEN), ['raw/clippings/keep.md']);
});

test('a token that is malformed, unknown or already closed is refused and no ledger is created', (t) => {
  const v = vault(t);
  for (const bad of ['../keep', '..\\keep', 'not-hex', '', 'abc', 'bbbbbbbbbbbbbbbb']) {
    assert.throws(() => recordWritten(v, bad, ['raw/clippings/a.md']), /operation token|no open operation/i, JSON.stringify(bad));
  }
  assert.equal(existsSync(join(v, '.wiki-master', 'ops', 'bbbbbbbbbbbbbbbb.paths.jsonl')), false);
  assert.match(openOperationProblem(v, 'bbbbbbbbbbbbbbbb'), /no open operation/);
  assert.match(openOperationProblem(v, 'nope'), /malformed/);
  assert.equal(openOperationProblem(v, TOKEN), null);
});

test('a damaged ledger line is an error that names the line', (t) => {
  const v = vault(t);
  writeFileSync(writtenLedgerFile(v, TOKEN), `${JSON.stringify('raw/clippings/a.md')}\nnot json\n`);
  assert.throws(() => readWritten(v, TOKEN), /line 2/);
  writeFileSync(writtenLedgerFile(v, TOKEN), `${JSON.stringify('raw/clippings/a.md')}\n${JSON.stringify('../up.md')}\n`);
  assert.throws(() => readWritten(v, TOKEN), /line 2/);
});

test('no ledger yet reads as an empty list, and removing it is quiet either way', (t) => {
  const v = vault(t);
  assert.deepEqual(readWritten(v, TOKEN), []);
  recordWritten(v, TOKEN, ['raw/clippings/a.md']);
  removeWritten(v, TOKEN);
  removeWritten(v, TOKEN);
  assert.equal(existsSync(writtenLedgerFile(v, TOKEN)), false);
});

test('the ledger file is not an operation: the open-operations list ignores it', (t) => {
  const v = vault(t);
  recordWritten(v, TOKEN, ['raw/clippings/a.md']);
  assert.deepEqual(listOperations(v).map((o) => o.token), [TOKEN]);
});

test('the recorder does nothing without --since, and reads both spellings with it', (t) => {
  const v = vault(t);
  writtenRecorder(v, [])(['raw/clippings/a.md']);
  assert.equal(existsSync(writtenLedgerFile(v, TOKEN)), false);
  writtenRecorder(v, ['https://x.test/', '--since', TOKEN])(['raw/clippings/a.md']);
  writtenRecorder(v, ['https://x.test/', `--since=${TOKEN}`])(['raw/clippings/b.md']);
  assert.deepEqual(readWritten(v, TOKEN), ['raw/clippings/a.md', 'raw/clippings/b.md']);
});

test('a recorder that cannot record says so loudly and does not throw after the write', (t) => {
  const v = vault(t);
  const w = quietWarn();
  writtenRecorder(v, ['x', '--since', 'bbbbbbbbbbbbbbbb'], w)([`raw/clippings/Fish ${DASH} a.md`]);
  assert.equal(w.lines.length, 1);
  assert.match(w.lines[0], /not recorded in the operation ledger/);
  assert.ok(w.lines[0].includes(`Fish ${DASH} a.md`), 'it names the path so it can be added by hand');
  assert.match(w.lines[0], /op-ledger\.mjs add/);
});

test('two processes appending at once lose no entry and tear no line', async (t) => {
  const v = vault(t);
  const url = pathToFileURL(join(root, 'scripts', 'lib', 'op-ledger.mjs')).href;
  const code = `import { recordWritten } from ${JSON.stringify(url)};
    const [vault, token, tag] = process.argv.slice(1);
    for (let i = 0; i < 150; i++) recordWritten(vault, token, [0, 1, 2].map((k) => 'raw/clippings/' + tag + '-' + i + '-' + k + '-${DASH}.md'));`;
  const child = (tag) => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['--input-type=module', '-e', code, v, TOKEN, tag], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(err))));
  });
  await Promise.all([child('A'), child('B'), child('C')]);
  const got = readWritten(v, TOKEN);
  assert.equal(got.length, 3 * 150 * 3);
  assert.equal(new Set(got).size, got.length);
});
