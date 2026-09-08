import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditIdentity } from '../scripts/identity-audit.mjs';

const page = (path, extra = {}) => ({ path, name: path.split('/').pop().slice(0, -3).toLowerCase(), aliases: [], ...extra });

test('identity audit separates invalid placement, alias conflicts, and qualified ambiguity', () => {
  const pages = [
    page('wiki/synthesis/misfiled.md', { type: 'synthesis' }),
    page('wiki/concepts/one.md', { aliases: ['two', 'Shared'] }),
    page('wiki/concepts/two.md', { aliases: ['shared'] }),
    page('wiki/concepts/a/same.md'), page('wiki/concepts/b/same.md'),
    page('wiki/authored/alpha/overview.md'), page('wiki/authored/beta/overview.md'),
    page('wiki/sources/paper.md'), page('raw/clippings/paper.md'),
    page('.recycle/wiki/concepts/one.md'),
  ];
  const r = auditIdentity({ pages });
  assert.ok(r.findings.some(f => f.kind === 'invalid-placement' && f.paths[0].includes('/synthesis/')));
  assert.equal(r.findings.filter(f => f.kind === 'alias-collision').length, 2);
  assert.ok(r.findings.some(f => f.name === 'same' && f.severity === 'review'));
  assert.ok(r.findings.some(f => f.name === 'overview' && f.severity === 'qualified-ambiguity'));
  assert.ok(r.findings.some(f => f.name === 'paper' && f.severity === 'qualified-ambiguity'));
  assert.ok(r.findings.every(f => f.paths.every(p => !p.startsWith('.recycle/'))));
  assert.deepEqual(auditIdentity({ pages: [...pages].reverse() }), r);
});

test('identity audit is bounded while preserving complete counts and rejects invalid limits', () => {
  const pages = Array.from({ length: 5 }, (_, i) => page(`wiki/wrong/p${i}.md`));
  const r = auditIdentity({ pages }, { limit: 2 });
  assert.equal(r.findings.length, 2);
  assert.equal(r.total, 5);
  assert.equal(r.truncated, 3);
  assert.throws(() => auditIdentity({ pages }, { limit: 0 }), /limit/);
});

test('aliases cannot shadow a full canonical path or another page declared title', () => {
  const r = auditIdentity({ pages: [page('wiki/concepts/a.md', { aliases: ['wiki/concepts/b', 'Display C'] }), page('wiki/concepts/b.md'), page('wiki/concepts/c.md', { metadata: { title: 'Display C' } })] });
  assert.equal(r.findings.filter(f => f.kind === 'alias-collision').length, 2);
});

test('different filenames with a shared declared title require identity review', () => {
  const r = auditIdentity({ pages: [page('wiki/concepts/a.md', { metadata: { title: 'Shared' } }), page('wiki/concepts/b.md', { metadata: { title: 'Shared' } })] });
  assert.ok(r.findings.some(f => f.kind === 'duplicate-title' && f.name === 'shared' && f.paths.length === 2));
});

test('a concept placed in moc is a placement defect while an actual MOC is valid', () => {
  const r = auditIdentity({ pages: [page('moc/misplaced.md', { type: 'concept' }), page('moc/task-map.md', { type: 'moc' })] });
  assert.deepEqual(r.findings.filter(f => f.kind === 'invalid-placement').map(f => f.paths[0]), ['moc/misplaced.md']);
});
