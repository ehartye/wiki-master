// The plan for renaming clippings whose names double the extension (`README.md.md`). Pure: the caller
// supplies the vault's file list under raw/ and, for top-level clippings, a way to read a file's title and
// source.
//
//   - A `clip-gh` clipping lives in its own repository folder and is unique by path, so it only loses
//     the second `.md`.
//   - A top-level clipping from `clip.mjs` with an empty title has a generic name (`README.md.md`,
//     `SKILL.md.md`), so it is renamed from its source URL with the rule new clips follow
//     (lib/clip-slug.mjs): nearest folder first.
//   - Nothing is renamed onto a name that exists or that another rename in the same plan has claimed,
//     case ignored, because the vault lives on case-insensitive file systems and Obsidian resolves names
//     without case. Such a rename is refused and the file keeps its name.
import { chooseClipSlug } from './clip-slug.mjs';
import { clipSafeName } from './clip-names.mjs';

const TOP_DIR = 'raw/clippings/';

export function planDoubledExtensionRenames(paths, { headOf } = {}) {
  const taken = new Set(paths.map((p) => p.toLowerCase()));
  const renames = [];
  const refused = [];
  const doubled = paths.filter((p) => p.startsWith('raw/') && /\.md\.md$/i.test(p)).sort();
  for (const from of doubled) {
    const slash = from.lastIndexOf('/');
    const dir = from.slice(0, slash + 1);
    const base = from.slice(slash + 1);
    let newBase = null;
    const head = dir === TOP_DIR && headOf ? headOf(from) : null;
    if (head && !String(head.title ?? '').trim() && head.source) {
      const pick = chooseClipSlug({ title: '', heading: null, url: head.source, exists: (s) => taken.has(`${dir}${s}.md`.toLowerCase()) });
      if (pick.clash) { refused.push({ from, to: `${dir}${pick.existing}.md`, reason: 'no free name could be made from its source URL' }); continue; }
      newBase = `${pick.slug}.md`;
    } else {
      newBase = base.slice(0, -3);
    }
    while (/\.md\.md$/i.test(newBase)) newBase = newBase.slice(0, -3);
    const to = `${dir}${clipSafeName(newBase.replace(/\.md$/i, '')) || 'untitled'}.md`;
    if (taken.has(to.toLowerCase())) { refused.push({ from, to, reason: 'target name already exists or is claimed by another rename' }); continue; }
    taken.add(to.toLowerCase());
    renames.push({ from, to });
  }
  return { renames, refused };
}
