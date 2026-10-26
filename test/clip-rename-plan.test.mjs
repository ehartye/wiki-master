import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDoubledExtensionRenames } from '../scripts/lib/clip-rename-plan.mjs';

// The plan for renaming clippings whose names double the extension (`README.md.md`). A clipping from
// `clip-gh` sits in its own repository folder and is unique by path, so it only loses the second `.md`.
// A top-level clipping from `clip.mjs` with an empty title has a generic name, so it is renamed from its
// source URL with the same rule new clips follow. Nothing is renamed onto a name that exists.

const GH = 'raw/clippings/gh/acme/agent';
const TOP = 'raw/clippings';
const heads = (map) => (path) => map[path] ?? { title: '', source: '' };

test('a clip-gh file loses its second .md and keeps its folder', () => {
  const { renames, refused } = planDoubledExtensionRenames([`${GH}/README.md.md`, `${GH}/skills-one-SKILL.md.md`]);
  assert.deepEqual(renames, [
    { from: `${GH}/README.md.md`, to: `${GH}/README.md` },
    { from: `${GH}/skills-one-SKILL.md.md`, to: `${GH}/skills-one-SKILL.md` },
  ]);
  assert.deepEqual(refused, []);
});

test('only doubled names under raw/ are planned; ordinary clippings and other files are left alone', () => {
  const { renames } = planDoubledExtensionRenames([`${GH}/ok.md`, `${GH}/x.yml.md`, 'raw/clippings/state.json', 'wiki/sources/Page.md.md', `${GH}/y.md.md`]);
  assert.deepEqual(renames.map((r) => r.from), [`${GH}/y.md.md`]);
});

test('a rename onto an existing name is refused, case ignored, and the file keeps its name', () => {
  const { renames, refused } = planDoubledExtensionRenames([`${GH}/LICENSE.md`, `${GH}/LICENSE.md.md`, `${GH}/b.md.md`, `${GH}/B.md`]);
  assert.deepEqual(renames, []);
  assert.deepEqual(refused.map((r) => r.from).sort(), [`${GH}/LICENSE.md.md`, `${GH}/b.md.md`]);
  assert.match(refused[0].reason, /already exists/);
});

test('two files that would claim one new name: the first gets it, the second is refused', () => {
  const { renames, refused } = planDoubledExtensionRenames([`${GH}/X.md.md`, `${GH}/x.md.md`]);
  assert.equal(renames.length, 1);
  assert.equal(refused.length, 1);
});

test('a top-level clipping with an empty title is renamed from its source URL, nearest folder first', () => {
  const paths = [`${TOP}/SKILL.md.md`, `${TOP}/README.md.md`];
  const headOf = heads({
    [`${TOP}/SKILL.md.md`]: { title: '', source: 'https://raw.githubusercontent.com/phaserjs/phaser/v4.2.1/skills/physics-arcade/SKILL.md' },
    [`${TOP}/README.md.md`]: { title: '', source: 'https://cdn.jsdelivr.net/npm/ue-mcp@1.3.8/README.md' },
  });
  const { renames, refused } = planDoubledExtensionRenames(paths, { headOf });
  assert.deepEqual(renames, [
    { from: `${TOP}/README.md.md`, to: `${TOP}/ue-mcp@1.3.8-README.md` },
    { from: `${TOP}/SKILL.md.md`, to: `${TOP}/physics-arcade-SKILL.md` },
  ]);
  assert.deepEqual(refused, []);
});

test('top-level files with one basename each get distinct names, and an existing name is never taken', () => {
  const paths = [`${TOP}/SKILL.md.md`, `${TOP}/SKILL2.md.md`, `${TOP}/physics-arcade-SKILL.md`];
  const headOf = heads({
    [`${TOP}/SKILL.md.md`]: { title: '', source: 'https://x.test/skills/physics-arcade/SKILL.md' },
    [`${TOP}/SKILL2.md.md`]: { title: '', source: 'https://x.test/other/physics-arcade/SKILL.md' },
  });
  const { renames } = planDoubledExtensionRenames(paths, { headOf });
  const to = renames.map((r) => r.to.toLowerCase());
  assert.equal(new Set(to).size, to.length, 'distinct');
  assert.ok(!to.includes(`${TOP}/physics-arcade-SKILL.md`.toLowerCase()), 'the existing file is not taken');
});

test('a top-level file that has a title, or no readable source, just loses its second .md', () => {
  const headOf = heads({ [`${TOP}/Titled.md.md`]: { title: 'A real title', source: 'https://x.test/a' } });
  const { renames } = planDoubledExtensionRenames([`${TOP}/Titled.md.md`, `${TOP}/NoHead.md.md`], { headOf });
  assert.deepEqual(renames.map((r) => r.to).sort(), [`${TOP}/NoHead.md`, `${TOP}/Titled.md`]);
});

test('no new name doubles the extension or starts with a dot', () => {
  const { renames } = planDoubledExtensionRenames([`${GH}/.hidden.md.md`, `${GH}/a.md.md`, `${TOP}/Weird.md.md.md`]);
  for (const r of renames) {
    const base = r.to.slice(r.to.lastIndexOf('/') + 1);
    assert.ok(!/\.md\.md$/i.test(base), r.to);
    assert.ok(!base.startsWith('.'), r.to);
  }
  assert.ok(renames.some((r) => r.to === `${GH}/dot-hidden.md`));
});

test('the plan is deterministic and, once applied, plans nothing more', () => {
  const paths = [`${GH}/b.md.md`, `${GH}/a.md.md`, `${TOP}/z.md.md`];
  const first = planDoubledExtensionRenames(paths);
  assert.deepEqual(first, planDoubledExtensionRenames([...paths].reverse()));
  const after = paths.map((p) => first.renames.find((r) => r.from === p)?.to ?? p);
  assert.deepEqual(planDoubledExtensionRenames(after), { renames: [], refused: [] });
});
