// How a new clipping gets its file name. Pure and I/O-free: the caller supplies `exists`.
//
// A clash used to drop a distinct document without a word. A title-less raw document has
// `title: ""`, so its slug was `untitled`; the next fallback was the URL's last segment (`SKILL.md`,
// which the writer then gave a second `.md`); with both taken the clip returned `duplicate`. Now the
// candidates are a fixed, deterministic list, the caller takes the first free one, and a name nobody
// can take is a `clash`, never a `duplicate`.
import { createHash } from 'node:crypto';
import { clipSafeName } from './clip-names.mjs';
import { normalizeUrl } from './url.mjs';

export function slugify(title) {
  const s = clipSafeName((title || '')
    .replace(/[\\/:*?"<>|#^[\]]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .trim());
  return s.slice(0, 120).replace(/[-\s]+$/, '') || 'untitled';
}

// Fallback slug when a page's <title> collides with an existing clipping — some
// sites (e.g. iquilezles.org) reuse one <title> across every article, so the
// title-derived slug is not unique. The URL's last path segment is.
export function slugFromUrl(url) {
  try {
    const { pathname, hostname } = new URL(url);
    const segs = pathname.split('/').filter(Boolean);
    const last = segs.length ? decodeURIComponent(segs[segs.length - 1]) : hostname;
    return slugify(last);
  } catch {
    return 'untitled';
  }
}

// Upper bound on names tried for one clip, so a pathological vault cannot loop.
export const MAX_SLUG_ATTEMPTS = 100;
const HASH_FORMS = 8;
const hash7 = (url) => createHash('sha256').update(normalizeUrl(String(url ?? ''))).digest('hex').slice(0, 7);

// The decoded path segments of a URL. A trailing `.md` is dropped from the last one: the writer adds
// `.md`, so keeping the source's would give `Name.md.md`. Query and fragment are ignored.
export function urlNameParts(url) {
  try {
    const u = new URL(url);
    const segs = u.pathname.split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
    if (!segs.length) return { host: u.hostname, segs: [u.hostname] };
    segs[segs.length - 1] = segs[segs.length - 1].replace(/\.md$/i, '') || segs[segs.length - 1];
    return { host: u.hostname, segs };
  } catch {
    return { host: '', segs: ['untitled'] };
  }
}

// The first level 1 or 2 heading of a Markdown body, without link or emphasis markup.
export function firstHeading(md) {
  const m = String(md ?? '').match(/^#{1,2}[ \t]+(.+?)[ \t]*#*[ \t]*$/m);
  if (!m) return null;
  const text = m[1].replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]+/g, '').replace(/\s+/g, ' ').trim();
  return text || null;
}

const noExt = (s) => s.replace(/\.md$/i, '');

// Every name to try, best first, without a trailing `.md`.
//   titled or headed document: its title or heading, then the last URL segment, then the parents
//     nearest first (`parent-last`, `grandparent-parent-last`, ...);
//   no title and no heading: the parents nearest first, then the bare last segment, so that
//     `skills/one/SKILL.md` is `one-SKILL` and not a second `SKILL`;
//   then the URL hash forms, which are the same for the same URL and differ for any other.
export function clipSlugCandidates({ title, heading, url }) {
  const { segs } = urlNameParts(url);
  const last = slugify(segs[segs.length - 1]);
  const parents = [];
  for (let k = 1; k < segs.length; k++) parents.push(slugify(segs.slice(segs.length - 1 - k).join('-')));
  const named = String(title || heading || '').trim();
  const base = named ? slugify(named) : '';
  const hasName = Boolean(base) && (base !== 'untitled' || named.toLowerCase() === 'untitled');
  const ordered = hasName ? [base, last, ...parents] : [...parents, last];
  const seen = new Set();
  const out = [];
  const add = (s) => {
    const name = noExt(s);
    if (!name || seen.has(name.toLowerCase())) return;
    seen.add(name.toLowerCase());
    out.push(name);
  };
  for (const s of ordered.slice(0, MAX_SLUG_ATTEMPTS - HASH_FORMS)) add(s);
  const h = hash7(url);
  const stem = noExt(hasName ? base : last);
  add(`${stem}-${h}`);
  for (let n = 2; n <= HASH_FORMS; n++) add(`${stem}-${h}-${n}`);
  return out.slice(0, MAX_SLUG_ATTEMPTS);
}

// The first free name, or a clash naming the best candidate (the file a reader would expect to find).
// `exists` must ignore letter case: Windows and macOS file systems do, and Obsidian resolves names the
// same way everywhere.
export function chooseClipSlug({ title, heading, url, exists }) {
  const candidates = clipSlugCandidates({ title, heading, url });
  for (const slug of candidates) if (!exists(slug)) return { slug };
  return { clash: true, existing: candidates[0] };
}

// A title is an identity in this vault, so a new clip must not take a title another clipping holds.
// The distinguishing URL part is added: `Smith v. Jones (93-1260.ZO)`. Deeper parents follow, then the
// URL hash. An empty title stays empty.
export function uniqueTitle({ title, url, taken }) {
  const t = String(title ?? '').trim();
  if (!t || !taken.has(t.toLowerCase())) return title;
  const { segs } = urlNameParts(url);
  const tail = segs.map((s, i) => (i === segs.length - 1 ? s.replace(/\.[A-Za-z0-9]{1,5}$/, '') : s));
  for (let k = 1; k <= tail.length; k++) {
    const candidate = `${t} (${tail.slice(tail.length - k).join('/')})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${t} (${hash7(url)})`;
}
