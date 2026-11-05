import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The commands and language this change removes stay removed. These are the acceptance greps as a test, walking the
// tree with node:fs so they work from a plain checkout. They cover scripts/, test/, templates/ and skills/wiki-setup/
// for now; docs, the other skills and the README join when the package that rewrites them lands.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Files a later package rewrites. Each package deletes its lines here as it finishes, widening the scans to the full
// acceptance criteria.
const LATER_PACKAGE = {
  'test/skill-contracts.test.mjs': 'WP4 removes this: rewritten with the skills',
  'test/skill-workflow.test.mjs': 'WP4 removes this: rewritten with the skills',
};

// Files that have to name what they check. These never go.
const ALWAYS_EXCLUDED = {
  'test/removed-surface.test.mjs': 'this file names the removed surface in order to check for it',
};
const OLD_MARKERS = {
  'scripts/lib/index-fence.mjs': 'holds the old fence markers, so a first run can replace them (decision 14)',
};

const WALKED = ['scripts', 'test', 'templates', 'skills/wiki-setup'];
const SKIPPED_FOLDERS = new Set(['node_modules', '.wiki-master', '.playwright-mcp']);

function trackedText(top) {
  const files = [];
  (function walk(dir, rel) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIPPED_FOLDERS.has(entry.name)) walk(join(dir, entry.name), `${rel}/${entry.name}`);
        continue;
      }
      const text = readFileSync(join(dir, entry.name), 'utf8');
      if (!text.includes('\0')) files.push({ path: `${rel}/${entry.name}`, text }); // like git grep, skip binaries
    }
  })(join(ROOT, top), top);
  return files;
}

// Each match as "path:line: text", leaving out the excluded files.
function grep(pattern, { tops = WALKED, exclude = {} } = {}) {
  const found = [];
  const excluded = { ...ALWAYS_EXCLUDED, ...LATER_PACKAGE, ...exclude };
  for (const top of tops) {
    for (const { path, text } of trackedText(top)) {
      if (excluded[path]) continue;
      text.split(/\r?\n/).forEach((line, i) => {
        if (pattern.test(line)) found.push(`${path}:${i + 1}: ${line.trim().slice(0, 140)}`);
      });
    }
  }
  return found;
}

test('the removed commands are gone', () => {
  const commands = [
    'index-embed', 'index-gen', 'refresh-catalogs', 'backlog-gen', 'moc-authored-gen',
    'op-begin', 'op-commit', 'op-abort', 'op-cleanup', 'op-ledger', 'wiki-sync',
  ];
  assert.deepEqual(commands.filter((name) => existsSync(join(ROOT, 'scripts', `${name}.mjs`))), []);
});

test('the removed libraries are gone', () => {
  const libraries = ['op', 'op-tokens', 'op-ledger', 'op-refusals', 'open-operations', 'sync-notes', 'evidence-bytes', 'auto-refresh', 'git', 'catalog-scope'];
  assert.deepEqual(libraries.filter((name) => existsSync(join(ROOT, 'scripts', 'lib', `${name}.mjs`))), []);
});

test('the command that replaces them is there', () => {
  assert.ok(existsSync(join(ROOT, 'scripts', 'refresh-index.mjs')));
});

test('criterion 1: nothing names the token system', () => {
  const pattern = /op-begin|op-commit|op-ledger|op-abort|op-cleanup|open-operations|wiki-sync|commit-local|wiki-master\/ops|evidence-map|owned-paths-file|paths-out|<token>|operation token|saved token|(open|close) (an|the|each|one) operation/i;
  assert.deepEqual(grep(pattern), []);
});

test('criterion 1: only the relationships command takes --since', () => {
  const lines = grep(/--since/, { tops: ['scripts', 'skills/wiki-setup'] });
  assert.deepEqual(lines.filter((line) => !line.startsWith('scripts/lib/cli-specs.mjs:') || !line.includes('relationships')), []);
});

test('criterion 3: nothing handles or mentions git locks', () => {
  assert.deepEqual(grep(/index\.lock|index lock|git lock|indexLockAge/i), []);
});

test('criterion 3: the Obsidian CLI gate stays: it is not a git lock', () => {
  assert.match(readFileSync(join(ROOT, 'scripts', 'lib', 'cli-transport.mjs'), 'utf8'), /CLI_LOCK/);
});

test('criterion 8: nothing names the replaced commands', () => {
  assert.deepEqual(grep(/index-embed|index-gen|refresh-catalogs|backlog-gen|moc-authored-gen/, { exclude: OLD_MARKERS }), []);
});

// Decision 7: the two flags that existed for ledgers are unknown options now, refused before anything is changed.
function clippingVault(t) {
  const vault = mkdtempSync(join(tmpdir(), 'wm-removed-'));
  t.after(() => rmSync(vault, { recursive: true, force: true }));
  mkdirSync(join(vault, 'raw', 'clippings', 'gh', 'o', 'r'), { recursive: true });
  for (const name of ['.gitignore.md', 'README.md.md']) writeFileSync(join(vault, 'raw', 'clippings', 'gh', 'o', 'r', name), '---\ntitle: "x"\n---\nEvidence.\n');
  return vault;
}
const runScript = (vault, script, ...args) => spawnSync(process.execPath, [join(ROOT, 'scripts', script), ...args], { encoding: 'utf8', env: { ...process.env, WIKI_MASTER_VAULT: vault } });

test('decision 7: apply-reclips refuses --owned-paths-file as an option it does not know', (t) => {
  const vault = clippingVault(t);
  const refused = runScript(vault, 'apply-reclips.mjs', '--owned-paths-file', 'ledger.json');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /Unknown option '--owned-paths-file'/);
  assert.doesNotMatch(runScript(vault, 'apply-reclips.mjs', '--help').stdout, /owned-paths/);
});

for (const script of ['rename-unsafe-clippings.mjs', 'rename-doubled-extension-clippings.mjs']) {
  test(`decision 7: ${script} rejects --paths-out as an unknown option and changes nothing`, (t) => {
    const vault = clippingVault(t);
    const out = join(vault, 'paths.json');
    const refused = runScript(vault, script, '--apply', '--paths-out', out);
    assert.equal(refused.status, 2, refused.stderr);
    assert.match(refused.stderr, /unknown option --paths-out/);
    assert.equal(existsSync(out), false);
    assert.deepEqual(readdirSync(join(vault, 'raw', 'clippings', 'gh', 'o', 'r')).sort(), ['.gitignore.md', 'README.md.md']);
    assert.doesNotMatch(runScript(vault, script, '--help').stdout, /paths-out/);
  });
}
