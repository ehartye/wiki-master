import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestRelationships } from '../scripts/relationships.mjs';

const page = (path, extra = {}) => ({ path, name: path.split('/').pop().slice(0, -3).toLowerCase(), aliases: [], outTargets: [], fmTargets: [], ...extra });
const concepts = [
  page('wiki/concepts/self-regulation.md', { fmTargets: ['raw/clippings/paper'], metadata: { topic: 'process' } }),
  page('wiki/concepts/procrastination.md', { fmTargets: ['raw/clippings/paper'], metadata: { topic: 'problem' } }),
  page('wiki/concepts/implementation-intentions.md', { fmTargets: ['raw/clippings/copy'], metadata: { topic: 'intervention' } }),
];
const evidence = [page('raw/clippings/paper.md', { sourceHash: 'aabbcc' }), page('raw/clippings/copy.md', { sourceHash: 'aabbcc' })];

test('unlinked process, problem and intervention yield unverified shared-source candidates using hash identity', () => {
  const r = suggestRelationships({ pages: [...concepts, ...evidence] });
  assert.equal(r.candidates.length, 3);
  assert.ok(r.candidates.every(c => c.verification === 'unverified' && c.proposedRole === 'related'));
  assert.ok(r.candidates.every(c => c.reasons.some(reason => reason.kind === 'shared-source' && reason.identity === 'hash:aabbcc')));
  assert.match(r.disclaimer, /not.*entailment|does not.*entailment/);
});

test('existing links, self pairs and ambiguous identities cannot become complement assertions', () => {
  const pages = [...concepts.map(p => ({ ...p })), ...evidence];
  pages[0].outTargets = ['procrastination'];
  pages.push(page('wiki/concepts/alias-collision.md', { aliases: ['implementation-intentions'], fmTargets: ['raw/clippings/paper'] }));
  const r = suggestRelationships({ pages });
  assert.equal(r.candidates.length, 0);
  assert.ok(r.identityReview.length > 0);
});

test('alias shadowing a canonical full path is identity review, not a proposed relationship', () => {
  const pages = [...concepts.map(p => ({ ...p })), ...evidence];
  pages[0].outTargets = ['procrastination'];
  pages.push(page('wiki/concepts/collision.md', { aliases: ['wiki/concepts/implementation-intentions'], fmTargets: ['raw/clippings/paper'] }));
  assert.equal(suggestRelationships({ pages }).candidates.length, 0);
});

test('candidate selection is deterministic, bounded, and supports seed and since scope', () => {
  const pages = [...concepts.map((p, i) => ({ ...p, updated: `2026-09-0${i + 1}` })), ...evidence];
  const opts = { seed: 'wiki/concepts/self-regulation.md', since: '2026-09-02', limit: 1 };
  const r = suggestRelationships({ pages }, opts);
  assert.equal(r.candidates.length, 1);
  assert.ok([r.candidates[0].from, r.candidates[0].to].includes(opts.seed));
  assert.deepEqual(suggestRelationships({ pages: [...pages].reverse() }, opts), r);
  assert.throws(() => suggestRelationships({ pages }, { since: 'yesterday' }), /since/);
});

test('optional vectors supply semantic neighbors without claiming a verified relation', () => {
  const pages = concepts.map(p => ({ ...p, fmTargets: [] }));
  const vectors = new Map(pages.map((p, i) => [p.path, i === 2 ? [0, 1] : [1, 0]]));
  const r = suggestRelationships({ pages }, { vectors });
  assert.equal(r.candidates.length, 1);
  assert.equal(r.candidates[0].reasons[0].kind, 'semantic-neighbor');
  assert.equal(r.candidates[0].verification, 'unverified');
});

test('rarer shared evidence and distinct declared topics outrank a popular source alone', () => {
  const popular = page('raw/clippings/popular.md');
  const rare = page('raw/clippings/rare.md');
  const pages = Array.from({ length: 8 }, (_, i) => page(`wiki/concepts/common-${i}.md`, { fmTargets: ['raw/clippings/popular'], metadata: { topic: 'same' } }));
  pages.push(page('wiki/concepts/process.md', { fmTargets: ['raw/clippings/rare'], metadata: { topic: 'process' } }));
  pages.push(page('wiki/concepts/intervention.md', { fmTargets: ['raw/clippings/rare'], metadata: { topic: 'intervention' } }));
  const r = suggestRelationships({ pages: [...pages, popular, rare] }, { limit: 1 });
  assert.equal(r.candidates[0].from, 'wiki/concepts/intervention.md');
  assert.equal(r.candidates[0].to, 'wiki/concepts/process.md');
  assert.equal(r.total, 29);
});

test('raw and log names do not block content relationship candidates', () => {
  const a = page('wiki/concepts/A.md', { fmTargets: ['raw/paper'] });
  const b = page('wiki/concepts/B.md', { fmTargets: ['raw/paper'] });
  const paper = page('raw/paper.md');
  for (const collisionPath of ['raw/A.md', 'log/A.md']) {
    const report = suggestRelationships({ pages: [a, b, paper, page(collisionPath)] });
    assert.equal(report.scanned, 2, collisionPath);
    assert.equal(report.candidates.length, 1, collisionPath);
    assert.deepEqual([report.candidates[0].from, report.candidates[0].to], [a.path, b.path]);
  }
});

test('content basename collisions still require review before relationship suggestions', () => {
  const pages = [
    page('wiki/concepts/A.md', { fmTargets: ['raw/paper'] }),
    page('wiki/concepts/B.md', { fmTargets: ['raw/paper'] }),
    page('moc/A.md'),
    page('raw/paper.md'),
  ];
  const report = suggestRelationships({ pages });
  assert.equal(report.scanned, 1);
  assert.equal(report.candidates.length, 0);
});

test('bare relationship seed navigates to the concept despite a same-named raw page', () => {
  const a = page('wiki/concepts/A.md', { fmTargets: ['raw/paper'] });
  const b = page('wiki/concepts/B.md', { fmTargets: ['raw/paper'] });
  const pages = [page('raw/A.md'), a, b, page('raw/paper.md')];
  const report = suggestRelationships({ pages }, { seed: 'A' });
  assert.equal(report.candidates.length, 1);
  assert.ok([report.candidates[0].from, report.candidates[0].to].includes(a.path));
});

test('operation log titles do not suppress otherwise valid concept candidates', () => {
  const pages = [...concepts, ...evidence, page('log/query-result.md', { metadata: { title: 'self-regulation' } })];
  const r = suggestRelationships({ pages });
  assert.equal(r.candidates.length, 3);
});
