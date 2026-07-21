import { buildNameIndex, resolveLinkTarget } from './graph.mjs';

// Images stay in the vault (rendered content, not a source doc). Everything else
// non-`.md` under raw/ is a source-doc binary that must leave once its content is
// captured. `.pdf`/`.doc(x)` extract cleanly; `.xlsx`/`.zip`/others have no clean
// text extractor and are held for triage rather than stranding their content.
const IMAGE = /\.(png|jpe?g|gif|svg|webp|bmp|tiff?|ico|avif)$/i;
const EXTRACTABLE = /\.(pdf|docx?)$/i;

// Normalize a filename to a title key: drop the `-<hash7>` clip suffix, drop the
// extension, and collapse to lowercase alphanumerics — so a binary and its `.md`
// twin (`X.pdf` ↔ `X-<hash7>.md`) map to the same key.
const norm = (s) =>
  s.toLowerCase().replace(/-[0-9a-f]{7}(-\d+)?$/, '').replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, ' ').trim();

export function planBinaryMigration({ pages }) {
  const byName = buildNameIndex(pages);

  // Normalized names of every raw `.md` clipping — "content already captured".
  const clipNorms = new Set();
  for (const p of pages) {
    if (p.path.startsWith('raw/') && p.path.endsWith('.md')) clipNorms.add(norm(p.name));
  }

  // Which wiki/sources pages cite each raw binary (so an extract can repoint them).
  const citersOf = new Map();
  for (const p of pages) {
    if (!p.path.startsWith('wiki/sources/')) continue;
    for (const t of [...p.outTargets, ...(p.fmTargets ?? [])]) {
      const tgt = resolveLinkTarget(byName, t);
      if (tgt && tgt.startsWith('raw/') && !tgt.endsWith('.md')) {
        if (!citersOf.has(tgt)) citersOf.set(tgt, []);
        citersOf.get(tgt).push({ page: p.path, target: t });
      }
    }
  }

  const plan = { moveOnly: [], extract: [], blocked: [] };
  for (const p of pages) {
    if (!p.path.startsWith('raw/') || p.path.endsWith('.md') || IMAGE.test(p.path)) continue;
    const base = p.path.split('/').pop();
    const citers = citersOf.get(p.path) || [];
    if (clipNorms.has(norm(base))) plan.moveOnly.push({ binary: p.path, citers });
    else if (EXTRACTABLE.test(base)) plan.extract.push({ binary: p.path, citers });
    else plan.blocked.push({ binary: p.path, reason: 'no clean extractor', citers });
  }
  return plan;
}
