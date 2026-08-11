import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeProject, projectKey, KIND_ORDER, OTHER, groupByProject, groupByKind,
} from '../scripts/lib/authored-group.mjs';

// A project is free text an authoring agent puts in frontmatter (spec
// docs/superpowers/specs/2026-08-11-authored-project-docs-design.md §5.1),
// normalized the same way topic.mjs normalizes `topic:` — trimmed, whitespace
// collapsed, case folded for the key, first-seen casing kept for display.

test('normalizeProject trims and collapses internal whitespace, keeping original casing', () => {
  assert.equal(normalizeProject('  sparta/migrator  '), 'sparta/migrator');
  assert.equal(normalizeProject('sparta /  migrator'), 'sparta / migrator');
});

test('normalizeProject treats blank and non-string input as no project at all', () => {
  for (const bad of ['', '   ', null, undefined, 42, {}]) {
    assert.equal(normalizeProject(bad), null, `${JSON.stringify(bad)} is not a project`);
  }
});

test('projectKey folds case so one project is one group regardless of spelling', () => {
  assert.equal(projectKey('Sparta/Migrator'), projectKey('sparta/migrator'));
});

// --- groupByProject ----------------------------------------------------------

const page = (path, project, kind) => ({ path, project, kind });

test('groupByProject returns one entry per distinct project, sorted alphabetically by key', () => {
  const pages = [
    page('a.md', 'sparta'),
    page('b.md', 'processing-agent'),
    page('c.md', 'sparta'),
  ];
  const g = groupByProject(pages);
  assert.deepEqual(g.map((x) => x.project), ['processing-agent', 'sparta']);
  assert.equal(g.find((x) => x.project === 'sparta').pages.length, 2);
});

test('groupByProject is a lookup order, not a ranking — alphabetical even when counts differ', () => {
  const pages = [page('a.md', 'zebra'), page('b.md', 'zebra'), page('c.md', 'zebra'), page('d.md', 'alpha')];
  const g = groupByProject(pages);
  assert.deepEqual(g.map((x) => x.project), ['alpha', 'zebra'], 'alpha first despite fewer pages');
});

test('groupByProject excludes pages with no project at all — the caller decides what that means', () => {
  const pages = [page('a.md', 'sparta'), page('b.md', undefined), page('c.md', null)];
  const g = groupByProject(pages);
  assert.deepEqual(g.map((x) => x.project), ['sparta']);
});

test('groupByProject folds casing variants into one group, displayed as first seen', () => {
  const pages = [page('a.md', 'Sparta'), page('b.md', 'sparta'), page('c.md', 'SPARTA')];
  const g = groupByProject(pages);
  assert.equal(g.length, 1);
  assert.equal(g[0].project, 'Sparta');
  assert.equal(g[0].pages.length, 3);
});

test('an empty page list produces no groups', () => {
  assert.deepEqual(groupByProject([]), []);
});

// Determinism: this project has repeatedly shipped bugs where filesystem/iteration
// order reached user-visible output (test/drift-guard.test.mjs's NUL-byte test;
// the topic-grouping spec's own §5). Two permutations of the same input must agree.
test('groupByProject is deterministic regardless of input order', () => {
  const pages = [page('a.md', 'beta'), page('b.md', 'alpha'), page('c.md', 'gamma')];
  const a = groupByProject(pages).map((x) => x.project);
  const b = groupByProject([...pages].reverse()).map((x) => x.project);
  assert.deepEqual(a, b);
});

// --- groupByKind ---------------------------------------------------------------

test('groupByKind orders pages by the fixed KIND_ORDER, not alphabetically or by count', () => {
  const pages = [
    page('roadmap.md', 'p', 'roadmap'),
    page('overview.md', 'p', 'overview'),
    page('guide.md', 'p', 'guide'),
    page('arch.md', 'p', 'architecture'),
  ];
  const g = groupByKind(pages);
  assert.deepEqual(g.map((x) => x.kind), ['overview', 'architecture', 'guide', 'roadmap']);
});

test('KIND_ORDER is the full fixed vocabulary from the spec, in reading order', () => {
  assert.deepEqual(KIND_ORDER, ['overview', 'architecture', 'reference', 'guide', 'diagram', 'decision', 'roadmap', 'note']);
});

test('a page with no kind, or an unrecognized one, lands in a trailing Other bucket', () => {
  const pages = [page('a.md', 'p', 'overview'), page('b.md', 'p', undefined), page('c.md', 'p', 'made-up-kind')];
  const g = groupByKind(pages);
  assert.equal(g.at(-1).kind, OTHER);
  assert.equal(g.at(-1).pages.length, 2);
  assert.equal(g[0].kind, 'overview');
});

test('the Other bucket is omitted entirely when every page has a recognized kind', () => {
  const pages = [page('a.md', 'p', 'overview'), page('b.md', 'p', 'guide')];
  const g = groupByKind(pages);
  assert.ok(!g.some((x) => x.kind === OTHER));
});

test('an empty page list produces no kind groups', () => {
  assert.deepEqual(groupByKind([]), []);
});

test('groupByKind is deterministic regardless of input order', () => {
  const pages = [page('a.md', 'p', 'roadmap'), page('b.md', 'p', 'overview'), page('c.md', 'p', 'guide')];
  const a = groupByKind(pages).map((x) => x.kind);
  const b = groupByKind([...pages].reverse()).map((x) => x.kind);
  assert.deepEqual(a, b);
});
