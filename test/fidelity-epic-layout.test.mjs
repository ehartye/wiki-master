import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractHtml } from '../scripts/lib/html-extract.mjs';

// Two things were lost from Epic's documentation pages, found on real pages fetched 2026-10-26:
//  - a `<block-callout>` (a "Prerequisite topics" box above the first section) was dropped whole, because the default
//    cleanup reads a box that is mostly links as navigation;
//  - a list of child-topic cards kept each title (as a linked image) and lost its one-line description.
// The fixtures stand in for those layouts. The fidelity check had warned correctly on both: the loss was real.

const URL1 = 'https://docs.example.com/documentation/unreal-engine/accessing-terrain';
const PARA = 'The terrain system stores its data in the project and reads it back whenever the level loads, which is why the setup steps below matter. ';
const body = (n) => Array.from({ length: n }, (_, i) => `<p>${PARA}Step ${i + 1} of the setup describes one more setting in detail.</p>`).join('');
const CALLOUT = '<block-callout class="block-callout is-info"><div class="block-callout-inner"><span class="eds-icon block-callout-icon"></span><span class="block-callout-content"><h6 class="text-uppercase"> Prerequisite topics </h6>'
  + '<p>In order to understand and use the content on this page, make sure you are familiar with the following topics:</p>'
  + '<ul><li><a href="/documentation/unreal-engine/working-with-plugins">Working with Plugins</a></li></ul></span></div></block-callout>';
const WARNING = '<block-callout class="block-callout is-warning"><div class="block-callout-inner"><span class="block-callout-content"><p>Selecting a modifier from this panel selects the component and not the root actor.</p></span></div></block-callout>';
const CARD = (title, description, href) => `<li><a class="document-list-card" href="${href}"><div class="thumbnail-container"><img class="thumbnail" src="https://cdn.example.com/${title}.png" alt="${title}"></div>`
  + `<div class="document-list-card-content"><div class="document-list-card-content-info"><p class="title">${title}</p>${description ? `<p class="description">${description}</p>` : ''}</div></div></a></li>`;
// The layout of the real pages: the hero image, the notice and any prerequisite box sit above the article, in the
// same column but outside the `<article>` element that holds the text, which is what the default content choice picks.
const epic = (inner, aboveArticle = '') => `<!doctype html><html><head><title>Accessing Terrain</title></head><body><main><header><nav><ol><li>Developer</li><li>Accessing Terrain</li></ol></nav><h1>Accessing Terrain</h1>`
  + `<p>Learn how to set up your project to use terrain.</p></header><div class="row"><div class="col-lg-9"><div class="b-img"><img alt="Accessing Terrain" src="https://cdn.example.com/hero.png"></div>${aboveArticle}`
  + `<header class="document-header"><button type="button">On this page</button></header><article><div class="content-blocks-renderer">${inner}</div></article></div></div></main></body></html>`;

test('a prerequisite callout above the first section is kept, as a blockquote, and the check no longer warns', async () => {
  const html = epic(`<h2>Enable the plugin</h2>${body(6)}<h2>Open the editor</h2>${body(6)}`, CALLOUT);
  const d = await extractHtml(html, URL1);
  assert.match(d.contentMarkdown, /Prerequisite topics/);
  assert.match(d.contentMarkdown, /make sure you are familiar with the following topics/);
  assert.match(d.contentMarkdown, /\[Working with Plugins\]\(https:\/\/docs\.example\.com\/documentation\/unreal-engine\/working-with-plugins\)/);
  assert.match(d.contentMarkdown, /^> .*Prerequisite topics/m);
  assert.deepEqual(d.fidelityWarnings, [], JSON.stringify(d.fidelityWarnings));
});

test('a callout inside the body is a blockquote too', async () => {
  const html = epic(`<h2>Enable the plugin</h2>${body(6)}${WARNING}<h2>Open the editor</h2>${body(6)}`);
  const d = await extractHtml(html, URL1);
  assert.match(d.contentMarkdown, /^> Selecting a modifier from this panel selects the component and not the root actor\./m);
  assert.deepEqual(d.fidelityWarnings, []);
});

test('the fidelity check expects the callout and warns when the clipping lacks it', async () => {
  const { assessFidelity } = await import('../scripts/lib/html-extract.mjs');
  const html = epic(`<h2>Enable the plugin</h2>${body(4)}`, CALLOUT);
  const lacking = '# Accessing Terrain\n\n## Enable the plugin\n\nThe terrain system stores its data in the project.\n';
  const kinds = assessFidelity(html, lacking, 'Accessing Terrain').map((w) => w.kind);
  assert.ok(kinds.includes('callout'), kinds.join(', '));
});

test('child-topic cards keep their descriptions beside their titles, and lose the thumbnail', async () => {
  const cards = `<ul class="block-document-list">${CARD('Script Conditions', 'Learn syntax to write script conditions.', 'https://docs.example.com/documentation/x/conditions')}${CARD('Script Types', 'Learn about the types a script declares.', 'https://docs.example.com/documentation/x/types')}</ul>`;
  const html = epic(`<h2>Scripting Reference</h2>${cards}<h2>Using Scripts</h2>${body(6)}`);
  const d = await extractHtml(html, URL1);
  assert.match(d.contentMarkdown, /^- \[Script Conditions\]\(https:\/\/docs\.example\.com\/documentation\/x\/conditions\): Learn syntax to write script conditions\.$/m);
  assert.match(d.contentMarkdown, /^- \[Script Types\]\(https:\/\/docs\.example\.com\/documentation\/x\/types\): Learn about the types a script declares\.$/m);
  assert.doesNotMatch(d.contentMarkdown, /cdn\.example\.com\/Script/);
  assert.deepEqual(d.fidelityWarnings, []);
});

test('a card with no description keeps its title as the link', async () => {
  const html = epic(`<h2>Scripting Reference</h2><ul>${CARD('Only A Title', '', 'https://docs.example.com/documentation/x/only')}</ul><h2>Using Scripts</h2>${body(6)}`);
  const d = await extractHtml(html, URL1);
  assert.match(d.contentMarkdown, /^- \[Only A Title\]\(https:\/\/docs\.example\.com\/documentation\/x\/only\)$/m);
});

test('a page with neither structure extracts as before: no blockquote, no hero image forced in', async () => {
  const html = `<!doctype html><html><head><title>Plain</title></head><body><main><article><h1>Plain article</h1>${body(8)}<h2>Second section</h2>${body(4)}</article></main></body></html>`;
  const d = await extractHtml(html, 'https://example.com/plain');
  assert.doesNotMatch(d.contentMarkdown, /^>/m);
  assert.match(d.contentMarkdown, /Second section/);
  assert.deepEqual(d.fidelityWarnings, []);
});
