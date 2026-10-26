import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// `--help` must be free of side effects. Measured on 51 scripts: four of them acted on the vault (rebuilt
// the index, refreshed the semantic index, started the triage server, scaffolded a vault) and two ran in
// full (lint, stale). Asking a script what it does must neither read nor change the vault.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = readdirSync(join(ROOT, 'scripts')).filter((f) => f.endsWith('.mjs')).sort();
const FIXED = ['index-gen.mjs', 'index-embed.mjs', 'triage.mjs', 'init.mjs', 'lint.mjs', 'stale.mjs'];

function snapshot(dir, base = dir, acc = {}) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) snapshot(p, base, acc);
    else acc[p.slice(base.length)] = createHash('sha1').update(readFileSync(p)).digest('hex');
  }
  return acc;
}

function world(t) {
  const home = mkdtempSync(join(tmpdir(), 'wm-help-home-'));
  const vault = join(home, 'vault');
  for (const d of ['raw/clippings', 'wiki/sources', 'wiki/concepts', 'wiki/entities', 'wiki/syntheses', 'moc', 'log']) mkdirSync(join(vault, d), { recursive: true });
  writeFileSync(join(vault, 'wiki/sources/probe.md'), '---\ntype: source\n---\n# Probe\n');
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const env = { ...process.env, HOME: home, USERPROFILE: home, WIKI_MASTER_VAULT: vault, WIKI_MASTER_VAULT_NAME: 'wm-help-probe' };
  delete env.NODE_TEST_CONTEXT;
  return { home, vault, env };
}

test('--help on any script leaves a vault and the home directory exactly as they were', { timeout: 240000 }, (t) => {
  const { home, vault, env } = world(t);
  const before = { vault: snapshot(vault), home: snapshot(home) };
  const changed = [];
  for (const script of SCRIPTS) {
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts', script), '--help'], { env, encoding: 'utf8', timeout: 20000, input: '' });
    assert.equal(r.signal, null, `${script} --help did not finish`);
    const now = { vault: snapshot(vault), home: snapshot(home) };
    if (JSON.stringify(now) !== JSON.stringify(before)) { changed.push(script); before.vault = now.vault; before.home = now.home; }
  }
  assert.deepEqual(changed, [], `these scripts changed files on --help: ${changed.join(', ')}`);
});

test('the scripts that used to act on --help print usage and exit 0, even with no vault configured', { timeout: 120000 }, (t) => {
  const { home, env } = world(t);
  const strict = { ...env, WIKI_MASTER_REQUIRE_VAULT: '1' };
  delete strict.WIKI_MASTER_VAULT;
  const before = snapshot(home);
  for (const [script, flag] of FIXED.flatMap((s) => [[s, '--help'], [s, '-h']])) {
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts', script), flag], { env: strict, encoding: 'utf8', timeout: 20000, input: '' });
    assert.equal(r.status, 0, `${script} ${flag} exited ${r.status}: ${r.stderr}`);
    assert.match(r.stdout, /usage/i, `${script} --help printed no usage`);
    assert.ok(r.stdout.includes(script.replace(/\.mjs$/, '')), `${script} usage does not name the script`);
    assert.doesNotMatch(r.stdout, /triage-ready|regenerated|Scaffolded|Content lint \(warn-only|Freshness backend:/, `${script} --help did the work`);
  }
  assert.deepEqual(snapshot(home), before);
});
