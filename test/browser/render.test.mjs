import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPage } from '../../scripts/lib/render.mjs';
import { laneSkip, startFixtureServer } from './helpers.mjs';

test('a real browser renders a local fixture and runs its script', { skip: laneSkip }, async (t) => {
  const server = await startFixtureServer();
  t.after(() => server.close());
  const page = await renderPage(server.url('/trivial.html'));
  assert.equal(page.status, 200);
  assert.equal(page.title, 'Trivial fixture');
  assert.match(page.html, /<main id="content">Inserted by the page's own script\.<\/main>/, 'the element is empty until a browser runs the page');
  assert.equal(page.finalUrl, server.url('/trivial.html'));
  assert.deepEqual(server.requests[0], { method: 'GET', path: '/trivial.html' });
});
