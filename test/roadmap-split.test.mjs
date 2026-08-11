import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitRoadmapItems, slugifyKebab, inferBacklogStatus, deriveTitle } from '../scripts/lib/roadmap-split.mjs';

// Mechanical, byte-preserving extraction of a monolithic roadmap's top-level items into
// individually-addressable backlog items — see
// docs/superpowers/specs/2026-08-11-authored-project-structure-v2-design.md §4. A parser that
// locates and cuts each item's EXISTING text cannot introduce the "dropped PR number" / "altered
// quote" failure mode a manual transcription risks; it moves bytes, never rewrites them.

// --- slugifyKebab -------------------------------------------------------------
// wiki/authored/'s own convention (sparta-migrator-roadmap.md, processing-agent-user-guide.md,
// ...) is all-lowercase, hyphenated -- distinct from clip.mjs's slugify (case/space-preserving,
// built for raw-clipping filenames, confirmed NOT a match before writing this).

test('slugifyKebab lowercases, hyphenates, and strips punctuation', () => {
  assert.equal(slugifyKebab("Remove Mission Control's fabricated data"), 'remove-mission-controls-fabricated-data');
  assert.equal(slugifyKebab('Metadata type selection UI cleanup'), 'metadata-type-selection-ui-cleanup');
  assert.equal(slugifyKebab('Creating snapshots failing: 502 Bad Gateway'), 'creating-snapshots-failing-502-bad-gateway');
});

test('slugifyKebab collapses repeated separators and trims leading/trailing hyphens', () => {
  assert.equal(slugifyKebab('  A -- B  '), 'a-b');
});

// --- inferBacklogStatus --------------------------------------------------------
// Every item in the real file already self-annotates with an inline marker near its start.
// Scanning is bounded to a PREFIX of the item (not the whole body) so a later, unrelated mention
// deep in a long item's own text (e.g. referencing another already-shipped feature in passing)
// cannot cause a false status match -- confirmed necessary by reading real 100+-line items.

test('inferBacklogStatus: a leading ✅ marker (any of the real file\'s phrasings) maps to shipped', () => {
  for (const text of [
    '**✅ RESOLVED — Creating snapshots failing: 502 Bad Gateway.** Shipped in #60...',
    '**✅ SHIPPED / DONE — Source/Target Org Model.** Substantial change...',
    '**✅ SHIPPED / DONE (all 3 phases) — Whole-configuration version model.** ...',
    '**✅ NOT A BUG — verified and closed (no code change) — "Discovering objects"...**',
  ]) {
    assert.equal(inferBacklogStatus(text, null), 'shipped', text.slice(0, 40));
  }
});

test('inferBacklogStatus: a real "Now" section item (status AFTER the bold span, not inside it)', () => {
  assert.equal(inferBacklogStatus("**Remove Mission Control's fabricated data** — ✅ done. Dependency Graph card removed.", null), 'shipped');
});

test('inferBacklogStatus: 🚧 maps to in-progress', () => {
  assert.equal(inferBacklogStatus('**🚧 Update (2026-08-11):** the whole-config correction has begun shipping, in phases.', null), 'in-progress');
});

test('inferBacklogStatus: 📐 (design spec complete, not yet implemented) and ⚠️ FUTURE both map to planned', () => {
  assert.equal(inferBacklogStatus('**📐 DESIGN SPEC COMPLETE, READY FOR IMPLEMENTATION PLANNING — Companion App.**', null), 'planned');
  assert.equal(inferBacklogStatus('**⚠️ FUTURE / NOT YET BUILT — Configuration retrieval/deployment history view.**', null), 'planned');
});

test('inferBacklogStatus: no inline marker falls back to the given default status', () => {
  assert.equal(inferBacklogStatus('**User directory / search-by-email API** — filed as an issue.', 'blocked'), 'blocked');
  assert.equal(inferBacklogStatus('**Metadata type selection UI cleanup** — not yet merged.', 'planned'), 'planned');
});

test('inferBacklogStatus: a later, unrelated ✅ deep in a long item does not cause a false match — only a bounded prefix is scanned', () => {
  const longItem = '**A real dependency-graph feature** — there is genuine value in showing migration-order/at-risk lookup relationships for a run; it just doesn\'t exist as a backend capability yet. ' +
    'x'.repeat(300) + ' Related work already shipped ✅ elsewhere in the app.';
  assert.equal(inferBacklogStatus(longItem, null), 'planned');
});

// --- deriveTitle ----------------------------------------------------------------
// Two real shapes coexist in the source file: (a) "Now"/"In progress" items where the bold span
// IS the clean title and status follows afterward; (b) "Explicitly future"/"Known issues" items
// where a status marker sits INSIDE the bold span itself, ahead of the real title.

test('deriveTitle: shape (a) — the whole bold span is already the clean title', () => {
  assert.equal(deriveTitle("**Remove Mission Control's fabricated data** — ✅ done. Dependency Graph card removed."), "Remove Mission Control's fabricated data");
  assert.equal(deriveTitle('**Metadata type selection UI cleanup** — `MetadataRetrievalDialog.tsx`.'), 'Metadata type selection UI cleanup');
});

test('deriveTitle: shape (b) — a leading status marker inside the bold span is stripped', () => {
  assert.equal(deriveTitle('**✅ RESOLVED — Creating snapshots failing: 502 Bad Gateway.** Shipped in #60...'), 'Creating snapshots failing: 502 Bad Gateway');
  assert.equal(deriveTitle('**✅ SHIPPED / DONE — Source/Target Org Model + reusable OrgSelector component.** Substantial...'), 'Source/Target Org Model + reusable OrgSelector component');
  assert.equal(deriveTitle('**📐 DESIGN SPEC COMPLETE, READY FOR IMPLEMENTATION PLANNING — Companion App (new initiative, 2026-08-11).** A small Tauri app...'), 'Companion App (new initiative, 2026-08-11)');
});

test('deriveTitle: a status marker with a mid-span secondary clause (two em-dashes) keeps only the final clause as the title', () => {
  assert.equal(
    deriveTitle('**✅ NOT A BUG — verified and closed (no code change) — "Discovering objects" not actually discovering anything.** Independently confirmed...'),
    '"Discovering objects" not actually discovering anything'
  );
});

// Found live against the real vault file: a bold span that WRAPS across source lines (the
// author's own markdown is hard-wrapped at ~72 chars) can put a newline + indentation right
// where a plain-text " — " split expects a single space, which silently defeated both the
// em-dash split AND left raw newlines/indentation inside the derived title.
test('deriveTitle: a status marker whose bold span wraps across source lines is still stripped, and internal whitespace is collapsed', () => {
  const wrapped = '**📐 DESIGN SPEC COMPLETE, READY FOR IMPLEMENTATION PLANNING —\n  Companion App (new initiative, 2026-08-11).** A small Tauri app...';
  assert.equal(deriveTitle(wrapped), 'Companion App (new initiative, 2026-08-11)');
});

test('deriveTitle: a shape-(a) title (no marker) that wraps across source lines still collapses to single-line, single-spaced text', () => {
  const wrapped = '**"Discovering\n  objects" not actually discovering anything** — some detail.';
  assert.equal(deriveTitle(wrapped), '"Discovering objects" not actually discovering anything');
});

// --- splitRoadmapItems ------------------------------------------------------------
// The full extractor: walks named sections, splits each on TOP-LEVEL list markers only (a
// nested/indented sub-item, like the real file's 3-sub-part scratch-org item, stays INSIDE its
// parent's extracted text), and returns items with verbatim body text.

const SAMPLE = `
## Now (this initiative, no external blockers)

1. **Remove Mission Control's fabricated data** — ✅ done. Dependency Graph
   card removed outright.
2. **Wire org-to-project assignment into the UI** — ✅ done.

## In progress (not yet merged)

- **Metadata type selection UI cleanup** — \`MetadataRetrievalDialog.tsx\`.
  Not yet merged as of this writing.

## Blocked on platform

- **User directory / search-by-email API** — filed as an issue. Once
  available, replace the raw-sub-paste field.

## Explicitly future, not this initiative

- **✅ SHIPPED / DONE — A nested item with sub-parts.** Top level text.
  1. **Sub-part one.** Indented, must stay inside the parent.
  2. **Sub-part two.** Also indented, also stays inside.
- **⚠️ FUTURE / NOT YET BUILT — A genuinely future idea.** Not built yet.

## Links

- [[some-other-page]]
`;

const SECTIONS = [
  'Now (this initiative, no external blockers)',
  'In progress (not yet merged)',
  'Known issues (active investigation)',
  'Blocked on platform',
  'Explicitly future, not this initiative',
];

test('splitRoadmapItems extracts one item per top-level list entry across every named section', () => {
  const items = splitRoadmapItems({ body: SAMPLE, sections: SECTIONS });
  assert.deepEqual(items.map((i) => i.title), [
    "Remove Mission Control's fabricated data",
    'Wire org-to-project assignment into the UI',
    'Metadata type selection UI cleanup',
    'User directory / search-by-email API',
    'A nested item with sub-parts',
    'A genuinely future idea',
  ]);
});

test('splitRoadmapItems does not split on nested/indented sub-items — they stay inside the parent', () => {
  const items = splitRoadmapItems({ body: SAMPLE, sections: SECTIONS });
  const nested = items.find((i) => i.title === 'A nested item with sub-parts');
  assert.ok(nested, 'the nested-parent item was extracted as ONE item');
  assert.ok(nested.body.includes('Sub-part one'), 'sub-part text preserved inside the parent');
  assert.ok(nested.body.includes('Sub-part two'), 'both sub-parts preserved');
  assert.ok(!items.some((i) => i.title.includes('Sub-part')), 'no sub-part was extracted as its own top-level item');
});

test('splitRoadmapItems ignores content outside the named sections (e.g. a trailing ## Links)', () => {
  const items = splitRoadmapItems({ body: SAMPLE, sections: SECTIONS });
  assert.ok(!items.some((i) => i.body.includes('some-other-page')), '## Links content is not extracted as a backlog item');
});

test('splitRoadmapItems assigns backlog-status per item, including the section-default fallback', () => {
  const items = splitRoadmapItems({ body: SAMPLE, sections: SECTIONS });
  const byTitle = Object.fromEntries(items.map((i) => [i.title, i.status]));
  assert.equal(byTitle["Remove Mission Control's fabricated data"], 'shipped');
  assert.equal(byTitle['Metadata type selection UI cleanup'], 'planned');
  assert.equal(byTitle['User directory / search-by-email API'], 'blocked', 'falls back to the Blocked on platform section default');
  assert.equal(byTitle['A nested item with sub-parts'], 'shipped');
  assert.equal(byTitle['A genuinely future idea'], 'planned');
});

test('splitRoadmapItems assigns a unique, kebab-case slug per item', () => {
  const items = splitRoadmapItems({ body: SAMPLE, sections: SECTIONS });
  assert.deepEqual(new Set(items.map((i) => i.slug)).size, items.length, 'every slug is unique');
  assert.ok(items.every((i) => /^[a-z0-9-]+$/.test(i.slug)), 'every slug is kebab-case');
});

test('splitRoadmapItems preserves each item\'s body text VERBATIM (byte-for-byte substring of the source)', () => {
  const items = splitRoadmapItems({ body: SAMPLE, sections: SECTIONS });
  for (const item of items) {
    assert.ok(SAMPLE.includes(item.body.trim()), `item "${item.title}"'s body is an exact substring of the source`);
  }
});

test('splitRoadmapItems on an empty/no-matching-section body returns no items', () => {
  assert.deepEqual(splitRoadmapItems({ body: '## Unrelated heading\n\nsome text\n', sections: SECTIONS }), []);
});
