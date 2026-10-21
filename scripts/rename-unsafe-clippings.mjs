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

export function renameUnsafeClippings(vaultPath, { apply = false } = {}) {
  const files = walkFiles(vaultPath);
  const { renames, refused } = planClippingRenames(files.filter((f) => f.startsWith('raw/')));
  const result = { renames, refused, pages: [], loose: [], paths: [] };
  if (!renames.length) return result;

  const mentions = new RegExp([...renames.map((r) => r.from), ...renames.map((r) => stemOf(r.from))]
    .sort((a, b) => b.length - a.length).map(escapeRe).join('|'), 'gi');

  const rewrites = [];
  for (const rel of files) {
    if (!rel.toLowerCase().endsWith('.md') || rel.split('/').some((seg) => seg.startsWith('.'))) continue;
    if (rel.startsWith('raw/') || rel.startsWith('_templates/')) continue;
    const text = readFileSync(join(vaultPath, rel), 'utf8');
    let after = text;
    if (!NO_REWRITE.some((p) => rel.startsWith(p))) {
      const r = rewriteLinkTargets(text, renames);
      if (r.count) { rewrites.push({ rel, text: r.text }); result.pages.push({ page: rel, links: r.count }); after = r.text; }
    }
    const left = new Map();
    for (const m of after.matchAll(mentions)) left.set(m[0].toLowerCase(), (left.get(m[0].toLowerCase()) ?? 0) + 1);
    for (const [path, count] of left) result.loose.push({ page: rel, path, count });
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

export function main(argv = process.argv.slice(2)) {
  const { path: vaultPath } = resolveVault();
  const apply = argv.includes('--apply');
  const out = argv.indexOf('--paths-out');
  const pathsOut = out >= 0 ? argv[out + 1] : undefined;
  if (out >= 0 && !pathsOut) throw new Error('rename-unsafe-clippings: --paths-out needs a file');
  const r = renameUnsafeClippings(vaultPath, { apply });

  console.log(JSON.stringify({
    type: 'rename-unsafe-clippings', applied: apply, renames: r.renames.length, refused: r.refused.length,
    pagesRewritten: r.pages.length, linksRewritten: r.pages.reduce((n, p) => n + p.links, 0), looseReferences: r.loose.length,
  }));
  for (const { from, to } of r.renames.slice(0, 12)) console.log(`  ${apply ? 'renamed' : 'would rename'} ${from}\n      -> ${to}`);
  if (r.renames.length > 12) console.log(`  ... and ${r.renames.length - 12} more`);
  for (const { page, links } of r.pages) console.log(`  ${apply ? 'repointed' : 'would repoint'} ${links} link(s) in ${page}`);
  for (const f of r.refused) console.log(`  refused ${f.from}: ${f.reason}\n      -> ${f.to}`);
  if (r.loose.length) {
    console.log('Other mentions of an old path (left as written; log/ is history, the rest is prose or code):');
    for (const { page, path, count } of r.loose.slice(0, 15)) console.log(`  ${page} x${count}: ${path}`);
    if (r.loose.length > 15) console.log(`  ... and ${r.loose.length - 15} more`);
  }
  if (apply && pathsOut) writeFileSync(pathsOut, `${JSON.stringify(r.paths, null, 2)}\n`);
  if (!apply) console.error('dry run — re-run with --apply to rename the files and repoint the links');
  return r;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
