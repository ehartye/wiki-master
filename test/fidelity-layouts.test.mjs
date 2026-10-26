import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessFidelity, assessFidelityDetailed } from '../scripts/lib/html-extract.mjs';

// Three layouts were still reporting a possible loss for headings whose section had been captured:
//  - an Epic documentation API page ends with a "Navigation" section (a breadcrumb and a table of module facts);
//    the extractor keeps the table and drops the heading label;
//  - a GitHub pull request rewrites every comment byline ("nodejs-github-bot commented Oct 1, 2023") into
//    "**nodejs-github-bot** · 2023-10-01" followed by the comment, so the heading text is never found, and a comment
//    that is a few links or a bare review header has no run of prose to prove its capture;
//  - GitHub's hidden "Choose a reason for hiding this comment" dialog is interface text.
// The fixtures are small stand-ins for what was measured on real pages (fetched 2026-10-26); the rules stay narrow
// and every exemption is reported, so a real loss still warns.

const page = (inner) => `<!doctype html><html><head><title>t</title></head><body><main>${inner}</main></body></html>`;
const labels = (w) => w.map((x) => x.label);
const GH = 'https://github.com/example/repo/pull/7';

// ---- an API page's "Navigation" section: the label is gone, the section text is not
const API = '<h1>AutomatedPerfTesting</h1><p>The module for automated performance tests that run in a build.</p>'
  + '<h2>Navigation</h2><p>API &gt; API/Plugins</p><div>Name AutomatedPerfTesting Type Plugin Location /Engine/Plugins/Performance/AutomatedPerfTesting/Source Module Build Rules AutomatedPerfTesting.Build.cs</div>'
  + '<h2>Classes</h2><p>The classes the module defines are listed here with their remarks.</p>';
const API_MD = '# AutomatedPerfTesting\n\nThe module for automated performance tests that run in a build.\n\nAPI > API/Plugins\n\n'
  + '| Name | AutomatedPerfTesting |\n| --- | --- |\n| Type | Plugin |\n| Location | /Engine/Plugins/Performance/AutomatedPerfTesting/Source |\n| Module Build Rules | AutomatedPerfTesting.Build.cs |\n\n'
  + '## Classes\n\nThe classes the module defines are listed here with their remarks.\n';

test('a heading whose whole section text was captured, with only the label missing, is not a loss', () => {
  const html = page(API);
  const d = assessFidelityDetailed(html, API_MD, 'AutomatedPerfTesting', 'https://docs.example.com/api/AutomatedPerfTesting');
  assert.deepEqual(d.warnings, []);
  assert.deepEqual(d.ignored.map((x) => x.label), ['Navigation']);
  assert.match(d.ignored[0].why, /heading label/i);
});

test('the same heading warns when part of its section text is missing from the clipping', () => {
  const partial = API_MD.replace('| Location | /Engine/Plugins/Performance/AutomatedPerfTesting/Source |\n', '');
  assert.deepEqual(labels(assessFidelity(page(API), partial, 'AutomatedPerfTesting')), ['Navigation']);
});

test('it warns when the section text and the label are both missing (a lost callout)', () => {
  const html = page('<h1>Accessing Mesh Terrain</h1><p>Intro text of the page.</p><h6>Prerequisite topics</h6><p>In order to understand and use the content on this page, make sure you are familiar with the following topics:</p><ul><li><a href="/p">Working with Plugins</a></li></ul><h2>Next</h2><p>Body of the next section here.</p>');
  const md = '# Accessing Mesh Terrain\n\nIntro text of the page.\n\n## Next\n\nBody of the next section here.\n';
  assert.deepEqual(labels(assessFidelity(html, md, 'Accessing Mesh Terrain')), ['Prerequisite topics']);
});

test('link cards whose descriptions were dropped still warn: only their titles survived', () => {
  const html = page('<h1>BuildGraph</h1><p>Intro to the page and its scope.</p><h2>Scripting Reference</h2><ul><li><a href="/c">Script Conditions Learn syntax to write script conditions for the graph.</a></li><li><a href="/t">Script Types Learn about valid data types for script properties.</a></li></ul>');
  const md = '# BuildGraph\n\nIntro to the page and its scope.\n\n- [Script Conditions](https://x/img)\n- [Script Types](https://x/img)\n';
  assert.deepEqual(labels(assessFidelity(html, md, 'BuildGraph')), ['Scripting Reference']);
});

test('a short section (fewer than two five-word windows) is not exempt, and neither is a long one', () => {
  const short = page('<h1>Page title here</h1><p>Intro paragraph of the page.</p><h2>Notes</h2><p>Only six words in here.</p>');
  assert.deepEqual(labels(assessFidelity(short, '# Page title here\n\nIntro paragraph of the page.\n\nOnly six words in here.\n', 'Page title here')), ['Notes']);
  const longText = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');
  const long = page(`<h1>Page title here</h1><p>Intro paragraph of the page.</p><h2>Notes</h2><p>${longText}</p>`);
  assert.deepEqual(labels(assessFidelity(long, `# Page title here\n\nIntro paragraph of the page.\n\n${longText}\n`, 'Page title here')), ['Notes']);
});

test('the section text must match as whole words in order, not as scattered words', () => {
  const html = page('<h1>Page title here</h1><p>Intro paragraph of the page.</p><h2>Notes</h2><p>alpha beta gamma delta epsilon zeta eta theta iota kappa</p>');
  const scattered = '# Page title here\n\nIntro paragraph of the page.\n\nkappa iota theta eta zeta epsilon delta gamma beta alpha\n';
  assert.deepEqual(labels(assessFidelity(html, scattered, 'Page title here')), ['Notes']);
});

// ---- GitHub: "Choose a reason for hiding this comment" is interface text
test('the hide-comment dialog heading is GitHub chrome, on github.com only', () => {
  const html = page('<h1>Fix the thing</h1><p>Description of the change in this pull request.</p><h3>Choose a reason for hiding this comment</h3><p>The reason will be displayed to describe this comment to others. Learn more.</p>');
  const md = '# Fix the thing\n\nDescription of the change in this pull request.\n';
  const d = assessFidelityDetailed(html, md, 'Fix the thing', GH);
  assert.deepEqual(d.warnings, []);
  assert.deepEqual(d.ignored.map((x) => x.label), ['Choose a reason for hiding this comment']);
  assert.deepEqual(labels(assessFidelity(html, md, 'Fix the thing', 'https://blog.example.com/post')), ['Choose a reason for hiding this comment']);
});

// ---- GitHub comment bylines: the clipper writes the author in bold with an ISO date
const PR = (comment) => page(`<h1>Fix the thing</h1><p>Description of the change in this pull request.</p>${comment}`);
const COMMENT = (byline) => `<h3>${byline}</h3><p>Copy link</p><p><a href="/t/a">Review requested</a>: <a href="/t/b">@team/actions</a></p>`;
const PR_MD = (quote) => `# Fix the thing\n\nDescription of the change in this pull request.\n\n${quote}\n`;

test('a comment byline is ignored when the author and date appear in the comment header', () => {
  const html = PR(COMMENT('some-bot commented Oct 1, 2023'));
  const md = PR_MD('> **some-bot** · 2023-10-01\n>\n> Review requested:');
  const d = assessFidelityDetailed(html, md, 'Fix the thing', GH);
  assert.deepEqual(d.warnings, []);
  assert.match(d.ignored[0].why, /author and date/i);
});

test('a "left a comment" byline has no date and is ignored on the bold author alone', () => {
  const html = PR(COMMENT('Some Reviewer (reviewer1) left a comment'));
  assert.deepEqual(assessFidelity(html, PR_MD('> **Some Reviewer (reviewer1)** ·\n>\n> Looks fine.'), 'Fix the thing', GH), []);
});

test('a byline still warns when the author is not in the clipping, or the date differs', () => {
  const html = PR(COMMENT('some-bot commented Oct 1, 2023'));
  assert.deepEqual(labels(assessFidelity(html, PR_MD('> **other-bot** · 2023-10-01'), 'Fix the thing', GH)), ['some-bot commented Oct 1, 2023']);
  assert.deepEqual(labels(assessFidelity(html, PR_MD('> **some-bot** · 2023-10-04'), 'Fix the thing', GH)), ['some-bot commented Oct 1, 2023']);
  assert.deepEqual(labels(assessFidelity(html, PR_MD('some-bot wrote something on 2023-10-01 without the bold name'), 'Fix the thing', GH)), ['some-bot commented Oct 1, 2023']);
});

test('a byline whose date cannot be read, and a byline on another host, are not exempt', () => {
  const relative = PR(COMMENT('some-bot commented 3 days ago'));
  assert.deepEqual(labels(assessFidelity(relative, PR_MD('> **some-bot** · 2023-10-01'), 'Fix the thing', GH)), ['some-bot commented 3 days ago']);
  const html = PR(COMMENT('some-bot commented Oct 1, 2023'));
  assert.deepEqual(labels(assessFidelity(html, PR_MD('> **some-bot** · 2023-10-01'), 'Fix the thing', 'https://forum.example.com/t/1')), ['some-bot commented Oct 1, 2023']);
});

test('a label with a digit, or with more than three words, is never treated as just a label', () => {
  const body = 'This section explains what changed in the release and why each change was made.';
  for (const heading of ['Release notes for 2024', 'A very long section title']) {
    const html = page(`<h1>Page title here</h1><p>Intro paragraph of the page.</p><h2>${heading}</h2><p>${body}</p>`);
    const md = `# Page title here\n\nIntro paragraph of the page.\n\n${body}\n`;
    assert.deepEqual(labels(assessFidelity(html, md, 'Page title here')), [heading], heading);
  }
  const html = page(`<h1>Page title here</h1><p>Intro paragraph of the page.</p><h2>Changes</h2><p>${body}</p>`);
  assert.deepEqual(assessFidelity(html, `# Page title here\n\nIntro paragraph of the page.\n\n${body}\n`, 'Page title here'), [], 'a short label without digits is');
});

test('a short label that holds a digit is not just a label, and the section text must match whole words', () => {
  const body = 'This section explains what changed in the release and why each change was made.';
  const html = page(`<h1>Page title here</h1><p>Intro paragraph of the page.</p><h2>Version 2024</h2><p>${body}</p>`);
  const md = `# Page title here\n\nIntro paragraph of the page.\n\n${body}\n`;
  assert.deepEqual(labels(assessFidelity(html, md, 'Page title here')), ['Version 2024'], 'two words, but a digit: it names a release, which is information');

  const section = page('<h1>Page title here</h1><p>Intro paragraph of the page.</p><h2>Notes</h2><p>alpha beta gamma delta epsilon zeta eta theta iota kappa</p>');
  const embedded = '# Page title here\n\nIntro paragraph of the page.\n\nZalpha beta gamma delta epsilonZ Zzeta eta theta iota kappaZ\n';
  assert.deepEqual(labels(assessFidelity(section, embedded, 'Page title here')), ['Notes'], 'the words are inside longer words, so the text was not captured');
});
