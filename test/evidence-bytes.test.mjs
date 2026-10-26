import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { commitOp, main as commitMain } from '../scripts/op-commit.mjs';
import { gitattributesLine, checkEvidenceMap } from '../scripts/lib/evidence-bytes.mjs';

// A receipt that records its own byte length and SHA-256 must reach the repository with exactly those
// bytes. The vault's `* text=auto eol=lf` converts a captured CRLF receipt on `git add`, so the published
// file no longer reproduced its recorded hash. op-commit now checks the staged blob against the declared
// size and hash before it commits, and refuses by name, rather than letting a normalised copy replace it.

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const declare = (buf) => ({ bytes: buf.length, sha256: sha(buf) });
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const gitBytes = (cwd, ...args) => execFileSync('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 });

const RECEIPT = Buffer.from('{\r\n  "run": 91,\r\n  "ok": true\r\n}\r\n');
const BINARY = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x0d, 0x0a, 0xff, 0x0d, 0x0a]);

function vault(t) {
  const dir = mkdtempSync(join(tmpdir(), 'wm-evid-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, 'init', '-q');
  git(dir, 'config', 'core.autocrlf', 'false');
  git(dir, 'config', 'core.safecrlf', 'false'); // the tests convert CRLF on purpose; git's warning for it is noise
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'Test');
  writeFileSync(join(dir, '.gitignore'), '.wiki-master/\n');
  writeFileSync(join(dir, '.gitattributes'), '* text=auto eol=lf\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'initial');
  const put = (path, data) => { const file = join(dir, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, data); };
  let n = 0;
  const token = () => {
    const id = `${(++n).toString(16).padStart(16, '0')}`;
    mkdirSync(join(dir, '.wiki-master', 'ops'), { recursive: true });
    writeFileSync(join(dir, '.wiki-master', 'ops', `${id}.json`), JSON.stringify({ op: 'relink', dirty: [] }));
    return id;
  };
  const commits = () => Number(git(dir, 'rev-list', '--count', 'HEAD'));
  return { dir, put, token, commits };
}

test('a CRLF receipt that git would normalise is refused by name, nothing is committed and the token is kept', t => {
  const v = vault(t);
  v.put('raw/evidence/receipt.json', RECEIPT);
  const before = v.commits();
  const token = v.token();
  const r = commitOp(v.dir, { op: 'relink', title: 'evidence', token, paths: ['raw/evidence/receipt.json'], evidence: { 'raw/evidence/receipt.json': declare(RECEIPT) } });
  assert.equal(r.ok, false);
  assert.match(r.reason, /raw\/evidence\/receipt\.json/);
  assert.match(r.reason, new RegExp(`declared ${RECEIPT.length} bytes`));
  assert.match(r.reason, /git would store \d+ bytes/);
  assert.match(r.reason, /raw\/evidence\/receipt\.json -text/, 'it says the exact line that would fix it');
  assert.equal(v.commits(), before, 'no commit was made');
  assert.equal(git(v.dir, 'diff', '--cached', '--name-only'), '', 'nothing is left staged');
  assert.ok(existsSync(join(v.dir, '.wiki-master', 'ops', `${token}.json`)), 'the token is kept so the same close can be retried');
  assert.deepEqual(readFileSync(join(v.dir, 'raw/evidence/receipt.json')), RECEIPT, 'the file on disk is not touched');
});

test('with an exact -text rule in the ledger the same receipt is committed byte for byte, and ordinary Markdown still normalises', t => {
  const v = vault(t);
  v.put('raw/evidence/receipt.json', RECEIPT);
  v.put('.gitattributes', '* text=auto eol=lf\nraw/evidence/receipt.json -text\n');
  v.put('wiki/authored/p/note.md', 'line one\r\nline two\r\n');
  const paths = ['raw/evidence/receipt.json', '.gitattributes', 'wiki/authored/p/note.md'];
  const r = commitOp(v.dir, { op: 'relink', title: 'evidence', token: v.token(), paths, evidence: { 'raw/evidence/receipt.json': declare(RECEIPT) } });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.committed, true);
  assert.deepEqual(r.evidence.verified, ['raw/evidence/receipt.json']);
  assert.deepEqual(gitBytes(v.dir, 'cat-file', 'blob', 'HEAD:raw/evidence/receipt.json'), RECEIPT, 'the committed blob is the declared bytes');
  assert.equal(gitBytes(v.dir, 'cat-file', 'blob', 'HEAD:wiki/authored/p/note.md').toString(), 'line one\nline two\n', 'Markdown follows the ordinary policy');
});

test('a binary file keeps its bytes under the global rule, and verifying it passes with no extra rule', t => {
  const v = vault(t);
  v.put('raw/evidence/shot.bin', BINARY);
  const r = commitOp(v.dir, { op: 'relink', title: 'binary', token: v.token(), paths: ['raw/evidence/shot.bin'], evidence: { 'raw/evidence/shot.bin': declare(BINARY) } });
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.evidence.verified, ['raw/evidence/shot.bin']);
  assert.deepEqual(gitBytes(v.dir, 'cat-file', 'blob', 'HEAD:raw/evidence/shot.bin'), BINARY);
});

test('a wrong declaration is refused even when git keeps the bytes: the check is against what is declared, not against the disk', t => {
  const v = vault(t);
  v.put('raw/evidence/receipt.json', RECEIPT);
  v.put('.gitattributes', '* text=auto eol=lf\nraw/evidence/receipt.json -text\n');
  const wrong = { bytes: RECEIPT.length, sha256: sha(Buffer.from('some other bytes')) };
  const r = commitOp(v.dir, { op: 'relink', title: 'wrong', token: v.token(), paths: ['raw/evidence/receipt.json', '.gitattributes'], evidence: { 'raw/evidence/receipt.json': wrong } });
  assert.equal(r.ok, false);
  assert.match(r.reason, /sha256/);
  assert.doesNotMatch(r.reason, /-text\s*$/m, 'when git kept the bytes the fix is not an attribute rule');
});

test('a declared path that is not in the index is named', t => {
  const v = vault(t);
  v.put('wiki/authored/p/note.md', 'x\n');
  const r = commitOp(v.dir, { op: 'relink', title: 'missing', token: v.token(), paths: ['wiki/authored/p/note.md', 'raw/evidence/gone.json'], evidence: { 'raw/evidence/gone.json': declare(RECEIPT) } });
  assert.equal(r.ok, false);
  assert.match(r.reason, /raw\/evidence\/gone\.json/);
  assert.match(r.reason, /not (in|found in) the index|no file/i);
});

test('one bad file refuses the whole commit, and the good file is not committed alone', t => {
  const v = vault(t);
  v.put('raw/evidence/ok.bin', BINARY);
  v.put('raw/evidence/receipt.json', RECEIPT);
  const before = v.commits();
  const r = commitOp(v.dir, { op: 'relink', title: 'mixed', token: v.token(), paths: ['raw/evidence/ok.bin', 'raw/evidence/receipt.json'],
    evidence: { 'raw/evidence/ok.bin': declare(BINARY), 'raw/evidence/receipt.json': declare(RECEIPT) } });
  assert.equal(r.ok, false);
  assert.equal(v.commits(), before);
  assert.match(r.reason, /receipt\.json/);
  assert.doesNotMatch(r.reason, /ok\.bin/, 'only the failing file is listed');
  assert.match(r.reason, /refused: 1 evidence file\(s\) would be committed/, 'the count is of the failing files, not of everything declared');
});

test('a path with a space gets a quoted attribute line', () => {
  assert.equal(gitattributesLine('raw/evidence/run 91.json'), '"raw/evidence/run 91.json" -text');
  assert.equal(gitattributesLine('raw/evidence/a.json'), 'raw/evidence/a.json -text');
});

test('the map must be an exact subset of the ledger and well formed', () => {
  const good = { bytes: 3, sha256: 'a'.repeat(64) };
  assert.equal(checkEvidenceMap({ 'a.json': good }, ['a.json', 'b.md']), null);
  assert.match(checkEvidenceMap({ 'c.json': good }, ['a.json']), /c\.json.*not in the operation's ledger/);
  assert.match(checkEvidenceMap({ 'a.json': { bytes: -1, sha256: good.sha256 } }, ['a.json']), /bytes/);
  assert.match(checkEvidenceMap({ 'a.json': { bytes: 3, sha256: 'xyz' } }, ['a.json']), /sha256/);
  assert.match(checkEvidenceMap({ 'a.json': { bytes: 3, sha256: 'A'.repeat(64) } }, ['a.json']), /sha256/, 'lower-case hex only, so one spelling is compared');
  assert.match(checkEvidenceMap([], ['a.json']), /object/);
  assert.match(checkEvidenceMap({}, ['a.json']), /empty/);
});

test('the CLI takes --evidence-map beside --paths-file, and refuses it without a ledger', async t => {
  const v = vault(t);
  v.put('raw/evidence/ok.bin', BINARY);
  const mapFile = join(v.dir, '.wiki-master', 'evidence.json');
  mkdirSync(dirname(mapFile), { recursive: true });
  writeFileSync(mapFile, JSON.stringify({ 'raw/evidence/ok.bin': declare(BINARY) }));
  const ledger = join(v.dir, '.wiki-master', 'ledger.json');
  writeFileSync(ledger, JSON.stringify(['raw/evidence/ok.bin']));

  const run = async (argv) => {
    const prev = process.env.WIKI_MASTER_VAULT, prevCode = process.exitCode;
    process.env.WIKI_MASTER_VAULT = v.dir; process.exitCode = 0;
    const logs = [], errs = [];
    const log = console.log, err = console.error;
    console.log = (...a) => logs.push(a.join(' ')); console.error = (...a) => errs.push(a.join(' '));
    try { await commitMain(argv); } finally { console.log = log; console.error = err; }
    const code = process.exitCode; process.exitCode = prevCode;
    if (prev === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = prev;
    return { logs, errs, code };
  };

  const noLedger = await run(['--op', 'relink', '--title', 't', '--since', v.token(), '--evidence-map', mapFile]);
  assert.equal(noLedger.code, 1);
  assert.match(noLedger.errs.join('\n'), /--evidence-map needs --paths-file/);

  const ok = await run(['--op', 'relink', '--title', 't', '--since', v.token(), '--paths-file', ledger, '--evidence-map', mapFile]);
  assert.ok(!ok.code, ok.errs.join('\n'));
  assert.match(ok.logs.join('\n'), /evidence: 1 file\(s\) committed byte-identical to their declared size and SHA-256/);
});
