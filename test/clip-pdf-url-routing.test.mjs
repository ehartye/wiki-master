// A PDF url sent to the HTML clipper should say so, not fail cryptically.
//
// Found 2026-09-05 replaying the failed-clip queue: arxiv.org/pdf/2404.03337
// (content-type application/pdf, confirmed live) went through the whole ladder
// -- four Defuddle attempts, then a full browser render -- and surfaced as
//
//   clip failed — rendered, but extraction failed: Command failed: npx --yes defuddle parse …
//
// which names neither the cause nor the cure. The vault already has a clipper
// for this (clip-pdf, and eight arxiv PDFs sit in raw/ correctly extracted by
// it); the only thing missing was telling anyone to use it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { looksLikePdfUrl } from '../scripts/clip.mjs';

test('a url whose path ends in .pdf is a pdf', () => {
  // Real vault source, correctly clipped by clip-pdf as cambridge-espresso-ratio.md.
  assert.equal(
    looksLikePdfUrl('https://www.cambridgemaths.org/Images/espresso_36_developing_concepts_of_ratio.pdf'),
    true
  );
  assert.equal(looksLikePdfUrl('https://example.test/a/b/paper.PDF'), true, 'extension is case-insensitive');
});

test('arxiv-style /pdf/ paths are pdfs even with no extension', () => {
  // The case that actually failed. Every arxiv PDF in this vault has this
  // shape: /pdf/<id> with no .pdf suffix at all.
  assert.equal(looksLikePdfUrl('https://arxiv.org/pdf/2404.03337'), true);
  assert.equal(looksLikePdfUrl('https://arxiv.org/pdf/2607.06766v2'), true);
});

test('a query string does not hide the extension', () => {
  assert.equal(looksLikePdfUrl('https://example.test/doc.pdf?download=1'), true);
});

test('ordinary pages are not mistaken for pdfs', () => {
  for (const u of [
    'https://home.army.mil/campbell/Go160thSOAR',        // text/html, confirmed live
    'https://example.test/pdfs',                          // not a /pdf/ segment
    'https://example.test/pdfviewer/help',                // not a /pdf/ segment
    'https://example.test/blog/how-to-read-a-pdf-file',   // .pdf inside a slug, not an extension
  ]) {
    assert.equal(looksLikePdfUrl(u), false, `${u} must not be treated as a pdf`);
  }
});

test('a malformed url is not a pdf rather than throwing', () => {
  assert.equal(looksLikePdfUrl('not a url'), false);
  assert.equal(looksLikePdfUrl(''), false);
  assert.equal(looksLikePdfUrl(undefined), false);
});
