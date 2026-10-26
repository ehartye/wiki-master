// Backfill classification for the 34 pre-existing wiki/authored/ files. See
// docs/superpowers/specs/2026-08-11-authored-project-docs-design.md §8.
//
// Pure functions over a filename (no `.md`) and, where a rule needs it, the
// page's raw body text — mirrors the rest of this repo's repair-script
// convention (e.g. scripts/lib/repoint.mjs) of operating on raw text rather
// than the parsed graph, since this is one-time classification logic specific
// to a single backfill, not a general graph-building concern.
//
// Every rule here was checked against the real 34 filenames before being
// written down (see the spec's §8 and this module's own test file, which uses
// stand-ins for the real filenames as its cases; the real project names live in the owner's wiki, not in this public repository) — nothing here is a guess extended from one
// example. Where confidence runs out, every function returns null rather than
// inventing a default: a wrong label is worse than an absent one, since it
// files a page under a heading nobody will think to double-check.

// Named to match the MOC that already exists (moc/acme-suite.md) — see the
// spec's §5.1 naming note for why the shorter, unexamined "acme" was
// rejected: it would target a NEW, different moc/acme.md and miss the hub
// that already exists.
const ACME_SUITE = 'acme-suite';
const ACME_MIGRATOR = 'acme-suite/migrator';
const PROCESSING_AGENT = 'widget-agent';
const PROCESSING_AGENT_TRANSLATION = 'widget-agent/translation';

// A handful of real files carry their own repo/topic name rather than a
// project-prefixed one — resolved by content, not filename shape, since no
// mechanical prefix rule reaches them.
const PROJECT_EXCEPTIONS = {
  'ACME-LABS-migrator-package': ACME_MIGRATOR, // its own body names it a sibling repo of acme-migrator
  'cli-local-auth-mechanics': null, // cross-cutting research, not one project's document
};

export function classifyAuthoredProject(filename) {
  if (filename in PROJECT_EXCEPTIONS) return PROJECT_EXCEPTIONS[filename];
  if (/^acme-migrator(-.*)?$/.test(filename)) return ACME_MIGRATOR;
  if (/^widget-agent-translation-/.test(filename)) return PROCESSING_AGENT_TRANSLATION;
  if (/^widget-agent-/.test(filename)) return PROCESSING_AGENT;
  if (/^acme-/.test(filename)) return ACME_SUITE;
  return null;
}

// A handful of real files need a kind resolved from their own content rather
// than any filename shape — same two exceptions as classifyAuthoredProject,
// for the same reasons (spec §8).
const KIND_EXCEPTIONS = {
  'ACME-LABS-migrator-package': 'reference', // matches the bare-overview SHAPE below, but acme-suite/migrator already has its overview (acme-migrator.md) — this is a supporting artifact, not a second front door
  'cli-local-auth-mechanics': 'note', // the escape hatch: cross-cutting research fitting no other kind
};

// Ordered filename-suffix rules — order matters only where a shorter suffix
// would otherwise shadow a longer, more specific one (diagram suffixes before
// the bare -architecture rule, most specific guide/reference lists first).
const KIND_SUFFIX_RULES = [
  [/-(architecture-diagrams|process-diagrams|diagrams)$/, 'diagram'],
  [/-(user|administrator|developer)-guide$/, 'guide'],
  [/-(configuration|skills|llm-integration|lwc|build-test|dashboards|gap-analysis|user-journeys|mission-control-redesign)$/, 'reference'],
  [/-adr$/, 'decision'],
  [/-roadmap$/, 'roadmap'],
  [/-overview$/, 'overview'],
  [/-architecture$/, 'architecture'],
];

// Every bare `<project-name>.md` with no doc-kind suffix, checked directly
// against the real vault before writing this: each one opens `# <slug>`, a
// blank line, then `## Summary` — the identical shape confirmed by reading
// acme-migrator.md in full, which is unambiguously that project's own
// overview page. Not extended from one example: verified for all seven
// acme-suite top-level apps plus acme-migrator.md itself.
const BARE_OVERVIEW_SHAPE = /^# .+\r?\n\r?\n## Summary\b/m;

export function classifyAuthoredKind(filename, body) {
  if (filename in KIND_EXCEPTIONS) return KIND_EXCEPTIONS[filename];
  for (const [re, kind] of KIND_SUFFIX_RULES) {
    if (re.test(filename)) return kind;
  }
  if (BARE_OVERVIEW_SHAPE.test(body)) return 'overview';
  return null;
}

// Nygard's own status vocabulary (proposed | accepted | superseded |
// deprecated — see the cited ADR post in the spec's §3), read from the ADR's
// own `## Status` prose via a small set of unambiguous keywords. Both real
// vault ADRs open their Status section with "Decided, done, ..." — "decided"/
// "done"/"shipped"/"merged" all read as accepted. No confident match leaves
// decision-status unset rather than guessed, matching classifyAuthoredKind's
// own discipline.
export function classifyDecisionStatus(kind, body) {
  if (kind !== 'decision') return null;
  const status = (body.match(/^## Status\r?\n\r?\n?\*\*([^*]+)\*\*/m)?.[1] ?? '').toLowerCase();
  if (/decided|done|shipped|merged|\baccepted\b/.test(status)) return 'accepted';
  if (/propos/.test(status)) return 'proposed';
  if (/supersed/.test(status)) return 'superseded';
  if (/deprecat|reject/.test(status)) return 'deprecated';
  return null;
}

// Appends project:/kind:/decision-status: at the end of the frontmatter block —
// mirrors insertSourceHash's shape in scripts/lib/backfill.mjs. Idempotent: a
// field already present is left untouched (never clobbered), and a field with
// no classified value is simply omitted rather than written as empty.
export function insertAuthoredMetadata(fileText, { project, kind, decisionStatus } = {}) {
  const fm = fileText.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!fm) return fileText;
  const block = fm[2];
  const additions = [];
  if (project && !/^project:/m.test(block)) additions.push(`project: ${project}`);
  if (kind && !/^kind:/m.test(block)) additions.push(`kind: ${kind}`);
  if (decisionStatus && !/^decision-status:/m.test(block)) additions.push(`decision-status: ${decisionStatus}`);
  if (!additions.length) return fileText;
  return fm[1] + `${block}\n${additions.join('\n')}` + fm[3] + fileText.slice(fm[0].length);
}
