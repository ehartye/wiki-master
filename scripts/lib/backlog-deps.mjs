// What a backlog item depends on, read once for both consumers: validate-authored.mjs reports
// the defects and backlog-gen.mjs renders the unmet and ready items. Pure and I/O-free, like
// authored-group.mjs; each caller reads its own items and hands them over.
//
// An item lists its prerequisites under `depends-on` as quoted wikilinks to other backlog items
// of the same project. The relation is derived state: it never changes an item's own
// `backlog-status`, so a human-set `blocked` stays what the human set.

export const DEPENDS_ON_KEY = 'depends-on';

// A prerequisite is met once it is shipped or dropped; every other state, including a status the
// generator does not recognize, leaves its dependents waiting.
export const CLOSED_STATUSES = Object.freeze(['shipped', 'dropped']);

const BACKLOG_SEGMENT = '/backlog/';
const strip = target => target.toLowerCase().replace(/\.md$/, '');
const projectOf = path => (path.includes(BACKLOG_SEGMENT) ? path.slice(0, path.indexOf(BACKLOG_SEGMENT)) : null);
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// The entries of one item's `depends-on`. One scalar counts as a list of one. An entry that is
// not a wikilink with a target is returned in `malformed` rather than dropped, because dropping
// it would make a mistyped prerequisite look like no prerequisite.
export function dependsOnEntries(metadata = {}) {
  const value = metadata[DEPENDS_ON_KEY];
  const raws = (Array.isArray(value) ? value : [value]).filter(v => typeof v === 'string' && v.trim() !== '').map(v => v.trim());
  const entries = [];
  const malformed = [];
  for (const raw of raws) {
    const inner = raw.match(/^\[\[([^\][]*)\]\]$/)?.[1];
    const target = inner?.split('|')[0].split('#')[0].trim();
    if (target) entries.push({ raw, target });
    else malformed.push(raw);
  }
  return { entries, malformed };
}

// One project's backlog items: [{ path, backlogStatus, metadata }].
// byPath maps each item's path to { deps, malformed, unmet }:
//   deps      every entry as { raw, target, path, problem }; `problem` is null, 'dangling' (no such
//             item in this project), 'cross-project' (a path into another project) or 'self'
//   unmet     the deps that leave the item waiting: every dep with a problem, and every resolved
//             dep whose item is not shipped or dropped
// cycles lists each dependency cycle as paths that return to their start, from the smallest path.
export function analyzeBacklog(items) {
  const statusByPath = new Map();
  const byFull = new Map();
  const byName = new Map();
  for (const it of items) {
    statusByPath.set(it.path, it.backlogStatus);
    const full = strip(it.path);
    if (!byFull.has(full)) byFull.set(full, it.path);
    const name = full.slice(full.lastIndexOf('/') + 1);
    if (!byName.has(name)) byName.set(name, it.path);
  }

  const byPath = new Map();
  const edges = new Map();
  for (const it of items) {
    const { entries, malformed } = dependsOnEntries(it.metadata);
    const home = projectOf(it.path);
    const deps = entries.map(({ raw, target }) => {
      const key = strip(target);
      const path = key.includes('/') ? byFull.get(key) : byName.get(key);
      if (path === it.path) return { raw, target, path, problem: 'self' };
      if (path) return { raw, target, path, problem: null };
      const away = key.startsWith('wiki/authored/') && projectOf(key + '.md') !== null && projectOf(key + '.md') !== home;
      return { raw, target, path: null, problem: away ? 'cross-project' : 'dangling' };
    });
    const unmet = deps.filter(d => d.problem || !CLOSED_STATUSES.includes(statusByPath.get(d.path)));
    byPath.set(it.path, { deps, malformed, unmet });
    edges.set(it.path, deps.filter(d => !d.problem).map(d => d.path));
  }
  return { byPath, cycles: findCycles(edges) };
}

// Depth-first with an explicit stack: a recursive search overflowed on a 5,000-link chain in the
// marketing runtime, and a backlog is a list people extend.
function findCycles(edges) {
  const WHITE = 0, GREY = 1, BLACK = 2;
  const color = new Map();
  const found = new Map();
  for (const start of [...edges.keys()].sort(compare)) {
    if (color.get(start)) continue;
    const trail = [start];
    const next = [0];
    color.set(start, GREY);
    while (trail.length) {
      const node = trail[trail.length - 1];
      const out = edges.get(node) ?? [];
      const i = next[next.length - 1]++;
      if (i >= out.length) { color.set(node, BLACK); trail.pop(); next.pop(); continue; }
      const to = out[i];
      const state = color.get(to) ?? WHITE;
      if (state === GREY) {
        const loop = trail.slice(trail.indexOf(to));
        const least = loop.reduce((m, p, k) => (p < loop[m] ? k : m), 0);
        const cycle = [...loop.slice(least), ...loop.slice(0, least)];
        found.set(cycle.join('\n'), [...cycle, cycle[0]]);
      } else if (state === WHITE) {
        color.set(to, GREY);
        trail.push(to);
        next.push(0);
      }
    }
  }
  return [...found.entries()].sort(([a], [b]) => compare(a, b)).map(([, cycle]) => cycle);
}
