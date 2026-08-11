// Mechanical extraction of a monolithic roadmap's top-level items into individually-addressable
// backlog items. See docs/superpowers/specs/2026-08-11-authored-project-structure-v2-design.md
// §4. Pure, I/O-free — the CLI script (scripts/backlog-split.mjs, when written) owns file I/O.
//
// Deliberately mechanical, not a rewrite: a parser that locates and cuts each item's EXISTING
// text cannot drop a PR number or alter a verbatim quote the way a manual transcription risks.
// It moves bytes; it never rewrites them.

// wiki/authored/'s own filename convention (sparta-migrator-roadmap.md, ...) is all-lowercase,
// hyphenated — distinct from clip.mjs's slugify, which preserves case/spaces for raw-clipping
// filenames (confirmed NOT a match for this convention before writing a separate function).
export function slugifyKebab(text) {
  const s = (text || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return s || 'untitled';
}

// Every item in the real source file self-annotates with an inline marker near its start —
// scanning is bounded to a PREFIX (not the whole body) so a later, unrelated mention deep in a
// long item's own text cannot cause a false status match. Confirmed necessary by reading real
// 100+-line items that reference other (already-shipped) work in passing.
const SCAN_PREFIX_LEN = 200;

export function inferBacklogStatus(itemText, sectionDefault) {
  const prefix = (itemText || '').slice(0, SCAN_PREFIX_LEN);
  if (prefix.includes('✅')) return 'shipped';
  if (prefix.includes('🚧')) return 'in-progress';
  if (prefix.includes('📐') || prefix.includes('⚠️')) return 'planned';
  return sectionDefault ?? 'planned';
}

// A recognized status emoji leading the item's FIRST bold span. Two real shapes coexist in the
// source: (a) "**Title** — ✅ done" — the marker sits AFTER the bold span, so the span content
// is already the clean title; (b) "**✅ SHIPPED / DONE — Title.**" — the marker sits INSIDE the
// span, ahead of the real title, sometimes with a second "— clarifying clause —" before the
// real title (e.g. "✅ NOT A BUG — verified and closed (no code change) — <real title>"). Taking
// the LAST " — "-separated segment of the span handles both the single- and double-dash cases
// uniformly, verified against every real example before settling on this rule.
const MARKER_EMOJI = ['✅', '🚧', '📐', '⚠️'];

export function deriveTitle(itemText) {
  const bold = (itemText || '').match(/\*\*([\s\S]+?)\*\*/);
  const rawSpan = bold ? bold[1] : (itemText || '');
  // Source lines wrap at ~72 chars — a bold span can carry a newline+indent right where a
  // plain-text " — " split expects a single space. Collapse ALL whitespace runs (not just
  // trim) before any marker detection or splitting, so a wrapped span behaves identically to
  // an unwrapped one.
  const span = rawSpan.replace(/\s+/g, ' ').trim();
  const startsWithMarker = MARKER_EMOJI.some((e) => span.startsWith(e));
  const segments = span.split(' — ');
  const title = startsWithMarker && segments.length > 1 ? segments[segments.length - 1] : span;
  return title.trim().replace(/\.$/, '');
}

// Splits body text on TOP-LEVEL list markers only — a line starting at column 0 with `- ` or
// `<digits>. `. An indented/nested marker (e.g. the real file's 3-sub-part scratch-org item)
// is NOT a split point and stays inside its parent's extracted text, matching the source
// document's own nesting.
const TOP_LEVEL_MARKER = /^(?:-|\d+\.) /;

function sectionBody(body, sectionName) {
  const headingRe = new RegExp(`^## ${sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm');
  const m = headingRe.exec(body);
  if (!m) return null;
  const start = m.index + m[0].length;
  const rest = body.slice(start);
  const next = rest.search(/^## /m);
  return next === -1 ? rest : rest.slice(0, next);
}

function topLevelItems(sectionText) {
  const lines = sectionText.split('\n');
  const items = [];
  let current = null;
  for (const line of lines) {
    if (TOP_LEVEL_MARKER.test(line)) {
      if (current !== null) items.push(current.join('\n'));
      current = [line];
    } else if (current !== null) {
      current.push(line);
    }
  }
  if (current !== null) items.push(current.join('\n'));
  return items.map((t) => t.trim()).filter(Boolean);
}

export function splitRoadmapItems({ body, sections }) {
  const out = [];
  const seenSlugs = new Set();
  for (const sectionName of sections) {
    const text = sectionBody(body, sectionName);
    if (text === null) continue;
    for (const raw of topLevelItems(text)) {
      const title = deriveTitle(raw);
      const status = inferBacklogStatus(raw, /blocked/i.test(sectionName) ? 'blocked' : null);
      let slug = slugifyKebab(title);
      // Titles are usually unique in practice, but guarantee it rather than assume it — a
      // silent slug collision would silently overwrite one item's file with another's.
      let n = 2;
      while (seenSlugs.has(slug)) slug = `${slugifyKebab(title)}-${n++}`;
      seenSlugs.add(slug);
      out.push({ title, status, slug, body: raw });
    }
  }
  return out;
}
