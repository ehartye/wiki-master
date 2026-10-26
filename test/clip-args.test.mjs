import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CLIP_SPECS, checkClipArgs, guardClipArgs } from '../scripts/lib/clip-args.mjs';

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');

// `clip.mjs <url> --dry-run` ignored the unknown option and performed a real clipping write, and
// `--help` was read as the URL. Each clipper checks its arguments before any network or vault activity.

const VALID = {
  clip: [['https://x.test/a', '--quality=high', '--topic=T', '--decline=reason', '--slug=name']],
  'clip-pdf': [
    ['a.pdf', '--source=u', '--quality=low', '--mode=table', '--ocr', '--ocr-lang=eng', '--topic=t', '--decline=r', '--figures', '--figures=3,5-7', '--figures-max=4', '--title=T', '--slug=s'],
    ['a.pdf', '--figures-only', '--clipping', 'raw/clippings/x.md'],
    ['a.pdf', '--clipping=raw/clippings/x.md', '--allow-pdf-mismatch'],
    ['--doctor'], ['a.pdf', '--doctor'],
  ],
  'clip-docx': [['a.docx', '--source=u', '--quality=high', '--topic=t', '--decline=r', '--allow-short', '--title=T', '--slug=s']],
  'clip-pptx': [['a.pptx', '--source=u', '--quality=high', '--topic=t', '--decline=r', '--title=T', '--slug=s']],
  'clip-xlsx': [['a.xlsx', '--source=u', '--quality=high', '--topic=t', '--decline=r', '--title=T', '--slug=s']],
  'clip-confluence': [['https://c.test/p/1', '--quality=high', '--topic=t', '--decline=r'], ['--doctor']],
  'clip-gh': [['owner/repo', '--ref=main', '--quality=low', '--topic=t', '--max-files=5', '--max-groups=2', '--force-full', '--decline=r'], ['--doctor']],
};

test('every option each clipper already accepted is still accepted', () => {
  assert.deepEqual(Object.keys(VALID).sort(), Object.keys(CLIP_SPECS).sort());
  for (const [name, argvs] of Object.entries(VALID)) for (const argv of argvs) {
    assert.deepEqual(checkClipArgs(argv, CLIP_SPECS[name]), { ok: true }, `${name} ${argv.join(' ')}`);
  }
});

test('an unknown option is an error that names it, in every position', () => {
  for (const [name, spec] of Object.entries(CLIP_SPECS)) {
    for (const argv of [['x', '--dry-run'], ['x', '--quality=high', '--nope=1'], ['--nope']]) {
      const r = checkClipArgs(argv, spec);
      assert.ok(r.error, `${name} ${argv.join(' ')}`);
      assert.match(r.error, /unknown option --(dry-run|nope)/);
    }
  }
});

test('--help and -h, anywhere, ask for the usage', () => {
  for (const spec of Object.values(CLIP_SPECS)) {
    for (const argv of [['--help'], ['-h'], ['x', '--help'], ['x', '--quality=high', '-h']]) assert.deepEqual(checkClipArgs(argv, spec), { help: true });
  }
});

test('a value option written without its value, and a spaced option missing its value, are errors', () => {
  assert.match(checkClipArgs(['x', '--quality'], CLIP_SPECS.clip).error, /--quality needs a value/);
  assert.match(checkClipArgs(['a.pdf', '--clipping'], CLIP_SPECS['clip-pdf']).error, /--clipping needs a value/);
  assert.match(checkClipArgs(['a.pdf', '--clipping', '--ocr'], CLIP_SPECS['clip-pdf']).error, /--clipping needs a value/);
});

test('a lead option such as --doctor is accepted first only where the clipper has one', () => {
  assert.deepEqual(checkClipArgs(['--doctor'], CLIP_SPECS['clip-gh']), { ok: true });
  assert.match(checkClipArgs(['--doctor'], CLIP_SPECS.clip).error, /unknown option --doctor/);
});

test('extra words that are not options are left alone, as before', () => {
  assert.deepEqual(checkClipArgs(['x', 'extra'], CLIP_SPECS.clip), { ok: true });
});

test('the guard prints usage and exits 0 for help, and prints the problem plus usage and exits 2 for an error', () => {
  const run = (argv) => {
    const out = [], err = []; let code = null;
    const result = guardClipArgs(argv, CLIP_SPECS['clip-docx'], { exit: (c) => { code = c; }, out: (l) => out.push(l), err: (l) => err.push(l) });
    return { result, code, out, err };
  };
  const help = run(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.out.join('\n'), /usage: clip-docx\.mjs/);
  assert.deepEqual(help.err, []);
  const bad = run(['a.docx', '--dry-run']);
  assert.equal(bad.code, 2);
  assert.match(bad.err.join('\n'), /clip-docx\.mjs: unknown option --dry-run/);
  assert.match(bad.err.join('\n'), /usage: clip-docx\.mjs/);
  assert.equal(run(['a.docx', '--quality=high']).code, null, 'a valid command does not exit');
});

// A real process per clipper: the check runs before any network or vault activity, so these need neither.
const POSITIONAL = {
  clip: 'https://example.org/a', 'clip-pdf': 'x.pdf', 'clip-docx': 'x.docx', 'clip-pptx': 'x.pptx',
  'clip-xlsx': 'x.xlsx', 'clip-confluence': 'https://example.atlassian.net/wiki/spaces/A/pages/1', 'clip-gh': 'owner/repo',
};
function runScript(name, args) {
  const vault = mkdtempSync(join(tmpdir(), 'wm-args-'));
  try {
    const r = spawnSync(process.execPath, [join(SCRIPTS, `${name}.mjs`), ...args], { encoding: 'utf8', env: { ...process.env, WIKI_MASTER_VAULT: vault }, timeout: 20000 });
    return { ...r, left: readdirSync(vault) };
  } finally { rmSync(vault, { recursive: true, force: true }); }
}

test('each clipper rejects an unknown option with exit 2 before touching the vault', () => {
  for (const [name, positional] of Object.entries(POSITIONAL)) {
    const r = runScript(name, [positional, '--dry-run']);
    assert.equal(r.status, 2, `${name}: ${r.stderr}`);
    assert.match(r.stderr, new RegExp(`${name}\\.mjs: unknown option --dry-run`));
    assert.deepEqual(r.left, [], `${name} must not create anything`);
  }
});

test('each clipper prints usage and exits 0 for --help, touching nothing', () => {
  for (const name of Object.keys(POSITIONAL)) {
    const r = runScript(name, ['--help']);
    assert.equal(r.status, 0, `${name}: ${r.stderr}`);
    assert.match(r.stdout, new RegExp(`usage: ${name}\\.mjs`));
    assert.deepEqual(r.left, [], `${name} must not create anything`);
  }
});
