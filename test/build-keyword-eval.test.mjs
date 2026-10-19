import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../scripts/build-keyword-eval.mjs';

// A synthetic vault shaped like the real one for this purpose: a skewed vocabulary so some words
// are on dozens of pages and most are rare, plus a few camelCase identifiers on one to three pages.
function corpus(seed = 7, pages = 600) {
  let a = seed >>> 0;
  const random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const syll = ['ka', 'lo', 'mi', 'ren', 'tu', 'vas', 'qui', 'dor', 'fen', 'gal', 'hov', 'jin'];
  const vocab = Array.from({ length: 700 }, (_, i) => `${syll[i % 12]}${syll[Math.floor(i / 12) % 12]}${syll[Math.floor(i / 144) % 12]}x${syll[(i * 7) % 12]}`);
  const word = () => vocab[Math.floor(vocab.length * random() ** 2.2)];
  const ids = Array.from({ length: 30 }, (_, i) => `${vocab[600 + i]}${vocab[650 + (i % 40)][0].toUpperCase()}${vocab[650 + (i % 40)].slice(1)}`);
  return Array.from({ length: pages }, (_, n) => {
    const paragraphs = Array.from({ length: 3 }, () => Array.from({ length: 40 }, word).join(' ')).join('\n\n');
    const id = n % 20 === 0 ? ids[(n / 20) % ids.length] : null;
    const extra = id ? ` ${id}` : '';
    // Every other identifier page also carries the identifier in its title, so identity lookup
    // could find it and the generator must not offer it as a keyword-only question.
    const title = id && n % 40 === 0 ? `Page ${n} ${id}` : `Page ${n}`;
    const text = `---\ntitle: ${title}\n---\n# ${title}\n${paragraphs}${extra}\n`;
    return { path: `wiki/p${n}.md`, text, lower: text.toLowerCase(), names: `wiki/p${n}.md\n${title.toLowerCase()}` };
  });
}

const options = { seed: 11, perCategory: 3 };

test('the same corpus and seed give the same questions; another seed gives different ones', () => {
  const c = corpus();
  assert.deepEqual(build(c, options), build(c, options));
  assert.notDeepEqual(build(c, options).map(q => q.query), build(c, { ...options, seed: 12 }).map(q => q.query));
});

test('questions are balanced across the three categories with unique ids and both splits', () => {
  const questions = build(corpus(), { seed: 11, perCategory: 4 });
  assert.deepEqual(questions.map(q => q.category), [...Array(4).fill('rare-token'), ...Array(4).fill('conjunction'), ...Array(4).fill('phrase')]);
  assert.equal(new Set(questions.map(q => q.id)).size, 12);
  assert.deepEqual([...new Set(questions.map(q => q.split))].sort(), ['development', 'heldout']);
  assert.equal(questions.filter(q => q.split === 'heldout').length, 3, 'one in four per category');
});

test('expected pages are exactly the pages whose text matches, recomputed independently', () => {
  const c = corpus();
  const df = (needle) => c.filter(p => p.lower.includes(needle)).length;
  const withAll = (words) => c.filter(p => words.every(w => p.lower.includes(w))).map(p => p.path);
  for (const q of build(c, options)) {
    if (q.category === 'rare-token') {
      const needle = q.query.toLowerCase();
      assert.deepEqual(q.expectedPages, c.filter(p => p.lower.includes(needle)).map(p => p.path), q.id);
      assert.ok(q.expectedPages.length >= 1 && q.expectedPages.length <= 4, q.id);
      assert.match(q.query, /^(?:[A-Za-z]+_[A-Za-z]+[A-Za-z_]*|[a-z]+[A-Z][a-z]+[A-Za-z]*|[A-Z]{6,})$/, `${q.id} looks like an identifier`);
      assert.ok(!c.some(p => p.names.includes(needle)), `${q.id} must be absent from every title, alias and filename`);
    } else if (q.category === 'conjunction') {
      const words = q.query.split(' ');
      assert.equal(words.length, 3, q.id);
      assert.deepEqual(q.expectedPages, withAll(words), q.id);
      assert.ok(q.expectedPages.length >= 1 && q.expectedPages.length <= 3, q.id);
      for (const w of words) assert.ok(df(w) >= 10 && df(w) <= 300, `${q.id}: ${w} is on ${df(w)} pages`);
    } else {
      const needle = q.query.toLowerCase();
      assert.deepEqual(q.expectedPages, c.filter(p => p.lower.includes(needle)).map(p => p.path), q.id);
      assert.ok(q.expectedPages.length >= 1 && q.expectedPages.length <= 3, q.id);
      for (const w of needle.split(' ')) assert.ok(df(w) >= 10, `${q.id}: ${w} is too rare to be a phrase of common words`);
    }
  }
});

test('a vault that cannot supply enough questions fails loudly instead of returning a short set', () => {
  assert.throws(() => build(corpus(7, 12), options), /could not find 3 \w[\w-]* questions/);
});

// The bounds are what make the ground truth meaningful, so each is tested on a corpus where every
// candidate sits just outside it: the category must find nothing rather than relax the bound.
function pages(count, body, extra = () => '') {
  return Array.from({ length: count }, (_, n) => {
    const text = `# Page ${n}\n${body(n)}${extra(n)}\n`;
    return { path: `wiki/q${n}.md`, text, lower: text.toLowerCase(), names: `wiki/q${n}.md\npage ${n}` };
  });
}
const filler = (n) => Array.from({ length: 40 }, (_, i) => `unrelated${String.fromCharCode(97 + (n % 26))}${String.fromCharCode(97 + (i % 26))}word`).join(' ');

test('a conjunction that co-occurs on more than three pages is never offered', () => {
  const together = 'alpha-ish bravoes charlie delta echoes foxtrots '.repeat(8);
  const c = [...pages(25, () => together), ...pages(25, filler)];
  assert.throws(() => build(c, { seed: 1, perCategory: 1, categories: ['conjunction'] }), /could not find 1 conjunction/);
});

test('a rare token on more than four pages is never offered', () => {
  const c = [...pages(6, filler, () => ' camelCaseThing'), ...pages(20, filler)];
  assert.throws(() => build(c, { seed: 1, perCategory: 1, categories: ['rare-token'] }), /could not find 1 rare-token/);
});

test('a phrase on more than three pages is never offered', () => {
  const sentence = 'quick brown foxes jumped over lazy sleeping dogs yesterday morning.';
  const c = [...pages(25, () => sentence), ...pages(25, filler)];
  assert.throws(() => build(c, { seed: 1, perCategory: 1, categories: ['phrase'] }), /could not find 1 phrase/);
});

test('categories limits what is generated', () => {
  const questions = build(corpus(), { seed: 11, perCategory: 2, categories: ['phrase'] });
  assert.deepEqual([...new Set(questions.map(q => q.category))], ['phrase']);
});
