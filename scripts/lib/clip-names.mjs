import { existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';

// A clipping's filename has to be a name Obsidian will index and a wikilink can
// carry. Two spellings break that, and both came from slugging a page title or a
// repo path verbatim:
//
//   - a leading dot (`.github-workflows-build.yml.md`). Obsidian does not index a
//     dot-prefixed file or folder, and graph.mjs skips the same names, so the
//     clipping is invisible: every link to it is dead in health and in Obsidian,
//     and an uncited one never reaches the ingest backlog.
//   - a backtick. Health reads a backtick pair inside a wikilink as an inline code
//     span and blanks it, so a link to such a file cannot resolve.
//
// Backticks are dropped; each leading dot becomes `dot-`. The result keeps every
// other character, so it is still recognisable beside the original.
export function clipSafeName(slug) {
  const s = String(slug ?? '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, (dots) => 'dot-'.repeat(dots.length))
    .replace(/[-\s]+$/, '');
  return s;
}

// The vault-wide test for a name this module would change. Takes a file or folder
// name, with or without its `.md`.
export function isUnsafeClippingName(name) {
  const stem = String(name).replace(/\.md$/i, '');
  return stem.startsWith('.') || stem.includes('`');
}

export const stemOf = (file) => file.replace(/\.md$/i, '');

// Rename plan for `paths` (vault-relative, `/`-separated, every file under raw/).
// Only `.md` clippings are planned: a non-Markdown file under raw/ (a state file
// such as `.booknom-state.json`) is not a clipping and is hidden on purpose.
// A rename is refused, never forced, when its target already exists or when two
// sources would claim the same target; case is ignored because the vault lives on
// case-insensitive filesystems and Obsidian resolves names without case.
export function planClippingRenames(paths) {
  const taken = new Set(paths.map((p) => p.toLowerCase()));
  const renames = [];
  const refused = [];
  for (const from of [...paths].sort()) {
    if (!from.toLowerCase().endsWith('.md')) continue;
    const slash = from.lastIndexOf('/');
    const dir = slash < 0 ? '' : from.slice(0, slash + 1);
    const base = from.slice(slash + 1);
    if (!isUnsafeClippingName(base)) continue;
    const safe = clipSafeName(stemOf(base));
    const to = `${dir}${safe || 'untitled'}.md`;
    if (taken.has(to.toLowerCase())) {
      refused.push({ from, to, reason: 'target name already exists or is claimed by another rename' });
      continue;
    }
    taken.add(to.toLowerCase());
    renames.push({ from, to });
  }
  return { renames, refused };
}

// clip-gh keeps one clipping per repo file at a name derived from the file's path.
// Before names were made safe, a hidden clipping sat at its legacy name; the
// current name is `clipSafeName` of it. These two helpers let a re-clip adopt the
// legacy file under its current name instead of writing a second copy beside it, or
// (in digest mode, which prunes every .md it did not just name) deleting it.
export function legacyNameMap(filenames) {
  const map = new Map();
  for (const f of filenames) {
    if (!f.toLowerCase().endsWith('.md') || !isUnsafeClippingName(f)) continue;
    map.set(`${clipSafeName(stemOf(f))}.md`.toLowerCase(), f);
  }
  return map;
}

// Rename the legacy file for `wanted` to `wanted`. Never overwrites: if `wanted`
// already exists the legacy file is left where it is.
export function adoptLegacyName(dir, legacyByWanted, wanted) {
  const legacy = legacyByWanted.get(wanted.toLowerCase());
  if (!legacy || legacy === wanted || existsSync(join(dir, wanted))) return false;
  renameSync(join(dir, legacy), join(dir, wanted));
  return true;
}
