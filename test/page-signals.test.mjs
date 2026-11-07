import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractHtml } from '../scripts/lib/html-extract.mjs';
import { renderAttempt } from '../scripts/clip.mjs';

// What the clipper learns from a page's own HTML before any cleaning. Everything here goes through the real extractor:
// with an injected `extract` these tests would pass while real runs found nothing.

const URL_A = 'https://docs.example.test/guide/page.html';
const PROSE = '<p>The guide explains how the service behaves in plain words so that the extractor has an article to keep.</p>';
const page = (body) => `<!doctype html><html><head><title>Guide</title></head><body>${body}</body></html>`;
const signalsOf = async (body) => (await extractHtml(page(body), URL_A)).pageSignals;

test('pdfLinks are the distinct absolute PDF URLs of the content region, resolved against the page', async () => {
  const { pdfLinks } = await signalsOf(`
    <header><a href="/header.pdf">Brochure</a></header>
    <nav><a href="/nav.pdf">Manual</a></nav>
    <main>${PROSE}
      <a href="report.pdf">Report</a>
      <a href="/guide/report.pdf#page=2">Report, page 2</a>
      <a href="https://cdn.example.test/white-paper.PDF?dl=1">White paper</a>
      <a href="/pdf/landing">A page about PDFs</a>
      <a href="mailto:someone@example.test?subject=x.pdf">Mail</a>
      <header><a href="/inner-header.pdf">Inner header</a></header>
      <footer><a href="/inner-footer.pdf">Inner footer</a></footer>
    </main>
    <aside><a href="/outside-the-main.pdf">Outside</a></aside>
    <footer><a href="/footer.pdf">Terms</a></footer>`);
  assert.deepEqual(pdfLinks, ['https://docs.example.test/guide/report.pdf', 'https://cdn.example.test/white-paper.PDF?dl=1']);
});

test('without main or article the region is the body, still leaving out nav, header and footer', async () => {
  const { pdfLinks } = await signalsOf(`
    <header><a href="/header.pdf">Brochure</a></header><nav><a href="/nav.pdf">Manual</a></nav>
    <div>${PROSE}<a href="/body.pdf">Body</a></div>
    <footer><a href="/footer.pdf">Terms</a></footer>`);
  assert.deepEqual(pdfLinks, ['https://docs.example.test/body.pdf']);
});

test('an article is the region when there is no main', async () => {
  const { pdfLinks } = await signalsOf(`<aside><a href="/aside.pdf">Aside</a></aside><article>${PROSE}<a href="/article.pdf">Article</a></article>`);
  assert.deepEqual(pdfLinks, ['https://docs.example.test/article.pdf']);
});

test('a base element moves what a relative link resolves against, as it does in a browser', async () => {
  const data = await extractHtml(`<!doctype html><html><head><base href="/docs/"></head><body><main>${PROSE}<a href="a.pdf">A</a></main></body></html>`, URL_A);
  assert.deepEqual(data.pageSignals.pdfLinks, ['https://docs.example.test/docs/a.pdf']);
});

test('markdownLinks are the labeled or typed links of the region', async () => {
  const { markdownLinks } = await signalsOf(`
    <nav><a href="/nav.md" type="text/markdown">Markdown</a></nav>
    <main>${PROSE}
      <a href="page.md">View page in Markdown</a>
      <a href="/other.txt">view as markdown</a>
      <a href="/typed" type="text/markdown">Source</a>
      <a href="/plain.md">Markdown guide</a>
    </main>`);
  assert.deepEqual(markdownLinks, ['https://docs.example.test/guide/page.md', 'https://docs.example.test/other.txt', 'https://docs.example.test/typed']);
});

// tabControls counts only the tabs whose panel the HTML leaves unread.
const tab = (attrs, label = 'Tab') => `<button role="tab" ${attrs}>${label}</button>`;
const CASES = [
  ['empty panels', 3, `<div role="tablist">${tab('aria-controls="a"')}${tab('aria-controls="b"')}${tab('aria-controls="c"')}</div>
    <div role="tabpanel" id="a"></div><div role="tabpanel" id="b" hidden>  </div><div role="tabpanel" id="c" hidden><script>var x = 1;</script><style>a{}</style></div>`],
  ['aria-controls naming a panel the HTML does not hold', 2, `<div role="tablist">${tab('aria-controls="absent-1"')}${tab('aria-controls="absent-2"')}</div>`],
  ['an id lookups cannot take as a selector', 1, `<div role="tablist">${tab('aria-controls="r:1:.x"')}</div><div role="tabpanel" id="r:1:.x"></div>`],
  ['aria-labelledby from an empty panel', 1, `<div role="tablist">${tab('id="t1"')}</div><div role="tabpanel" aria-labelledby="t1"></div>`],
  ['position in the group', 1, `<div role="tablist">${tab('')}${tab('')}</div><div role="tabpanel"><p>Full</p></div><div role="tabpanel"></div>`],
  ['panels with content, also hidden', 0, `<div role="tablist">${tab('aria-controls="a"')}${tab('aria-controls="b"')}</div>
    <div role="tabpanel" id="a"><p>First</p></div><div role="tabpanel" id="b" hidden><p>Second</p></div>`],
  ['a panel holding only an image', 0, `<div role="tablist">${tab('aria-controls="a"')}</div><div role="tabpanel" id="a"><img src="/x.png" alt=""></div>`],
  ['tabs that cannot be linked to a panel', 0, `<div role="tablist">${tab('')}${tab('')}${tab('')}</div><div role="tabpanel"><p>Only the open one</p></div>`],
  ['tabs with no panel at all', 0, `<div role="tablist">${tab('')}${tab('')}</div>`],
];
for (const [name, want, markup] of CASES) {
  test(`tabControls: ${name} gives ${want}`, async () => {
    assert.equal((await signalsOf(`<main>${PROSE}${markup}</main>`)).tabControls, want);
  });
}

test('tabControls leaves out tabs in nav, header and footer', async () => {
  const empty = `<div role="tablist">${tab('aria-controls="gone"')}</div>`;
  const signals = await signalsOf(`<main>${PROSE}<nav>${empty}</nav><header>${empty}</header><footer>${empty}</footer></main>`);
  assert.equal(signals.tabControls, 0);
});

test('a plain page has empty signals, and they reach the clipper through extract-page and the render route', async (t) => {
  assert.deepEqual(await signalsOf(`<main>${PROSE}</main>`), { tabControls: 0, pdfLinks: [], markdownLinks: [] });

  const tmp = mkdtempSync(join(tmpdir(), 'wm-signals-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const rendered = page(`<main>${PROSE}<a href="/rendered.pdf">Paper</a><div role="tablist">${tab('aria-controls="gone"')}</div></main>`);
  const run = (cmd) => {
    const out = /render-page\.mjs" "[^"]+" "([^"]+)"/.exec(cmd)?.[1];
    if (!out) return execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    writeFileSync(out, rendered);
    return JSON.stringify({ htmlFile: out, finalUrl: URL_A, status: 200, title: 'Guide', words: 40 });
  };
  const result = renderAttempt(URL_A, { run, tmp });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.pageSignals, { tabControls: 1, pdfLinks: ['https://docs.example.test/rendered.pdf'], markdownLinks: [] });
});
