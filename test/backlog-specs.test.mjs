import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relationEntries } from '../scripts/lib/backlog-deps.mjs';
import { SPECCED_IN_KEY, analyzeSpecs } from '../scripts/lib/backlog-specs.mjs';

// The specced-in relation: an item names the spec (another backlog item of its project) that
// covers it. The analysis is pure, like the dependency analysis; no vault is read.
const P = 'wiki/authored/demo/backlog';
const item = (slug, status, speccedIn, project = 'demo') => ({
  path: `wiki/authored/${project}/backlog/${slug}.md`,
  backlogStatus: status,
  metadata: speccedIn === undefined ? {} : { [SPECCED_IN_KEY]: speccedIn },
});
const at = slug => `${P}/${slug}.md`;
const get = (analysis, slug) => analysis.byPath.get(at(slug));

test('the key is named once', () => {
  assert.equal(SPECCED_IN_KEY, 'specced-in');
});

test('relationEntries reads a scalar and a list under any key, with the label after the first pipe', () => {
  assert.deepEqual(relationEntries({ 'specced-in': '[[spec]]' }, 'specced-in'), {
    entries: [{ raw: '[[spec]]', target: 'spec', label: null }], malformed: [],
  });
  const { entries } = relationEntries({ rel: ['[[a|WP1]]', '[[b| WP 2 |x]]', '[[c#Goal|WP3]]', '[[d|  ]]'] }, 'rel');
  assert.deepEqual(entries, [
    { raw: '[[a|WP1]]', target: 'a', label: 'WP1' },
    { raw: '[[b| WP 2 |x]]', target: 'b', label: 'WP 2 |x' },
    { raw: '[[c#Goal|WP3]]', target: 'c', label: 'WP3' },
    { raw: '[[d|  ]]', target: 'd', label: null },
  ]);
  assert.deepEqual(relationEntries({}, 'rel'), { entries: [], malformed: [] });
  assert.deepEqual(relationEntries({ rel: ['[[ok]]', 'plain', '[[]]'] }, 'rel').malformed, ['plain', '[[]]']);
});

test('an item with no specced-in has no specs and is in no group', () => {
  const a = analyzeSpecs([item('a', 'planned')]);
  assert.deepEqual(get(a, 'a'), { specs: [], malformed: [] });
  assert.deepEqual(a.groups, []);
  assert.deepEqual(a.cycles, []);
});

test('a flow list, a block sequence (parsed to a list) and a scalar all name their spec, with labels', () => {
  const a = analyzeSpecs([
    item('spec', 'in-progress'),
    item('flow', 'planned', ['[[spec|WP1]]']),
    item('scalar', 'planned', '[[spec]]'),
  ]);
  assert.deepEqual(get(a, 'flow').specs, [{ raw: '[[spec|WP1]]', target: 'spec', label: 'WP1', path: at('spec'), problem: null }]);
  assert.deepEqual(get(a, 'scalar').specs.map(s => [s.path, s.label]), [[at('spec'), null]]);
  assert.deepEqual(a.groups, [{ spec: at('spec'), members: [{ path: at('flow'), label: 'WP1' }, { path: at('scalar'), label: null }] }]);
});

test('one item may be specced in two specs, and appears in both groups', () => {
  const a = analyzeSpecs([item('s1', 'planned'), item('s2', 'planned'), item('x', 'planned', ['[[s2|WP4]]', '[[s1|WP1]]'])]);
  assert.deepEqual(a.groups.map(g => [g.spec, g.members]), [
    [at('s1'), [{ path: at('x'), label: 'WP1' }]],
    [at('s2'), [{ path: at('x'), label: 'WP4' }]],
  ]);
});

test('naming the same spec twice makes one member whose labels are joined', () => {
  const a = analyzeSpecs([item('s', 'planned'), item('x', 'planned', ['[[s|WP1]]', '[[s|WP2]]', '[[s]]', '[[s|WP1]]'])]);
  assert.deepEqual(a.groups, [{ spec: at('s'), members: [{ path: at('x'), label: 'WP1, WP2' }] }]);
});

test('a bare name and a full path resolve to the same spec, ignoring case and .md', () => {
  const a = analyzeSpecs([item('Spec', 'planned'), item('x', 'planned', ['[[spec]]', '[[wiki/authored/demo/backlog/SPEC.md|WP1]]', '[[spec.md]]'])]);
  assert.deepEqual(get(a, 'x').specs.map(s => s.path), Array(3).fill(at('Spec')));
});

test('dangling, cross-project and self entries carry their problem and make no group member', () => {
  const a = analyzeSpecs([item('x', 'planned', ['[[nowhere|WP1]]', '[[wiki/authored/other/backlog/s.md|WP2]]', '[[x]]'])]);
  assert.deepEqual(get(a, 'x').specs.map(s => [s.target, s.path, s.problem]), [
    ['nowhere', null, 'dangling'],
    ['wiki/authored/other/backlog/s.md', null, 'cross-project'],
    ['x', at('x'), 'self'],
  ]);
  assert.deepEqual(a.groups, []);
  assert.deepEqual(a.cycles, []);
});

test('a malformed entry is kept in malformed, not dropped and not a member', () => {
  const a = analyzeSpecs([item('s', 'planned'), item('x', 'planned', ['[[s]]', 'spec-name', '[[s|WP]]1]]'])]);
  assert.deepEqual(get(a, 'x').malformed, ['spec-name', '[[s|WP]]1]]']);
  assert.deepEqual(a.groups[0].members, [{ path: at('x'), label: null }]);
});

test('a chain is allowed; a three-item loop is reported once, from its smallest member', () => {
  const chain = analyzeSpecs([item('item', 'planned', ['[[small]]']), item('small', 'planned', ['[[big]]']), item('big', 'planned')]);
  assert.deepEqual(chain.cycles, []);
  const loop = analyzeSpecs([item('b', 'planned', ['[[c]]']), item('c', 'planned', ['[[a]]']), item('a', 'planned', ['[[b]]'])]);
  assert.deepEqual(loop.cycles, [[at('a'), at('b'), at('c'), at('a')]]);
});

test('a 20000-item chain and a 20000-item ring are searched without recursion', () => {
  const n = 20000;
  const chain = Array.from({ length: n }, (_, i) => item(`i${i}`, 'planned', i + 1 < n ? [`[[i${i + 1}]]`] : undefined));
  assert.deepEqual(analyzeSpecs(chain).cycles, []);
  const ring = Array.from({ length: n }, (_, i) => item(`i${i}`, 'planned', [`[[i${(i + 1) % n}]]`]));
  const { cycles } = analyzeSpecs(ring);
  assert.equal(cycles.length, 1);
  assert.equal(cycles[0].length, n + 1);
});

test('groups are sorted by spec path and members by their path, whatever the input order', () => {
  const a = analyzeSpecs([
    item('z-item', 'planned', ['[[b-spec]]']), item('b-spec', 'planned'), item('m-item', 'shipped', ['[[a-spec]]']),
    item('a-item', 'planned', ['[[b-spec]]']), item('a-spec', 'planned'),
  ]);
  assert.deepEqual(a.groups.map(g => [g.spec, g.members.map(m => m.path)]), [
    [at('a-spec'), [at('m-item')]],
    [at('b-spec'), [at('a-item'), at('z-item')]],
  ]);
});
