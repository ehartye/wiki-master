import { existsSync, writeFileSync, readdirSync, statSync, readFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join, extname, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { loadDeclines, isDeclined, recordDecline } from './lib/decline.mjs';
import { slugify, buildFrontmatter } from './clip.mjs';
import { parseTopicArg } from './lib/topic.mjs';

const THIN_WORD_FLOOR = 20; // lower than the prose clippers' 100 — a small
// real source file (a config, a short script) is still worth a clipping.
const DEFAULT_MAX_FILES = 300;
const DEFAULT_MAX_FILE_SIZE = 256 * 1024;

function wordCount(md) { return (md.match(/\S+/g) || []).length; }
function today() { return new Date().toISOString().slice(0, 10); }

// A GitHub repo is pasted in every shape a user has ever copied one in:
// bare `owner/repo`, a full https URL (`.git` suffix optional), or an ssh
// remote (`git@github.com:owner/repo.git`). All four resolve to the same
// identity, so the rest of the pipeline only has to handle one shape.
export function parseRepoSpec(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  let m = /^([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(s);
  if (m && !s.includes('://') && !s.includes('@')) return { owner: m[1], repo: m[2] };
  m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(s);
  if (m) return { owner: m[1], repo: m[2] };
  m = /^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(s);
  if (m) return { owner: m[1], repo: m[2] };
  return null;
}

// "Don't clip the whole repo contents" starts here. Three curated,
// name-based lists (never full .gitignore parsing — that's a much bigger
// job for marginal extra precision) plus a size ceiling: dependency/build
// directories at any depth, binary/media/archive/compiled extensions, and
// generated lockfiles by exact basename. `.github/` is deliberately NOT a
// blanket-excluded dot-directory — CI workflow config is real, clippable
// content; only the specific named directories below are excluded.
const EXCLUDED_DIRS = new Set([
  '.git', 'node_modules', 'vendor', 'dist', 'build', 'target', '.venv', 'venv',
  '__pycache__', '.next', '.nuxt', 'coverage', '.terraform', 'bower_components',
]);
const EXCLUDED_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svg',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.zip', '.tar', '.gz', '.tgz', '.rar', '.7z',
  '.exe', '.dll', '.so', '.dylib', '.class', '.pyc', '.o', '.a', '.jar', '.war', '.whl',
  '.mp3', '.mp4', '.wav', '.avi', '.mov', '.mkv',
  '.pdf', '.db', '.sqlite', '.sqlite3', '.bin',
]);
const EXCLUDED_BASENAMES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'Cargo.lock',
  'poetry.lock', 'Gemfile.lock', 'composer.lock', 'go.sum',
]);

export function shouldExcludePath(relPath, { size = 0, maxSize = DEFAULT_MAX_FILE_SIZE } = {}) {
  const segments = relPath.split('/');
  const basename = segments[segments.length - 1];
  if (segments.slice(0, -1).some((d) => EXCLUDED_DIRS.has(d))) {
    return { excluded: true, reason: 'dependency/build directory' };
  }
  if (EXCLUDED_BASENAMES.has(basename)) return { excluded: true, reason: 'generated lockfile' };
  const ext = extname(basename).toLowerCase();
  if (EXCLUDED_EXTENSIONS.has(ext)) return { excluded: true, reason: 'binary/media/archive extension' };
  if (size > maxSize) return { excluded: true, reason: `too large (${size} bytes > ${maxSize})` };
  return { excluded: false, reason: null };
}

export function githubBlobUrl(owner, repo, ref, relPath) {
  return `https://github.com/${owner}/${repo}/blob/${ref}/${relPath}`;
}

// Small, deliberately non-exhaustive lookup — enough for a fenced code block
// to get real syntax highlighting on the languages this vault's own research
// has actually clipped (Java, Python, JS/TS, and the usual config formats).
// Falls back to no language hint rather than guessing.
const LANGUAGE_BY_EXT = {
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'jsx',
  '.ts': 'typescript', '.tsx': 'tsx',
  '.py': 'python', '.rb': 'ruby', '.go': 'go', '.rs': 'rust',
  '.java': 'java', '.kt': 'kotlin', '.swift': 'swift', '.c': 'c', '.h': 'c',
  '.cpp': 'cpp', '.cc': 'cpp', '.hpp': 'cpp', '.cs': 'csharp', '.php': 'php',
  '.sh': 'bash', '.bash': 'bash', '.ps1': 'powershell',
  '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml', '.xml': 'xml',
  '.html': 'html', '.css': 'css', '.scss': 'scss', '.sql': 'sql', '.graphql': 'graphql',
  '.dockerfile': 'dockerfile', '.tf': 'hcl', '.proto': 'protobuf',
};
export function languageHintForExt(ext) { return LANGUAGE_BY_EXT[ext.toLowerCase()] || ''; }

// clip-gh writes one clipping PER REPO FILE, so its output filename is
// derived from a full, sometimes deeply-nested repo-relative PATH — not a
// short human title. clip.mjs's shared `slugify()` (built for article
// titles) blindly truncates to 120 characters, which is unsafe here: a real
// ~10k-file Salesforce DX repo had many sibling files sharing one long
// directory prefix and differing only in their last few characters
// (`Foo.js` vs `Foo.html` vs `Foo.js-meta.xml`, or
// `...MockWith4Records.json` vs `...MockWith8Records.json`) — truncating at
// a fixed length collapsed every one of them to an IDENTICAL filename, and
// each subsequent write silently overwrote the file written before it.
// Confirmed against the real repo: 49 files silently lost in one run.
//
// Same character-substitution rule as `slugify()` (duplicated, not
// imported, so a future change to clip.mjs's title-slugging behavior can't
// silently change file-naming here), but the truncation ceiling is much
// longer, and — critically — when a path DOES exceed it, a short hash of
// the FULL original path (not the truncated remainder) is appended, so any
// two paths differing anywhere — even only in their last few characters —
// still resolve to different filenames. A pure function of relPath alone
// (no dependency on write order or which sibling files exist), so
// re-running against an unchanged repo always maps one source file to the
// same output filename every time — required for dedup to keep working.
const REPO_SLUG_SAFE_LENGTH = 100;
export function slugifyRepoPath(relPath) {
  const s = String(relPath || '')
    .replace(/[\\/:*?"<>|#^[\]]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .trim()
    .replace(/[-\s]+$/, '');
  if (s.length <= REPO_SLUG_SAFE_LENGTH) return s || 'untitled';
  const digest = createHash('sha256').update(String(relPath)).digest('hex').slice(0, 12);
  return `${s.slice(0, REPO_SLUG_SAFE_LENGTH - digest.length - 1)}-${digest}`;
}

// Build one file's clipping. Pure: no IO, no git, no gh — the testable core.
// A `.md` file is stored AS-IS, never re-fenced (fencing a markdown file
// would nest its own headings and code fences inside an outer fence and
// break both); every other file is wrapped in a language-hinted fence so it
// reads as quotable source, not accidental prose, mirroring how this vault's
// earlier GitHub source-file clips (e.g. the Data 360 MCP server's Java
// files) already read.
export function fileClipContent({ owner, repo, ref, relPath, content, quality = 'medium', created = today(), topic } = {}) {
  const source = githubBlobUrl(owner, repo, ref, relPath);
  const title = `${repo}/${relPath} at ${ref}`;
  const raw = String(content || '').replace(/\r\n/g, '\n');
  const isMarkdown = /\.mdx?$/i.test(relPath);
  const lang = languageHintForExt(extname(relPath));
  const md = isMarkdown ? raw.trim() : `\`\`\`${lang}\n${raw.replace(/\n+$/, '')}\n\`\`\``;
  const hash = createHash('sha256').update(md).digest('hex');
  const fm = buildFrontmatter({ title, source, created, quality, hash, topic });
  return { md, wordCount: wordCount(raw), hash, body: `${fm}\n\n${md}\n`, title, source };
}

// The one clipping that represents the REPO itself, not a file in it — cites
// the repo tree (not a blob), and is the natural entry point /wiki-ingest
// reaches for first when summarizing the whole clone into wiki/sources/.
export function repoManifestContent({ owner, repo, ref, description, primaryLanguage, includedPaths = [], excludedCount = 0, quality = 'medium', created = today(), topic } = {}) {
  const source = `https://github.com/${owner}/${repo}/tree/${ref}`;
  const title = `${owner}/${repo} at ${ref}`;
  const lines = [
    `# ${owner}/${repo}`,
    '',
    description ? description : '_(no description)_',
    '',
    `- **Primary language:** ${primaryLanguage || 'unknown'}`,
    `- **Ref clipped:** \`${ref}\``,
    `- **Files included:** ${includedPaths.length}`,
    `- **Files excluded (dependency/build/binary/oversized):** ${excludedCount}`,
    '',
    '## Included files',
    '',
    ...includedPaths.map((p) => `- \`${p}\``),
  ];
  const md = lines.join('\n').trim();
  const hash = createHash('sha256').update(md).digest('hex');
  const fm = buildFrontmatter({ title, source, created, quality, hash, topic });
  return { md, wordCount: wordCount(md), hash, body: `${fm}\n\n${md}\n`, title, source };
}

// A module's directory path for URL/citation purposes: strip groupIntoModules'
// own display decorations ('(root)' and the ' (direct files)' suffix) back
// down to a real repo-relative path (or '' for the root, which must not grow
// a trailing slash on the tree URL below).
function moduleDirPath(moduleName) {
  return moduleName.replace(/ \(direct files\)$/, '').replace(/^\(root\)$/, '');
}

// One digest-mode "listing" per module group — the mechanical, no-judgment
// half of "some combination of listings and summary" (see main()'s digest
// branch and groupIntoModules' own comment for why groups are bounded, not
// 1:1 with file count). A table of path/size/language per file, NEVER file
// content: cheap and safe to generate for every module without reading or
// interpreting what any file actually does. Cites the module's own directory
// tree URL, not a blob — mirrors repoManifestContent citing the repo tree
// rather than a file for the same reason (this represents a whole directory,
// not one file in it).
export function moduleListingContent({ owner, repo, ref, moduleName, files = [], quality = 'medium', created = today(), topic } = {}) {
  const dirPath = moduleDirPath(moduleName);
  const source = `https://github.com/${owner}/${repo}/tree/${ref}${dirPath ? `/${dirPath}` : ''}`;
  const title = `${repo}/${moduleName} at ${ref} (${files.length} file${files.length === 1 ? '' : 's'})`;
  const sorted = files.slice().sort((a, b) => a.path.localeCompare(b.path));
  const lines = [
    `# ${moduleName}`,
    '',
    `${files.length} file${files.length === 1 ? '' : 's'} in this module. Listing only — see individual clippings`,
    'for full content where one exists.',
    '',
    '| File | Size (bytes) | Language |',
    '| --- | --- | --- |',
    ...sorted.map((f) => `| \`${f.path}\` | ${f.size ?? ''} | ${languageHintForExt(extname(f.path)) || ''} |`),
  ];
  const md = lines.join('\n').trim();
  const hash = createHash('sha256').update(md).digest('hex');
  const fm = buildFrontmatter({ title, source, created, quality, hash, topic });
  return { md, wordCount: wordCount(md), hash, body: `${fm}\n\n${md}\n`, title, source };
}

// Universally valuable files worth clipping in FULL even in digest mode —
// never a heuristic "biggest file" or "most-referenced file" guess, which
// would have no principled basis for "important" and could easily be wrong.
// Matched by exact/variant basename only, and only within a shallow depth
// (repo root, or one level of monorepo-style package nesting) — a
// coincidentally anchor-named file buried deep in the tree is not a
// repo-level anchor. `maxAnchors` keeps even a monorepo with hundreds of
// packages (each with its own README) from producing hundreds of full clips.
const ANCHOR_BASENAME_RE = [
  /^readme(\.[a-z0-9]+)?$/i,
  /^licen[cs]e(\.[a-z0-9]+)?$/i,
  /^changelog(\.[a-z0-9]+)?$/i,
  /^contributing(\.[a-z0-9]+)?$/i,
  /^package\.json$/i,
  /^sfdx-project\.json$/i,
  /^pom\.xml$/i,
  /^cargo\.toml$/i,
  /^go\.mod$/i,
  /^pyproject\.toml$/i,
  /^composer\.json$/i,
  /^gemfile$/i,
  /^build\.gradle(\.kts)?$/i,
];
const ANCHOR_MAX_DEPTH = 3; // repo root (depth 1) through one level of monorepo nesting (depth 3)

export function selectAnchorFiles(paths, { maxAnchors = 15 } = {}) {
  const matched = paths.filter((p) => {
    const segments = p.split('/');
    if (segments.length > ANCHOR_MAX_DEPTH) return false;
    return ANCHOR_BASENAME_RE.some((re) => re.test(segments[segments.length - 1]));
  });
  return matched.slice(0, maxAnchors);
}

// The digest-mode manifest — the entry point for a repo too large for a
// one-clipping-per-file digest. Reports TOTALS and bounded GROUPS (extension
// composition, module listing sizes), never a per-file bullet list: that is
// exactly the 1:1-with-file-count scaling this whole digest mode exists to
// avoid (see groupIntoModules' own comment for the incident that motivated
// it — a 5,118-file, one-clipping-per-file run that flooded a vault's
// orphan/graph view before anything had a chance to be ingested).
export function digestManifestContent({
  owner, repo, ref, description, primaryLanguage,
  totalIncluded = 0, moduleGroups = [], extensionCounts = {},
  excludedCount = 0, anchorFiles = [], quality = 'medium', created = today(), topic,
} = {}) {
  const source = `https://github.com/${owner}/${repo}/tree/${ref}`;
  const title = `${owner}/${repo} at ${ref} (digest)`;
  const extRows = Object.entries(extensionCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const moduleRows = moduleGroups.slice().sort((a, b) => b.files.length - a.files.length || a.name.localeCompare(b.name));
  const lines = [
    `# ${owner}/${repo} — digest`,
    '',
    description ? description : '_(no description)_',
    '',
    `- **Primary language:** ${primaryLanguage || 'unknown'}`,
    `- **Ref clipped:** \`${ref}\``,
    `- **Total files represented:** ${totalIncluded} (across ${moduleGroups.length} module listing${moduleGroups.length === 1 ? '' : 's'} below)`,
    `- **Files excluded (dependency/build/binary/oversized):** ${excludedCount}`,
    `- **Anchor files clipped in full:** ${anchorFiles.length}`,
    '',
    'This repo was too large for a one-clipping-per-file digest — a',
    'per-module *listing* replaces per-file clippings below, so the number',
    'of documents does not grow 1:1 with the number of source files.',
    '',
    '## Composition',
    '',
    '| Extension | Files |',
    '| --- | --- |',
    ...extRows.map(([ext, count]) => `| \`${ext || '(none)'}\` | ${count} |`),
    '',
    '## Modules',
    '',
    '| Module | Files |',
    '| --- | --- |',
    ...moduleRows.map((g) => `| \`${g.name}\` | ${g.files.length} |`),
  ];
  if (anchorFiles.length) {
    lines.push('', '## Anchor files (clipped in full)', '', ...anchorFiles.map((p) => `- \`${p}\``));
  }
  const md = lines.join('\n').trim();
  const hash = createHash('sha256').update(md).digest('hex');
  const fm = buildFrontmatter({ title, source, created, quality, hash, topic });
  return { md, wordCount: wordCount(md), hash, body: `${fm}\n\n${md}\n`, title, source };
}

function ghReachable() {
  try { execFileSync('gh', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

const DEFAULT_MAX_FILES_PER_GROUP = 150;
// 150, not the much smaller cap a first pass used: measured against the real
// repo that motivated digest mode, its two largest directories alone (a
// Salesforce metadata "main" and its mirrored "test" tree) contain 65 and 66
// real functional submodules respectively, several of which are themselves
// still large enough to need a further level of splitting. A low cap forces
// those two directories to stay as two giant, unsubdivided listings instead
// of exposing their real module boundaries — still bounded and still no
// data loss, just less useful than it could be. 150 groups against even a
// ~10k-file repo is still a ~65x reduction from one-clipping-per-file, so
// "doesn't scale 1:1" holds comfortably with real headroom to spare.
const DEFAULT_MAX_GROUPS = 150;
const DEFAULT_MAX_GROUP_DEPTH = 6;

// Splits a flat list of repo-relative paths into a BOUNDED number of named
// module groups — the mechanism that keeps digest-mode output (see main()'s
// digest branch) from scaling 1:1 with file count. A repo with 10 files and
// a repo with 10,000 files both produce a small, bounded number of listing
// documents; the bigger repo's groups are just larger, up to a hard cap,
// rather than there being more and more of them. Built after a real clip-gh
// run against a ~10k-file Salesforce repo produced 5,118 separate clipping
// files — one per source file — which flooded the vault's orphan/graph view
// before anything had a chance to be ingested and cross-linked.
//
// Starts with ONE group covering every included path. While the largest
// group still exceeds maxFilesPerGroup, and splitting it would not push the
// total group count past maxGroups, and its own depth is under maxDepth, it
// is replaced by its immediate child groups — partitioned by the next path
// segment past the group's own prefix. Files with no further segment (they
// sit directly in that directory, alongside subdirectories) collect into
// their own "(direct files)" group rather than being lost. A group that
// cannot be split any further (every file in it is already a direct child —
// no directory structure left to divide on) or whose split would breach
// maxGroups is accepted as-is, oversized: a graceful ceiling, never a silent
// file loss. (A pathological repo with thousands of same-depth sibling
// directories can still end up as one large accepted group rather than many
// small ones — bounding total group count matters more here than perfectly
// even bucketing of a shape this uncommon in real repos.)
export function groupIntoModules(paths, {
  maxFilesPerGroup = DEFAULT_MAX_FILES_PER_GROUP,
  maxGroups = DEFAULT_MAX_GROUPS,
  maxDepth = DEFAULT_MAX_GROUP_DEPTH,
} = {}) {
  if (!paths.length) return [];
  let groups = [{ prefix: '', depth: 0, files: paths.slice(), splittable: true, isDirect: false }];

  for (;;) {
    const candidates = groups.filter((g) => g.splittable && g.files.length > maxFilesPerGroup && g.depth < maxDepth);
    if (!candidates.length) break;
    candidates.sort((a, b) => b.files.length - a.files.length || a.prefix.localeCompare(b.prefix));
    const target = candidates[0];

    const prefixLen = target.prefix ? target.prefix.length + 1 : 0;
    const bySegment = new Map();
    const direct = [];
    for (const f of target.files) {
      const rest = f.slice(prefixLen);
      const slash = rest.indexOf('/');
      if (slash === -1) { direct.push(f); continue; }
      const seg = rest.slice(0, slash);
      if (!bySegment.has(seg)) bySegment.set(seg, []);
      bySegment.get(seg).push(f);
    }

    if (!bySegment.size) {
      // Every file here is already a direct child — nothing left to split on.
      target.splittable = false;
      continue;
    }
    const newCount = bySegment.size + (direct.length ? 1 : 0);
    if (groups.length - 1 + newCount > maxGroups) {
      // Splitting would breach the cap — keep this one group, oversized.
      target.splittable = false;
      continue;
    }

    const replacement = [];
    for (const [seg, files] of bySegment) {
      replacement.push({ prefix: target.prefix ? `${target.prefix}/${seg}` : seg, depth: target.depth + 1, files, splittable: true, isDirect: false });
    }
    if (direct.length) {
      replacement.push({ prefix: target.prefix, depth: target.depth, files: direct, splittable: false, isDirect: true });
    }
    groups = groups.filter((g) => g !== target).concat(replacement);
  }

  return groups
    .map((g) => ({ name: (g.prefix || '(root)') + (g.isDirect ? ' (direct files)' : ''), files: g.files }))
    .sort((a, b) => b.files.length - a.files.length || a.name.localeCompare(b.name));
}

// Every real file under `dir`, repo-relative, in a stable (sorted) order —
// so re-running against an unchanged clone always walks in the same order,
// which keeps dedup/log output deterministic across runs.
function walkRepoFiles(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git') continue;
      out.push(...walkRepoFiles(abs, base));
    } else if (entry.isFile()) {
      out.push(relative(base, abs).split(sep).join('/'));
    }
  }
  return out.sort();
}

// Digest-mode branch: instead of refusing a repo whose file count is over
// the per-file cap, write a BOUNDED set of documents that still represents
// every included file — a manifest (composition + module-group totals), one
// listing per module group (path/size/language, never content), and a full
// clip for a small, deterministic set of anchor files. See
// groupIntoModules' own comment for the incident that motivated this: a
// 5,118-file, one-clipping-per-file run against a real repo that flooded a
// vault's orphan/graph view before anything had a chance to be ingested.
// I/O glue only — every decision it makes (grouping, anchor selection,
// content shape) lives in an already-unit-tested pure function above.
function writeDigest({ owner, repo, resolvedRef, included, excluded, meta, quality, topic, outDir, tmp, maxGroups }) {
  const extensionCounts = {};
  for (const p of included) {
    const ext = extname(p).toLowerCase() || '(none)';
    extensionCounts[ext] = (extensionCounts[ext] || 0) + 1;
  }
  const groups = groupIntoModules(included, maxGroups ? { maxGroups } : undefined);
  const anchorPaths = selectAnchorFiles(included);

  const existingHashes = new Map();
  if (existsSync(outDir)) {
    for (const f of readdirSync(outDir)) {
      if (!f.endsWith('.md')) continue;
      const m = /^source-hash:\s*"?([0-9a-fA-F]{6,64})/m.exec(readFileSync(join(outDir, f), 'utf8').slice(0, 800));
      if (m) existingHashes.set(m[1].toLowerCase(), f);
    }
  }

  let listingsWritten = 0; let listingsUnchanged = 0;
  for (const g of groups) {
    const files = g.files.map((relPath) => ({ path: relPath, size: statSync(join(tmp, relPath)).size }));
    const listing = moduleListingContent({ owner, repo, ref: resolvedRef, moduleName: g.name, files, quality, topic });
    if (existingHashes.has(listing.hash)) { listingsUnchanged++; continue; }
    writeFileSync(join(outDir, `${slugifyRepoPath(`_listing-${g.name}`)}.md`), listing.body);
    listingsWritten++;
  }

  let anchorsClipped = 0; let anchorsUnchanged = 0; let anchorsThin = 0;
  for (const relPath of anchorPaths) {
    const content = readFileSync(join(tmp, relPath), 'utf8');
    const clip = fileClipContent({ owner, repo, ref: resolvedRef, relPath, content, quality, topic });
    if (clip.wordCount < THIN_WORD_FLOOR) { anchorsThin++; continue; }
    if (existingHashes.has(clip.hash)) { anchorsUnchanged++; continue; }
    writeFileSync(join(outDir, `${slugifyRepoPath(relPath)}.md`), clip.body);
    anchorsClipped++;
  }

  const manifest = digestManifestContent({
    owner, repo, ref: resolvedRef, description: meta.description, primaryLanguage: meta.primaryLanguage,
    totalIncluded: included.length, moduleGroups: groups, extensionCounts,
    excludedCount: excluded.length, anchorFiles: anchorPaths, quality, topic,
  });
  writeFileSync(join(outDir, '_repo-overview.md'), manifest.body);

  const totalDocs = 1 + listingsWritten + anchorsClipped;
  console.log(`digest mode: ${included.length} file(s) represented across ${groups.length} module listing(s) — ${owner}/${repo} was over the per-file cap`);
  console.log(`  documents written this run: ${totalDocs} (manifest: 1, listings: ${listingsWritten}, anchor clips: ${anchorsClipped})`);
  console.log(`  listings unchanged (already up to date): ${listingsUnchanged}`);
  console.log(`  anchor clips unchanged: ${anchorsUnchanged}, thin (skipped): ${anchorsThin}`);
  console.log(`  excluded (dependency/build/binary/oversized): ${excluded.length}`);
  return {
    status: 'digest', totalIncluded: included.length, moduleCount: groups.length,
    listingsWritten, listingsUnchanged, anchorsClipped, anchorsUnchanged, anchorsThin,
    excluded: excluded.length, outDir,
  };
}

export function main(argv) {
  const target = argv[0];
  if (!target || target === '--doctor') {
    if (target === '--doctor') {
      if (!ghReachable()) {
        console.log('gh CLI: NOT FOUND — install from https://cli.github.com/, then `gh auth login`.');
        return { status: 'gh-missing' };
      }
      try {
        console.log(execFileSync('gh', ['auth', 'status'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
      } catch (err) {
        console.log('gh CLI is installed but not authenticated:');
        console.log((err.stderr || err.message || '').toString().trim());
        return { status: 'gh-unauthenticated' };
      }
      return { status: 'ok' };
    }
    console.error('usage: clip-gh.mjs <owner/repo | github-url> [--ref=<branch>] [--quality=high|medium|low]');
    console.error('                        [--topic="<research topic>"] [--max-files=N] [--force-full]');
    console.error('                        [--max-groups=N]');
    console.error('                        [--decline="reason"]');
    console.error('       clip-gh.mjs --doctor   (check whether gh is installed and authenticated)');
    console.error('');
    console.error('  Clones the repo to a temp directory (never into the vault), then writes ONE');
    console.error('  clipping per included source file to raw/clippings/gh/<owner>/<repo>/ — never');
    console.error('  one giant dump of the whole repo. Excludes dependency/build directories,');
    console.error('  binaries, lockfiles, and oversized files by default.');
    console.error('');
    console.error('  A repo over the per-file cap (default 300) switches to DIGEST mode instead of');
    console.error('  refusing: a manifest + bounded per-module file listings + a small set of full');
    console.error('  anchor clips (README, LICENSE, top-level manifests), never one file per source');
    console.error('  file. Pass --force-full (with a raised --max-files) to force the old exhaustive');
    console.error('  per-file behavior on a large repo instead.');
    process.exit(2);
  }

  const spec = parseRepoSpec(target);
  if (!spec) {
    console.error(`not a recognizable GitHub repo: ${target}`);
    console.error('expected owner/repo, a github.com URL, or a git@github.com: remote');
    return { status: 'failed' };
  }
  const { owner, repo } = spec;
  const refArg = argv.find((a) => a.startsWith('--ref='));
  const ref = refArg ? refArg.split('=').slice(1).join('=') : null;
  const qArg = argv.find((a) => a.startsWith('--quality='));
  const quality = qArg ? qArg.split('=')[1] : 'medium';
  const maxFilesArg = argv.find((a) => a.startsWith('--max-files='));
  const maxFiles = maxFilesArg ? Number(maxFilesArg.split('=')[1]) : DEFAULT_MAX_FILES;
  const maxGroupsArg = argv.find((a) => a.startsWith('--max-groups='));
  const maxGroups = maxGroupsArg ? Number(maxGroupsArg.split('=')[1]) : undefined;
  const forceFull = argv.includes('--force-full');
  const topic = parseTopicArg(argv);

  const { path: vaultPath } = resolveVault();

  const declineArg = argv.find((a) => a.startsWith('--decline='));
  if (declineArg) {
    const reason = declineArg.slice('--decline='.length) || 'declined';
    recordDecline(vaultPath, `github.com/${owner}/${repo}`, reason);
    console.log(`declined (recorded): ${owner}/${repo} — ${reason}`);
    return { status: 'declined' };
  }

  const declines = loadDeclines(vaultPath);
  if (isDeclined(`github.com/${owner}/${repo}`, declines)) {
    const e = declines.find((d) => isDeclined(`github.com/${owner}/${repo}`, [d]));
    console.log(`declined previously (${e.date}: ${e.reason}): ${owner}/${repo}`);
    return { status: 'declined' };
  }

  if (!ghReachable()) {
    console.error('gh CLI not found — cannot clone. Install from https://cli.github.com/, then `gh auth login`.');
    console.error('Nothing was written; run with --doctor any time to check again.');
    return { status: 'gh-missing' };
  }

  const tmp = mkdtempSync(join(tmpdir(), 'clip-gh-'));
  try {
    const cloneArgs = ['repo', 'clone', `${owner}/${repo}`, tmp, '--', '--depth', '1'];
    if (ref) cloneArgs.push('--branch', ref);
    try {
      execFileSync('gh', cloneArgs, { stdio: 'ignore' });
    } catch (err) {
      console.error(`gh repo clone failed for ${owner}/${repo}:`);
      console.error((err.stderr || err.message || '').toString().trim());
      return { status: 'failed' };
    }

    const sha = execFileSync('git', ['-C', tmp, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const resolvedRef = ref || sha;

    let meta = { description: null, primaryLanguage: null };
    try {
      const raw = execFileSync('gh', ['repo', 'view', `${owner}/${repo}`, '--json', 'description,primaryLanguage'], { encoding: 'utf8' });
      const parsed = JSON.parse(raw);
      meta = { description: parsed.description || null, primaryLanguage: parsed.primaryLanguage?.name || null };
    } catch { /* metadata is a nice-to-have; proceed without it */ }

    const allFiles = walkRepoFiles(tmp);
    const included = [];
    const excluded = [];
    for (const relPath of allFiles) {
      const abs = join(tmp, relPath);
      const size = statSync(abs).size;
      const verdict = shouldExcludePath(relPath, { size });
      if (verdict.excluded) excluded.push({ relPath, reason: verdict.reason });
      else included.push(relPath);
    }

    const outDir = join(vaultPath, 'raw', 'clippings', 'gh', slugify(owner), slugify(repo));

    if (included.length > maxFiles) {
      if (!forceFull) {
        mkdirSync(outDir, { recursive: true });
        return writeDigest({ owner, repo, resolvedRef, included, excluded, meta, quality, topic, outDir, tmp, maxGroups });
      }
      console.error(`${included.length} includable files found — over the ${maxFiles}-file cap, and --force-full was given.`);
      console.error(`Re-run with --max-files=${included.length} (or higher) to force full per-file clipping,`);
      console.error('or drop --force-full to write a bounded digest (manifest + module listings) instead.');
      console.error('Nothing was written.');
      return { status: 'too-many-files', includedCount: included.length, maxFiles };
    }

    mkdirSync(outDir, { recursive: true });

    const existingHashes = new Map();
    if (existsSync(outDir)) {
      for (const f of readdirSync(outDir)) {
        if (!f.endsWith('.md')) continue;
        const m = /^source-hash:\s*"?([0-9a-fA-F]{6,64})/m.exec(readFileSync(join(outDir, f), 'utf8').slice(0, 800));
        if (m) existingHashes.set(m[1].toLowerCase(), f);
      }
    }

    let clipped = 0; let unchanged = 0; let thin = 0;
    for (const relPath of included) {
      const content = readFileSync(join(tmp, relPath), 'utf8');
      const clip = fileClipContent({ owner, repo, ref: resolvedRef, relPath, content, quality, topic });
      if (clip.wordCount < THIN_WORD_FLOOR) { thin++; continue; }
      if (existingHashes.has(clip.hash)) { unchanged++; continue; }
      const fileSlug = slugifyRepoPath(relPath);
      writeFileSync(join(outDir, `${fileSlug}.md`), clip.body);
      clipped++;
    }

    const manifest = repoManifestContent({
      owner, repo, ref: resolvedRef, description: meta.description, primaryLanguage: meta.primaryLanguage,
      includedPaths: included, excludedCount: excluded.length, quality, topic,
    });
    writeFileSync(join(outDir, '_repo-overview.md'), manifest.body);

    console.log(`clipped: ${clipped} file(s) to raw/clippings/gh/${slugify(owner)}/${slugify(repo)}/ (+ _repo-overview.md)`);
    console.log(`  unchanged (already clipped, same content): ${unchanged}`);
    console.log(`  thin (skipped): ${thin}`);
    console.log(`  excluded (dependency/build/binary/oversized): ${excluded.length}`);
    return { status: 'clipped', clipped, unchanged, thin, excluded: excluded.length, outDir };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
