import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join, delimiter, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

// What to tell whoever hit the missing runtime. A development checkout (it has a .git entry; an installed plugin copy
// does not) holds its dependencies only after `npm ci`, which the message used to leave out, so a fresh worktree's
// extraction tests failed like a regression. An installed copy is run through the pinned npm exec launcher.
export function runtimeUnavailableMessage(root = fileURLToPath(new URL('../..', import.meta.url)), exists = existsSync) {
  return exists(join(root, '.git'))
    ? 'HTML extraction runtime unavailable: this is a development checkout without its dependencies; run `npm ci` in it'
    : 'HTML extraction runtime unavailable; run through the pinned npm exec launcher';
}

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
  throw new Error(runtimeUnavailableMessage());
}

const CALLOUT = '.ghd-alert, .starlight-aside, .admonition, .markdown-alert';
const AVAILABILITY = '[class*="PermissionsStatement_permissionsBox"]';
const HEADINGS = 'h1, h2, h3, h4, h5, h6';
const REST_OPERATION = '[class*="RestOperation_codeBlock"]';
const REST_PARAMETERS = 'table[class*="ParameterTable_parameterTable"]';
const REST_EXAMPLE = '[class*="RestCodeSamples_codeBlock"] > code';
const REST_ENDPOINT = '[class*="RestCodeSamples_method"]';
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

// Site chrome that an extractor removes on purpose is not a loss, but "is this chrome" is a judgement that
// can hide a real loss, so every rule here is narrow and every exemption is reported (see assessSignals):
//  - a heading must be short on body text, measured as non-link words up to the next heading;
//  - a generic name must be the WHOLE heading ("Share", not "Share your results");
//  - names that are ordinary content elsewhere (About, Labels, Resources) count only on github.com, where
//    the page layout is known, or inside a container whose id or class says sidebar, menu or dropdown;
//  - a title the clipping keeps as metadata, and a GitHub comment byline whose comment body was captured.
const GENERIC_CHROME = new Set(['feedback', 'share', 'read next', 'related posts', 'recent posts', 'stay informed']);
const GITHUB_CHROME = new Set(['repository navigation', 'repository files navigation', 'conversation', 'latest commit', 'folders and files',
  'about', 'resources', 'stars', 'watchers', 'forks', 'releases', 'packages', 'contributors', 'languages',
  'reviewers', 'assignees', 'labels', 'projects', 'milestone', 'development', 'notifications', 'choose a reason for hiding this comment']);
const COUNTER = /^\d+ (participants?|reviewers?|comments?)$/;
const BYLINE = /^.{1,60}? commented\b/;
// The clipper writes a GitHub comment as "**author** · 2023-10-01" followed by the comment, so the heading text
// ("author commented Oct 1, 2023", or "author left a comment") is never found. The header it wrote is the proof.
const BYLINE_HEADER = /^(.{1,60}?) (?:commented(?: on)?|left a comment)\b\s*(.*)$/i;
function bylineHeaderCaptured(text, literal) {
  const m = BYLINE_HEADER.exec(String(text).replace(/\s+/g, ' ').trim());
  if (!m) return false;
  const [, author, rest] = m;
  if (!literal.includes(`**${author}**`)) return false;
  if (!rest) return true;
  const time = Date.parse(`${rest} UTC`);
  return !Number.isNaN(time) && literal.includes(new Date(time).toISOString().slice(0, 10));
}
// A heading whose whole section text (links included) appears in the clipping, in order, has lost only its label.
// The proof is every non-overlapping five-word window of that text, in a section of 10 to 150 words (so at least two
// windows; a shorter section gives none and never qualifies).
const LABEL_ONLY_MIN_WORDS = 10;
const LABEL_ONLY_MAX_WORDS = 150;
// Only a structural section title may go: short and without a digit. A comment byline ("author commented Oct 1")
// carries who said it and when, which is information, so a missing byline is never just a label.
const labelOnlyEligible = (text) => { const n = normalize(text); return n.split(' ').length <= 3 && !/\d/.test(n); };
const CHROME_CONTAINER = new Set(['dropdown', 'menu', 'sidebar', 'toc', 'navigation', 'nav', 'breadcrumb', 'widget', 'promo', 'banner']);
const CHROME_SECTION_MAX_WORDS = 40;
const wordCount = text => (text.match(/[\p{L}\p{N}]+/gu) ?? []).length;

// The outermost ancestor below the content root whose id or class names a chrome container (camelCase and
// separators both split: sidebarSection, discussion-sidebar-item). Above the root nothing counts, so a
// layout class on <body> cannot exempt a whole page.
function chromeContainerOf(node, root) {
  let found = null;
  for (let p = node.parentElement; p && p !== root; p = p.parentElement) {
    const tokens = String(p.getAttribute('id') ?? '') + ' ' + String(p.getAttribute('class') ?? '');
    if (tokens.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).some(token => CHROME_CONTAINER.has(token))) found = p;
  }
  return found;
}

// For each heading: how many non-link words follow it before the next heading (within its container when it
// has one), the first ten words of the longest run of them (a comment's body, not the badges and dates that
// precede it; empty when no run has eight words), and whether it sits in a chrome container. One pass in
// document order.
function headingSections(root, headings) {
  const wanted = new Set(headings);
  const items = [];
  const walk = (node, inLink) => {
    if (node.nodeType === 3) { if (node.textContent.trim()) items.push({ text: node.textContent, link: inLink, node }); return; }
    if (node.nodeType !== 1) return;
    if (wanted.has(node)) { items.push({ heading: node }); return; }
    if (node.matches('script, style, svg, nav, button, [hidden], [aria-hidden="true"]')) return;
    const link = inLink || node.tagName === 'A';
    for (const child of node.childNodes) walk(child, link);
  };
  walk(root, false);
  const sections = new Map();
  items.forEach((item, i) => {
    if (!item.heading) return;
    const container = chromeContainerOf(item.heading, root);
    let words = 0, longest = 0, probe = '';
    const sectionText = [];
    for (let j = i + 1; j < items.length && !items[j].heading; j++) {
      if (container && !container.contains(items[j].node)) break;
      sectionText.push(items[j].text);
      if (items[j].link) continue;
      const run = wordCount(items[j].text);
      words += run;
      if (run > longest) { longest = run; probe = normalize(items[j].text).split(' ').filter(Boolean).slice(0, 10).join(' '); }
    }
    const flat = normalize(sectionText.join(' ')).split(' ').filter(Boolean);
    const windows = [];
    if (flat.length >= LABEL_ONLY_MIN_WORDS && flat.length <= LABEL_ONLY_MAX_WORDS) for (let k = 0; k + 5 <= flat.length; k += 5) windows.push(flat.slice(k, k + 5).join(' '));
    sections.set(item.heading, { words, probe: longest >= 8 ? probe : '', container: !!container, windows });
  });
  return sections;
}

function signals(document) {
  const root = contentRoot(document);
  const candidates = [];
  const add = (kind, nodes) => {
    for (const node of nodes) {
      if (node.closest('nav, footer, [role="navigation"], [hidden], [aria-hidden="true"]')) continue;
      const text = textOf(node).trim();
      if (normalize(text).length < 3) continue;
      candidates.push({ kind, text, label: text.replace(/\s+/g, ' ').slice(0, 100), ...(kind === 'heading' ? { node } : {}) });
    }
  };
  add('heading', root.querySelectorAll(HEADINGS));
  const headingNodes = candidates.filter(c => c.kind === 'heading').map(c => c.node);
  const sections = headingNodes.length ? headingSections(root, headingNodes) : new Map();
  for (const c of candidates) if (c.node) { c.chrome = sections.get(c.node); delete c.node; }
  add('callout', root.querySelectorAll(CALLOUT));
  add('availability', root.querySelectorAll(AVAILABILITY));
  add('introduction', root.querySelectorAll('.class-description > p, [data-container="lead"] > p'));
  add('list-item', root.querySelectorAll('.class-description li'));
  if (root.querySelector(REST_OPERATION)) {
    add('endpoint', root.querySelectorAll(REST_ENDPOINT));
    add('parameter-row', root.querySelectorAll(`${REST_PARAMETERS} tbody tr`));
    add('table-caption', root.querySelectorAll(`${REST_PARAMETERS} caption`));
    add('code-block', root.querySelectorAll(REST_EXAMPLE));
  }
  return candidates;
}
// The warnings only (site chrome the extractor removed on purpose is left out); the detailed form also
// returns what was ignored and why, so nothing is dropped without a record.
export function assessFidelity(html, markdown, title = '', url = '') {
  return assessFidelityDetailed(html, markdown, title, url).warnings;
}
export function assessFidelityDetailed(html, markdown, title = '', url = '') {
  const { parseHTML } = extractionRuntime();
  const { document } = parseHTML(html);
  return assessSignalsDetailed(signals(document), markdown, title, url);
}
function chromeReason(signal, context, plain) {
  const c = signal.chrome;
  if (signal.kind !== 'heading' || !c) return null;
  const n = normalize(signal.text);
  const words = n.split(' ');
  // The clipping keeps the title in its frontmatter, so a heading that restates it is not lost text.
  if (words.length >= 3 && words.every(word => context.titleWords.has(word))) { context.titleHeadings.push(n); return 'the page title, which the clipping keeps as metadata'; }
  if (context.titleHeadings.some(title => n.startsWith(title + ' '))) return 'the page title with a status line, which the clipping keeps as metadata';
  const light = c.words <= CHROME_SECTION_MAX_WORDS;
  if (light && GENERIC_CHROME.has(n)) return 'known page chrome (a short heading the extractor removes on purpose)';
  if (context.github) {
    if (light && (GITHUB_CHROME.has(n) || COUNTER.test(n))) return 'GitHub page chrome';
    if (BYLINE.test(n) && c.probe && plain.includes(c.probe)) return 'GitHub comment byline; the comment body was captured';
    if (bylineHeaderCaptured(signal.text, context.literal)) return 'GitHub comment byline; the author and date were captured in the comment header';
  }
  if (c.container && light) return 'inside a sidebar, menu or dropdown container';
  const spaced = ` ${plain} `;
  if (labelOnlyEligible(signal.text) && c.windows.length > 0 && c.windows.every(w => spaced.includes(` ${w} `))) return 'only the heading label is missing; the whole section text was captured';
  return null;
}
function assessSignalsDetailed(expected, markdown, title, url = '') {
  const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
  const context = { github: host === 'github.com', literal: markdown, titleWords: new Set(normalize(title).split(' ').filter(Boolean)), titleHeadings: [] };
  const ignored = [];
  // Strip Markdown link destinations so an inline link does not interrupt its source sentence.
  const plain = normalize(`${title}\n${markdown.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')}`);
  const literal = markdown.replace(/\r\n?/g, '\n');
  const warnings = expected.filter(signal => {
    // Code punctuation, case and line boundaries are semantic; do not use prose normalization.
    if (signal.kind === 'code-block') return !literal.includes(signal.text.replace(/\r\n?/g, '\n').trim());
    if (['parameter-row', 'endpoint'].includes(signal.kind)) return !plain.includes(normalize(signal.text));
    const words = normalize(signal.text).split(' ');
    // Bounded start/end probes catch selective loss without mistaking link destinations for text.
    const missing = ![words.slice(0, 14), words.slice(-14)].every(probe => plain.includes(probe.join(' ')));
    if (!missing) return false;
    const why = chromeReason(signal, context, plain);
    if (why) { ignored.push({ kind: signal.kind, label: signal.label, why }); return false; }
    return true;
  }).map(({ kind, label }) => ({ kind, label }));
  return { warnings, ignored };
}

export async function extractHtml(html, url, { extractImpl } = {}) {
  const { Defuddle, parseHTML } = extractionRuntime();
  const { document } = parseHTML(html);
  const expected = signals(document);
  const root = contentRoot(document);
  const restReference = !!root.querySelector(REST_OPERATION);
  const documentation = restReference || !!root.querySelector(`.class-description, ${CALLOUT}, ${AVAILABILITY}`);

  // Defuddle 0.19.5 treats every fragment link in a heading as a removable permalink,
  // including actual API identifiers. Unwrap meaningful text; keep icon-only anchors removable.
  for (const heading of root.querySelectorAll(HEADINGS)) {
    for (const anchor of heading.querySelectorAll('a[href^="#"]')) {
      const text = textOf(anchor).trim();
      if (text && !/^[#¶§🔗]+$/.test(text)) anchor.replaceWith(...anchor.childNodes);
    }
  }
  if (documentation) {
    if (restReference) {
      // Defuddle's exact `.gutter` cleanup removes GitHub's endpoint layout columns.
      // Preserve the enclosing reference below, and give its non-<pre> samples
      // semantic code-block markup so Markdown conversion retains line breaks.
      for (const code of root.querySelectorAll(REST_EXAMPLE)) {
        if (code.parentElement.tagName === 'PRE') continue;
        const pre = document.createElement('pre');
        const language = code.className.match(/(?:^|\s)language-([\w-]+)/)?.[1];
        if (language) pre.setAttribute('data-language', language);
        code.replaceWith(pre); pre.append(code);
      }
      for (const endpoint of root.querySelectorAll(REST_ENDPOINT)) {
        const p = document.createElement('p'); const code = document.createElement('code');
        code.textContent = [...endpoint.childNodes].map(child => textOf(child).trim()).filter(Boolean).join(' ');
        p.append(code); endpoint.replaceWith(p);
      }
      for (const caption of root.querySelectorAll(`${REST_PARAMETERS} caption`)) {
        const label = document.createElement('p'); label.textContent = caption.textContent;
        caption.closest('table').before(label); caption.remove();
      }
    }
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
  const { warnings: fidelityWarnings, ignored } = assessSignalsDetailed(expected, markdown, data.title ?? '', url);
  return { ...data, fidelityWarnings, fidelityAssessment: { checked: expected.length, missing: fidelityWarnings.length, ignored, scope: 'headings, callouts, availability, API introductions, feature lists and recognized REST endpoints, parameters and examples' } };
}
