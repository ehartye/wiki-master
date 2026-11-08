// Which spec covers a backlog item, read once for its consumers: validate-authored.mjs reports the
// defects (backlog-specs-check.mjs), catalogs.mjs renders the "Specced work" section and
// backlog-list.mjs filters on it. Pure and I/O-free, like backlog-deps.mjs.
//
// An item names the spec that absorbed it under `specced-in` as quoted wikilinks to other backlog
// items of the same project, each with an optional `|WP1` label. A spec is not a kind of its own:
// it is any item that another item names here. The relation means "is part of"; it never changes
// any item's `backlog-status`.

import { relationEntries, projectResolver, findCycles } from './backlog-deps.mjs';

export const SPECCED_IN_KEY = 'specced-in';

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// One project's backlog items: [{ path, backlogStatus, metadata }].
// byPath maps each item's path to { specs, malformed }:
//   specs   every entry as { raw, target, label, path, problem }; `problem` is null, 'dangling',
//           'cross-project' or 'self', resolved exactly as a depends-on target is
// groups lists each spec that at least one item names without a problem, as { spec, members },
// sorted by spec path; members are { path, label } sorted by path, one per item (an item that
// names the same spec twice gets its distinct labels joined with ", ").
// cycles lists each loop (an item in a spec that is, through the chain, in that item), from the
// smallest path; a chain without a loop is allowed.
export function analyzeSpecs(items) {
  const resolve = projectResolver(items);
  const byPath = new Map();
  const edges = new Map();
  const members = new Map(); // spec path -> Map(member path -> [label])
  for (const it of items) {
    const { entries, malformed } = relationEntries(it.metadata, SPECCED_IN_KEY);
    const specs = entries.map(({ raw, target, label }) => ({ raw, target, label, ...resolve(it.path, target) }));
    byPath.set(it.path, { specs, malformed });
    const ok = specs.filter(s => !s.problem);
    edges.set(it.path, [...new Set(ok.map(s => s.path))]);
    for (const s of ok) {
      if (!members.has(s.path)) members.set(s.path, new Map());
      const labels = members.get(s.path);
      if (!labels.has(it.path)) labels.set(it.path, []);
      if (s.label && !labels.get(it.path).includes(s.label)) labels.get(it.path).push(s.label);
    }
  }
  const groups = [...members.keys()].sort(compare).map(spec => ({
    spec,
    members: [...members.get(spec).keys()].sort(compare).map(path => {
      const labels = members.get(spec).get(path);
      return { path, label: labels.length ? labels.join(', ') : null };
    }),
  }));
  return { byPath, groups, cycles: findCycles(edges) };
}
