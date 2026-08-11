// Project-documentation grouping for wiki/authored/ pages.
//
// 34 files, two organically-formed projects, zero frontmatter signal for either --
// the only grouping cue was a string baked into each filename. `project:` and
// `kind:` give tooling something real to read. See
// docs/superpowers/specs/2026-08-11-authored-project-docs-design.md.
//
// Deliberately mirrors scripts/lib/topic.mjs's shape: pure, I/O-free, and
// normalization exists only so that "Sparta/Migrator" and "sparta / migrator"
// are one group instead of two -- never a taxonomy, never enforced at write time.
//
// Pure and I/O-free: the graph is built by the caller (scripts/lib/graph.mjs
// owns the one filesystem pass), so every grouping and ordering rule here is
// testable without a vault.

export const OTHER = 'Other';

// The organically-emerged doc-kind vocabulary (spec §5.2), in reading order --
// overview first ("start here"), roadmap and note last. Fixed, not alphabetical
// and not by count: this is a catalog a person scans for their project, not a
// ranking, and reading order is a deliberate editorial choice.
export const KIND_ORDER = [
  'overview', 'architecture', 'reference', 'guide', 'diagram', 'decision', 'roadmap', 'note',
];

export function normalizeProject(value) {
  if (typeof value !== 'string') return null;
  const t = value.trim().replace(/\s+/g, ' ');
  return t || null;
}

export function projectKey(value) {
  const p = normalizeProject(value);
  return p ? p.toLowerCase() : null;
}

// One entry per distinct `project:` value, sorted ALPHABETICALLY by key -- a
// lookup aid, not a ranking. Deliberately not count-descending like triage's
// topic chips (a filter bar, where "biggest problem first" is the right read):
// this is a catalog, and a person scanning for "my project" wants alphabetical
// order, the same reason a phone book isn't sorted by how many people call you.
// Pages with no project at all are excluded -- this module only groups what
// it's given; what "no project" means is the caller's decision, not this one's.
export function groupByProject(pages = []) {
  const groups = new Map();
  for (const p of pages) {
    const project = normalizeProject(p?.project);
    if (!project) continue;
    const key = projectKey(project);
    const g = groups.get(key);
    if (g) g.pages.push(p);
    // First spelling seen wins the display label; the key already folds case.
    else groups.set(key, { project, key, pages: [p] });
  }
  return [...groups.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

// Groups one project's pages by `kind:`, in KIND_ORDER. A page with no kind, or
// one outside the vocabulary, lands in a trailing Other bucket -- never dropped,
// never silently merged into the wrong kind (mirrors topic.mjs's Unattributed:
// a residue bucket, always last, omitted entirely when nothing needs it rather
// than shown empty).
export function groupByKind(pages = []) {
  const byKind = new Map();
  const other = [];
  for (const p of pages) {
    const kind = KIND_ORDER.includes(p?.kind) ? p.kind : null;
    if (!kind) { other.push(p); continue; }
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind).push(p);
  }
  const out = KIND_ORDER.filter((k) => byKind.has(k)).map((kind) => ({ kind, pages: byKind.get(kind) }));
  if (other.length) out.push({ kind: OTHER, pages: other });
  return out;
}

// A generated roadmap.md indexes backlog/*.md items by backlog-status, "what's live" before
// "what's done" — a reader wants in-progress/planned/blocked work first, not to scroll past a
// long shipped-item history to find it. See
// docs/superpowers/specs/2026-08-11-authored-project-structure-v2-design.md §3.
export const BACKLOG_STATUS_ORDER = ['in-progress', 'planned', 'blocked', 'shipped', 'dropped'];

// Unlike groupByKind, an item with no/unrecognized backlogStatus is simply excluded — never
// bucketed under an "Other" catch-all. A backlog item without a real status is a data-entry gap
// worth fixing at the source, not something a generated view should paper over with a vague
// bucket.
export function groupByBacklogStatus(items = []) {
  const byStatus = new Map();
  for (const it of items) {
    const status = BACKLOG_STATUS_ORDER.includes(it?.backlogStatus) ? it.backlogStatus : null;
    if (!status) continue;
    if (!byStatus.has(status)) byStatus.set(status, []);
    byStatus.get(status).push(it);
  }
  return BACKLOG_STATUS_ORDER.filter((s) => byStatus.has(s)).map((status) => ({ status, pages: byStatus.get(status) }));
}
