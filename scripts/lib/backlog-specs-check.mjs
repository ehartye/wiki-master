// The specced-in defects for validate-authored.mjs, kept beside the analysis rather than in the
// validator. Like the dependency check, a spec resolves among the items of the page's own project
// only, so one read of that backlog folder (readBacklogItems) is enough: no whole-vault graph.

import { parseNote } from './note.mjs';
import { readBacklogItems } from './backlog-read.mjs';
import { AUTHORED_ROOT, placement } from './authored-contract.mjs';
import { relationEntries } from './backlog-deps.mjs';
import { SPECCED_IN_KEY, analyzeSpecs } from './backlog-specs.mjs';

const slug = path => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');
const PROBLEMS = {
  dangling: ['specced-in-dangling', target => `[[${target}]] matches no backlog item in this project`],
  'cross-project': ['specced-in-cross-project', target => `[[${target}]] is in another project; a spec must be an item of the same project`],
  self: ['specced-in-self', () => 'an item cannot be specced in itself'],
};

// texts: Map(path -> markdown) of the ledger's pages. keyLines(markdown) gives each frontmatter
// key's file line; the validator passes its own so every defect counts lines the same way.
// Only pages that carry the key are examined.
export function speccedInDefects(vaultPath, texts, { keyLines }) {
  const out = [];
  const analyses = new Map();
  const analysisFor = (path, metadata) => {
    const place = placement(path);
    const dir = place?.project ? `${AUTHORED_ROOT}${place.project}/backlog` : null;
    if (!analyses.has(dir)) analyses.set(dir, { items: dir ? readBacklogItems(vaultPath, dir) : [], analysis: null });
    const entry = analyses.get(dir);
    if (!entry.items.some(it => it.path === path)) {
      entry.items.push({ path, backlogStatus: metadata['backlog-status'], metadata });
      entry.analysis = null;
    }
    entry.analysis ??= analyzeSpecs(entry.items);
    return entry.analysis;
  };
  for (const [path, markdown] of texts) {
    const { metadata } = parseNote(markdown);
    if (!Object.hasOwn(metadata, SPECCED_IN_KEY)) continue;
    const line = keyLines(markdown).get(SPECCED_IN_KEY) ?? 1;
    const add = (rule, message) => out.push({ path, line, rule, message });
    if (metadata.kind !== 'backlog-item') {
      const { entries, malformed } = relationEntries(metadata, SPECCED_IN_KEY);
      if (entries.length || malformed.length) add('specced-in-misplaced', `${SPECCED_IN_KEY} is read only on backlog items (kind: backlog-item), so these entries are ignored`);
      continue;
    }
    const analysis = analysisFor(path, metadata);
    const { specs, malformed } = analysis.byPath.get(path);
    for (const raw of malformed) add('specced-in-malformed', `${SPECCED_IN_KEY} entry ${JSON.stringify(raw)} is not a [[wikilink]]; write quoted wikilinks, e.g. ${SPECCED_IN_KEY}: ["[[spec|WP1]]"]`);
    for (const spec of specs) {
      if (spec.problem) add(PROBLEMS[spec.problem][0], PROBLEMS[spec.problem][1](spec.target));
    }
    for (const cycle of analysis.cycles) {
      if (cycle.slice(0, -1).includes(path)) add('specced-in-cycle', `${SPECCED_IN_KEY} cycle: ${cycle.map(slug).join(' -> ')}`);
    }
  }
  return out;
}
