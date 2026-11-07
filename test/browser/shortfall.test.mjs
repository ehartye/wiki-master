import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPage } from '../../scripts/lib/render.mjs';
import { extractHtml } from '../../scripts/lib/html-extract.mjs';
import { laneSkip, startFixtureServer } from './helpers.mjs';

const words = (text) => (text.match(/\S+/g) ?? []).length;

test('a page a script builds in the shape that loses its text is clipped completely', { skip: laneSkip }, async (t) => {
  const server = await startFixtureServer();
  t.after(() => server.close());
  const page = await renderPage(server.url('/shortfall-shell.html'));
  assert.ok(words(page.html.replace(/<[^>]*>/g, ' ')) > 2000, 'the browser built the whole article');

  const lost = await extractHtml(page.html, page.finalUrl, { shortfallGuard: false });
  assert.ok(words(lost.contentMarkdown) < 5, `without the guard: ${words(lost.contentMarkdown)} words`);

  const data = await extractHtml(page.html, page.finalUrl);
  assert.equal(data.extractionRetry, 'unwrap-inline');
  assert.ok(words(data.contentMarkdown) >= 2000, `${words(data.contentMarkdown)} words`);
  assert.equal(data.shortfall, undefined);
});
