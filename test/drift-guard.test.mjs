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

test('version is identical across all five manifests (Claude + Copilot)', () => {
  // The version is one fact copied into five files — the exact drift seam this
  // suite exists to guard. wiki-master ships to two hosts (Claude Code reads
  // .claude-plugin/; Copilot CLI reads a root plugin.json + .github/plugin/),
  // and a manifest set that disagrees about what version this is must fail loud.
  const versions = [
    'package.json',
    '.claude-plugin/plugin.json',
    '.claude-plugin/marketplace.json',
    'plugin.json',
    '.github/plugin/marketplace.json',
  ].map((f) => {
    const j = JSON.parse(readFileSync(join(ROOT, f), 'utf8'));
    return { f, v: j.version ?? j.plugins?.[0]?.version };
  });
  const distinct = new Set(versions.map((x) => x.v));
  assert.equal(distinct.size, 1,
    `manifests disagree: ${versions.map((x) => `${x.f}=${x.v}`).join(', ')}`);
});

test('Copilot manifests are structurally valid and point at skills/', () => {
  // Copilot CLI reads a root plugin.json and .github/plugin/marketplace.json.
  // The plugin ships its user-facing operations as skills (commands/ retired
  // in 0.3.0), so the manifest must point Copilot at skills/.
  const plugin = JSON.parse(readFileSync(join(ROOT, 'plugin.json'), 'utf8'));
  assert.equal(plugin.name, 'wiki-master', 'root plugin.json name');
  const skills = [].concat(plugin.skills ?? []);
  assert.ok(skills.includes('skills/'), 'root plugin.json declares skills: ["skills/"]');

  const mkt = JSON.parse(readFileSync(join(ROOT, '.github/plugin/marketplace.json'), 'utf8'));
  const entry = mkt.plugins?.[0];
  assert.ok(entry && entry.name === 'wiki-master' && entry.source,
    '.github/plugin/marketplace.json lists the wiki-master plugin with a source');
});

test('commands/ is retired — every former op exists as a skill', () => {
  // 0.3.0 migrated commands→skills (Copilot has no commands tier; skills are
  // the portable entry-point both hosts load as /wiki-*). No commands/ dir may
  // linger, and each former command must exist as skills/<name>/SKILL.md.
  assert.ok(!existsSync(join(ROOT, 'commands')), 'commands/ must be removed');
  const ops = ['wiki-discover', 'wiki-health', 'wiki-ingest', 'wiki-init',
    'wiki-lint', 'wiki-query', 'wiki-relink', 'wiki-stale'];
  const missing = ops.filter((op) => !existsSync(join(ROOT, 'skills', op, 'SKILL.md')));
  assert.deepEqual(missing, [], `missing skills for former commands: ${missing.join(', ')}`);
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
