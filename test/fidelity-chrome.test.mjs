import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessFidelity, assessFidelityDetailed, extractHtml } from '../scripts/lib/html-extract.mjs';

// Every Microsoft Learn clip queued a triage entry for a single site heading, `Feedback`, although each
// sentence relied on was present. The fidelity check looks for the page's headings in the extracted text
// and calls any it cannot find a possible loss; site chrome (a feedback widget, a share row, GitHub's
// sidebar) is removed on purpose, so it was a false alarm each time and hid the real ones. These pages are
// small stand-ins for the structures measured on real pages; the rules are deliberately narrow.

const page = (inner, head = '') => `<!doctype html><html><head><title>t</title>${head}</head><body><main>${inner}</main></body></html>`;
const ARTICLE = '<h1>Terminating a Process</h1><h2>Syntax</h2><p>Call the function with a handle and an exit code.</p><h2>Remarks</h2><p>The handle must have the right access.</p>';
const FEEDBACK = '<section id="site-user-feedback-footer"><h2>Feedback</h2><p>Was this page helpful?</p><p><a href="/y">Yes</a> <a href="/n">No</a> <a href="/f">Provide product feedback</a></p></section>';
const MD = '# Terminating a Process\n\n## Syntax\n\nCall the function with a handle and an exit code.\n\n## Remarks\n\nThe handle must have the right access.\n';
const labels = (w) => w.map((x) => x.label);

test('a Feedback widget that the extractor removed is not a possible loss', () => {
  const html = page(ARTICLE + FEEDBACK);
  assert.deepEqual(assessFidelity(html, MD, 'Terminating a Process'), []);
  const d = assessFidelityDetailed(html, MD, 'Terminating a Process');
  assert.deepEqual(d.ignored.map((x) => x.label), ['Feedback']);
  assert.match(d.ignored[0].why, /page chrome/i);
});

test('a missing content heading still warns, beside the ignored Feedback', () => {
  const lost = MD.replace('## Remarks\n\nThe handle must have the right access.\n', '');
  assert.deepEqual(labels(assessFidelity(page(ARTICLE + FEEDBACK), lost, 'Terminating a Process')), ['Remarks']);
});

test('Applies to is substantive and is never treated as chrome', () => {
  const html = page(ARTICLE + '<h2>Applies to</h2><p>Windows 10 and later versions of the client and server editions.</p>' + FEEDBACK);
  assert.deepEqual(labels(assessFidelity(html, MD, 'Terminating a Process')), ['Applies to']);
});

test('a Feedback heading that carries a long body is not treated as chrome', () => {
  const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
  const html = page(ARTICLE + `<section><h2>Feedback</h2><p>${long}</p></section>`);
  assert.deepEqual(labels(assessFidelity(html, MD, 'Terminating a Process')), ['Feedback']);
});

test('only the exact chrome heading counts: a longer heading that starts with a chrome word warns', () => {
  const html = page(ARTICLE + '<h2>Share your results with the team</h2><p>Short note.</p>');
  assert.deepEqual(labels(assessFidelity(html, MD, 'Terminating a Process')), ['Share your results with the team']);
});

test('blog chrome headings the extractor removed are ignored', () => {
  const chrome = ['Share', 'Read next', 'Related posts', 'Recent posts', 'Stay informed'].map((h) => `<h2>${h}</h2><p><a href="/a">Another post title</a></p>`).join('');
  const d = assessFidelityDetailed(page(ARTICLE + chrome), MD, 'Terminating a Process', 'https://blog.example.com/post');
  assert.deepEqual(d.warnings, []);
  assert.deepEqual(d.ignored.map((x) => x.label), ['Share', 'Read next', 'Related posts', 'Recent posts', 'Stay informed']);
});

test('GitHub chrome headings are ignored on github.com only', () => {
  const side = ['Repository navigation', 'Reviewers', 'Assignees', 'Labels', 'Projects', 'Milestone', 'Development', '4 participants', 'Conversation']
    .map((h) => `<h2>${h}</h2><p>None yet</p>`).join('');
  const html = page(ARTICLE + side);
  const onGithub = assessFidelityDetailed(html, MD, 'Terminating a Process', 'https://github.com/o/r/pull/1');
  assert.deepEqual(onGithub.warnings, []);
  assert.equal(onGithub.ignored.length, 9);
  const elsewhere = assessFidelityDetailed(html, MD, 'Terminating a Process', 'https://docs.example.com/page');
  assert.deepEqual(labels(elsewhere.warnings), ['Repository navigation', 'Reviewers', 'Assignees', 'Labels', 'Projects', 'Milestone', 'Development', '4 participants', 'Conversation']);
});

test('headings inside a sidebar or dropdown container with only a link list are ignored, and the same headings outside one are not', () => {
  const list = (h) => `<div class="column"><h2>${h}</h2><ul><li><a href="/a">git-add</a></li><li><a href="/b">git-mv</a></li></ul></div>`;
  const inContainer = `<div id="topics-dropdown" class="dropdown-panel">${list('Setup and Config')}${list('Basic Snapshotting')}</div>`;
  const d = assessFidelityDetailed(page(ARTICLE + inContainer), MD, 'Terminating a Process', 'https://git-scm.com/docs/x');
  assert.deepEqual(d.warnings, []);
  assert.deepEqual(d.ignored.map((x) => x.label), ['Setup and Config', 'Basic Snapshotting']);
  const outside = assessFidelityDetailed(page(ARTICLE + `<div class="content">${list('Setup and Config')}</div>`), MD, 'Terminating a Process', 'https://git-scm.com/docs/x');
  assert.deepEqual(labels(outside.warnings), ['Setup and Config']);
});

test('a container ends the section: text after a sidebar does not count against its last heading', () => {
  const afterwards = Array.from({ length: 120 }, (_, i) => `following${i}`).join(' ');
  const html = page(`<div id="topics-dropdown" class="dropdown-panel"><div class="column"><h2>Plumbing Commands</h2><ul><li><a href="/a">git-cat-file</a></li></ul></div></div><p>${afterwards}</p>` + ARTICLE);
  const d = assessFidelityDetailed(html, MD, 'Terminating a Process', 'https://git-scm.com/docs/x');
  assert.deepEqual(d.warnings, []);
  assert.deepEqual(d.ignored.map((x) => x.label), ['Plumbing Commands']);
});

test('a heading inside a menu container still warns when its section is long', () => {
  const long = Array.from({ length: 80 }, (_, i) => `dish${i}`).join(' ');
  const html = page(ARTICLE + `<div class="menu"><h2>Dinner</h2><p>${long}</p></div>`);
  assert.deepEqual(labels(assessFidelity(html, MD, 'Terminating a Process')), ['Dinner']);
});

test('a container token above the content root does not exempt the whole page', () => {
  const html = `<!doctype html><html><body class="has-sidebar"><div class="layout-menu"><main>${ARTICLE}</main></div></body></html>`;
  const lost = MD.replace('## Remarks\n\nThe handle must have the right access.\n', '');
  assert.deepEqual(labels(assessFidelity(html, lost, 'Terminating a Process')), ['Remarks']);
});

test('a heading that restates the page title is kept as metadata, and a status line that starts with it is too', () => {
  const html = page('<h1>Bump actions/upload-artifact from 3.1.2 to 3.1.3 - #50000</h1><h1>Bump actions/upload-artifact from 3.1.2 to 3.1.3 - #50000 merged 1 commit into main from dependabot</h1><h2>Syntax</h2><p>Call the function.</p>');
  const md = '## Syntax\n\nCall the function.\n';
  const d = assessFidelityDetailed(html, md, 'Bump actions/upload-artifact from 3.1.2 to 3.1.3 by dependabot · Pull Request #50000 · o/r');
  assert.deepEqual(d.warnings, []);
  assert.equal(d.ignored.length, 2);
  assert.ok(d.ignored.every((x) => /title/i.test(x.why)));
});

test('a heading with words the title does not have is not mistaken for the title', () => {
  const html = page('<h1>Completely different heading about something else entirely</h1><h2>Syntax</h2><p>Call the function.</p>');
  const d = assessFidelityDetailed(html, '## Syntax\n\nCall the function.\n', 'Terminating a Process');
  assert.deepEqual(labels(d.warnings), ['Completely different heading about something else entirely']);
  // Sharing some words with the title is not enough: every word must be the title's.
  const partial = assessFidelityDetailed(page('<h1>Terminating the old runtime safely</h1><h2>Syntax</h2><p>Call the function.</p>'), '## Syntax\n\nCall the function.\n', 'Terminating a Process');
  assert.deepEqual(labels(partial.warnings), ['Terminating the old runtime safely']);
});

test('a GitHub comment byline is ignored only when the comment body was captured', () => {
  const body = 'Bumps the action to the latest release and updates the lock file for every workflow in the repository.';
  const html = page(`<h1>Syntax</h1><div class="timeline-comment-header"><h3>dependabot commented Oct 1, 2023</h3></div><p>${body}</p>`);
  const kept = assessFidelityDetailed(html, `# Syntax\n\n${body}\n`, 'Syntax', 'https://github.com/o/r/pull/1');
  assert.deepEqual(kept.warnings, []);
  assert.match(kept.ignored[0].why, /comment/i);
  const lost = assessFidelityDetailed(html, '# Syntax\n', 'Syntax', 'https://github.com/o/r/pull/1');
  assert.deepEqual(labels(lost.warnings), ['dependabot commented Oct 1, 2023']);
});

test('a byline on another host is not special', () => {
  const body = 'Bumps the action to the latest release and updates the lock file for every workflow in the repository.';
  const html = page(`<h1>Syntax</h1><h3>dependabot commented Oct 1, 2023</h3><p>${body}</p>`);
  assert.deepEqual(labels(assessFidelity(html, `# Syntax\n\n${body}\n`, 'Syntax', 'https://forum.example.com/t/1')), ['dependabot commented Oct 1, 2023']);
});

test('extractHtml reports the ignored headings in the assessment and leaves the warnings empty', async () => {
  const html = page(ARTICLE + FEEDBACK);
  const data = await extractHtml(html, 'https://learn.example.com/page', { extractImpl: async () => ({ title: 'Terminating a Process', contentMarkdown: MD }) });
  assert.deepEqual(data.fidelityWarnings, []);
  assert.deepEqual(data.fidelityAssessment.ignored.map((x) => x.label), ['Feedback']);
  assert.equal(data.fidelityAssessment.missing, 0);
  assert.ok(data.fidelityAssessment.checked >= 4);
});
