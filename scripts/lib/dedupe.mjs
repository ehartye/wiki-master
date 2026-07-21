import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Duplicate clippings: two files, one content-hash. A clip pass that writes
// without first asking "does the vault already hold this content?" produces
// them, and the uncited copy then reads as permanent ingest backlog.
//
// The hash is the proof of identity — bodies are identical by construction, so
// removal loses nothing. Citation is the proof of which copy the vault actually
// uses. Where those two do not settle a clear keeper, refuse and report: the
// vault deliberately holds identical clippings when one paper was bookmarked
// twice, and the summary documents that by citing every copy.

// Every clipping's recorded hash, for the pre-write check below.
export function readClippingHashes(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({
      file: `raw/clippings/${f}`,
      hash: /^source-hash:\s*"?([0-9a-fA-F]{6,64})"?/m.exec(readFileSync(join(dir, f), 'utf8').slice(0, 800))?.[1],
    }));
}

// Ask, before writing: does the vault already hold this exact content? Keyed on
// the extracted body's hash, not the binary's path — the source file may have
// moved or been renamed since it was first clipped, and a path-keyed check then
// silently re-clips it. `clippings` is [{ file, hash }].
export function existingClippingWithHash(clippings, hash) {
  if (!hash) return null; // two unknowns are not the same content
  const want = String(hash).toLowerCase();
  return clippings.find((c) => c.hash && String(c.hash).toLowerCase() === want)?.file ?? null;
}

export function planClippingDedupe(pages, isCited) {
  const groups = new Map();
  for (const p of pages) {
    if (!p.sourceHash) continue; // nothing proves these identical
    if (!groups.has(p.sourceHash)) groups.set(p.sourceHash, []);
    groups.get(p.sourceHash).push(p.path);
  }

  const remove = [];
  const refused = [];
  for (const [hash, files] of groups) {
    if (files.length < 2) continue;
    const cited = files.filter((f) => isCited(f));
    if (cited.length === files.length) {
      refused.push({ hash, files, reason: 'every copy is cited — intentional duplicate, see the page\'s dedup note' });
    } else if (cited.length === 0) {
      refused.push({ hash, files, reason: 'no copy is cited — no keeper to prove correct' });
    } else {
      remove.push(...files.filter((f) => !isCited(f)));
    }
  }
  return { remove, refused };
}
