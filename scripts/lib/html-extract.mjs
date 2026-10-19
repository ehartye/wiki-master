import { createRequire } from 'node:module';
import { dirname, join, delimiter, basename } from 'node:path';

// Local npm installation in development; npm exec exposes its pinned runtime through PATH.
export function extractionRuntime() {
  const resolvers = [createRequire(import.meta.url)];
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (basename(dir).toLowerCase() === '.bin') resolvers.push(createRequire(join(dir, '..', 'package.json')));
  }
  for (const resolve of resolvers) {
    try {
      const entry = resolve.resolve('defuddle');
      return { Defuddle: resolve(join(dirname(entry), 'node.js')).Defuddle, parseHTML: resolve('linkedom').parseHTML,
        fetch: resolve(join(dirname(entry), 'fetch.js')) };
    } catch { /* try the next explicit runtime directory */ }
  }
  throw new Error('HTML extraction runtime unavailable; run through the pinned npm exec launcher');
}

const CALLOUT = '.ghd-alert, .starlight-aside, .admonition, .markdown-alert';
const AVAILABILITY = '[class*="PermissionsStatement_permissionsBox"]';
const HEADINGS = 'h1, h2, h3, h4, h5, h6';
const BLOCK = /^(P|DIV|SECTION|ARTICLE|ASIDE|BLOCKQUOTE|LI|UL|OL|H[1-6]|HEADER|MAIN)$/;
const normalize = text => String(text).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
function textOf(node) {
  if (node.nodeType === 3) return node.textContent;
  if (node.nodeType !== 1 || node.matches('script, style, svg, nav, button, [hidden], [aria-hidden="true"]')) return '';
  if (node.tagName === 'BR') return ' ';
  let inner = [...node.childNodes].map(textOf).join('');
  const label = node.matches(CALLOUT) ? node.getAttribute('aria-label') : null;
  if (label && !normalize(inner).startsWith(normalize(label))) inner = `${label} ${inner}`;
  return BLOCK.test(node.tagName) ? ` ${inner} ` : inner;
}
function contentRoot(document) {
  const description = document.querySelector('.class-description');
  const main = document.querySelector('main, [role="main"]');
  if (main) return main;
  // An API introduction may be a sibling of its article, or of several sections.
  // Never narrow the capture or audit to only the introduction's nearest section.
  const article = document.querySelector('article');
  return description ? (article?.contains(description) ? article : document.body) : (article ?? document.body);
}
function signals(document) {
  const root = contentRoot(document);
  const candidates = [];
  const add = (kind, nodes) => {
    for (const node of nodes) {
      if (node.closest('nav, footer, [role="navigation"], [hidden], [aria-hidden="true"]')) continue;
      const text = textOf(node).trim();
      if (normalize(text).length < 3) continue;
      candidates.push({ kind, text, label: text.replace(/\s+/g, ' ').slice(0, 100) });
    }
  };
  add('heading', root.querySelectorAll(HEADINGS));
  add('callout', root.querySelectorAll(CALLOUT));
  add('availability', root.querySelectorAll(AVAILABILITY));
  add('introduction', root.querySelectorAll('.class-description > p, [data-container="lead"] > p'));
  add('list-item', root.querySelectorAll('.class-description li'));
  return candidates;
}
export function assessFidelity(html, markdown, title = '') {
  const { parseHTML } = extractionRuntime();
  const { document } = parseHTML(html);
  return assessSignals(signals(document), markdown, title);
}
function assessSignals(expected, markdown, title) {
  // Strip Markdown link destinations so an inline link does not interrupt its source sentence.
  const plain = normalize(`${title}\n${markdown.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')}`);
  return expected.filter(signal => {
    const words = normalize(signal.text).split(' ');
    // Bounded start/end probes catch selective loss without mistaking link destinations for text.
    return ![words.slice(0, 14), words.slice(-14)].every(probe => plain.includes(probe.join(' ')));
  }).map(({ kind, label }) => ({ kind, label }));
}

export async function extractHtml(html, url, { extractImpl } = {}) {
  const { Defuddle, parseHTML } = extractionRuntime();
  const { document } = parseHTML(html);
  const expected = signals(document);
  const root = contentRoot(document);
  const documentation = !!root.querySelector(`.class-description, ${CALLOUT}, ${AVAILABILITY}`);

  // Defuddle 0.19.5 treats every fragment link in a heading as a removable permalink,
  // including actual API identifiers. Unwrap meaningful text; keep icon-only anchors removable.
  for (const heading of root.querySelectorAll(HEADINGS)) {
    for (const anchor of heading.querySelectorAll('a[href^="#"]')) {
      const text = textOf(anchor).trim();
      if (text && !/^[#¶§🔗]+$/.test(text)) anchor.replaceWith(...anchor.childNodes);
    }
  }
  if (documentation) {
    // Starlight hides a duplicate visual title from assistive technology; its aria-label is substantive.
    for (const callout of root.querySelectorAll(CALLOUT)) {
      const title = callout.querySelector('.starlight-aside__title');
      if (title && callout.getAttribute('aria-label')) title.removeAttribute('aria-hidden');
    }
    for (const node of root.querySelectorAll('nav, footer, button, [role="navigation"], [hidden], [aria-hidden="true"]')) node.remove();
    // Technical introductions live in <header> siblings before <article> on generated API pages.
    for (const header of root.querySelectorAll('header')) {
      const div = document.createElement('div'); div.innerHTML = header.innerHTML; header.replaceWith(div);
    }
    // Process children first: replacing a parent clones its already-preserved descendants.
    for (const node of [...root.querySelectorAll(`${CALLOUT}, ${AVAILABILITY}`)].reverse()) {
      const block = document.createElement('blockquote'); block.innerHTML = node.innerHTML;
      const label = node.getAttribute('aria-label');
      if (label && !normalize([...node.childNodes].map(textOf).join('')).startsWith(normalize(label))) {
        const title = document.createElement('p'); title.textContent = label; block.prepend(title);
      }
      for (const child of block.querySelectorAll('*')) {
        for (const attr of [...child.attributes]) {
          if (/^(class|id|style|role|aria-.+|data-.+)$/.test(attr.name)) child.removeAttribute(attr.name);
        }
      }
      node.replaceWith(block);
    }
    root.setAttribute('data-wiki-content', '');
  }
  const data = await (extractImpl ?? Defuddle)(document.toString(), url, {
    separateMarkdown: true, language: 'en',
    ...(documentation ? { contentSelector: '[data-wiki-content]', removeLowScoring: false, removeExactSelectors: false, removePartialSelectors: false, removeContentPatterns: false } : {}),
  });
  const markdown = data.contentMarkdown ?? '';
  const fidelityWarnings = assessSignals(expected, markdown, data.title ?? '');
  return { ...data, fidelityWarnings, fidelityAssessment: { checked: expected.length, missing: fidelityWarnings.length, scope: 'headings, callouts, availability, API introductions and feature lists' } };
}
