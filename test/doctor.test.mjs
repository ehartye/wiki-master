import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { gather, installInfo, evaluate, renderReport, main } from '../scripts/doctor.mjs';
import { TOOLS, CLIPPERS } from '../scripts/lib/doctor-table.mjs';

// The doctor reads the machine and prints what each command needs; it writes nothing and resolves no vault.

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'doctor.mjs');

function deps(overrides = {}) {
  const calls = [];
  const present = new Set(Object.keys(TOOLS));
  return {
    calls,
    run: (cmd, args) => { calls.push(cmd); return present.has(cmd) ? { ran: true, status: 0, text: `${cmd} version 9.9\nsecond line` } : { ran: false, status: null, text: '' }; },
    which: (cmd) => (present.has(cmd) ? `/usr/bin/${cmd}` : null),
    poppler: (name) => (present.has(name) ? `/usr/bin/${name}` : null),
    python: () => ({ cmd: 'python3', pptx: true }),
    htmlRuntime: () => ({ ok: true }),
    playwright: async () => ({ ok: true }),
    browser: () => '/usr/bin/chromium',
    confluencer: () => '/plugins/confluencer/scripts',
    packageVersions: () => ({ defuddle: '0.19.5', linkedom: '0.18.12', turndown: '7.2.0' }),
    nodeVersion: 'v22.0.0',
    ...overrides,
    present,
  };
}

test('every requirement is found and reported with a path and the first line of its version', async () => {
  const r = await gather(deps());
  for (const id of ['git', 'gh', 'pandoc', 'pdftotext', 'pdftoppm', 'tesseract', 'soffice']) assert.equal(r[id].ok, true, id);
  assert.equal(r.git.path, '/usr/bin/git');
  assert.equal(r.git.version, 'git version 9.9');
  assert.equal(r.python.ok, true);
  assert.equal(r['python-pptx'].ok, true);
  assert.equal(r['html-runtime'].ok, true);
  assert.equal(r['playwright-core'].ok, true);
});

test('a tool that cannot be started is missing, with the install hint', async () => {
  const d = deps(); d.present.delete('pandoc');
  const r = await gather(d);
  assert.equal(r.pandoc.ok, false);
  assert.match(r.pandoc.hint, /pandoc/);
  assert.equal(r.git.ok, true);
});

test('a nonzero version exit still counts as installed, as the clippers treat it', async () => {
  const r = await gather(deps({ run: () => ({ ran: true, status: 99, text: 'pdftotext version 24.01' }) }));
  assert.equal(r.pdftotext.ok, true);
  assert.equal(r.pandoc.ok, true, 'a plain tool whose version flag exits nonzero is still installed');
});

test('python is missing, or present without python-pptx, and the two say different things', async () => {
  const none = await gather(deps({ python: () => ({ cmd: null, pptx: false }) }));
  assert.equal(none.python.ok, false); assert.equal(none['python-pptx'].ok, false);
  const bare = await gather(deps({ python: () => ({ cmd: 'python', pptx: false }) }));
  assert.equal(bare.python.ok, true); assert.equal(bare['python-pptx'].ok, false);
  assert.match(bare['python-pptx'].hint, /pip install python-pptx/);
});

test('the Obsidian CLI is found on PATH and never started', async () => {
  const d = deps();
  const r = await gather(d);
  assert.equal(r.obsidian.ok, true);
  assert.equal(r.obsidian.path, '/usr/bin/obsidian');
  assert.ok(!d.calls.includes('obsidian'), 'the doctor started the Obsidian CLI');
});

test('the npm runtime, playwright and the browser are reported on their own', async () => {
  const r = await gather(deps({ htmlRuntime: () => ({ ok: false, message: 'run npm ci' }), playwright: async () => ({ ok: false, message: 'not installed' }), browser: () => null }));
  assert.equal(r['html-runtime'].ok, false);
  assert.match(r['html-runtime'].detail, /run npm ci/);
  assert.equal(r['playwright-core'].ok, false);
  assert.equal(r.browser.ok, false);
});

test('naming a command: a missing requirement fails it, a missing optional one does not', async () => {
  const d = deps(); d.present.delete('tesseract'); d.present.delete('pandoc');
  const results = await gather(d);
  const pdf = evaluate(results, ['clip-pdf']);
  assert.equal(pdf.exit, 0, 'tesseract is optional for clip-pdf');
  assert.deepEqual(pdf.clippers.find((c) => c.name === 'clip-pdf').optionalMissing, ['tesseract']);
  const docx = evaluate(results, ['clip-docx']);
  assert.equal(docx.exit, 1);
  assert.deepEqual(docx.clippers.find((c) => c.name === 'clip-docx').missing, ['pandoc']);
  assert.equal(evaluate(results, ['clip-pdf', 'clip-docx']).exit, 1);
});

test('naming nothing reports every command and exits 0 whatever is missing', async () => {
  const d = deps(); d.present.clear();
  const e = evaluate(await gather(d), []);
  assert.equal(e.exit, 0);
  assert.deepEqual(e.clippers.map((c) => c.name), Object.keys(CLIPPERS));
  assert.ok(e.clippers.every((c) => c.ok === false || c.missing.length === 0));
});

test('an unknown command name exits 2 and lists the valid ones', async () => {
  const out = await main(['clip-docs'], deps());
  assert.equal(out.exit, 2);
  assert.match(out.error, /clip-docs/);
  assert.match(out.error, /clip-docx/);
});

test('the report names what is missing, how to fix it and the node version', async () => {
  const d = deps(); d.present.delete('soffice');
  const out = await main(['clip-xlsx'], d);
  assert.equal(out.exit, 1);
  assert.match(out.output, /clip-xlsx/);
  assert.match(out.output, /MISSING/);
  assert.match(out.output, /soffice/);
  assert.match(out.output, /LibreOffice/);
  assert.match(out.output, /node 22\.0\.0/);
});

test('--json is one object with the results, the commands and the exit code', async () => {
  const d = deps(); d.present.delete('gh');
  const out = await main(['clip-gh', '--json'], d);
  const j = JSON.parse(out.output);
  assert.equal(j.exit, 1);
  assert.equal(j.requirements.gh.ok, false);
  assert.deepEqual(j.commands.find((c) => c.name === 'clip-gh').missing, ['gh']);
  assert.equal(out.exit, 1);
});

test('installInfo: a copy that is not the installed version says so and how to refresh', () => {
  const read = (p) => (p.endsWith('installed_plugins.json') ? JSON.stringify({ plugins: { 'wiki-master@hartye-plugins': [{ version: '0.71.0', installPath: '/c/wiki-master/0.71.0' }] } }) : JSON.stringify({ version: '0.54.1' }));
  const info = installInfo({ root: '/c/wiki-master/0.54.1', claudeDir: '/home/.claude', exists: () => false, readFile: read });
  assert.equal(info.runFrom.version, '0.54.1');
  assert.equal(info.installed.version, '0.71.0');
  assert.match(info.note, /0\.54\.1/);
  assert.match(info.note, /0\.71\.0/);
  assert.match(info.note, /reload-plugins/);
});

test('installInfo: the installed copy itself, a development checkout and no record', () => {
  const read = (p) => (p.endsWith('installed_plugins.json') ? JSON.stringify({ plugins: { 'wiki-master@hartye-plugins': [{ version: '0.71.0', installPath: '/c/wiki-master/0.71.0' }] } }) : JSON.stringify({ version: '0.71.0' }));
  assert.equal(installInfo({ root: '/c/wiki-master/0.71.0', claudeDir: '/h/.claude', exists: () => false, readFile: read }).note, null);
  const dev = installInfo({ root: '/r/wiki-master', claudeDir: '/h/.claude', exists: (p) => p.endsWith('.git'), readFile: read });
  assert.match(dev.note, /development checkout/);
  const none = installInfo({ root: '/r/wiki-master', claudeDir: '/h/.claude', exists: () => false, readFile: (p) => { if (p.endsWith('installed_plugins.json')) throw new Error('ENOENT'); return JSON.stringify({ version: '1.0.0' }); } });
  assert.equal(none.installed, null);
  assert.match(none.note, /no installed copy/);
});

test('the real command on a machine with nothing on PATH: exit 1 for a clipper, 0 for the plain report, nothing written', () => {
  const work = mkdtempSync(join(tmpdir(), 'wm-doctor-')), home = mkdtempSync(join(tmpdir(), 'wm-doctor-home-')), empty = mkdtempSync(join(tmpdir(), 'wm-doctor-path-'));
  try {
    const env = { ...process.env, PATH: empty, Path: empty, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: join(home, '.claude') };
    delete env.WIKI_MASTER_VAULT;
    const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: work, env, encoding: 'utf8' });
    const docx = run(['clip-docx']);
    assert.equal(docx.status, 1, docx.stderr);
    assert.match(docx.stdout, /pandoc/);
    assert.match(docx.stdout, /MISSING/);
    const plain = run([]);
    assert.equal(plain.status, 0, plain.stderr);
    const json = JSON.parse(run(['--json']).stdout);
    assert.equal(json.requirements.pandoc.ok, false);
    assert.deepEqual(readdirSync(work), [], 'the doctor wrote into the working directory');
    assert.deepEqual(readdirSync(home), [], 'the doctor wrote into the home directory');
    const bad = run(['--bogus']);
    assert.equal(bad.status, 2);
    assert.equal(bad.stderr.trim().split('\n').length, 1, bad.stderr);
    const help = run(['--help']);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /usage: node scripts\/doctor\.mjs/);
  } finally {
    for (const d of [work, home, empty]) rmSync(d, { recursive: true, force: true });
  }
});
