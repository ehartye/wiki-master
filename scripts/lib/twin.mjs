// A page that extracts thin is often one rendering of a document the site also serves as plain Markdown: `<page>.md.txt`,
// `<page>.md`, a "View page in Markdown" link, or an entry of the site's /llms.txt. The Markdown keeps code and tables that a
// rendered read loses, and it costs one request instead of a browser. This module finds such a twin and judges it; the
// clipper decides when to ask (clip.mjs) and the fetch is injected, so nothing here reaches a network.

import { urlCarriesSecret } from './url-safety.mjs';

export const TWIN_MIN_WORDS = 100;

// The only content types that make a reply a document of its own. A `text/html` page, JSON or a binary is something else
// that happens to live at the guessed address.
const TWIN_TYPE = /^(?:text\/plain|text\/markdown|text\/x-markdown)\s*(?:;|$)/i;
// \s covers a byte order mark.
const HTML_START = /^\s*<(?:!doctype\s+html|html[\s>]|head[\s>]|body[\s>])/i;

const wordCount = (text) => (String(text).match(/\S+/g) || []).length;

// The page address without query, fragment and trailing slash, or null when the path is empty: `https://example.com.md` would be
// another host, so a site's root has no suffix probes.
export function twinBase(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const path = u.pathname.replace(/\/+$/, '');
  return path ? `${u.origin}${path}` : null;
}

// Does the reply count as the twin of `requested`? The final address matters because a missing page often redirects to a login
// or a home page that happens to be long Markdown-looking text.
export function qualifiesAsTwin(reply, requested) {
  if (!reply?.ok || typeof reply.text !== 'string') return false;
  if (!TWIN_TYPE.test(reply.type ?? '')) return false;
  if (HTML_START.test(reply.text)) return false;
  if (wordCount(reply.text) < TWIN_MIN_WORDS) return false;
  try {
    const final = new URL(reply.finalUrl ?? requested);
    const asked = new URL(requested);
    return final.origin === asked.origin && final.pathname === asked.pathname;
  } catch { return false; }
}

// What a page address and an llms.txt entry have in common once the Markdown conventions are taken off: a `.md` or `.md.txt`
// suffix, `index.html` for a directory and `.html` for a file.
const pathKey = (path) => path.replace(/\.md(?:\.txt)?$/i, '').replace(/\/index(?:\.html?)?$/i, '').replace(/\.html?$/i, '').replace(/\/+$/, '') || '/';

// The first link of an /llms.txt that is on the page's origin and names the page. The index itself is never an entry.
export function llmsEntry(llmsText, pageUrl) {
  let page;
  try { page = new URL(pageUrl); } catch { return null; }
  const wanted = pathKey(page.pathname);
  const found = String(llmsText).matchAll(/\]\(\s*<?([^)\s>]+)|(https?:\/\/[^\s)<>\]]+)/g);
  for (const m of found) {
    let entry;
    try { entry = new URL(m[1] ?? m[2], page.origin); } catch { continue; }
    entry.hash = '';
    if (entry.origin !== page.origin || entry.pathname === '/llms.txt') continue;
    if (pathKey(entry.pathname) === wanted) return entry.href;
  }
  return null;
}

// Probe in order until one qualifies; at most five requests. `fetchTwin(url)` answers { ok, text, type, finalUrl }.
// { ok: true, url, text } | { ok: false }
export function findTwin({ url, signals, fetchTwin }) {
  const tried = new Set();
  const probe = (candidate) => {
    // A link or an llms.txt entry that carries a secret is never asked for: the twin's address is stored and printed.
    if (!candidate || tried.has(candidate) || urlCarriesSecret(candidate)) return null;
    tried.add(candidate);
    const reply = fetchTwin(candidate);
    return qualifiesAsTwin(reply, candidate) ? { ok: true, url: candidate, text: reply.text } : null;
  };
  const base = twinBase(url);
  if (base) {
    const hit = probe(`${base}.md.txt`) ?? probe(`${base}.md`);
    if (hit) return hit;
  }
  let origin;
  try { origin = new URL(url).origin; } catch { return { ok: false }; }
  // A link on the page can name any site, and what comes back is stored under this page's provenance: only the page's own origin.
  const hit = probe(signals?.markdownLinks?.find((link) => { try { return new URL(link).origin === origin; } catch { return false; } }));
  if (hit) return hit;
  const index = fetchTwin(`${origin}/llms.txt`);
  if (index?.ok && typeof index.text === 'string') return probe(llmsEntry(index.text, url)) ?? { ok: false };
  return { ok: false };
}

// The twin's first `#` heading, outside any code fence, without link or emphasis markup.
function heading(text) {
  const m = String(text).replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\1[ \t]*$/gm, '').match(/^#[ \t]+(.+?)[ \t]*#*[ \t]*$/m);
  const clean = m?.[1].replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]+/g, '').replace(/\s+/g, ' ').trim();
  return clean || null;
}

// The page as the clipper stores it: the Markdown unchanged, titled by its heading, else by the page, else by the address.
export function twinPage({ twin, pageTitle, name }) {
  return { title: heading(twin.text) || String(pageTitle ?? '').trim() || name, contentMarkdown: twin.text.trimEnd() };
}
