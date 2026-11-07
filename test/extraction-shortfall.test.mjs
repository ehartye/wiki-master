import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractHtml, extractionRuntime } from '../scripts/lib/html-extract.mjs';

// An extraction that keeps far less text than the page shows is read again (lib/html-extract.mjs). The loss is Defuddle's,
// so the fixtures go through the real extractor; only the retry rules that the real one can't produce use a stub.

const URL_A = 'https://docs.example.test/guide/page';
const VOCAB = 'river lantern copper meadow signal harbor ledger orchard window thread granite compass velvet anchor marble quiet ember pillar canvas drift summit hollow beacon cobalt thimble current fable'.split(' ');
// Exactly n words of synthetic prose, in sentences of twelve.
const prose = (n, seed = 0) => Array.from({ length: n }, (_, i) => {
  const word = VOCAB[(i * 7 + seed) % VOCAB.length];
  return (i % 12 === 0 ? word[0].toUpperCase() + word.slice(1) : word) + (i % 12 === 11 || i === n - 1 ? '.' : '');
}).join(' ');
const paragraphs = (n) => Array.from({ length: Math.ceil(n / 60) }, (_, i) => `<p>${prose(Math.min(60, n - i * 60), i)}</p>`).join('\n');
const page = (body) => `<!doctype html><html><head><title>Guide</title></head><body>${body}</body></html>`;
const words = (text) => (text.match(/\S+/g) ?? []).length;

// The shape a documentation site's router produces: the article inside a wrapper whose custom element holds a paragraph
// with one lazy-loaded image. The same text in a `div` extracts in full.
const wrapped = (tag, n = 2000, extra = '') => page(`<main><h1>Guide</h1><${tag} class="router-outlet-wrapper"><custom-element><p><img src="/lazy.png" alt="">${prose(30)}${extra}</p>${paragraphs(n)}</custom-element></${tag}></main>`);
const VISIBLE = 2031; // the heading, the lead paragraph and 2,000 words

const extract = (html, options) => extractHtml(html, URL_A, options);

test('a span around a custom element with an image loses the page, and the guard reads it again', async () => {
  const baseline = await extract(wrapped('span'), { shortfallGuard: false });
  assert.ok(words(baseline.contentMarkdown) < 5, `the loss is real: ${words(baseline.contentMarkdown)} words`);
  assert.equal(baseline.extractionRetry, undefined);
  assert.equal(baseline.shortfall, undefined, 'with the guard off nothing is judged');

  const data = await extract(wrapped('span'));
  assert.equal(data.extractionRetry, 'unwrap-inline');
  assert.ok(words(data.contentMarkdown) >= 2000, `${words(data.contentMarkdown)} words`);
  assert.equal(data.visibleWords, VISIBLE);
  assert.equal(data.shortfall, undefined);
  assert.deepEqual(data.pageSignals, baseline.pageSignals);
  assert.deepEqual(data.pageCounts, baseline.pageCounts);
});

test('a label wrapper needs the unwrap first: removing images alone gives nothing', async () => {
  const imagesOnly = await extract(wrapped('label'), { shortfallRetries: ['remove-images'] });
  assert.equal(imagesOnly.extractionRetry, undefined);
  assert.deepEqual(imagesOnly.shortfall, { extracted: words(imagesOnly.contentMarkdown), visible: VISIBLE });
  assert.ok(imagesOnly.shortfall.extracted < 5);

  const data = await extract(wrapped('label'));
  assert.equal(data.extractionRetry, 'unwrap-inline');
  assert.ok(words(data.contentMarkdown) >= 2000);
});

test('a text-bearing link keeps its address through the unwrap', async () => {
  const data = await extract(wrapped('span', 600, ' See the <a href="https://docs.example.test/reference">reference</a> for more.'));
  assert.equal(data.extractionRetry, 'unwrap-inline');
  assert.match(data.contentMarkdown, /\[reference\]\(https:\/\/docs\.example\.test\/reference\)/);
});

// Pages that keep their first read: the guard does nothing, or finds nothing better.
const THREAD = Array.from({ length: 60 }, (_, i) => `<div class="comment"><p>${prose(24, i)}</p></div>`).join('');
const KEPT = [
  ['an ordinary article', page(`<main><h1>Guide</h1>${paragraphs(1200)}</main>`), false],
  ['a page under 300 visible words, even one that loses its text', wrapped('span', 150), false],
  ['an article beside a 60-comment thread', page(`<main><h1>Guide</h1><img src="/figure.png" alt="">${paragraphs(300)}<div class="comments">${THREAD}</div></main>`), true],
];
for (const [name, html, short] of KEPT) {
  test(`${name} keeps its first extraction`, async () => {
    const baseline = await extract(html, { shortfallGuard: false });
    const data = await extract(html);
    assert.equal(data.extractionRetry, undefined);
    assert.equal(data.contentMarkdown, baseline.contentMarkdown);
    assert.deepEqual(data.fidelityWarnings, baseline.fidelityWarnings);
    assert.deepEqual(data.fidelityAssessment, baseline.fidelityAssessment);
    assert.equal(typeof data.visibleWords, 'number');
    if (short) assert.deepEqual(data.shortfall, { extracted: words(data.contentMarkdown), visible: data.visibleWords });
    else assert.equal(data.shortfall, undefined);
  });
}

test('visible words leave out chrome, scripts, templates and hidden elements', async () => {
  const data = await extract(page(`<header><p>${prose(10)}</p></header><nav>${prose(10)}</nav>
    <main><header><p>${prose(10)}</p></header><p>${prose(20)}</p><script>var a = "one two three";</script><style>p { color: red }</style>
    <template><p>${prose(10)}</p></template><div hidden><p>${prose(10)}</p></div><p aria-hidden="true">${prose(10)}</p>
    <p style="display: none">${prose(10)}</p><p style="VISIBILITY:hidden">${prose(10)}</p>
    <ul><li>alpha</li><li>beta</li></ul><p><span>in</span><span>line</span> text</p><footer>${prose(10)}</footer></main><footer>${prose(10)}</footer>`));
  assert.equal(data.visibleWords, 20 + 2 + 2);
});

// Rules the real extractor can't produce on demand, driven by an injected extractor. A page with a wrapper and an image
// has both retries to run; each call to the stub is one read.
const BOTH = page(`<main><h1>Guide</h1><span><p>${prose(400)}</p></span><img src="/figure.png" alt=""></main>`); // 401 visible words
const sequence = (...counts) => {
  const reads = { calls: 0 };
  reads.impl = () => ({ title: 'Guide', contentMarkdown: prose(counts[Math.min(reads.calls++, counts.length - 1)]) });
  return reads;
};

const KEEP_RULES = [
  // [first, unwrap, images, kept, why]
  [10, 30, 60, 'remove-images', 'the retry with the most words wins'],
  [10, 60, 30, 'unwrap-inline', 'the other way round'],
  [10, 40, 40, 'unwrap-inline', 'a tie goes to the earlier retry'],
  [10, 19, 20, 'remove-images', 'exactly twice the first read qualifies'],
  [10, 19, 19, undefined, 'less than twice the first read does not'],
  [10, 10, 10, undefined, 'the same words are not more'],
  [0, 0, 0, undefined, 'nothing from nothing'],
  [0, 0, 1, 'remove-images', 'any words beat a first read of none'],
];
for (const [first, unwrap, images, kept, why] of KEEP_RULES) {
  test(`keep rule: ${why} (${first}, ${unwrap}, ${images})`, async () => {
    const reads = sequence(first, unwrap, images);
    const data = await extract(BOTH, { extractImpl: reads.impl });
    assert.equal(reads.calls, 3, 'every retry that is not skipped runs');
    assert.equal(data.extractionRetry, kept);
    if (kept) {
      assert.equal(data.shortfall, undefined);
      assert.equal(words(data.contentMarkdown), kept === 'unwrap-inline' ? unwrap : images);
    } else {
      assert.deepEqual(data.shortfall, { extracted: first, visible: 401 });
      assert.equal(words(data.contentMarkdown), first);
    }
  });
}

test('the trigger is under 20% of at least 300 visible words', async () => {
  const at = (n) => page(`<main><p>${prose(n)}</p></main>`);
  const fires = async (visible, extracted) => (await extract(at(visible), { extractImpl: sequence(extracted).impl })).shortfall !== undefined;
  assert.equal(await fires(1000, 199), true);
  assert.equal(await fires(1000, 200), false);
  assert.equal(await fires(300, 59), true);
  assert.equal(await fires(300, 60), false);
  assert.equal(await fires(299, 0), false);
  assert.equal(await fires(300, 0), true);
});

test('a retry that changes nothing is skipped, and so is the guard when it is off or restricted', async () => {
  const plain = page(`<main><p>${prose(400)}</p></main>`);
  const none = sequence(10);
  const data = await extract(plain, { extractImpl: none.impl });
  assert.equal(none.calls, 1, 'no wrapper and no image: both retries would read the same page');
  assert.deepEqual(data.shortfall, { extracted: 10, visible: 400 });

  const wrapperOnly = sequence(10);
  await extract(page(`<main><span><p>${prose(400)}</p></span></main>`), { extractImpl: wrapperOnly.impl });
  assert.equal(wrapperOnly.calls, 2, 'only the unwrap has anything to change');

  const off = sequence(10);
  await extract(BOTH, { extractImpl: off.impl, shortfallGuard: false });
  assert.equal(off.calls, 1);
  const restricted = sequence(10, 60);
  const only = await extract(BOTH, { extractImpl: restricted.impl, shortfallRetries: ['remove-images'] });
  assert.equal(restricted.calls, 2);
  assert.equal(only.extractionRetry, 'remove-images');
});

// The real extractor after a short first read: the second read is Defuddle's own, on the transformed page.
test('removing images keeps an image equation, its text and the first parse\'s count of what to check', async () => {
  const html = page(`<main><h1>Guide</h1><img src="/decoration.png" alt="">${paragraphs(400)}<p>The area is <img src="/e.png" alt="$x^2 + y^2$"> in square units.</p></main>`);
  const baseline = await extract(html, { shortfallGuard: false });
  let calls = 0;
  const { Defuddle } = extractionRuntime();
  const data = await extract(html, {
    shortfallRetries: ['remove-images'],
    extractImpl: (...args) => (++calls === 1 ? { title: 'Guide', contentMarkdown: 'A short first read.' } : Defuddle(...args)),
  });
  assert.equal(calls, 2);
  assert.equal(data.extractionRetry, 'remove-images');
  assert.match(data.contentMarkdown, /`\$x\^2 \+ y\^2\$`/, 'the equation survives as code');
  assert.doesNotMatch(data.contentMarkdown, /decoration\.png/);
  assert.equal(data.fidelityAssessment.checked, baseline.fidelityAssessment.checked);
  assert.ok(baseline.fidelityAssessment.checked >= 2, 'the equation and the heading were expected');
  assert.deepEqual(data.fidelityWarnings, []);
});
