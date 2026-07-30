import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planCitationRepair } from '../scripts/lib/backfill.mjs';
import { repointCitation } from '../scripts/lib/repoint.mjs';

// Ingest wrote `sources: [[<remembered title>]]`, but the clipper had already
// slugified that title into the filename. Any title carrying `/`, `:`, `#` — or
// running past 120 chars — produced a citation naming a file that never existed.
// Live vault: 11 source pages, 11 clippings, all correctly ingested and all
// uncitable. The join below is the content hash; the title is what drifted.

const clip = (path, sourceHash) => ({ path, name: path.split('/').pop().replace(/\.md$/, '').toLowerCase(), sourceHash });
const page = (path, fmTargets, sourceHashes) => ({ path, name: path.split('/').pop().replace(/\.md$/, '').toLowerCase(), fmTargets, sourceHashes });

test('repairs a citation whose title was slugified into the filename', () => {
  const pages = [
    clip('raw/clippings/prolearner-procedural-planet- a 3D procedural Planet in THREEJS and WebGl.md', 'abc123'),
    page('wiki/sources/prolearner — Procedural Planet.md',
      ['prolearner/procedural-planet: a 3D procedural Planet in THREEJS and WebGl'], ['abc123']),
  ];
  const plan = planCitationRepair({ pages });
  assert.equal(plan.repairs.length, 1);
  assert.deepEqual(plan.repairs[0], {
    page: 'wiki/sources/prolearner — Procedural Planet.md',
    from: 'prolearner/procedural-planet: a 3D procedural Planet in THREEJS and WebGl',
    to: 'raw/clippings/prolearner-procedural-planet- a 3D procedural Planet in THREEJS and WebGl.md',
  });
  assert.equal(plan.ambiguous.length + plan.unresolved.length, 0);
});

test('repairs a citation whose title was truncated at the 120-char cap', () => {
  const long = 'CK42BB/procedural-clouds-threejs: Generate beautiful procedural clouds in Three.js using WebGPU raymarching with WebGL2 billboard/mesh fallbacks.';
  const file = 'raw/clippings/CK42BB-procedural-clouds-threejs- Generate beautiful procedural clouds in Three.js using WebGPU raymarching with WebGL2.md';
  const plan = planCitationRepair({ pages: [clip(file, 'd40eab'), page('wiki/sources/CK42BB.md', [long], ['d40eab'])] });
  assert.equal(plan.repairs.length, 1);
  assert.equal(plan.repairs[0].to, file);
});

test('leaves an already-correct path-qualified citation alone', () => {
  const pages = [
    clip('raw/clippings/Foo.md', 'aaa'),
    page('wiki/sources/Foo Summary.md', ['raw/clippings/Foo.md'], ['aaa']),
  ];
  assert.deepEqual(planCitationRepair({ pages }), { repairs: [], ambiguous: [], unresolved: [] });
});

test('a page with no source-hashes is never touched — there is nothing to join on', () => {
  const pages = [clip('raw/clippings/Foo.md', 'aaa'), page('wiki/sources/Legacy.md', ['Some Missing Title'], [])];
  assert.equal(planCitationRepair({ pages }).repairs.length, 0);
});

test('multi-source page: each broken citation is pinned to its own clipping by slug', () => {
  const pages = [
    clip('raw/clippings/A- one.md', 'h1'),
    clip('raw/clippings/B- two.md', 'h2'),
    page('wiki/sources/Both.md', ['A: one', 'B: two'], ['h1', 'h2']),
  ];
  const plan = planCitationRepair({ pages });
  assert.equal(plan.repairs.length, 2);
  assert.equal(plan.repairs.find((r) => r.from === 'A: one').to, 'raw/clippings/A- one.md');
  assert.equal(plan.repairs.find((r) => r.from === 'B: two').to, 'raw/clippings/B- two.md');
});

test('a clipping already spoken for by a correct citation is not re-used', () => {
  const pages = [
    clip('raw/clippings/Foo.md', 'h1'),
    clip('raw/clippings/Bar- baz.md', 'h2'),
    page('wiki/sources/Two.md', ['raw/clippings/Foo.md', 'Bar: baz'], ['h1', 'h2']),
  ];
  const plan = planCitationRepair({ pages });
  assert.equal(plan.repairs.length, 1);
  assert.equal(plan.repairs[0].to, 'raw/clippings/Bar- baz.md', 'must not retarget onto the already-cited Foo');
});

// The guardrail: a wrong citation mis-attributes provenance, so an unpinnable
// target is reported rather than guessed.
test('two broken citations with two indistinguishable candidates are reported, not guessed', () => {
  const pages = [
    clip('raw/clippings/x-1.md', 'h1'),
    clip('raw/clippings/x-2.md', 'h2'),
    page('wiki/sources/Amb.md', ['Totally Different One', 'Totally Different Two'], ['h1', 'h2']),
  ];
  const plan = planCitationRepair({ pages });
  assert.equal(plan.repairs.length, 0, 'neither may be guessed');
  assert.equal(plan.ambiguous.length, 2);
});

test('a broken citation with no hash-vouched candidate left is reported as unresolved', () => {
  const pages = [
    clip('raw/clippings/Foo.md', 'h1'),
    page('wiki/sources/Gone.md', ['raw/clippings/Foo.md', 'A Title With No Clipping'], ['h1']),
  ];
  const plan = planCitationRepair({ pages });
  assert.equal(plan.repairs.length, 0);
  assert.equal(plan.unresolved.length, 1);
  assert.equal(plan.unresolved[0].target, 'A Title With No Clipping');
});

test('the planner is idempotent — re-running over repaired text finds nothing', () => {
  const file = 'raw/clippings/prolearner-procedural-planet- a 3D procedural Planet in THREEJS and WebGl.md';
  const title = 'prolearner/procedural-planet: a 3D procedural Planet in THREEJS and WebGl';
  const pages = [clip(file, 'abc123'), page('wiki/sources/P.md', [title], ['abc123'])];
  const plan = planCitationRepair({ pages });
  // Simulate the CLI write, then re-plan against the post-repair citation.
  pages[1].fmTargets = [plan.repairs[0].to];
  assert.equal(planCitationRepair({ pages }).repairs.length, 0);
});

test('repointCitation rewrites only inside frontmatter and survives regex-special targets', () => {
  const t = '---\nsources: ["[[A/b: c.]]"]\n---\nbody mentions [[A/b: c.]] and must not change\n';
  const out = repointCitation(t, 'A/b: c.', 'raw/clippings/A-b- c..md');
  assert.match(out, /sources: \["\[\[raw\/clippings\/A-b- c\.\.md\]\]"\]/);
  assert.match(out, /body mentions \[\[A\/b: c\.\]\] and must not change/);
});
