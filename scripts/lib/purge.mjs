import { resolveLinkTarget } from './graph.mjs';

// Pages that exist to point at other pages. index.md catalogs everything and a
// MOC's whole job is linking, so an inbound edge from one carries no evidence
// that the target belongs to a topic. They are excluded from the "is anything
// outside the set referencing this?" test — never from being purged, which a
// seed can still do explicitly.
const STRUCTURAL_FILES = new Set(['index.md', 'log.md', 'vault-schema.md']);
// Deliberately NOT the same prefix set graph.mjs's isContent() excludes:
// raw/ is omitted because clippings are purge targets, not structure, and
// wiki/syntheses/ is omitted because — unlike graph.mjs's isRoot(), which
// groups syntheses with moc/ as link-hub roots — purge must treat a synthesis
// as ordinary content that can be the off-topic survivor of a closure.
const STRUCTURAL_PREFIXES = ['moc/', 'log/', '_templates/'];

export function isStructural(path) {
  return STRUCTURAL_FILES.has(path) || STRUCTURAL_PREFIXES.some((p) => path.startsWith(p));
}

// Inverts the graph: target path -> set of page paths linking to it. The two
// link channels resolve differently and mixing them up silently mis-attributes
// provenance edges — body wikilinks ask the navigation question (nav: true),
// `sources:` frontmatter asks the provenance question (nav: false). Same
// convention as graph.mjs's computeGraphMetrics().
export function inboundMap(pages, byName) {
  const inbound = new Map(pages.map((p) => [p.path, new Set()]));
  const add = (from, target, nav) => {
    const to = resolveLinkTarget(byName, target, { nav });
    if (to && to !== from && inbound.has(to)) inbound.get(to).add(from);
  };
  for (const p of pages) {
    for (const t of p.outTargets ?? []) add(p.path, t, true);
    for (const t of p.fmTargets ?? []) add(p.path, t, false);
  }
  return inbound;
}
