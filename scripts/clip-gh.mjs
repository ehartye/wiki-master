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

function ghReachable() {
  try { execFileSync('gh', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
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
    console.error('                        [--topic="<research topic>"] [--max-files=N] [--decline="reason"]');
    console.error('       clip-gh.mjs --doctor   (check whether gh is installed and authenticated)');
    console.error('');
    console.error('  Clones the repo to a temp directory (never into the vault), then writes ONE');
    console.error('  clipping per included source file to raw/clippings/gh/<owner>/<repo>/ — never');
    console.error('  one giant dump of the whole repo. Excludes dependency/build directories,');
    console.error('  binaries, lockfiles, and oversized files by default.');
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

    if (included.length > maxFiles) {
      console.error(`${included.length} includable files found — over the ${maxFiles}-file default cap.`);
      console.error(`Re-run with --max-files=${included.length} (or higher) to proceed, or --ref=<a smaller subtree>.`);
      console.error('Nothing was written. This vault does not clip an entire large repo silently.');
      return { status: 'too-many-files', includedCount: included.length, maxFiles };
    }

    const outDir = join(vaultPath, 'raw', 'clippings', 'gh', slugify(owner), slugify(repo));
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
      const fileSlug = slugify(relPath);
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
