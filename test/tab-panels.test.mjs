import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractHtml } from '../scripts/lib/html-extract.mjs';
import { main } from '../scripts/clip.mjs';

// Tab panels the served HTML already holds are kept on every extraction. All of it runs through the real extractor,
// because the losses are Defuddle's: it drops hidden panels, and its case-insensitive `tabs-` partial selector drops
// whatever sits in a tab wrapper unless the wrapper holds code.

const URL_A = 'https://docs.example.test/guide/pricing';
const PROSE = `<p>${'The guide explains how the service behaves in plain words so that the extractor has an article to keep. '.repeat(8)}</p>`;
const table = (tier, price) => `<table><thead><tr><th>Tier</th><th>Price</th></tr></thead><tbody><tr><td>${tier}</td><td>${price}</td></tr></tbody></table>`;
const page = (markup) => `<!doctype html><html><head><title>Guide</title></head><body><main><h1>Guide</h1>${PROSE}<h2>Pricing</h2>${markup}</main></body></html>`;
const md = async (markup, url = URL_A) => (await extractHtml(page(markup), url)).contentMarkdown;

const tabs = (...labels) => `<div role="tablist">${labels.map((label, i) => `<button role="tab" aria-controls="p${i}" aria-selected="${i === 0}">${label}</button>`).join('')}</div>`;
const panel = (i, content, attrs = i ? 'hidden' : '') => `<div role="tabpanel" id="p${i}" ${attrs}>${content}</div>`;
const TWO = tabs('Alpha', 'Beta') + panel(0, table('alpha-tier', 'one-dollar')) + panel(1, table('beta-tier', 'two-dollars'));

function assertBothPanels(text) {
  const alpha = text.search(/^#{2,6} Alpha$/m), beta = text.search(/^#{2,6} Beta$/m);
  assert.ok(alpha >= 0 && beta > alpha, `each panel is under its tab's label, in order:\n${text}`);
  assert.ok(text.indexOf('alpha-tier') > alpha && text.indexOf('alpha-tier') < beta, `the first table is under the first label:\n${text}`);
  assert.ok(text.indexOf('beta-tier') > beta, `the hidden panel's table is under its label:\n${text}`);
  assert.equal(text.match(/\bAlpha\b/g).length, 1, `the tab list is gone:\n${text}`);
}

// Defuddle deleted the panels of the first five `tabs-` shapes outright; the others lost only their hidden panels.
const WRAPPERS = [
  ['no wrapper', TWO],
  ['tabs-container', `<div class="tabs-container">${TWO}</div>`],
  ['tabs-wrapper > tabs-container', `<div class="tabs-wrapper"><div class="tabs-container">${TWO}</div></div>`],
  ['a mantine-Tabs-root class', `<div class="mantine-Tabs-root">${TWO}</div>`],
  ['data-testid="tabs-root"', `<div data-testid="tabs-root">${TWO}</div>`],
  ['an id with tabs-', `<div id="tabs-1"><section>${TWO}</section></div>`],
  ['div.tabs-body inside the panel', tabs('Alpha', 'Beta') + panel(0, `<div class="tabs-body">${table('alpha-tier', 'one-dollar')}</div>`) + panel(1, `<div class="tabs-body"><div data-qa="tabs-inner">${table('beta-tier', 'two-dollars')}</div></div>`)],
  ['tab-content', `<div class="tab-content">${TWO}</div>`],
  ['tabContent', `<div class="tabContent">${TWO}</div>`],
  ['tabs_container', `<div class="tabs_container">${TWO}</div>`],
];
for (const [name, markup] of WRAPPERS) {
  test(`every panel survives with ${name}`, async () => assertBothPanels(await md(markup)));
}

test('a callout, which switches on the documentation handling, keeps every panel too', async () => {
  const text = await md(`<div class="admonition"><p>Prices change monthly and are listed here for reference.</p></div>${TWO}`);
  assertBothPanels(text);
  assert.match(text, /Prices change monthly/);
});

test('a wrapper-matching table is unwrapped by its attribute, not by losing its structure', async () => {
  const text = await md(tabs('Alpha', 'Beta') + panel(0, `<table class="tabs-table"><thead><tr><th>Tier</th></tr></thead><tbody><tr><td>alpha-tier</td></tr></tbody></table>`) + panel(1, table('beta-tier', 'two-dollars')));
  assert.match(text, /\|\s*alpha-tier\s*\|/);
});

test('labels come from aria-controls, then aria-labelledby, then position, and a panel with none is still kept', async () => {
  const controlsBeatPosition = `<div role="tablist"><button role="tab" aria-controls="second">Second</button><button role="tab" aria-controls="first">First</button></div>
    <div role="tabpanel" id="first">${table('first-tier', '1')}</div><div role="tabpanel" id="second" hidden>${table('second-tier', '2')}</div>`;
  let text = await md(controlsBeatPosition);
  assert.ok(text.search(/^#{2,6} First$/m) < text.indexOf('first-tier') && text.indexOf('first-tier') < text.search(/^#{2,6} Second$/m), text);

  text = await md(`<div role="tablist"><button role="tab" id="t-a">Alpha</button><button role="tab" id="t.b:c">Beta</button></div>
    <div role="tabpanel" aria-labelledby="t.b:c">${table('beta-tier', '1')}</div><div role="tabpanel" aria-labelledby="t-a" hidden>${table('alpha-tier', '2')}</div>`);
  assert.ok(text.search(/^#{2,6} Beta$/m) < text.indexOf('beta-tier') && text.search(/^#{2,6} Alpha$/m) < text.indexOf('alpha-tier'), text);
  assert.ok(text.indexOf('beta-tier') < text.search(/^#{2,6} Alpha$/m), text);

  text = await md(`<div role="tablist"><button role="tab">Gamma</button><button role="tab">Delta</button></div>
    <div role="tabpanel">${table('gamma-tier', '1')}</div><div role="tabpanel" hidden>${table('delta-tier', '2')}</div>`);
  assert.ok(text.search(/^#{2,6} Gamma$/m) < text.indexOf('gamma-tier') && text.search(/^#{2,6} Delta$/m) < text.indexOf('delta-tier'), text);

  // Three tabs and one panel, with nothing linking them: the panel can't be attributed to any of them.
  text = await md(`<div role="tablist"><button role="tab">One</button><button role="tab">Two</button><button role="tab">Three</button></div>
    <div role="tabpanel">${table('only-tier', '1')}</div>`);
  assert.match(text, /only-tier/);
  assert.doesNotMatch(text, /^#{1,6} (One|Two|Three)$/m);
});

test('a panel with no tab list at all is kept without a heading, hiding removed', async () => {
  const text = await md(`<div role="tabpanel" hidden>${table('orphan-tier', '1')}</div>`);
  assert.match(text, /orphan-tier/);
});

test('hiding is removed however the panel was hidden', async () => {
  const text = await md(`${tabs('A1', 'B2', 'C3')}${panel(0, table('a-tier', '1'), 'style="display:none"')}${panel(1, table('b-tier', '2'), 'aria-hidden="true"')}${panel(2, table('c-tier', '3'), 'class="hidden invisible"')}`);
  for (const tier of ['a-tier', 'b-tier', 'c-tier']) assert.match(text, new RegExp(tier));
});

test('nested panels are kept, each under its own label one level below its parent', async () => {
  const inner = `<div role="tablist"><button role="tab" aria-controls="in-py">Python</button><button role="tab" aria-controls="in-js">Node</button></div>
    <div role="tabpanel" id="in-py"><pre><code>print("python-sample")</code></pre></div><div role="tabpanel" id="in-js" hidden><pre><code>log("node-sample")</code></pre></div>`;
  const text = await md(`<div role="tablist"><button role="tab" aria-controls="out-a">Client</button><button role="tab" aria-controls="out-b">Server</button></div>
    <div role="tabpanel" id="out-a">${inner}</div><div role="tabpanel" id="out-b" hidden>${table('server-tier', '1')}</div>`);
  const at = (re) => text.search(re);
  assert.ok(at(/^### Client$/m) >= 0 && at(/^#### Python$/m) > at(/^### Client$/m) && at(/^#### Node$/m) > at(/^#### Python$/m) && at(/^### Server$/m) > at(/^#### Node$/m), text);
  for (const sample of ['python-sample', 'node-sample', 'server-tier']) assert.match(text, new RegExp(sample));
});

test('identical panels in a group appear once; panels differing only in a link destination do not', async () => {
  const shared = table('same-tier', 'same-price');
  const once = await md(tabs('Monthly', 'Yearly') + panel(0, shared) + panel(1, shared));
  assert.equal(once.match(/same-tier/g).length, 1, once);
  assert.doesNotMatch(once, /Yearly/);

  const links = await md(tabs('Windows', 'Linux') + panel(0, `<p><a href="/win.zip">Download the package here</a></p>`) + panel(1, `<p><a href="/linux.zip">Download the package here</a></p>`));
  assert.match(links, /win\.zip/);
  assert.match(links, /linux\.zip/);

  const twoGroups = await md(tabs('Monthly', 'Yearly') + panel(0, shared) + panel(1, table('other-tier', '1'))
    + `<h2>Again</h2><div role="tablist"><button role="tab" aria-controls="q0">Annual</button></div><div role="tabpanel" id="q0">${shared}</div>`);
  assert.equal(twoGroups.match(/same-tier/g).length, 2, 'the same text in another group is not a duplicate');
});

test('a heading lost from a formerly hidden panel gives a fidelity warning', async () => {
  const html = page(tabs('Alpha', 'Beta') + panel(0, table('alpha-tier', '1')) + panel(1, `<h3>Beta quota limits</h3><p>Limits for the second tier.</p>`));
  const data = await extractHtml(html, URL_A, { extractImpl: () => ({ title: 'Guide', contentMarkdown: 'Guide Pricing Alpha Beta alpha-tier' }) });
  assert.ok(data.fidelityWarnings.some((w) => w.kind === 'heading' && /Beta quota limits/.test(w.label)), JSON.stringify(data.fidelityWarnings));
});

// main, with the real extractor's result supplied: main is synchronous and the extractor isn't.
function vault(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-tab-panels-'));
  const clippings = join(root, 'raw', 'clippings');
  mkdirSync(clippings, { recursive: true });
  const prior = process.env.WIKI_MASTER_VAULT;
  process.env.WIKI_MASTER_VAULT = root;
  t.after(() => { if (prior === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = prior; rmSync(root, { recursive: true, force: true }); });
  return { root, clippings, names: () => readdirSync(clippings) };
}
function clip(argv, deps) {
  const lines = [];
  const log = console.log, err = console.error;
  console.log = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  try { return { result: main(argv, { today: () => '2026-11-06', render: () => assert.fail('no browser in this test'), ...deps }), lines }; }
  finally { console.log = log; console.error = err; }
}
const clipHtml = async (markup, argv = []) => {
  const data = await extractHtml(page(markup), URL_A);
  return clip([URL_A, ...argv], { extract: () => data });
};

const EMPTY = tabs('Alpha', 'Beta', 'Gamma') + panel(0, '') + panel(1, '') + panel(2, '  ');
const NOTE = /^note: page has 3 tab controls this clip did not open; use --recapture --expand$/m;

test('a tab list with empty panels stays out of the text, and the clip says what it did not open', async (t) => {
  const v = vault(t);
  const { result, lines } = await clipHtml(EMPTY);
  assert.equal(result.status, 'clipped');
  assert.equal(result.unexpandedTabs, 3);
  assert.match(lines.join('\n'), NOTE);
  const body = readFileSync(join(v.clippings, `${result.slug}.md`), 'utf8');
  assert.doesNotMatch(body, /Alpha|Beta|Gamma/);
});

for (const [name, markup] of [
  ['panels that hold content', TWO],
  ['tabs that cannot be linked to a panel', `<div role="tablist"><button role="tab">One</button><button role="tab">Two</button></div><div role="tabpanel">${table('only-tier', '1')}</div>`],
]) {
  test(`no note for ${name}`, async (t) => {
    vault(t);
    const { result, lines } = await clipHtml(markup);
    assert.equal(result.status, 'clipped');
    assert.ok(!result.unexpandedTabs);
    assert.doesNotMatch(lines.join('\n'), /^note:/m);
  });
}

test('--recapture of a clipping that lost its panels writes a new capture', async (t) => {
  const v = vault(t);
  const lost = (await extractHtml(page('<div class="tabs-container"></div>'), URL_A)).contentMarkdown;
  const hash = createHash('sha256').update(lost).digest('hex');
  writeFileSync(join(v.clippings, 'Guide.md'), `---\ntitle: "Guide"\nsource: "${URL_A}"\ncreated: 2026-01-01\ntags: [clippings]\nquality: medium\nsource-hash: ${hash}\n---\n\n${lost}\n`);
  const { result } = await clipHtml(`<div class="tabs-container">${TWO}</div>`, ['--recapture']);
  assert.equal(result.status, 'clipped');
  assert.equal(result.slug, 'Guide (recaptured 2026-11-06)');
  assertBothPanels(readFileSync(join(v.clippings, `${result.slug}.md`), 'utf8'));
});

test('--from-file HTML keeps panels too', (t) => {
  const v = vault(t);
  const file = join(v.root, 'saved.html');
  writeFileSync(file, page(`<div class="tabs-container">${TWO}</div>`));
  const { result } = clip([URL_A, '--from-file', file], { render: undefined });
  assert.equal(result.status, 'clipped');
  assertBothPanels(readFileSync(join(v.clippings, `${result.slug}.md`), 'utf8'));
});

test('a tab list of plain links keeps its links when an unrelated tab panel follows it', async () => {
  const links = ['guide', 'reference', 'changelog'].map((name) => `<li><a role="tab" href="/docs/${name}">Read the ${name}</a></li>`).join('');
  const text = await md(`<ul role="tablist">${links}</ul><div role="tabpanel">${table('unrelated-tier', '1')}</div>`);
  for (const name of ['guide', 'reference', 'changelog']) assert.match(text, new RegExp(`/docs/${name}`), `the ${name} link is kept:\n${text}`);
  assert.match(text, /unrelated-tier/);
});

test('a tab controlling a populated hidden block that is no tab panel is reported as unopened, and the block is not flattened', async (t) => {
  vault(t);
  const markup = `<div role="tablist"><button role="tab" aria-controls="more">More</button></div><div id="more" hidden><p>hidden-block-text</p></div>`;
  const data = await extractHtml(page(markup), URL_A);
  assert.equal(data.pageSignals.tabControls, 1);
  assert.doesNotMatch(data.contentMarkdown, /hidden-block-text/);
  const { result, lines } = clip([URL_A], { extract: () => data });
  assert.equal(result.unexpandedTabs, 1);
  assert.match(lines.join('\n'), /^note: page has 1 tab controls this clip did not open; use --recapture --expand$/m);
});

test('a block hidden by an inline style is reported however the style is spaced', async () => {
  for (const style of ['display:none', 'display: none', 'display : none', 'DISPLAY:  NONE']) {
    const markup = `<div role="tablist"><button role="tab" aria-controls="more">More</button></div><div id="more" style="${style}"><p>hidden-block-text</p></div>`;
    const data = await extractHtml(page(markup), URL_A);
    assert.equal(data.pageSignals.tabControls, 1, style);
  }
});

test('a tab controlling a visible block that is no tab panel is not reported', async () => {
  const data = await extractHtml(page(`<div role="tablist"><button role="tab" aria-controls="more">More</button></div><div id="more"><p>visible-block-text</p></div>`), URL_A);
  assert.equal(data.pageSignals.tabControls, 0);
});

// A panel that opens with a heading naming its own tab would carry the label twice. Only that exact case drops the label.
const headed = (i, heading, body) => `<div role="tabpanel" id="p${i}" ${i ? 'hidden' : ''}>${heading}<p>${body}</p></div>`;

test('a panel opening with a heading of the tab label text gets no second label heading', async () => {
  const text = await md(tabs('Alpha', 'Beta') + headed(0, '<h4>  ALPHA\n</h4>', 'alpha-body-text') + headed(1, '<h4>Beta</h4>', 'beta-body-text'));
  assert.equal(text.match(/^#{2,6} (Alpha)$/gim).length, 1, `one Alpha heading:\n${text}`);
  assert.equal(text.match(/^#{2,6} Beta$/gm).length, 1, `one Beta heading:\n${text}`);
  assert.equal(text.match(/alpha-body-text/g).length, 1, text);
  assert.equal(text.match(/beta-body-text/g).length, 1, text);
  assert.ok(text.indexOf('alpha-body-text') < text.search(/^#{2,6} Beta$/m), text);
});

test('a panel whose first heading differs from the tab label keeps both', async () => {
  const text = await md(tabs('Alpha', 'Beta') + headed(0, '<h4>Alpha details</h4>', 'alpha-body-text') + headed(1, '<h4>Beta details</h4>', 'beta-body-text'));
  assert.match(text, /^#{2,6} Alpha$/m);
  assert.match(text, /^#{2,6} Alpha details$/m);
  assert.match(text, /^#{2,6} Beta$/m);
  assert.match(text, /^#{2,6} Beta details$/m);
});

test('a panel with no heading, or a heading that is not its first child, still gets the label', async () => {
  const text = await md(tabs('Alpha', 'Beta') + headed(0, '', 'alpha-body-text') + headed(1, '<p>intro-text</p><h4>Beta</h4>', 'beta-body-text'));
  assert.equal(text.match(/^#{2,6} Alpha$/gm).length, 1, text);
  assert.equal(text.match(/^#{2,6} Beta$/gm).length, 2, `the label and the panel's own later heading:\n${text}`);
});
