import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const skills = readdirSync(join(root, 'skills')).filter(name => existsSync(join(root, 'skills', name, 'SKILL.md')));
const read = name => readFileSync(join(root, 'skills', name, 'SKILL.md'), 'utf8');
const links = text => [...text.matchAll(/\[[^\]]+\]\(([^)]+\.md)(?:#[^)]*)?\)/g)].map(match => match[1]);

test('all nineteen portable skill descriptions identify triggers and resolve direct references', () => {
  assert.equal(skills.length, 19);
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
