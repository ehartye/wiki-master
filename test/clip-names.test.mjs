import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  clipSafeName, isUnsafeClippingName, planClippingRenames, legacyNameMap, adoptLegacyName,
} from '../scripts/lib/clip-names.mjs';
import { rewriteLinkTargets } from '../scripts/lib/rewrite-links.mjs';
import { slugify } from '../scripts/clip.mjs';
import { slugifyRepoPath } from '../scripts/clip-gh.mjs';

// clipSafeName: what Obsidian indexes and a wikilink can carry --------------------

test('clipSafeName spells each leading dot as dot- and leaves the rest alone', () => {
  assert.equal(clipSafeName('.github-workflows-build.yml'), 'dot-github-workflows-build.yml');
  assert.equal(clipSafeName('.gitignore'), 'dot-gitignore');
  assert.equal(clipSafeName('..hidden'), 'dot-dot-hidden');
  assert.equal(clipSafeName('src-.hidden'), 'src-.hidden', 'only a leading dot hides a file');
  assert.equal(clipSafeName('README.md'), 'README.md');
});

test('clipSafeName drops backticks and collapses the gap they leave', () => {
  assert.equal(clipSafeName('`stringify`-`uneval` serialize shared memory'), 'stringify-uneval serialize shared memory');
  assert.equal(clipSafeName('Security- `npx -y x@latest` in config'), 'Security- npx -y x@latest in config');
  assert.equal(clipSafeName('a ` ` b'), 'a b');
});

test('clipSafeName handles a dot that a backtick was hiding, and degenerate names', () => {
  assert.equal(clipSafeName('`.env` file'), 'dot-env file');
  assert.equal(clipSafeName('...'), 'dot-dot-dot');
  assert.equal(clipSafeName('.'), 'dot');
  assert.equal(clipSafeName('``'), '');
});

test('clipSafeName is idempotent', () => {
  for (const s of ['.a', '`b`', '..c d', 'plain', '.`x`']) assert.equal(clipSafeName(clipSafeName(s)), clipSafeName(s));
});

test('isUnsafeClippingName covers dots and backticks, with or without .md', () => {
  assert.equal(isUnsafeClippingName('.gitignore.md'), true);
  assert.equal(isUnsafeClippingName('`x` y.md'), true);
  assert.equal(isUnsafeClippingName('dot-gitignore.md'), false);
  assert.equal(isUnsafeClippingName('a.b.md'), false);
  assert.equal(isUnsafeClippingName('x.md.md'), false);
});

// The clippers use it -------------------------------------------------------------

test('slugify never returns a hidden or backtick name', () => {
  assert.equal(slugify('`stringify`-`uneval` serialize shared memory'), 'stringify-uneval serialize shared memory');
  assert.equal(slugify('.htaccess cheat sheet'), 'dot-htaccess cheat sheet');
  assert.equal(slugify('...'), 'dot-dot-dot');
  assert.equal(slugify('Ordinary Title'), 'Ordinary Title');
});

test('slugifyRepoPath names a dot-leading repo file so Obsidian can see it', () => {
  assert.equal(slugifyRepoPath('.github/workflows/build.yml'), 'dot-github-workflows-build.yml');
  assert.equal(slugifyRepoPath('.gitignore'), 'dot-gitignore');
  assert.equal(slugifyRepoPath('src/.eslintrc.json'), 'src-.eslintrc.json');
});

test('slugifyRepoPath keeps the hash of a long path, so a file written before is recognisable', () => {
  // The digest comes from the full original path and the safe-name step runs after
  // it, so the legacy file (same name with a bare leading dot) maps to the new name
  // and a re-clip can adopt it instead of writing a second copy.
  const deep = `.github/${'workflows/'.repeat(14)}release.yml`;
  const digest = createHash('sha256').update(deep).digest('hex').slice(0, 12);
  const now = slugifyRepoPath(deep);
  assert.ok(now.startsWith('dot-github-workflows-'));
  assert.ok(now.endsWith(`-${digest}`), 'digest still derives from the full path');
  assert.ok(now.length <= 104, `expected a bounded slug, got ${now.length}`);
  assert.notEqual(now, slugifyRepoPath(`${deep}x`), 'paths differing at the end stay distinct');
  const legacy = `.${now.slice('dot-'.length)}.md`;
  assert.equal(legacyNameMap([legacy]).get(`${now}.md`.toLowerCase()), legacy);
});

// planClippingRenames -------------------------------------------------------------

test('planClippingRenames plans only unsafe .md files under their own folder', () => {
  const { renames, refused } = planClippingRenames([
    'raw/clippings/gh/o/r/.gitignore.md',
    'raw/clippings/gh/o/r/README.md',
    'raw/clippings/`code` title.md',
    'raw/book-nom/.booknom-state.json',
  ]);
  assert.deepEqual(renames, [
    { from: 'raw/clippings/`code` title.md', to: 'raw/clippings/code title.md' },
    { from: 'raw/clippings/gh/o/r/.gitignore.md', to: 'raw/clippings/gh/o/r/dot-gitignore.md' },
  ]);
  assert.deepEqual(refused, []);
});

test('planClippingRenames refuses a target that exists, ignoring case, and never overwrites', () => {
  const { renames, refused } = planClippingRenames([
    'raw/clippings/gh/o/r/.gitignore.md',
    'raw/clippings/gh/o/r/Dot-Gitignore.md',
  ]);
  assert.deepEqual(renames, []);
  assert.equal(refused.length, 1);
  assert.equal(refused[0].from, 'raw/clippings/gh/o/r/.gitignore.md');
});

test('planClippingRenames refuses the second of two sources that want one target', () => {
  const { renames, refused } = planClippingRenames(['raw/clippings/`a` b.md', 'raw/clippings/a b`.md']);
  assert.equal(renames.length, 1);
  assert.equal(refused.length, 1);
});

// rewriteLinkTargets --------------------------------------------------------------

const R = [{ from: 'raw/clippings/gh/o/r/.gitignore.md', to: 'raw/clippings/gh/o/r/dot-gitignore.md' }];

test('rewriteLinkTargets repoints a frontmatter citation, a body link and keeps the alias', () => {
  const text = [
    '---', 'sources:', '  - "[[raw/clippings/gh/o/r/.gitignore.md]]"', '---',
    'See [[raw/clippings/gh/o/r/.gitignore.md|the ignore file]] and [[raw/clippings/gh/o/r/.gitignore]].', '',
  ].join('\n');
  const r = rewriteLinkTargets(text, R);
  assert.equal(r.count, 3);
  assert.ok(r.text.includes('"[[raw/clippings/gh/o/r/dot-gitignore.md]]"'));
  assert.ok(r.text.includes('[[raw/clippings/gh/o/r/dot-gitignore.md|the ignore file]]'));
  assert.ok(r.text.includes('[[raw/clippings/gh/o/r/dot-gitignore]]'), 'extensionless form stays extensionless');
  assert.ok(!r.text.includes('/.gitignore'));
});

test('rewriteLinkTargets keeps a heading anchor and the escaped pipe of a table cell', () => {
  const text = '| a | [[raw/clippings/gh/o/r/.gitignore.md\\|ignore]] | [[raw/clippings/gh/o/r/.gitignore.md#Rules]] |\n';
  const r = rewriteLinkTargets(text, R);
  assert.equal(r.count, 2);
  assert.ok(r.text.includes('[[raw/clippings/gh/o/r/dot-gitignore.md\\|ignore]]'));
  assert.ok(r.text.includes('[[raw/clippings/gh/o/r/dot-gitignore.md#Rules]]'));
});

test('rewriteLinkTargets matches the whole path and ignores case', () => {
  const text = '[[RAW/Clippings/gh/o/r/.GitIgnore.md]] [[.gitignore.md]] [[raw/clippings/gh/other/r/.gitignore.md]]\n';
  const r = rewriteLinkTargets(text, R);
  assert.equal(r.count, 1);
  assert.ok(r.text.startsWith('[[raw/clippings/gh/o/r/dot-gitignore.md]] [[.gitignore.md]] [[raw/clippings/gh/other/r/.gitignore.md]]'));
});

test('rewriteLinkTargets leaves links in code fences, inline code and comments alone', () => {
  const link = '[[raw/clippings/gh/o/r/.gitignore.md]]';
  const text = ['```', link, '```', `\`${link}\``, `<!-- ${link} -->`, link, ''].join('\n');
  const r = rewriteLinkTargets(text, R);
  assert.equal(r.count, 1);
  assert.equal(r.text.split(link).length - 1, 3, 'three examples keep the old path');
});

test('rewriteLinkTargets repoints a link to a backtick-named file and keeps the code span rule for real code', () => {
  const rn = [{ from: 'raw/clippings/`stringify`-`uneval` x.md', to: 'raw/clippings/stringify-uneval x.md' }];
  const text = '---\nsources: ["[[raw/clippings/`stringify`-`uneval` x.md]]"]\n---\nSee [[raw/clippings/`stringify`-`uneval` x.md|advisory]].\n`[[raw/clippings/`stringify`-`uneval` x.md]]`\n';
  const r = rewriteLinkTargets(text, rn);
  assert.equal(r.count, 2);
  assert.ok(r.text.includes('"[[raw/clippings/stringify-uneval x.md]]"'));
  assert.ok(r.text.includes('[[raw/clippings/stringify-uneval x.md|advisory]]'));
  assert.ok(r.text.includes('`[[raw/clippings/`stringify`-`uneval` x.md]]`'), 'the example in a code span is untouched');
});

test('rewriteLinkTargets returns the same text when nothing matches', () => {
  const text = 'No links here, only [[Other Page]].\n';
  assert.deepEqual(rewriteLinkTargets(text, R), { text, count: 0 });
  assert.deepEqual(rewriteLinkTargets(text, []), { text, count: 0 });
});

// legacy adoption -----------------------------------------------------------------

function dirWith(...names) {
  const d = mkdtempSync(join(tmpdir(), 'wm-legacy-'));
  for (const n of names) writeFileSync(join(d, n), n);
  return d;
}

test('adoptLegacyName renames a legacy file to its current name', () => {
  const d = dirWith('.gitignore.md', 'README.md');
  try {
    const map = legacyNameMap(readdirSync(d));
    assert.equal(adoptLegacyName(d, map, 'dot-gitignore.md'), true);
    assert.deepEqual(readdirSync(d).sort(), ['README.md', 'dot-gitignore.md']);
    assert.equal(adoptLegacyName(d, map, 'dot-gitignore.md'), false, 'nothing left to adopt');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('adoptLegacyName never overwrites an existing current file', () => {
  const d = dirWith('.gitignore.md', 'dot-gitignore.md');
  try {
    assert.equal(adoptLegacyName(d, legacyNameMap(readdirSync(d)), 'dot-gitignore.md'), false);
    assert.deepEqual(readdirSync(d).sort(), ['.gitignore.md', 'dot-gitignore.md']);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('adoptLegacyName ignores a file that is not the legacy form of the wanted name', () => {
  const d = dirWith('.gitignore.md');
  try {
    assert.equal(adoptLegacyName(d, legacyNameMap(readdirSync(d)), 'dot-other.md'), false);
    assert.deepEqual(readdirSync(d), ['.gitignore.md']);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
