import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeHealth, backlogReport } from '../scripts/health.mjs';
import { buildGraph, computeGraphMetrics } from '../scripts/lib/graph.mjs';

// An agent finds a repair or backfill script from the index in docs/scripts.md or from the report that names the
// problem. The index is written by hand (cli-specs.mjs has no purpose line for every script), so this test keeps it
// complete. That every script the docs mention exists is skill-contracts.test.mjs's check.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replaceAll('\r\n', '\n');
const rows = () => [...read('docs/scripts.md').matchAll(/^\| `([\w-]+\.mjs)` \| (.*) \|$/gm)].map((m) => ({ script: m[1], purpose: m[2].trim() }));

test('docs/scripts.md has one row with a purpose for every script, and no row for a script that is not there', () => {
  const scripts = readdirSync(join(ROOT, 'scripts')).filter((f) => f.endsWith('.mjs')).sort();
  const listed = rows().map((r) => r.script);
  assert.deepEqual(scripts.filter((s) => !listed.includes(s)), [], 'scripts missing from docs/scripts.md');
  assert.deepEqual(listed.filter((s) => !scripts.includes(s)), [], 'rows naming no script');
  assert.equal(new Set(listed).size, listed.length, 'a script is listed twice');
  for (const r of rows()) assert.ok(r.purpose.length > 10, `${r.script}: no purpose`);
});

test('the README and the setup and maintenance references link the index', () => {
  for (const rel of ['README.md', 'skills/wiki-setup/references/checks.md', 'skills/wiki-maintainer/references/maintenance.md'])
    assert.match(read(rel), /\]\((?:\.\.\/)*(?:docs\/)?scripts\.md(?:#[^)]*)?\)/, `${rel} does not link docs/scripts.md`);
});

test('the missing source-hash line in health and in the backlog report names the repair command', () => {
  const r = computeHealth(computeGraphMetrics(buildGraph(join(ROOT, 'test', 'fixtures', 'vault'))));
  assert.ok(r.missingHash.length > 0, 'the fixture has a clipping with no source-hash');
  const line = new RegExp(`^  clippings missing source-hash \\(repair\\): ${r.missingHash.length} .*repair-missing-hash\\.mjs`, 'm');
  assert.match(r.report, line);
  assert.match(backlogReport(r), line);
  assert.doesNotMatch(backlogReport({}), /repair-missing-hash/, 'nothing to repair, no command');
});

test('the maintenance reference names the duplicate-clipping and quote-provenance repairs', () => {
  const text = read('skills/wiki-maintainer/references/maintenance.md');
  assert.match(text, /dedupe-clippings\.mjs/);
  assert.match(text, /repair-quote-provenance\.mjs/);
});
