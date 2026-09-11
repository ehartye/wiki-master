import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const skills = readdirSync(join(root, 'skills')).filter(name => existsSync(join(root, 'skills', name, 'SKILL.md')));
const read = name => readFileSync(join(root, 'skills', name, 'SKILL.md'), 'utf8');
const links = text => [...text.matchAll(/\[[^\]]+\]\(([^)]+\.md)(?:#[^)]*)?\)/g)].map(match => match[1]);

test('all twenty portable skill descriptions identify triggers and resolve direct references', () => {
  assert.equal(skills.length, 20);
  for (const name of skills) {
    const text = read(name);
    assert.equal(text.match(/^name: (.+)$/m)?.[1], name);
    const description = text.match(/^description: (.+)$/m)?.[1];
    assert.ok(description && description.length <= 1024, `${name}: description budget`);
    assert.match(description, /when|asked|requests/i, `${name}: concrete trigger`);
    for (const link of links(text)) {
      if (/^https?:/.test(link)) continue;
      assert.ok(existsSync(resolve(root, 'skills', name, link)), `${name}: missing ${link}`);
    }
  }
});

test('shared core is bounded and each operation can reach access policy directly', () => {
  assert.ok(read('wiki-maintainer').split('\n').length <= 150);
  for (const name of skills) {
    assert.ok(links(read(name)).some(link => link.endsWith('/access.md')), `${name}: direct access contract`);
  }
});

test('writing routes share completion policy while read-only entry points do not open operations', () => {
  const mutating = skills.filter(name => !['wiki-health', 'wiki-search', 'wiki-stale', 'obsidian-cli'].includes(name));
  for (const name of mutating) {
    assert.ok(links(read(name)).some(link => link.endsWith('/operations.md')), `${name}: direct completion contract`);
  }
  for (const name of ['wiki-health', 'wiki-search', 'wiki-stale']) {
    assert.doesNotMatch(read(name), /op-begin\.mjs/, `${name}: read-only operation`);
  }
  assert.match(read('wiki-author'), /before (?:the first |any )?writ/i);
  assert.match(read('wiki-author'), /Done only/i);
});

test('operation examples expose both shells without mixed token syntax or relative helper execution', () => {
  const file = join(root, 'skills/wiki-maintainer/references/operations.md');
  assert.ok(existsSync(file));
  const text = readFileSync(file, 'utf8');
  assert.match(text, /```powershell/);
  assert.match(text, /```sh/);
  assert.match(text, /finally/);
  for (const name of skills) {
    assert.doesNotMatch(read(name), /TOKEN=\$\(/, `${name}: shell-specific lifecycle is centralized`);
    assert.doesNotMatch(read(name), /node (?:\.\.\/|scripts\/)/, `${name}: helper execution must use resolved absolute path`);
  }
  for (const [, block] of text.matchAll(/```(?:powershell|sh)\n([\s\S]*?)```/g)) {
    for (const [, script] of block.matchAll(/scripts\/([\w-]+\.mjs)/g)) {
      assert.ok(existsSync(join(root, 'scripts', script)), `example helper exists: ${script}`);
    }
  }
});

// A clipper script is a user-facing entry point: the user names a file format and
// expects a route for it. The skill is that route's only trigger — metadata is the
// one tier loaded for every installed skill, so a clipper with no SKILL.md is
// reachable only from inside another skill that happens to name its script.
// `clip.mjs` is wiki-discover's internal HTML path and `clip-and-repoint.mjs` is a
// maintenance helper; neither is a format the user asks for by name.
test('every document-format clipper has a skill that can trigger it', () => {
  const internal = new Set(['clip.mjs', 'clip-and-repoint.mjs']);
  const clippers = readdirSync(join(root, 'scripts'))
    .filter(f => /^clip-.*\.mjs$/.test(f) && !internal.has(f));
  assert.ok(clippers.length >= 6, 'expected the shipped clipper set');
  for (const file of clippers) {
    const name = file.replace(/\.mjs$/, '');
    assert.ok(existsSync(join(root, 'skills', name, 'SKILL.md')),
      `${file} ships with no skills/${name}/SKILL.md, so nothing can trigger it`);
  }
});
