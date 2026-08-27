import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRepoSpec,
  shouldExcludePath,
  githubBlobUrl,
  languageHintForExt,
  fileClipContent,
  repoManifestContent,
  slugifyRepoPath,
  groupIntoModules,
  moduleListingContent,
  digestManifestContent,
  selectAnchorFiles,
} from '../scripts/clip-gh.mjs';

// A GitHub repo is identified as `owner/repo`, but users paste every shape:
// a bare spec, a full https URL (with or without .git), or an ssh remote.
// All four must resolve to the same {owner, repo} so the rest of the
// pipeline never has to care which one was typed.
test('parseRepoSpec parses a bare owner/repo', () => {
  assert.deepEqual(parseRepoSpec('octocat/Hello-World'), { owner: 'octocat', repo: 'Hello-World' });
});

test('parseRepoSpec parses a full https URL', () => {
  assert.deepEqual(parseRepoSpec('https://github.com/octocat/Hello-World'), { owner: 'octocat', repo: 'Hello-World' });
});

test('parseRepoSpec parses a full https URL with a .git suffix', () => {
  assert.deepEqual(parseRepoSpec('https://github.com/octocat/Hello-World.git'), { owner: 'octocat', repo: 'Hello-World' });
});

test('parseRepoSpec parses an ssh remote', () => {
  assert.deepEqual(parseRepoSpec('git@github.com:octocat/Hello-World.git'), { owner: 'octocat', repo: 'Hello-World' });
});

test('parseRepoSpec strips a trailing slash', () => {
  assert.deepEqual(parseRepoSpec('https://github.com/octocat/Hello-World/'), { owner: 'octocat', repo: 'Hello-World' });
});

test('parseRepoSpec returns null for something that is not a repo spec', () => {
  assert.equal(parseRepoSpec('not a repo'), null);
  assert.equal(parseRepoSpec(''), null);
  assert.equal(parseRepoSpec('https://example.com/foo'), null);
});

// The exclusion list is the whole point of "don't clip the whole repo
// contents" — dependency trees, build output, binaries, and lockfiles are
// real bytes in the repo but are not the kind of content a clipping is for.
test('shouldExcludePath excludes a dependency directory regardless of depth', () => {
  assert.equal(shouldExcludePath('node_modules/left-pad/index.js').excluded, true);
  assert.equal(shouldExcludePath('packages/app/node_modules/left-pad/index.js').excluded, true);
  assert.equal(shouldExcludePath('vendor/bundle/gem.rb').excluded, true);
  assert.equal(shouldExcludePath('dist/bundle.js').excluded, true);
  assert.equal(shouldExcludePath('target/classes/Main.class').excluded, true);
});

test('shouldExcludePath excludes known binary/media extensions', () => {
  assert.equal(shouldExcludePath('logo.png').excluded, true);
  assert.equal(shouldExcludePath('font/Roboto.woff2').excluded, true);
  assert.equal(shouldExcludePath('archive.zip').excluded, true);
  assert.equal(shouldExcludePath('bin/tool.exe').excluded, true);
});

test('shouldExcludePath excludes known lockfiles by exact basename', () => {
  assert.equal(shouldExcludePath('package-lock.json').excluded, true);
  assert.equal(shouldExcludePath('sub/dir/yarn.lock').excluded, true);
  assert.equal(shouldExcludePath('go.sum').excluded, true);
});

test('shouldExcludePath excludes a file over the size ceiling, with a reason', () => {
  const r = shouldExcludePath('data/huge.json', { size: 10 * 1024 * 1024 });
  assert.equal(r.excluded, true);
  assert.match(r.reason, /large/i);
});

test('shouldExcludePath includes an ordinary source file', () => {
  const r = shouldExcludePath('src/main/java/com/example/Foo.java', { size: 2048 });
  assert.equal(r.excluded, false);
});

test('shouldExcludePath includes README and other docs at the repo root', () => {
  assert.equal(shouldExcludePath('README.md').excluded, false);
  assert.equal(shouldExcludePath('docs/guide.md').excluded, false);
});

test('shouldExcludePath does not exclude .github (CI config is real content)', () => {
  assert.equal(shouldExcludePath('.github/workflows/ci.yml').excluded, false);
});

test('githubBlobUrl builds the exact blob URL GitHub itself uses', () => {
  assert.equal(
    githubBlobUrl('octocat', 'Hello-World', 'a1b2c3d', 'src/main.js'),
    'https://github.com/octocat/Hello-World/blob/a1b2c3d/src/main.js',
  );
});

test('languageHintForExt maps common extensions to a fenced-code-block language', () => {
  assert.equal(languageHintForExt('.js'), 'javascript');
  assert.equal(languageHintForExt('.py'), 'python');
  assert.equal(languageHintForExt('.java'), 'java');
  assert.equal(languageHintForExt('.rs'), 'rust');
});

test('languageHintForExt falls back to empty for an unknown extension', () => {
  assert.equal(languageHintForExt('.xyz123'), '');
});

// Building the clipping note. Pure: no IO, no git, no gh CLI. Markdown files
// are stored as-is (never re-fenced — that would break their own headings
// and nested code fences); every other file is wrapped in a language-hinted
// fence so it reads as quotable source, not accidental prose.
test('fileClipContent wraps a non-markdown file in a language-hinted fence', () => {
  const c = fileClipContent({
    owner: 'octocat', repo: 'Hello-World', ref: 'a1b2c3d', relPath: 'src/main.js',
    content: 'console.log("hi");\n', quality: 'medium', created: '2026-08-26',
  });
  assert.match(c.body, /^---\n/);
  assert.match(c.body, /title: "Hello-World\/src\/main\.js at a1b2c3d"/);
  assert.match(c.body, /source: "https:\/\/github\.com\/octocat\/Hello-World\/blob\/a1b2c3d\/src\/main\.js"/);
  assert.match(c.body, /```javascript\nconsole\.log\("hi"\);\n```/);
});

test('fileClipContent stores a markdown file unfenced, verbatim', () => {
  const c = fileClipContent({
    owner: 'octocat', repo: 'Hello-World', ref: 'a1b2c3d', relPath: 'README.md',
    content: '# Hello\n\nSome **prose**.\n', quality: 'medium', created: '2026-08-26',
  });
  assert.ok(!c.body.includes('```'), 'markdown content is not re-fenced');
  assert.ok(c.body.trimEnd().endsWith('# Hello\n\nSome **prose**.'.trimEnd()));
});

test('fileClipContent exposes a content hash for dedup', () => {
  const c = fileClipContent({
    owner: 'o', repo: 'r', ref: 'sha', relPath: 'a.txt', content: 'hello world\n', created: '2026-08-26',
  });
  assert.match(c.hash, /^[0-9a-f]{64}$/);
});

test('fileClipContent counts words for the thin-content gate', () => {
  const c = fileClipContent({
    owner: 'o', repo: 'r', ref: 'sha', relPath: 'a.txt', content: 'one two three', created: '2026-08-26',
  });
  assert.equal(c.wordCount, 3);
});

// The manifest is the one clipping that represents the REPO, not a file in
// it — the entry point /wiki-ingest reaches for first.
test('repoManifestContent cites the repo root, not a file, as its source', () => {
  const c = repoManifestContent({
    owner: 'octocat', repo: 'Hello-World', ref: 'a1b2c3d', description: 'My first repo',
    primaryLanguage: 'JavaScript', includedPaths: ['README.md', 'src/main.js'],
    excludedCount: 2, created: '2026-08-26',
  });
  assert.match(c.body, /source: "https:\/\/github\.com\/octocat\/Hello-World\/tree\/a1b2c3d"/);
  assert.match(c.body, /My first repo/);
  assert.match(c.body, /JavaScript/);
  assert.match(c.body, /README\.md/);
  assert.match(c.body, /src\/main\.js/);
  assert.match(c.body, /Files excluded[^:]*:\*\* 2/);
});

test('repoManifestContent handles a missing description gracefully', () => {
  const c = repoManifestContent({
    owner: 'o', repo: 'r', ref: 'sha', description: null, primaryLanguage: null,
    includedPaths: ['a.txt'], excludedCount: 0, created: '2026-08-26',
  });
  assert.doesNotMatch(c.body, /null/);
});

// slugifyRepoPath: clip-gh writes one clipping PER REPO FILE, so its output
// filename is derived from a full, sometimes deeply-nested repo-relative
// PATH — not a short human title. clip.mjs's shared `slugify()` (built for
// article titles) blindly truncates to 120 characters, which is unsafe here:
// a real ~10k-file Salesforce DX repo had many sibling files sharing one
// long directory prefix and differing only in their last few characters
// (`Foo.js` vs `Foo.html` vs `Foo.js-meta.xml`, or `...MockWith4Records.json`
// vs `...MockWith8Records.json`) — truncating at a fixed length collapsed
// every one of them to an IDENTICAL filename, and each subsequent write
// silently overwrote the file before it. Confirmed: 49 real files silently
// lost in a single run before this fix existed.
test('slugifyRepoPath matches ordinary slugify output for a short, typical repo path', () => {
  assert.equal(slugifyRepoPath('src/main.js'), 'src-main.js');
  assert.equal(slugifyRepoPath('README.md'), 'README.md');
});

test('slugifyRepoPath is a pure, deterministic function — same input always yields the same output', () => {
  const p = 'sfdx-source/CMPL123/main/ai-text-summarization/lwc/textSummarizationRelationshipConfiguration/textSummarizationRelationshipConfiguration.html';
  assert.equal(slugifyRepoPath(p), slugifyRepoPath(p));
});

// The actual regression this fix exists for: two real sibling paths from the
// bug report, sharing a common prefix well past 120 characters, must resolve
// to two DIFFERENT filenames.
test('slugifyRepoPath gives two different long sibling paths two different filenames (the actual collision bug)', () => {
  const a = 'sfdx-source/CMPL123/main/ai-text-summarization/lwc/textSummarizationRelationshipConfiguration/textSummarizationRelationshipConfiguration.html';
  const b = 'sfdx-source/CMPL123/main/ai-text-summarization/lwc/textSummarizationRelationshipConfiguration/textSummarizationRelationshipConfiguration.js';
  const c = 'sfdx-source/CMPL123/main/ai-text-summarization/lwc/textSummarizationRelationshipConfiguration/textSummarizationRelationshipConfiguration.js-meta.xml';
  const slugs = new Set([slugifyRepoPath(a), slugifyRepoPath(b), slugifyRepoPath(c)]);
  assert.equal(slugs.size, 3, 'each distinct long path must produce a distinct slug');
});

test('slugifyRepoPath gives two paths differing only near the very end (past a long common prefix) different filenames', () => {
  const a = 'sfdx-source/CMPL123/main/report-template/lwc/completedReportsGenerationStatusTable/__tests__/data/completedReportsMockWith4Records.json';
  const b = 'sfdx-source/CMPL123/main/report-template/lwc/completedReportsGenerationStatusTable/__tests__/data/completedReportsMockWith8Records.json';
  assert.notEqual(slugifyRepoPath(a), slugifyRepoPath(b));
});

test('slugifyRepoPath keeps every filename under a safe length bound regardless of input length', () => {
  const veryLong = 'a/'.repeat(100) + 'file.js'; // absurdly deep path
  assert.ok(slugifyRepoPath(veryLong).length <= 120, `expected a bounded slug, got ${slugifyRepoPath(veryLong).length} chars`);
});

test('slugifyRepoPath never produces an empty string', () => {
  assert.ok(slugifyRepoPath('').length > 0);
  assert.ok(slugifyRepoPath('///').length > 0);
});

// groupIntoModules: the mechanism that keeps digest-mode output from scaling
// 1:1 with file count. A repo with 10 files and a repo with 10,000 files
// both produce a small, BOUNDED number of module groups — just larger ones
// for the bigger repo, up to a hard cap — rather than more and more of them.
// Found necessary after a real clip-gh run against a ~10k-file Salesforce
// repo produced 5,118 separate clipping files, one per source file, which
// flooded the vault's orphan/graph view before anything had a chance to be
// ingested and cross-linked.
test('groupIntoModules returns a single root group when everything fits under the per-group cap', () => {
  const paths = ['README.md', 'src/main.js', 'src/util.js'];
  const groups = groupIntoModules(paths, { maxFilesPerGroup: 10, maxGroups: 60 });
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].files.slice().sort(), paths.slice().sort());
});

test('groupIntoModules splits by top-level directory once the root group exceeds the per-group cap', () => {
  const paths = ['a/1.js', 'a/2.js', 'a/3.js', 'b/1.js', 'b/2.js', 'b/3.js'];
  const groups = groupIntoModules(paths, { maxFilesPerGroup: 3, maxGroups: 60 });
  assert.equal(groups.length, 2);
  const byName = Object.fromEntries(groups.map((g) => [g.name, g.files.length]));
  assert.equal(byName['a'], 3);
  assert.equal(byName['b'], 3);
});

test('groupIntoModules recurses more than one level when a top-level directory is itself still too large', () => {
  const paths = [
    'src/mod-a/1.js', 'src/mod-a/2.js', 'src/mod-a/3.js',
    'src/mod-b/1.js', 'src/mod-b/2.js', 'src/mod-b/3.js',
  ];
  const groups = groupIntoModules(paths, { maxFilesPerGroup: 3, maxGroups: 60 });
  const names = groups.map((g) => g.name).sort();
  assert.deepEqual(names, ['src/mod-a', 'src/mod-b']);
});

// The most important invariant: grouping must never lose or duplicate a
// file. This is the same class of bug slugifyRepoPath's own tests guard
// against (silent data loss), just one layer up — at the grouping level
// instead of the filename level.
test('groupIntoModules never loses or duplicates a file, across every group combined', () => {
  const paths = [];
  for (let i = 0; i < 500; i++) paths.push(`pkg${i % 20}/file${i}.js`);
  const groups = groupIntoModules(paths, { maxFilesPerGroup: 40, maxGroups: 60 });
  const allFiles = groups.flatMap((g) => g.files).sort();
  assert.deepEqual(allFiles, paths.slice().sort());
});

test('groupIntoModules keeps files that sit directly in a directory (not lost to its subdirectories)', () => {
  const paths = ['mod/loose.js', 'mod/sub/a.js', 'mod/sub/b.js'];
  const groups = groupIntoModules(paths, { maxFilesPerGroup: 1, maxGroups: 60 });
  const allFiles = groups.flatMap((g) => g.files).sort();
  assert.deepEqual(allFiles, paths.slice().sort());
});

test('groupIntoModules never exceeds maxGroups, even for a huge, wide input', () => {
  const paths = [];
  for (let i = 0; i < 5000; i++) paths.push(`dir${i}/file.js`); // 5000 distinct top-level dirs
  const groups = groupIntoModules(paths, { maxFilesPerGroup: 150, maxGroups: 60 });
  assert.ok(groups.length <= 60, `expected at most 60 groups, got ${groups.length}`);
  const allFiles = groups.flatMap((g) => g.files).sort();
  assert.deepEqual(allFiles, paths.slice().sort(), 'no files lost even when the cap forces oversized groups');
});

test('groupIntoModules stops descending at maxDepth even if a group is still oversized', () => {
  // A pathologically deep, narrow tree: one file per level, 10 levels deep.
  const paths = [];
  for (let i = 0; i < 10; i++) paths.push(Array.from({ length: i + 1 }, (_, j) => `d${j}`).join('/') + '/file.js');
  const groups = groupIntoModules(paths, { maxFilesPerGroup: 1, maxGroups: 60, maxDepth: 3 });
  const allFiles = groups.flatMap((g) => g.files).sort();
  assert.deepEqual(allFiles, paths.slice().sort(), 'still no files lost, even though some groups stay over cap');
  for (const g of groups) {
    const depth = g.name === '' ? 0 : g.name.split('/').length;
    assert.ok(depth <= 3, `group "${g.name}" exceeded maxDepth (depth ${depth})`);
  }
});

test('groupIntoModules is a pure function — same input always yields the same grouping', () => {
  const paths = ['a/1.js', 'a/2.js', 'a/3.js', 'b/1.js', 'b/2.js'];
  const g1 = groupIntoModules(paths, { maxFilesPerGroup: 2, maxGroups: 60 });
  const g2 = groupIntoModules(paths, { maxFilesPerGroup: 2, maxGroups: 60 });
  assert.deepEqual(g1, g2);
});

test('groupIntoModules returns an empty array for an empty input, not an error', () => {
  assert.deepEqual(groupIntoModules([], { maxFilesPerGroup: 10, maxGroups: 60 }), []);
});

// moduleListingContent: one digest-mode "listing" document per module group —
// a table of file path/size/language, never file CONTENT. This is the
// "listings" half of "some combination of listings and summary" digest
// output: cheap, mechanical, and safe to produce for every module without
// reading or judging file content, unlike the "summary" half (key modules,
// notable patterns), which is written separately, by hand, in a bounded,
// curated way — not mechanically generated here.
test('moduleListingContent lists every file with its size and a language hint, sorted by path', () => {
  const c = moduleListingContent({
    owner: 'octocat', repo: 'Hello-World', ref: 'abc123', moduleName: 'src/utils',
    files: [{ path: 'src/utils/b.py', size: 200 }, { path: 'src/utils/a.js', size: 100 }],
    created: '2026-08-26',
  });
  const aIdx = c.md.indexOf('src/utils/a.js');
  const bIdx = c.md.indexOf('src/utils/b.py');
  assert.ok(aIdx !== -1 && bIdx !== -1 && aIdx < bIdx, 'rows sorted alphabetically by path');
  assert.match(c.md, /100/);
  assert.match(c.md, /200/);
  assert.match(c.md, /javascript/);
  assert.match(c.md, /python/);
});

test('moduleListingContent cites the module directory tree URL, not a file blob', () => {
  const c = moduleListingContent({
    owner: 'octocat', repo: 'Hello-World', ref: 'abc123', moduleName: 'src/utils',
    files: [{ path: 'src/utils/a.js', size: 100 }], created: '2026-08-26',
  });
  assert.match(c.body, /source: "https:\/\/github\.com\/octocat\/Hello-World\/tree\/abc123\/src\/utils"/);
});

test('moduleListingContent cites the bare repo tree URL for the root module, not a trailing slash', () => {
  const c = moduleListingContent({
    owner: 'octocat', repo: 'Hello-World', ref: 'abc123', moduleName: '(root)',
    files: [{ path: 'README.md', size: 50 }], created: '2026-08-26',
  });
  assert.match(c.body, /source: "https:\/\/github\.com\/octocat\/Hello-World\/tree\/abc123"/);
  assert.doesNotMatch(c.body, /tree\/abc123\/\(root\)/);
});

test('moduleListingContent strips the "(direct files)" suffix when building the directory URL', () => {
  const c = moduleListingContent({
    owner: 'octocat', repo: 'Hello-World', ref: 'abc123', moduleName: 'src (direct files)',
    files: [{ path: 'src/index.js', size: 50 }], created: '2026-08-26',
  });
  assert.match(c.body, /source: "https:\/\/github\.com\/octocat\/Hello-World\/tree\/abc123\/src"/);
});

test('moduleListingContent reports the file count in its title', () => {
  const c = moduleListingContent({
    owner: 'o', repo: 'r', ref: 'x', moduleName: 'lib',
    files: [{ path: 'lib/a.js', size: 1 }, { path: 'lib/b.js', size: 1 }], created: '2026-08-26',
  });
  assert.match(c.title, /2/);
});

test('moduleListingContent is deterministic — same input yields byte-identical output (needed for dedup)', () => {
  const input = {
    owner: 'o', repo: 'r', ref: 'x', moduleName: 'lib',
    files: [{ path: 'lib/a.js', size: 1 }], created: '2026-08-26',
  };
  assert.equal(moduleListingContent(input).body, moduleListingContent(input).body);
});

// selectAnchorFiles: a small, bounded, DETERMINISTIC set of universally
// valuable files (README, LICENSE, top-level manifests) clipped in full even
// in digest mode — never a heuristic "biggest file" guess, which would have
// no principled basis for "important."
test('selectAnchorFiles picks README, LICENSE, and package.json from a root-level file list', () => {
  const paths = ['README.md', 'LICENSE', 'package.json', 'src/index.js', 'src/util.js'];
  const anchors = selectAnchorFiles(paths);
  assert.deepEqual(anchors.slice().sort(), ['LICENSE', 'README.md', 'package.json'].sort());
});

test('selectAnchorFiles matches case-insensitively and common variant basenames', () => {
  const paths = ['readme.rst', 'Licence.txt', 'CHANGELOG.md'];
  const anchors = selectAnchorFiles(paths);
  assert.equal(anchors.length, 3);
});

test('selectAnchorFiles does not pick ordinary source files', () => {
  const paths = ['src/index.js', 'src/util.js', 'test/index.test.js'];
  assert.deepEqual(selectAnchorFiles(paths), []);
});

test('selectAnchorFiles stays bounded even with many monorepo-style candidates', () => {
  const paths = [];
  for (let i = 0; i < 100; i++) paths.push(`packages/pkg${i}/README.md`);
  const anchors = selectAnchorFiles(paths, { maxAnchors: 10 });
  assert.ok(anchors.length <= 10);
});

test('selectAnchorFiles excludes anchor-named files buried too deep to be a real repo-level anchor', () => {
  const paths = ['a/b/c/d/e/README.md'];
  assert.deepEqual(selectAnchorFiles(paths), []);
});

test('selectAnchorFiles returns an empty array, not an error, when nothing matches', () => {
  assert.deepEqual(selectAnchorFiles([]), []);
});

// digestManifestContent: the manifest half of digest mode. Composition and
// module-group TOTALS, never a per-file bullet list — that would itself
// scale 1:1 with file count, the exact property digest mode exists to avoid.
test('digestManifestContent shows composition (extension counts) and module groups, not a per-file listing', () => {
  const manyFiles = [];
  for (let i = 0; i < 500; i++) manyFiles.push(`pkg${i % 10}/file${i}.js`);
  const groups = groupIntoModules(manyFiles, { maxFilesPerGroup: 60, maxGroups: 60 });
  const c = digestManifestContent({
    owner: 'o', repo: 'r', ref: 'sha', description: 'A big repo', primaryLanguage: 'JavaScript',
    totalIncluded: manyFiles.length, moduleGroups: groups, extensionCounts: { '.js': 500 },
    excludedCount: 12, anchorFiles: ['README.md'], created: '2026-08-26',
  });
  assert.match(c.md, /500/); // total file count is stated
  assert.match(c.md, /\.js/); // composition table shows the extension
  assert.doesNotMatch(c.md, /pkg0\/file0\.js/, 'must not enumerate individual files — that scales 1:1');
  assert.match(c.md, /README\.md/); // anchor files ARE named individually (small, bounded)
});

test('digestManifestContent handles a missing description gracefully', () => {
  const c = digestManifestContent({
    owner: 'o', repo: 'r', ref: 'sha', description: null, primaryLanguage: null,
    totalIncluded: 1, moduleGroups: [{ name: '(root)', files: ['a.txt'] }], extensionCounts: { '.txt': 1 },
    excludedCount: 0, anchorFiles: [], created: '2026-08-26',
  });
  assert.doesNotMatch(c.body, /null/);
});

test('digestManifestContent is deterministic — same input yields byte-identical output', () => {
  const input = {
    owner: 'o', repo: 'r', ref: 'sha', description: 'x', primaryLanguage: 'Go',
    totalIncluded: 1, moduleGroups: [{ name: '(root)', files: ['a.go'] }], extensionCounts: { '.go': 1 },
    excludedCount: 0, anchorFiles: [], created: '2026-08-26',
  };
  assert.equal(digestManifestContent(input).body, digestManifestContent(input).body);
});

