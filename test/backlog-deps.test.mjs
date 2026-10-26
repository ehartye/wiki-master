import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEPENDS_ON_KEY, CLOSED_STATUSES, dependsOnEntries, analyzeBacklog } from '../scripts/lib/backlog-deps.mjs';

// A backlog item as the graph and the validator both hand it over: a path, the status the
// generator groups by, and the parsed frontmatter. The analysis is pure; no vault is read.
const P = 'wiki/authored/demo/backlog';
const item = (slug, status, dependsOn, project = 'demo') => ({
  path: `wiki/authored/${project}/backlog/${slug}.md`,
  backlogStatus: status,
  metadata: dependsOn === undefined ? {} : { [DEPENDS_ON_KEY]: dependsOn },
});
const get = (analysis, slug, project = 'demo') => analysis.byPath.get(`wiki/authored/${project}/backlog/${slug}.md`);

test('the key and the closed statuses are named once', () => {
  assert.equal(DEPENDS_ON_KEY, 'depends-on');
  assert.deepEqual([...CLOSED_STATUSES].sort(), ['dropped', 'shipped']);
});

test('dependsOnEntries reads a bare name, an alias, a path with .md, and a heading', () => {
  const { entries, malformed } = dependsOnEntries({ 'depends-on': ['[[a]]', '[[b|The B item]]', '[[wiki/authored/demo/backlog/c.md|c]]', '[[d#Acceptance]]'] });
  assert.deepEqual(entries.map(e => e.target), ['a', 'b', 'wiki/authored/demo/backlog/c.md', 'd']);
  assert.deepEqual(malformed, []);
});

test('dependsOnEntries takes one scalar as a list of one, and no key as no entries', () => {
  assert.deepEqual(dependsOnEntries({ 'depends-on': '[[only]]' }).entries.map(e => e.target), ['only']);
  assert.deepEqual(dependsOnEntries({}), { entries: [], malformed: [] });
  assert.deepEqual(dependsOnEntries({ 'depends-on': '' }), { entries: [], malformed: [] });
  assert.deepEqual(dependsOnEntries({ 'depends-on': [] }), { entries: [], malformed: [] });
});

test('dependsOnEntries reports an entry that is not a wikilink instead of dropping it', () => {
  const { entries, malformed } = dependsOnEntries({ 'depends-on': ['[[ok]]', 'plain-text', '[[]]', '[[unclosed'] });
  assert.deepEqual(entries.map(e => e.target), ['ok']);
  assert.deepEqual(malformed, ['plain-text', '[[]]', '[[unclosed']);
});

test('an item with no depends-on has no dependencies and nothing unmet', () => {
  const a = analyzeBacklog([item('a', 'planned')]);
  assert.deepEqual(get(a, 'a'), { deps: [], malformed: [], unmet: [] });
  assert.deepEqual(a.cycles, []);
});

test('a prerequisite is met only when it is shipped or dropped', () => {
  const a = analyzeBacklog([
    item('want', 'planned', ['[[done]]', '[[gone]]', '[[going]]', '[[queued]]', '[[stuck]]', '[[odd]]', '[[none]]']),
    item('done', 'shipped'), item('gone', 'dropped'), item('going', 'in-progress'),
    item('queued', 'planned'), item('stuck', 'blocked'), item('odd', 'proposed'), item('none', undefined),
  ]);
  assert.deepEqual(get(a, 'want').unmet.map(d => d.path.split('/').pop()), ['going.md', 'queued.md', 'stuck.md', 'odd.md', 'none.md']);
});

test('a bare name and a path resolve to the same item, ignoring case and the .md suffix', () => {
  const a = analyzeBacklog([
    item('x', 'planned', ['[[Target]]', '[[wiki/authored/demo/backlog/TARGET.md|t]]', '[[target.md]]']),
    item('target', 'shipped'),
  ]);
  assert.deepEqual(get(a, 'x').deps.map(d => d.path), Array(3).fill(`${P}/target.md`));
  assert.deepEqual(get(a, 'x').unmet, []);
});

test('a dependency that matches no item in the project is dangling and counts as unmet', () => {
  const a = analyzeBacklog([item('x', 'planned', ['[[nowhere]]'])]);
  const [dep] = get(a, 'x').deps;
  assert.equal(dep.problem, 'dangling');
  assert.equal(dep.path, null);
  assert.equal(get(a, 'x').unmet.length, 1);
});

test('a path into another project is cross-project, not found by its bare name either', () => {
  const a = analyzeBacklog([item('x', 'planned', ['[[wiki/authored/other/backlog/y.md|y]]'])]);
  assert.equal(get(a, 'x').deps[0].problem, 'cross-project');
});

test('an item that names itself has a self problem and no cycle', () => {
  const a = analyzeBacklog([item('x', 'planned', ['[[x]]'])]);
  assert.equal(get(a, 'x').deps[0].problem, 'self');
  assert.deepEqual(a.cycles, []);
});

test('a cycle is reported once, as a path that returns to its start, from its smallest member', () => {
  const a = analyzeBacklog([item('b', 'planned', ['[[c]]']), item('c', 'planned', ['[[a]]']), item('a', 'planned', ['[[b]]']), item('free', 'planned', ['[[a]]'])]);
  assert.deepEqual(a.cycles, [[`${P}/a.md`, `${P}/b.md`, `${P}/c.md`, `${P}/a.md`]]);
});

test('two separate cycles are both reported; a diamond is not a cycle', () => {
  const two = analyzeBacklog([item('a', 'planned', ['[[b]]']), item('b', 'planned', ['[[a]]']), item('c', 'planned', ['[[d]]']), item('d', 'planned', ['[[c]]'])]);
  assert.equal(two.cycles.length, 2);
  const diamond = analyzeBacklog([item('top', 'planned', ['[[l]]', '[[r]]']), item('l', 'planned', ['[[base]]']), item('r', 'planned', ['[[base]]']), item('base', 'planned')]);
  assert.deepEqual(diamond.cycles, []);
});

test('a 20000-item chain and a 20000-item ring are searched without recursion', () => {
  const n = 20000;
  const chain = Array.from({ length: n }, (_, i) => item(`i${i}`, 'planned', i + 1 < n ? [`[[i${i + 1}]]`] : undefined));
  assert.deepEqual(analyzeBacklog(chain).cycles, []);
  const ring = Array.from({ length: n }, (_, i) => item(`i${i}`, 'planned', [`[[i${(i + 1) % n}]]`]));
  const { cycles } = analyzeBacklog(ring);
  assert.equal(cycles.length, 1);
  assert.equal(cycles[0].length, n + 1);
});
