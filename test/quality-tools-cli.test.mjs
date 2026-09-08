import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeVectors } from '../scripts/lib/vector-index.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const run = (script, args) => spawnSync(process.execPath, [join(repo, 'scripts', script), ...args], { encoding: 'utf8', timeout: 10000 });
const write = (dir, path, text) => { const abs = join(dir, path); mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, text); };
const snapshot = dir => Object.fromEntries(readdirSync(dir, { recursive: true }).filter(p => statSync(join(dir, p)).isFile()).sort().map(p => [p, readFileSync(join(dir, p)).toString('base64')]));

test('identity and relationship CLIs read actual metadata and existing vectors without changing the vault', () => {
  const vault = mkdtempSync(join(tmpdir(), 'wiki-quality-cli-'));
  try {
    write(vault, 'wiki/concepts/a.md', '---\ntype: concept\naliases: ["A process"]\n---\n# A\nA process.');
    write(vault, 'wiki/concepts/b.md', '---\ntype: concept\n---\n# B\nAn intervention.');
    write(vault, 'wiki/synthesis/misfiled.md', '---\ntype: synthesis\n---\n# Misfiled');
    const manifest = {};
    for (const name of ['a', 'b']) {
      const path = `wiki/concepts/${name}.md`, stat = statSync(join(vault, path));
      manifest[path] = { mtimeMs: stat.mtimeMs, size: stat.size, chunks: [{ hash: name, startLine: 1, endLine: 5 }] };
    }
    const { buffer, idx } = encodeVectors({ a: [1, 0], b: [1, 0] });
    write(vault, '.wiki-master/chunks.json', JSON.stringify(manifest));
    write(vault, '.wiki-master/vectors.bin', buffer);
    write(vault, '.wiki-master/vectors.idx.json', JSON.stringify(idx));
    const before = snapshot(vault);
    const audit = run('identity-audit.mjs', ['--vault', vault, '--limit=1', '--json']);
    assert.equal(audit.status, 0, audit.stderr);
    assert.equal(JSON.parse(audit.stdout).findings[0].kind, 'invalid-placement');
    const relationships = run('relationships.mjs', ['--vault', vault, '--limit=1', '--seed=A process', '--semantic', '--json']);
    assert.equal(relationships.status, 0, relationships.stderr);
    assert.equal(JSON.parse(relationships.stdout).candidates[0].reasons[0].kind, 'semantic-neighbor');
    assert.deepEqual(snapshot(vault), before);
    const invalid = run('relationships.mjs', ['--vault', vault, '--limit=0']);
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /limit/);
  } finally { rmSync(vault, { recursive: true, force: true }); }
});

test('evaluation CLI loads alternate search modules, writes a JSON report, and exposes incomplete legacy coverage', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wiki-eval-cli-'));
  const vault = join(dir, 'vault');
  try {
    write(vault, 'wiki/concepts/a.md', '# A\nExpected passage.');
    write(dir, 'questions.json', JSON.stringify({ version: 1, questions: [{ id: 'dev', query: 'A', split: 'development', expectedPages: ['wiki/concepts/a.md'], expectedPassages: [{ path: 'wiki/concepts/a.md', text: 'Expected passage' }] }] }));
    write(dir, 'legacy-search.mjs', `export async function main() { if (process.env.WIKI_MASTER_VAULT !== ${JSON.stringify(vault)}) throw new Error('Legacy search uses environment vault'); return { tier: "keyword", results: [{ path: "wiki/concepts/a.md", startLine: 1 }] }; }`);
    const output = join(dir, 'report.json');
    const before = snapshot(vault);
    const result = run('evaluate-retrieval.mjs', ['--vault', vault, '--questions', join(dir, 'questions.json'), '--search-module', join(dir, 'legacy-search.mjs'), '--split=development', '--output', output]);
    assert.equal(result.status, 2, result.stderr);
    const report = JSON.parse(readFileSync(output, 'utf8'));
    assert.deepEqual(JSON.parse(result.stdout), report);
    assert.equal(report.summary.pageRecallAt10, 1);
    assert.equal(report.summary.passageHitRate, null);
    assert.equal(report.coverage.evaluated, 1);
    assert.deepEqual(snapshot(vault), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
