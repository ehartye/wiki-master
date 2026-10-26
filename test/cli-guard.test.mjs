import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { unknownOption, rejection, cliGuard } from '../scripts/lib/cli-guard.mjs';
import { CLI_SPECS } from '../scripts/lib/cli-specs.mjs';

// A script that ignores an option it does not know runs with a default its caller did not choose. These tests pin
// the guard itself and then run every script under scripts/ with a made-up option in a throwaway HOME, vault and
// working directory: it must refuse, say so in one line, and write nothing.

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const BOGUS = '--bogus-flag-zq';

test('unknownOption finds the first option the spec does not list', () => {
  assert.equal(unknownOption(['--apply'], ['apply']), null);
  assert.equal(unknownOption(['--apply', '--aply'], ['apply']), '--aply');
  assert.equal(unknownOption(['--limit=5'], ['limit']), null);
  assert.equal(unknownOption(['--limit', '5'], ['limit']), null);
  assert.equal(unknownOption(['--limt=5'], ['limit']), '--limt');
  assert.equal(unknownOption(['--help'], []), null, '--help is the guard\'s own');
  assert.equal(unknownOption(['page.md', '-x'], []), null, 'positional words and short options are not checked');
  assert.equal(unknownOption(['--', '--anything'], []), null, 'nothing after a bare -- is checked');
  assert.equal(unknownOption([BOGUS], []), BOGUS);
});

test('rejection names the script, the option and what is accepted, on one line', () => {
  assert.equal(rejection('dedupe-clippings', ['apply'], '--aply'), 'dedupe-clippings: unknown option --aply (accepted: --apply; see --help)');
  assert.equal(rejection('stale', [], '--x'), 'stale: unknown option --x (it takes no options; see --help)');
});

function guarded(argv, { entry = '/x/dedupe-clippings.mjs' } = {}) {
  const log = { out: [], err: [], exit: [] };
  const moduleUrl = pathToFileURL('/x/dedupe-clippings.mjs').href;
  cliGuard(moduleUrl, { argv, entry, exit: (c) => log.exit.push(c), out: (s) => log.out.push(s), err: (s) => log.err.push(s) });
  return log;
}

test('the guard prints usage for --help or -h and exits 0, rejects an unknown option with exit 2, and passes a good call', () => {
  for (const flag of ['--help', '-h']) {
    const h = guarded([flag]);
    assert.deepEqual(h.exit, [0]);
    assert.match(h.out[0], /^usage: node scripts\/dedupe-clippings\.mjs/);
  }
  const bad = guarded(['--aply']);
  assert.deepEqual(bad.exit, [2]);
  assert.equal(bad.err.length, 1);
  assert.match(bad.err[0], /unknown option --aply/);
  const ok = guarded(['--apply']);
  assert.deepEqual(ok.exit, []);
  assert.deepEqual(ok.err, []);
});

test('the guard does nothing when the module is imported rather than run', () => {
  const log = guarded([BOGUS], { entry: '/somewhere/else.mjs' });
  assert.deepEqual(log.exit, []);
  assert.deepEqual(log.err, []);
});

test('a script with no entry in the table is a programming error, not a silent pass', () => {
  assert.throws(() => cliGuard(pathToFileURL('/x/not-in-the-table.mjs').href, { argv: [], entry: '/x/not-in-the-table.mjs', exit: () => {} }), /no entry for not-in-the-table/);
});

// ---- every script ----

const allScripts = readdirSync(SCRIPTS).filter((f) => f.endsWith('.mjs')).map((f) => f.slice(0, -4)).sort();
// Scripts checked elsewhere: the clippers by clip-args, triage starts a server, obsidian talks to the running app.
const EXEMPT = new Set(['clip', 'clip-confluence', 'clip-docx', 'clip-gh', 'clip-pdf', 'clip-pptx', 'clip-xlsx', 'obsidian']);
// Guarded, but never run with a made-up option here: if the guard ever failed, triage would start a server.
const NO_SPAWN = new Set(['triage']);
// Scripts that refuse an unknown option with their own parser. They are run with the made-up option below, so a
// regression shows, but they are not yet moved to the shared guard (their `--help` is not uniform either).
const OWN_CHECK = new Set(['apply-reclips', 'backlog-gen', 'backlog-list', 'bump-version', 'doctor', 'drift', 'evaluate-retrieval', 'evaluate-skill-behavior', 'extract-page', 'identity-audit', 'index-gen', 'moc-authored-gen', 'op-cleanup', 'refresh-catalogs', 'relationships', 'search', 'session-brief', 'validate-authored', 'wiki-sync']);
const source = (name) => readFileSync(join(SCRIPTS, `${name}.mjs`), 'utf8');
const adopted = allScripts.filter((n) => source(n).includes('cliGuard(import.meta.url)'));

test('every script is guarded, checks its own options, or is exempt for a stated reason', () => {
  const open = allScripts.filter((n) => !EXEMPT.has(n) && !OWN_CHECK.has(n) && !adopted.includes(n));
  assert.deepEqual(open, [], `scripts with no check for an unknown option: ${open.join(', ')}`);
});

test('the table and the scripts agree: every entry is a script that calls the guard, and every guarded script has an entry', () => {
  assert.deepEqual(Object.keys(CLI_SPECS).sort(), adopted);
  for (const [n, spec] of Object.entries(CLI_SPECS)) {
    assert.ok(!EXEMPT.has(n), `${n} is exempt and also guarded`);
    // A guard entry without options only answers --help, so the script's own parser must refuse the rest.
    assert.equal(OWN_CHECK.has(n), spec.options === undefined, `${n}: ${spec.options === undefined ? 'help-only, but not listed as checking its own options' : 'has options, but is also listed as checking its own'}`);
    assert.ok(spec.options !== undefined || spec.usage, `${n} has neither options nor usage`);
  }
});

// Arguments that would let a script start work if the guard did not stop it.
const BASE = {
  'op-begin': ['--op', 'relink'],
  'op-commit': ['--op', 'relink', '--title', 't', '--since', 'tok'],
  'log-entry': ['--op', 'relink', '--title', 't'],
  purge: ['--plan', 'topic'],
  'render-page': ['not-a-url', 'out.html'],
  'clip-and-repoint': ['--from=/no/such/dir'],
  'resolve-evidence': ['wiki/x.md'],
};

function fakeWorld() {
  const home = mkdtempSync(join(tmpdir(), 'wm-guard-home-')), vault = mkdtempSync(join(tmpdir(), 'wm-guard-vault-')), cwd = mkdtempSync(join(tmpdir(), 'wm-guard-cwd-'));
  for (const d of ['raw/clippings', 'wiki/sources', 'wiki/authored', 'moc', 'log']) mkdirSync(join(vault, d), { recursive: true });
  return { home, vault, cwd, drop: () => [home, vault, cwd].forEach((d) => rmSync(d, { recursive: true, force: true })) };
}
function snapshot(...roots) {
  const out = [];
  const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) { out.push(`${p}/`); walk(p); } else out.push(`${p}:${statSync(p).size}`); } };
  roots.forEach(walk);
  return out.join('\n');
}
function run(name, args) {
  const w = fakeWorld();
  try {
    const before = snapshot(w.home, w.vault, w.cwd);
    const r = spawnSync(process.execPath, [join(SCRIPTS, `${name}.mjs`), ...args], { cwd: w.cwd, encoding: 'utf8', timeout: 30000, stdin: 'ignore',
      env: { ...process.env, HOME: w.home, USERPROFILE: w.home, WIKI_MASTER_VAULT: w.vault, WIKI_MASTER_VAULT_NAME: 'wm-guard', CLAUDE_CONFIG_DIR: join(w.home, '.claude') } });
    return { ...r, wrote: snapshot(w.home, w.vault, w.cwd) !== before };
  } finally { w.drop(); }
}

for (const name of adopted.filter((n) => !NO_SPAWN.has(n))) {
  if (CLI_SPECS[name].options) {
    test(`${name}: refuses an unknown option with one line and exit 2, and writes nothing`, () => {
      const r = run(name, [...(BASE[name] ?? []), BOGUS]);
      assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
      assert.equal(r.stderr.trim().split('\n').length, 1, r.stderr);
      assert.match(r.stderr, new RegExp(`^${name}: unknown option ${BOGUS}`));
      assert.equal(r.wrote, false);
    });
  }
  if (CLI_SPECS[name].usage) {
    test(`${name}: --help prints its usage, exits 0 and writes nothing`, () => {
      const r = run(name, ['--help']);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, new RegExp(`^usage: node scripts/${name}\\.mjs`));
      assert.equal(r.wrote, false);
    });
  }
}

for (const name of OWN_CHECK) {
  test(`${name}: refuses an unknown option without a stack trace and writes nothing`, () => {
    const r = run(name, [BOGUS]);
    assert.notEqual(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.doesNotMatch(r.stderr, /\n\s+at |node:internal/);
    assert.equal(r.wrote, false);
  });
}

test('a help-only entry answers --help and leaves every other option to the script\'s own parser', () => {
  const log = { out: [], err: [], exit: [] };
  const url = pathToFileURL('/x/drift.mjs').href;
  const hooks = { entry: '/x/drift.mjs', exit: (c) => log.exit.push(c), out: (s) => log.out.push(s), err: (s) => log.err.push(s) };
  cliGuard(url, { argv: ['--limit=5', '--whatever'], ...hooks });
  assert.deepEqual(log.exit, []);
  cliGuard(url, { argv: ['--help'], ...hooks });
  assert.deepEqual(log.exit, [0]);
  assert.match(log.out[0], /^usage: node scripts\/drift\.mjs/);
});
