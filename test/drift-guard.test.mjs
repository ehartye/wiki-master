import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFrontmatter } from '../scripts/clip.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Spec/executor drift is the endemic failure of prose-driven systems: the
// SKILL.md is the executor, and nothing else checks that what it references
// exists or that what the schema declares matches what the code writes.
// Every confirmed drift in sibling projects lived where a fact was COPIED
// rather than DERIVED — these tests derive.

function allProseFiles() {
  const out = [];
  for (const dir of ['skills', 'commands']) {
    const base = join(ROOT, dir);
    if (!existsSync(base)) continue;
    (function walk(d) {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(d, e.name));
        else if (e.name.endsWith('.md')) out.push(join(d, e.name));
      }
    })(base);
  }
  return out;
}

test('every script path referenced in skills/commands exists on disk', () => {
  const missing = [];
  for (const f of allProseFiles()) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/scripts\/[\w./-]+\.mjs/g)) {
      if (!existsSync(join(ROOT, m[0]))) missing.push(`${f} -> ${m[0]}`);
    }
  }
  assert.deepEqual(missing, [], `prose references scripts that do not exist:\n${missing.join('\n')}`);
});

test('clipping frontmatter contract: schema template and clip.mjs agree', () => {
  const schema = readFileSync(join(ROOT, 'templates', 'vault-schema.md'), 'utf8');
  const contractLine = schema.match(/Raw\/clippings:\s*`([^`]+)`/)?.[1];
  assert.ok(contractLine, 'vault-schema.md declares a Raw/clippings contract');
  const declared = contractLine.match(/[\w-]+/g).filter((w) => w !== 'clippings');

  const fm = buildFrontmatter({
    title: 'T', source: 'https://x.com/a', author: 'A',
    published: '2026-01-01', created: '2026-01-02', quality: 'high', hash: 'h',
  });
  const written = [...fm.matchAll(/^([\w-]+):/gm)].map((m) => m[1]);

  for (const field of declared) {
    assert.ok(written.includes(field) || field === 'tags',
      `schema declares '${field}' but clip.mjs does not write it`);
  }
  for (const field of written) {
    assert.ok(declared.includes(field) || field === 'tags',
      `clip.mjs writes '${field}' but the schema contract does not declare it`);
  }
});

test('wiki-page contract declares every field the health graph reads', () => {
  const schema = readFileSync(join(ROOT, 'templates', 'vault-schema.md'), 'utf8');
  const contractLine = schema.match(/Wiki pages:\s*`([^`]+)`/)?.[1];
  assert.ok(contractLine, 'vault-schema.md declares a Wiki pages contract');
  // graph.mjs reads `status` from frontmatter; if the schema ever drops it,
  // stub detection silently dies again (issue #3's failure mode).
  assert.ok(contractLine.includes('status'),
    'wiki-page contract must declare status (graph.mjs stub detection reads it)');
});
