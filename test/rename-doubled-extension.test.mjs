import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { renameDoubledExtensionClippings } from '../scripts/rename-doubled-extension-clippings.mjs';
import { scanIntegrity } from '../scripts/health.mjs';

// Renaming the clippings whose names double the extension, and the citations to them. The contract is
// the one rename-unsafe-clippings.mjs shipped in 0.53.0: a dry run first, file bytes untouched, only
// full-path wikilinks repointed, raw/ and log/ never rewritten, a second run a no-op.

const GH = 'raw/clippings/gh/acme/agent';
const clipping = (title, source, extra = '') => `---\ntitle: "${title}"\nsource: "${source}"\nsource-hash: "${createHash('sha256').update(title + source).digest('hex')}"\n---\n\nEvidence for ${title} ${extra}.\n`;
const BODY = 'A substantive summary of the repository: its build, its agent skills and the checks it runs on every push.';
const page = (cites, extra = '') => `---\ntype: source\nstatus: maintained\nsources:\n${cites.map((c) => `  - "[[${c}]]"`).join('\n')}\n---\n${BODY}\n${extra}`;
const sha = (root, p) => createHash('sha256').update(readFileSync(join(root, p))).digest('hex');

function vault(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'wm-rename-dbl-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}
const read = (root, p) => readFileSync(join(root, p), 'utf8');

const SKILL_URL = 'https://raw.githubusercontent.com/phaserjs/phaser/v4.2.1/skills/physics-arcade/SKILL.md';
const base = () => ({
  [`${GH}/README.md.md`]: clipping('README', 'https://github.com/acme/agent/blob/main/README.md'),
  [`${GH}/skills-one-SKILL.md.md`]: clipping('one', 'https://github.com/acme/agent/blob/main/skills/one/SKILL.md'),
  'raw/clippings/SKILL.md.md': clipping('', SKILL_URL),
  'wiki/sources/Agent Summary.md': page([`${GH}/README.md.md`, `${GH}/skills-one-SKILL.md`, 'raw/clippings/SKILL.md.md'], `See [[${GH}/README.md.md|the readme]] and [[raw/clippings/SKILL.md.md#Intro|skill]].\n`),
  'wiki/authored/consumer-app/notes/Citing.md': `---\ntype: authored\nsources: []\n---\nSee [[${GH}/README.md.md]].\n`,
  'log/2026-01-01-ingest-agent.md': `## [2026-01-01] ingest | agent\n\nClipped ${GH}/README.md.md.\n`,
  'wiki/concepts/Prose.md': `---\ntype: concept\nstatus: stub\nsources: []\n---\nThe path \`${GH}/README.md.md\` in a code span stays as written.\n`,
});

test('a dry run plans every rename and repoint, flags the pages it was asked to, and writes nothing', (t) => {
  const root = vault(t, base());
  const before = readdirSync(join(root, GH)).sort();
  const r = renameDoubledExtensionClippings(root, { flag: ['wiki/authored/consumer-app/'] });
  assert.equal(r.refused.length, 0);
  assert.deepEqual(r.renames.map((x) => x.to).sort(), [`${GH}/README.md`, `${GH}/skills-one-SKILL.md`, 'raw/clippings/physics-arcade-SKILL.md']);
  assert.ok(r.pages.some((p) => p.page === 'wiki/sources/Agent Summary.md'));
  assert.deepEqual(r.flagged, ['wiki/authored/consumer-app/notes/Citing.md']);
  assert.deepEqual(readdirSync(join(root, GH)).sort(), before);
  assert.ok(existsSync(join(root, 'raw/clippings/SKILL.md.md')));
});

test('--apply renames the files byte-for-byte, repoints the citations, and the graph resolves them', (t) => {
  const root = vault(t, base());
  const hashes = Object.fromEntries(['README', 'skills-one-SKILL'].map((n) => [n, sha(root, `${GH}/${n}.md.md`)]));
  const skillHash = sha(root, 'raw/clippings/SKILL.md.md');
  const issuesBefore = scanIntegrity(root).issues.length;
  const r = renameDoubledExtensionClippings(root, { apply: true });
  assert.equal(r.renames.length, 3);
  assert.deepEqual(readdirSync(join(root, GH)).sort(), ['README.md', 'skills-one-SKILL.md']);
  assert.equal(sha(root, `${GH}/README.md`), hashes.README);
  assert.equal(sha(root, `${GH}/skills-one-SKILL.md`), hashes['skills-one-SKILL']);
  assert.equal(sha(root, 'raw/clippings/physics-arcade-SKILL.md'), skillHash);
  const summary = read(root, 'wiki/sources/Agent Summary.md');
  assert.match(summary, new RegExp(`\\[\\[${GH}/README\\.md\\|the readme\\]\\]`));
  assert.match(summary, /\[\[raw\/clippings\/physics-arcade-SKILL\.md#Intro\|skill\]\]/);
  assert.ok(!summary.includes('SKILL.md.md'));
  assert.equal(scanIntegrity(root).issues.length, issuesBefore, 'no citation became unresolved or ambiguous');
  assert.ok(r.paths.includes(`${GH}/README.md`) && r.paths.includes(`${GH}/README.md.md`) && r.paths.includes('wiki/sources/Agent Summary.md'));
});

test('raw/ and log/ are never rewritten, and a path in a code span or in history is reported, not changed', (t) => {
  const root = vault(t, base());
  const log = read(root, 'log/2026-01-01-ingest-agent.md');
  const prose = read(root, 'wiki/concepts/Prose.md');
  const r = renameDoubledExtensionClippings(root, { apply: true });
  assert.equal(read(root, 'log/2026-01-01-ingest-agent.md'), log);
  assert.equal(read(root, 'wiki/concepts/Prose.md'), prose);
  const loose = r.loose.map((x) => x.page).sort();
  assert.ok(loose.includes('log/2026-01-01-ingest-agent.md') && loose.includes('wiki/concepts/Prose.md'), loose.join(','));
});

test('a second run is a no-op', (t) => {
  const root = vault(t, base());
  renameDoubledExtensionClippings(root, { apply: true });
  const again = renameDoubledExtensionClippings(root, { apply: true });
  assert.deepEqual([again.renames.length, again.refused.length, again.pages.length], [0, 0, 0]);
});

test('a rename onto an existing name is refused and that file stays where it is', (t) => {
  const root = vault(t, { ...base(), [`${GH}/README.md`]: clipping('another readme', 'https://example.org/other') });
  const r = renameDoubledExtensionClippings(root, { apply: true });
  assert.deepEqual(r.refused.map((x) => x.from), [`${GH}/README.md.md`]);
  assert.ok(existsSync(join(root, `${GH}/README.md.md`)));
  assert.match(read(root, 'wiki/sources/Agent Summary.md'), /README\.md\.md/);
});

test('a page under an excluded prefix is left untouched and its unrepointed citation is reported', (t) => {
  const root = vault(t, base());
  const cited = read(root, 'wiki/authored/consumer-app/notes/Citing.md');
  const r = renameDoubledExtensionClippings(root, { apply: true, exclude: ['wiki/authored/consumer-app/'] });
  assert.equal(read(root, 'wiki/authored/consumer-app/notes/Citing.md'), cited);
  assert.ok(r.loose.some((x) => x.page === 'wiki/authored/consumer-app/notes/Citing.md'), 'the unrepointed citation is reported');
  assert.ok(!r.pages.some((p) => p.page.startsWith('wiki/authored/consumer-app/')));
});

// Found on the live vault: it holds BOTH raw/clippings/Build.md and raw/clippings/build.md.md. A link to
// `raw/clippings/Build.md` is the exact path of the real file, and the resolver says an exact file wins
// over another file's extension-stripped path. The rewrite matched that link as the stem form of the
// doubled file, ignoring case, and would have repointed 16 citations of the real file to the wrong one.
const BUILD = () => ({
  'raw/clippings/Build.md': clipping('Build', 'https://example.org/real-build'),
  'raw/clippings/build.md.md': clipping('', 'https://raw.example.org/o/r/main/docs/guide/build.md'),
  'wiki/sources/Cites both.md': page(['raw/clippings/Build.md', 'raw/clippings/build.md.md'], 'The real file: [[raw/clippings/Build.md|build guide]]. The other: [[raw/clippings/build.md.md|the doubled one]].\n'),
});

test('a link to an existing file is never taken for the extension-stripped path of a renamed one', (t) => {
  const root = vault(t, BUILD());
  const r = renameDoubledExtensionClippings(root);
  assert.deepEqual(r.renames.map((x) => x.to), ['raw/clippings/guide-build.md']);
  assert.deepEqual(r.pages, [{ page: 'wiki/sources/Cites both.md', links: 2 }], 'only the two links to the doubled file');
});

test('applying keeps the real Build.md citations and repoints only the doubled file', (t) => {
  const root = vault(t, BUILD());
  const before = scanIntegrity(root).issues.map((i) => `${i.rule} ${i.target}`).sort();
  renameDoubledExtensionClippings(root, { apply: true });
  const text = read(root, 'wiki/sources/Cites both.md');
  assert.equal((text.match(/\[\[raw\/clippings\/Build\.md[|\]]/g) ?? []).length, 2, 'the real file is still cited twice, exact case');
  assert.match(text, /\[\[raw\/clippings\/guide-build\.md\|the doubled one\]\]/);
  assert.ok(!text.includes('build.md.md'));
  assert.deepEqual(scanIntegrity(root).issues.map((i) => `${i.rule} ${i.target}`).sort(), before.filter((x) => !x.includes('build.md.md')));
  assert.ok(existsSync(join(root, 'raw/clippings/Build.md')));
});

test('a link written as the extension-stripped path of a renamed file is repointed when no existing file has that path', (t) => {
  const root = vault(t, {
    'raw/clippings/SKILL.md.md': clipping('', SKILL_URL),
    'wiki/sources/Stem form.md': page(['raw/clippings/SKILL.md'], 'See [[raw/clippings/SKILL.md|the skill]].\n'),
  });
  const before = scanIntegrity(root).issues.length;
  const r = renameDoubledExtensionClippings(root, { apply: true });
  assert.deepEqual(r.pages, [{ page: 'wiki/sources/Stem form.md', links: 2 }]);
  const text = read(root, 'wiki/sources/Stem form.md');
  assert.match(text, /\[\[raw\/clippings\/physics-arcade-SKILL\]\]/);
  assert.match(text, /\[\[raw\/clippings\/physics-arcade-SKILL\|the skill\]\]/);
  assert.equal(scanIntegrity(root).issues.length, before, 'both links still resolve');
});
test('without --flag nothing is flagged, and several prefixes can be given', (t) => {
  const root = vault(t, base());
  assert.deepEqual(renameDoubledExtensionClippings(root).flagged, []);
  const r = renameDoubledExtensionClippings(root, { flag: ['wiki/concepts/', 'wiki/authored/consumer-app/'] });
  assert.deepEqual(r.flagged, ['wiki/authored/consumer-app/notes/Citing.md', 'wiki/concepts/Prose.md']);
});
