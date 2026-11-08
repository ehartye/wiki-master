import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { auditSkills, parseFrontmatter } from './helpers/skill-audit.mjs';

// The structural skill audit (test/helpers/skill-audit.mjs). skill-contracts.test.mjs owns the real tree's skill
// count, description budget and catalog; these tests pin the audit's own parsing on fixtures, the reference-depth
// report, and that every script taking --apply is named where an agent reads.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HELPER = join(ROOT, 'test', 'helpers', 'skill-audit.mjs');

function library(t, files) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'wm-skill-audit-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}
const skill = (name, extra = '', bodyText = 'Body.\n') => `---\nname: ${name}\ndescription: Does a thing. Use when asked to do the thing.\n${extra}---\n${bodyText}`;
const audit = (root) => auditSkills(join(root, 'skills'), { root, cliSpecs: {} });

test('on the real tree the command prints one row per skill and exits 0', () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [HELPER], { encoding: 'utf8', env, timeout: 30000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const rows = r.stdout.split('\n').filter((l) => /^wiki-[a-z-]+ +description +\d+ +body lines +\d+$/.test(l));
  assert.deepEqual(rows.map((l) => l.split(' ')[0]), ['wiki-maintainer', 'wiki-project', 'wiki-purge', 'wiki-researcher', 'wiki-search', 'wiki-setup']);
  assert.match(r.stdout, /^reference depth: /m, 'the depth report is printed');
  assert.doesNotMatch(r.stdout, /^finding:/m);
});

test('on the real tree every script that takes --apply is named by a skill, reference, README or doc', async () => {
  const { findings } = await auditSkills(join(ROOT, 'skills'));
  assert.deepEqual(findings.filter((f) => f.includes('--apply')), []);
});

test('a description over 1,024 characters is a finding, and the command exits 1', async (t) => {
  const root = library(t, { 'skills/long/SKILL.md': `---\nname: long\ndescription: ${'x'.repeat(1025)}\n---\nBody.\n` });
  const { findings, rows } = await audit(root);
  assert.equal(rows[0].descriptionLength, 1025);
  assert.ok(findings.some((f) => /long: description is 1025 characters, over 1024/.test(f)), findings.join('\n'));
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [HELPER, join(root, 'skills')], { encoding: 'utf8', env, timeout: 30000 });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^finding: long: description is 1025/m);
});

test('a when_to_use key and a name that differs from the folder are findings', async (t) => {
  const root = library(t, {
    'skills/a/SKILL.md': skill('a', 'when_to_use: Use when asked.\n'),
    'skills/b/SKILL.md': skill('not-b'),
  });
  const { findings } = await audit(root);
  assert.ok(findings.some((f) => f.startsWith('a: when_to_use')), findings.join('\n'));
  assert.ok(findings.some((f) => f.startsWith('b: frontmatter name is not-b')), findings.join('\n'));
});

test('a CRLF copy of a skill audits exactly as its LF copy, folded descriptions included', async (t) => {
  const text = '---\nname: same\ndescription: >-\n  Reads the thing\n  across two lines.\nlicense: MIT\n---\nBody line one.\nBody line two.\n';
  const lf = library(t, { 'skills/same/SKILL.md': text });
  const crlf = library(t, { 'skills/same/SKILL.md': text.replace(/\n/g, '\r\n') });
  assert.equal(parseFrontmatter(text).description, 'Reads the thing across two lines.');
  assert.deepEqual(parseFrontmatter(text.replace(/\n/g, '\r\n')), parseFrontmatter(text));
  assert.deepEqual(await audit(crlf), await audit(lf));
  assert.equal((await audit(lf)).rows[0].descriptionLength, 'Reads the thing across two lines.'.length);
});

test('a file two hops beyond SKILL.md -> reference -> doc is reported, not a finding', async (t) => {
  const root = library(t, {
    'skills/deep/SKILL.md': skill('deep', '', 'See [ref](references/ref.md).\n'),
    'skills/deep/references/ref.md': 'See [doc](../../../docs/one.md). `[ignored](../../../docs/none.md)`\n',
    'docs/one.md': '[two](two.md)\n',
    'docs/two.md': '[three](three.md)\n',
    'docs/three.md': 'End.\n',
  });
  const { findings, deep } = await audit(root);
  assert.deepEqual(findings, []);
  assert.deepEqual(deep.map((d) => [d.file, d.depth]), [['docs/two.md', 3], ['docs/three.md', 4]]);
});

test('a link whose percent-encoding is malformed is skipped, not thrown on', async (t) => {
  const root = library(t, {
    'skills/odd/SKILL.md': skill('odd', '', 'See [bad](references/100%zz.md) and [ref](references/ref.md).\n'),
    'skills/odd/references/ref.md': '[doc](../../../docs/one.md)\n',
    'docs/one.md': 'End.\n',
  });
  const { findings, deep } = await audit(root);
  assert.deepEqual(findings, []);
  assert.deepEqual(deep, []);
});

test('a script that takes --apply but nothing names is a finding; the script index alone does not name it', async (t) => {
  const files = {
    'skills/s/SKILL.md': skill('s'),
    'scripts/fix-things.mjs': '// node scripts/fix-things.mjs --apply\n',
    'scripts/read-only.mjs': '// prints\n',
    'docs/scripts.md': '| `fix-things.mjs` | Fixes things. |\n',
  };
  const unnamed = library(t, files);
  assert.deepEqual((await audit(unnamed)).findings, ['scripts/fix-things.mjs: takes --apply but no skill, reference, README.md or doc names it']);
  const named = library(t, { ...files, 'skills/s/references/repair.md': 'Run `node scripts/fix-things.mjs` then `--apply`.\n' });
  assert.deepEqual((await audit(named)).findings, []);
  const bySpec = library(t, { 'skills/s/SKILL.md': skill('s'), 'scripts/spec-only.mjs': '// guarded\n' });
  const { findings } = await auditSkills(join(bySpec, 'skills'), { root: bySpec, cliSpecs: { 'spec-only': { options: ['apply'] } } });
  assert.deepEqual(findings, ['scripts/spec-only.mjs: takes --apply but no skill, reference, README.md or doc names it']);
});
