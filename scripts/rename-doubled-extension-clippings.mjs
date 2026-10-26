// Rename the raw clippings whose names double the extension (`README.md.md`, `SKILL.md.md`) and repoint
// the citations to them. Same contract as rename-unsafe-clippings.mjs (0.53.0): a dry run first, the file
// bytes and `source-hash` untouched, only full-path wikilinks repointed, `raw/` and `log/` never rewritten,
// a rename onto an existing name refused, pages rewritten before files so an interrupted run is finished
// by running it again.
//
//   - a `clip-gh` clipping (raw/clippings/gh/<owner>/<repo>/...) loses its second `.md`;
//   - a top-level clipping from clip.mjs with an empty title is renamed from its source URL, nearest
//     folder first, as new clips are (lib/clip-slug.mjs).
//
//   node scripts/rename-doubled-extension-clippings.mjs --list-out review.tsv     # dry run, full listing
//   node scripts/rename-doubled-extension-clippings.mjs --apply --paths-out ledger.json
//   add --flag=<prefix> to list, and --exclude=<prefix> to leave unrewritten, pages whose citations an app
//   reads by title (both repeatable)
//
// A link written as a bare name (`[[README.md]]`) is not rewritten: it resolves by name and is not tied to
// a path. An app that loads a cited title as `raw/clippings/<title>.md` is the reason for --flag and
// --exclude: name its pages and decide before applying.
import { openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renameClippings, runRenameCli } from './rename-unsafe-clippings.mjs';
import { planDoubledExtensionRenames } from './lib/clip-rename-plan.mjs';
import { cliGuard } from './lib/cli-guard.mjs';
cliGuard(import.meta.url);

// The title and source of a clipping, from the head of its file.
function headOf(vaultPath, rel) {
  const buf = Buffer.alloc(8192);
  let head = '';
  try {
    const fd = openSync(join(vaultPath, ...rel.split('/')), 'r');
    try { head = buf.toString('utf8', 0, readSync(fd, buf, 0, buf.length, 0)); } finally { closeSync(fd); }
  } catch { return { title: '', source: '' }; }
  const value = (key) => {
    let v = head.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'))?.[1]?.trim() ?? '';
    if (v.startsWith('"')) { try { v = JSON.parse(v); } catch { /* keep the raw text */ } }
    return String(v).trim();
  };
  return { title: value('title'), source: value('source') };
}

export function renameDoubledExtensionClippings(vaultPath, options = {}) {
  return renameClippings(vaultPath, {
    mentionStems: false,
    ...options,
    plan: (rawFiles) => planDoubledExtensionRenames(rawFiles, { headOf: (rel) => headOf(vaultPath, rel) }),
  });
}

export function main(argv = process.argv.slice(2)) {
  return runRenameCli(argv, { type: 'rename-doubled-extension-clippings', run: renameDoubledExtensionClippings });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
