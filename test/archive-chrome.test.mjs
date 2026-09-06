// Web-archive services inject a banner above the page they serve, and Defuddle
// has no reason to know it is not the article. Three clippings in the reference
// vault open with one, so every quote taken from their first paragraph would be
// archival boilerplate attributed to the source.
//
// This vault leans on archives heavily -- 9 web.archive.org and 2
// wayback.archive-it.org urls in one triage queue -- so it recurs.
//
// Both banner texts below are verbatim from real clippings in raw/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stripArchiveChrome } from '../scripts/clip.mjs';

const ARCHIVE_IT = 'hide You are viewing an archived web page collected at the request of [University of Minnesota](https://archive-it.org/organizations/121) using [Archive-It](https://archive-it.org/). This page was captured on 15:29:26 Jan 22, 2019. The information on this web page may be out of date. See [All versions](https://wayback.archive-it.org/org-121/*/http://www.cehd.umn.edu/ci/rationalnumberproject/rnp1-09.html) of this archived page. Found 0 archived media items out of 0 total on this page.\n\n<\n\n×\n\n\\>\n\n';

test('an archive-it banner is removed and the article kept intact', () => {
  const article = 'Rational Number Project: Initial Fraction Ideas\n\nCramer, K., Behr, M., Post T., Lesh, R., (2009)';
  const out = stripArchiveChrome(ARCHIVE_IT + article);
  assert.equal(out, article);
});

test('a wayback header line is removed', () => {
  const md = 'The Wayback Machine - https://web.archive.org/web/20130827063035/http://www.turnonccmath.net/index.php?p=map\n\nReal content begins here.';
  assert.equal(stripArchiveChrome(md), 'Real content begins here.');
});

test('an ordinary clipping is returned byte-identical', () => {
  // The overwhelmingly common case. A strip that rewrites normal clippings
  // would change every source-hash in the vault on the next re-clip.
  const md = '# A normal article\n\nIt mentions the Wayback Machine in passing, and archived pages generally.';
  assert.equal(stripArchiveChrome(md), md);
});

test('the banner is only stripped at the top, never mid-article', () => {
  // An article ABOUT web archiving may quote the banner text. Only a document
  // that opens with it is wearing it.
  const md = 'A study of link rot.\n\nArchive-It shows: "You are viewing an archived web page collected at the request of someone".';
  assert.equal(stripArchiveChrome(md), md);
});

test('content that is nothing but banner collapses to empty, so the thin floor catches it', () => {
  // index.php.md reached 385 words on banner plus terms-of-use text and passed
  // the 100-word floor as if it were an article. Stripping first lets the floor
  // do its job.
  assert.equal(stripArchiveChrome(ARCHIVE_IT).trim(), '');
});

test('empty and non-string input is handled without throwing', () => {
  assert.equal(stripArchiveChrome(''), '');
  assert.equal(stripArchiveChrome(undefined), '');
  assert.equal(stripArchiveChrome(null), '');
});
