import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRepoSpec,
  shouldExcludePath,
  githubBlobUrl,
  languageHintForExt,
  fileClipContent,
  repoManifestContent,
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
