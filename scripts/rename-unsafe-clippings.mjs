// Give raw clippings a name Obsidian will index and a wikilink can carry, and repoint
// the citations that name them. A clipping filed as `.github-workflows-build.yml.md`
// is invisible to Obsidian and to the graph walk, so every link to it is dead;
// one whose name holds a backtick cannot be linked, because a backtick pair inside
// a wikilink reads as a code span. See lib/clip-names.mjs for the naming rule.
//
// What it does, and does not:
//   - renames only `.md` files under raw/ (a state file such as
//     `raw/book-nom/.booknom-state.json` is not a clipping and stays hidden);
//   - leaves the clipping's content untouched, so its source-hash is unchanged and a
//     re-clip still sees it as current;
//   - repoints wikilinks written as a full vault path, in every page except raw/,
//     log/ (append-only history) and _templates/; a link in a code block or code span
//     is an example and stays;
//   - reports, never rewrites, any other mention of an old path;
//   - refuses a rename whose target already exists.
// The pages are rewritten before the files are renamed, so a run that stops half way
// is finished by running it again.
//
//   node scripts/rename-unsafe-clippings.mjs                              # dry run
//   node scripts/rename-unsafe-clippings.mjs --apply --paths-out ledger.json
//
// `--paths-out` writes the vault-relative paths the run changed (old names, new
// names, rewritten pages), for `op-commit --paths-file`.
import { readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { planClippingRenames, stemOf } from './lib/clip-names.mjs';
import { rewriteLinkTargets } from './lib/rewrite-links.mjs';

const SKIP_DIRS = new Set(['.git', '.obsidian', '.wiki-master', 'node_modules']);
// log/ is append-only history: it is scanned for mentions but never rewritten.
const NO_REWRITE = ['log/'];

// Unlike the graph walk, this one enters dot-prefixed names: finding them is the point.
function walkFiles(root) {
  const out = [];
  (function walk(dir, rel) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name), r); }
      else out.push(r);
    }
  })(root, '');
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The engine, shared with rename-doubled-extension-clippings.mjs. `plan(rawFiles)` decides what is renamed
// and returns { renames: [{ from, to }], refused }; the rest (repointing full-path wikilinks, pages before
// files, never raw/ or log/, a ledger) is the same for every rename. `mentionStems` also reports pages
// that name a renamed file by its extension-stripped path: right for a hidden or backtick name, noise for a
// generic one such as README.md. `exclude` lists page prefixes that are reported but not rewritten, and
// `flag` lists page prefixes to mark for a person to look at before applying.
export function renameClippings(vaultPath, {
  apply = false, plan = (rawFiles) => planClippingRenames(rawFiles), mentionStems = true, exclude = [], flag = [],
} = {}) {
  const files = walkFiles(vaultPath);
  const { renames, refused } = plan(files.filter((f) => f.startsWith('raw/')));
  const result = { renames, refused, pages: [], loose: [], paths: [], flagged: [] };
  if (!renames.length) return result;

  const mentions = new RegExp([...renames.map((r) => r.from), ...(mentionStems ? renames.map((r) => stemOf(r.from)) : [])]
    .sort((a, b) => b.length - a.length).map(escapeRe).join('|'), 'gi');
  const keep = [...NO_REWRITE, ...exclude];

  const existing = new Set(files.map((f) => f.toLowerCase()));
  const rewrites = [];
  for (const rel of files) {
    if (!rel.toLowerCase().endsWith('.md') || rel.split('/').some((seg) => seg.startsWith('.'))) continue;
    if (rel.startsWith('raw/') || rel.startsWith('_templates/')) continue;
    const text = readFileSync(join(vaultPath, rel), 'utf8');
    let after = text;
    let touched = false;
    if (!keep.some((p) => rel.startsWith(p))) {
      const r = rewriteLinkTargets(text, renames, { existing });
      if (r.count) { rewrites.push({ rel, text: r.text }); result.pages.push({ page: rel, links: r.count }); after = r.text; touched = true; }
    }
    const left = new Map();
    for (const m of after.matchAll(mentions)) left.set(m[0].toLowerCase(), (left.get(m[0].toLowerCase()) ?? 0) + 1);
    for (const [path, count] of left) result.loose.push({ page: rel, path, count });
    if (flag.some((p) => rel.startsWith(p)) && (touched || left.size)) result.flagged.push(rel);
  }

  result.paths = [...new Set([
    ...renames.flatMap((r) => [r.from, r.to]),
    ...rewrites.map((r) => r.rel),
  ])].sort();
  if (apply) {
    for (const r of rewrites) writeFileSync(join(vaultPath, r.rel), r.text);
    for (const { from, to } of renames) renameSync(join(vaultPath, from), join(vaultPath, to));
  }
  return result;
}

export function renameUnsafeClippings(vaultPath, options = {}) {
  return renameClippings(vaultPath, options);
}

// The paths with uncommitted changes in a git vault, or null when it is not one. The vault is shared:
// another writer may be editing a page this run would rewrite.
function dirtyPaths(vaultPath) {
  try {
    const out = execFileSync('git', ['-C', vaultPath, 'status', '--porcelain', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    const tokens = out.split('\0').filter(Boolean);
    const dirty = new Set();
    for (let i = 0; i < tokens.length; i++) {
      dirty.add(tokens[i].slice(3));
      if (/[RC]/.test(tokens[i].slice(0, 2))) i++; // a rename or copy is followed by its original path
    }
    return dirty;
  } catch { return null; }
}

// The command line of both rename scripts. `run(vaultPath, { apply, exclude })` does the work.
//   --apply              rename the files and repoint the links (a dry run without it)
//   --paths-out <file>   with --apply: the vault-relative paths the run changed, for op-commit --paths-file
//   --list-out <file>    every rename and repointed page as tab-separated lines, for review before applying
//   --exclude=<prefix>   a page prefix to report but not rewrite (repeatable)
//   --flag=<prefix>      a page prefix to list for review before applying (repeatable)
export function runRenameCli(argv, { type, run }) {
  const { path: vaultPath } = resolveVault();
  const apply = argv.includes('--apply');
  const fileOption = (flag) => {
    const at = argv.indexOf(flag);
    if (at < 0) return undefined;
    if (!argv[at + 1] || argv[at + 1].startsWith('--')) throw new Error(`${type}: ${flag} needs a file`);
    return argv[at + 1];
  };
  const pathsOut = fileOption('--paths-out');
  const listOut = fileOption('--list-out');
  const exclude = argv.filter((a) => a.startsWith('--exclude=')).map((a) => a.slice('--exclude='.length)).filter(Boolean);
  const flag = argv.filter((a) => a.startsWith('--flag=')).map((a) => a.slice('--flag='.length)).filter(Boolean);
  if (apply) {
    // Refuse before changing anything when a file this run would change has uncommitted changes.
    const dirty = dirtyPaths(vaultPath);
    if (dirty) {
      const blocked = run(vaultPath, { apply: false, exclude }).paths.filter((p) => dirty.has(p));
      if (blocked.length) {
        throw new Error(`${type}: refusing to apply: ${blocked.length} file(s) it would change have uncommitted changes (another writer may be editing them): ${blocked.slice(0, 10).join(', ')}${blocked.length > 10 ? ', ...' : ''}. Commit or finish those edits first; nothing was changed.`);
      }
    }
  }
  const r = run(vaultPath, { apply, exclude, flag });

  console.log(JSON.stringify({
    type, applied: apply, renames: r.renames.length, refused: r.refused.length,
    pagesRewritten: r.pages.length, linksRewritten: r.pages.reduce((n, p) => n + p.links, 0), looseReferences: r.loose.length,
    ...(r.flagged?.length ? { flaggedPages: r.flagged.length } : {}),
  }));
  for (const { from, to } of r.renames.slice(0, 12)) console.log(`  ${apply ? 'renamed' : 'would rename'} ${from}\n      -> ${to}`);
  if (r.renames.length > 12) console.log(`  ... and ${r.renames.length - 12} more (${listOut ? `all in ${listOut}` : 'use --list-out <file> for the full list'})`);
  for (const { page, links } of r.pages.slice(0, 40)) console.log(`  ${apply ? 'repointed' : 'would repoint'} ${links} link(s) in ${page}`);
  if (r.pages.length > 40) console.log(`  ... and ${r.pages.length - 40} more pages`);
  for (const f of r.refused) console.log(`  refused ${f.from}: ${f.reason}\n      -> ${f.to}`);
  if (r.flagged?.length) {
    console.log('Pages you asked to look at before applying (exclude them with --exclude=<prefix> to leave them as written):');
    for (const page of r.flagged.slice(0, 20)) console.log(`  ${page}`);
  }
  if (r.loose.length) {
    console.log('Other mentions of an old path (left as written; log/ is history, the rest is prose or code):');
    for (const { page, path, count } of r.loose.slice(0, 15)) console.log(`  ${page} x${count}: ${path}`);
    if (r.loose.length > 15) console.log(`  ... and ${r.loose.length - 15} more`);
  }
  if (listOut) {
    const lines = [...r.renames.map(({ from, to }) => `rename\t${from}\t${to}`), ...r.refused.map(({ from, to, reason }) => `refused\t${from}\t${to}\t${reason}`),
      ...r.pages.map(({ page, links }) => `repoint\t${page}\t${links}`), ...r.loose.map(({ page, path, count }) => `mention\t${page}\t${path}\t${count}`)];
    writeFileSync(listOut, `${lines.join('\n')}\n`);
  }
  if (apply && pathsOut) writeFileSync(pathsOut, `${JSON.stringify(r.paths, null, 2)}\n`);
  if (!apply) console.error('dry run — re-run with --apply to rename the files and repoint the links');
  return r;
}

export function main(argv = process.argv.slice(2)) {
  return runRenameCli(argv, { type: 'rename-unsafe-clippings', run: renameUnsafeClippings });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
