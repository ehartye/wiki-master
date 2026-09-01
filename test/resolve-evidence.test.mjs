import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNameIndex } from '../scripts/lib/graph.mjs';
import { stripLineSuffix, resolveEvidence, formatEvidenceReport } from '../scripts/resolve-evidence.mjs';

// Mirrors test/evidence-trail.test.mjs's own fixture shape exactly — this tool
// is a thin, deliberately-reused wrapper around evidencePaths() (never a
// second implementation of the same walk), so its own tests share that
// fixture convention rather than inventing a new one.
const mk = (path, links = [], extra = {}) => ({
  path,
  name: (path.split('/').pop() ?? '').replace(/\.md$/i, '').toLowerCase(),
  fmTargets: [],
  outTargets: links,
  ...extra,
});

function fixture() {
  const pages = [
    mk('wiki/concepts/C.md', ['A']),
    mk('wiki/sources/A.md', ['a-clip']),
    mk('raw/clippings/a-clip.md'),
    mk('wiki/authored/dac/overview.md', [], { declaresNoSources: true }),
    mk('wiki/concepts/Dangling.md', ['Nowhere']),
  ];
  return { byName: buildNameIndex(pages), pageByPath: new Map(pages.map((p) => [p.path, p])) };
}

// ── stripLineSuffix ──────────────────────────────────────────────────────
// search.mjs emits `path:line` on stdout for a semantic/chunk hit (never for
// a keyword-only or raw/ hit, which carry no line). This must be pipeable
// straight from that output, so the line suffix has to come off cleanly
// without needing the caller to pre-parse it.

test('stripLineSuffix removes a trailing :N line number', () => {
  assert.equal(stripLineSuffix('wiki/sources/Foo.md:23'), 'wiki/sources/Foo.md');
});

test('stripLineSuffix leaves a path with no line suffix untouched', () => {
  assert.equal(stripLineSuffix('raw/clippings/Bar.md'), 'raw/clippings/Bar.md');
});

test('stripLineSuffix trims surrounding whitespace (piped stdin lines)', () => {
  assert.equal(stripLineSuffix('  wiki/sources/Foo.md:5  '), 'wiki/sources/Foo.md');
});

// ── resolveEvidence ──────────────────────────────────────────────────────
// Every classification here mirrors an existing, already-scored vocabulary
// in lib/graph.mjs's computeGraphMetrics (declaredNoProvenance,
// unreachableProvenance) rather than inventing new terms — a page that is a
// gap in health.mjs must read as the same kind of gap here.

test('resolveEvidence on an already-raw/ input reports it needs no further resolution', () => {
  const { pageByPath, byName } = fixture();
  const r = resolveEvidence('raw/clippings/a-clip.md', { pageByPath, byName });
  assert.equal(r.status, 'is-raw');
});

test('resolveEvidence on a page not present in the vault graph reports not-found', () => {
  const { pageByPath, byName } = fixture();
  const r = resolveEvidence('wiki/concepts/DoesNotExist.md', { pageByPath, byName });
  assert.equal(r.status, 'not-found');
});

test('resolveEvidence follows the citation chain to real raw/ evidence', () => {
  const { pageByPath, byName } = fixture();
  const r = resolveEvidence('wiki/concepts/C.md', { pageByPath, byName });
  assert.equal(r.status, 'resolved');
  assert.deepEqual(r.rawPaths, ['raw/clippings/a-clip.md']);
  assert.deepEqual(r.sourcePaths, ['wiki/sources/A.md'], 'the intermediate source page is reported too, for context');
});

test('resolveEvidence strips a :line suffix before resolving', () => {
  const { pageByPath, byName } = fixture();
  const r = resolveEvidence('wiki/concepts/C.md:42', { pageByPath, byName });
  assert.equal(r.status, 'resolved');
  assert.equal(r.path, 'wiki/concepts/C.md', 'the reported path is the stripped one, not the raw input');
});

test('resolveEvidence reports declared-no-provenance for a page that legitimately has none', () => {
  const { pageByPath, byName } = fixture();
  const r = resolveEvidence('wiki/authored/dac/overview.md', { pageByPath, byName });
  assert.equal(r.status, 'declared-no-provenance');
});

test('resolveEvidence reports unreachable rather than guessing when no raw/ evidence exists and none was declared', () => {
  const { pageByPath, byName } = fixture();
  const r = resolveEvidence('wiki/concepts/Dangling.md', { pageByPath, byName });
  assert.equal(r.status, 'unreachable');
});

test('resolveEvidence never invents a raw/ path that evidencePaths did not actually find', () => {
  const { pageByPath, byName } = fixture();
  const r = resolveEvidence('wiki/concepts/Dangling.md', { pageByPath, byName });
  assert.deepEqual(r.rawPaths ?? [], []);
});

// ── formatEvidenceReport ─────────────────────────────────────────────────
// Pure formatting, mirroring search.mjs's own renderResult() split of
// concerns: resolution logic and its human-readable rendering are separate,
// independently testable functions.

test('formatEvidenceReport lists every raw/ path and the source page it came via', () => {
  const lines = formatEvidenceReport({
    path: 'wiki/concepts/C.md', status: 'resolved',
    rawPaths: ['raw/clippings/a-clip.md'], sourcePaths: ['wiki/sources/A.md'],
  });
  const text = lines.join('\n');
  assert.match(text, /raw\/clippings\/a-clip\.md/);
  assert.match(text, /wiki\/sources\/A\.md/);
});

test('formatEvidenceReport clearly labels an already-raw input rather than an empty result', () => {
  const lines = formatEvidenceReport({ path: 'raw/clippings/Foo.md', status: 'is-raw' });
  assert.match(lines.join('\n'), /already.*raw|raw.*evidence/i);
});

test('formatEvidenceReport clearly labels a declared-no-provenance page as by design, not broken', () => {
  const lines = formatEvidenceReport({ path: 'wiki/authored/x.md', status: 'declared-no-provenance' });
  assert.match(lines.join('\n'), /no provenance/i);
  assert.doesNotMatch(lines.join('\n'), /broken|error/i, 'a deliberate disclosure must not read as a defect');
});

test('formatEvidenceReport flags an unreachable page as a real gap, distinct from declared-no-provenance', () => {
  const lines = formatEvidenceReport({ path: 'wiki/concepts/Dangling.md', status: 'unreachable', sourcePaths: [] });
  assert.match(lines.join('\n'), /no raw|unreachable/i);
});

test('formatEvidenceReport reports not-found plainly', () => {
  const lines = formatEvidenceReport({ path: 'bogus/path.md', status: 'not-found' });
  assert.match(lines.join('\n'), /not found/i);
});
