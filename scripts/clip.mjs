import { readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { isBlocked } from './lib/blocklist.mjs';
import { isDuplicateUrl } from './lib/url.mjs';
import { loadDeclines, isDeclined, recordDecline } from './lib/decline.mjs';
import { recordIssue } from './lib/triage.mjs';

const THIN_WORD_FLOOR = 100;

// A meta <description>'s DISTINCTIVE words (len > 5, so common short function
// words don't count) must reach this count before it's treated as "substantive"
// evidence about what the page actually contains, as opposed to a placeholder/
// generic description. Real meta descriptions are conventionally 1-3 sentences,
// which comfortably clears this without approaching THIN_WORD_FLOOR.
const DESCRIPTION_SUBSTANTIVE_DISTINCTIVE_WORDS = 8;

// If a substantive description's distinctive words show up in the extracted
// body at less than this rate, the body is presumed NOT to be about what the
// description says the page is about (see classifyShortExtraction). This must
// be a PROPORTION, not "at least one shared word": same-topic pages routinely
// share a few common domain words by coincidence (e.g. two unrelated FDA-news
// items both containing "issued") without actually being about the same
// content — a real, confirmed false-negative caught during testing of this
// fix. A real match reflects a large fraction of the description's wording;
// pure topical coincidence reflects only a sliver of it.
const WRONG_NODE_OVERLAP_CEILING = 0.2;

// A realistic desktop browser User-Agent, always sent to Defuddle. Some
// sites/WAFs (confirmed: NCBI's PMC) serve a bot-check interstitial page to
// requests with no UA or a non-browser UA. Defuddle "succeeds" against that
// interstitial (no thrown error, a short-but-valid JSON payload) -- so the
// failure only surfaces later, misclassified as thin content rather than a
// fetch error. Verified: the same PMC URL went from ~17 extracted words (the
// "Checking your browser..." bot-check shell) to ~14,885 words (the real
// article) purely by adding this header, on one request -- but PMC's gate
// turned out to be probabilistic/session-based on retest (the same URL later
// failed again, and a different URL failed on a first attempt), so this header
// measurably helps but is not a guaranteed bypass for every anti-bot system.
// It is not deceptive either way -- it is what a real browser already sends.
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export function slugify(title) {
  const s = (title || '')
    .replace(/[\\/:*?"<>|#^[\]]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .trim();
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

// Resolve a slug collision without losing the clipping. Same-source re-clips are
// already caught upstream (isDuplicateUrl), so a collision reaching here is a
// GENUINELY DISTINCT clipping — dropping it silently loses a source. The `exists`
// predicate MUST be case-insensitive: on case-insensitive filesystems (Windows,
// default macOS) "Foo.md" and "foo.md" are one file, and Obsidian resolves
// [[Foo]] and [[foo]] to the same note on every OS — so two slugs differing only
// in case must be disambiguated regardless of platform. The disambiguator (the
// content hash) makes the fallback deterministic per distinct content.
export function disambiguateSlug(slug, disambiguator, exists) {
  if (!exists(slug)) return slug;
  const short = String(disambiguator || '').replace(/[^a-z0-9]/gi, '').slice(0, 7) || 'x';
  let candidate = `${slug}-${short}`;
  for (let n = 2; exists(candidate); n++) candidate = `${slug}-${short}-${n}`;
  return candidate;
}

export { normalizeUrl, isDuplicateUrl } from './lib/url.mjs';

function yaml(v) { return JSON.stringify(String(v)); }

export function buildFrontmatter({ title, source, author, published, created, quality, hash, fidelity, extraction }) {
  const lines = ['---'];
  lines.push(`title: ${yaml(title)}`);
  lines.push(`source: ${yaml(source)}`);
  if (author) lines.push(`author: ${yaml(author)}`);
  if (published) lines.push(`published: ${published}`);
  lines.push(`created: ${created}`);
  lines.push('tags: [clippings]');
  lines.push(`quality: ${quality}`);
  // How the text was obtained: 'ocr' when clip-pdf recognized rasterized pages
  // (Tesseract) instead of reading the PDF text layer. Omitted for the default.
  if (extraction && extraction !== 'text') lines.push(`extraction: ${extraction}`);
  // Extraction fidelity is set by clip-pdf when pdftotext likely mangled math or
  // symbols — a signal to ingest to paraphrase, not quote. Omitted when high.
  if (fidelity && fidelity !== 'high') lines.push(`fidelity: ${fidelity}`);
  lines.push(`source-hash: ${hash}`);
  lines.push('---');
  return lines.join('\n');
}

function wordCount(md) { return (md.match(/\S+/g) || []).length; }
function today() { return new Date().toISOString().slice(0, 10); }
function normalizeWord(w) { return String(w).toLowerCase().replace(/[^a-z0-9]/g, ''); }

// A short extraction (< THIN_WORD_FLOOR words) has more than one possible cause,
// and treating them identically throws away information a human (or a future
// run) needs to act correctly. This function is pure/exported so it can be unit
// tested without shelling out to Defuddle.
//
//  - 'short_real_article': Defuddle found a genuine <article>/<main> container,
//    and the body is not vanishingly short. Some reference/stub pages (e.g. a
//    one-paragraph regulatory guidance docket page) are legitimately this brief
//    -- don't discard real content just because of a flat word floor.
//  - 'wrong_node': Defuddle's OWN metadata extraction (the <meta description>)
//    is substantive, but none of it shows up in the extracted body. This is the
//    signature of Defuddle grabbing the wrong DOM node -- confirmed reproducible
//    on at least one real site's markup (a "related articles" widget picked
//    instead of the actual article), independent of User-Agent/network issues.
//    This is a MISSED clip, not a genuinely empty page.
//  - 'empty_shell': neither of the above -- the page really does look like an
//    SPA/paywall placeholder with nothing to extract.
export function classifyShortExtraction({ markdown, rawHtml, description }) {
  const words = wordCount(markdown);
  const isStructurallyRealArticle = /^\s*<(article|main)\b/i.test(String(rawHtml || '').trim());
  if (isStructurallyRealArticle && words >= Math.floor(THIN_WORD_FLOOR / 2)) {
    return { kind: 'short_real_article' };
  }

  const bodyLower = String(markdown || '').toLowerCase();
  const distinctiveDescriptionWords = String(description || '')
    .split(/\s+/)
    .map(normalizeWord)
    .filter((w) => w.length > 5);
  const descriptionIsSubstantive = distinctiveDescriptionWords.length >= DESCRIPTION_SUBSTANTIVE_DISTINCTIVE_WORDS;
  const overlapCount = distinctiveDescriptionWords.filter((w) => bodyLower.includes(w)).length;
  const overlapRatio = distinctiveDescriptionWords.length ? overlapCount / distinctiveDescriptionWords.length : 0;

  if (descriptionIsSubstantive && overlapRatio < WRONG_NODE_OVERLAP_CEILING) {
    return {
      kind: 'wrong_node',
      reason: 'likely wrong-node extraction (description has substantive text absent from the extracted article body — try clipping manually)',
    };
  }
  return { kind: 'empty_shell', reason: 'thin content (SPA/paywall shell)' };
}

// Existing clipping source: URLs, for dedup.
export function knownSourceUrls(vaultPath) {
  const dir = join(vaultPath, 'raw', 'clippings');
  if (!existsSync(dir)) return [];
  const urls = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md')) continue;
    const m = readFileSync(join(dir, f), 'utf8').match(/^source:\s*"?([^"\n]+)"?/m);
    if (m) urls.push(m[1].trim());
  }
  return urls;
}

// Run through the shell (execSync) so Windows resolves the `defuddle.cmd` npm shim
// via PATHEXT; execFile can't launch .cmd. The URL is validated as a real URL in
// main() and double-quoted, so it is safe to interpolate.
function runDefuddleJson(url) {
  const q = `"${url}"`;
  const ua = `"${DEFAULT_USER_AGENT}"`;
  const cmds = [
    `defuddle parse ${q} --json --user-agent ${ua}`,
    `npx --yes defuddle parse ${q} --json --user-agent ${ua}`,
  ];
  let lastErr;
  for (const cmd of cmds) {
    try {
      return JSON.parse(execSync(cmd, {
        encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
      }));
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

function defuddleReachable() {
  for (const cmd of ['defuddle --version', 'npx --yes defuddle --version']) {
    try { execSync(cmd, { stdio: 'ignore' }); return true; } catch { /* try next */ }
  }
  return false;
}

export function main(argv) {
  const url = argv[0];
  if (!url) { console.error('usage: clip.mjs <url> [--quality=high|medium|low] [--decline="reason"]'); process.exit(2); }
  try { new URL(url); } catch { console.error(`invalid url: ${url}`); process.exit(2); }
  const qArg = argv.find((a) => a.startsWith('--quality='));
  const quality = qArg ? qArg.split('=')[1] : 'medium';

  if (isBlocked(url)) { console.log(`blocked (unreliable domain): ${url}`); return { status: 'blocked' }; }

  const { path: vaultPath } = resolveVault();

  // Explicit decline (Phase 2 reject): record the decision instead of clipping,
  // so the next discovery run does not re-litigate this URL.
  const declineArg = argv.find((a) => a.startsWith('--decline='));
  if (declineArg) {
    const reason = declineArg.slice('--decline='.length) || 'declined';
    recordDecline(vaultPath, url, reason);
    console.log(`declined (recorded): ${url} — ${reason}`);
    return { status: 'declined' };
  }

  const declines = loadDeclines(vaultPath);
  if (isDeclined(url, declines)) {
    const e = declines.find((d) => isDeclined(url, [d]));
    console.log(`declined previously (${e.date}: ${e.reason}): ${url}`);
    return { status: 'declined' };
  }

  if (isDuplicateUrl(url, knownSourceUrls(vaultPath))) {
    console.log(`duplicate (already clipped): ${url}`); return { status: 'duplicate' };
  }

  let data;
  try { data = runDefuddleJson(url); }
  catch {
    // Distinguish "Defuddle not installed" (fatal) from "this URL failed" (skip, so
    // batch runs continue). A per-URL failure is usually a 403 / paywall / SPA.
    if (!defuddleReachable()) {
      console.error(`Defuddle CLI not found. Install it: npm i -g defuddle`);
      process.exit(1);
    }
    // A transient failure is deliberately NOT declined — it may recover, and a
    // 180-day TTL would bury a recoverable source. It IS queued for triage, so the
    // link survives the terminal scrollback and reaches a human.
    const reason = 'fetch failed (likely 403/paywall/transient)';
    recordIssue(vaultPath, { url, kind: 'failed', reason });
    console.log(`clip failed (likely blocked/paywalled — clip manually; queued for triage): ${url}`);
    return { status: 'failed', reason };
  }

  const md = data.contentMarkdown || data.content || '';
  if (wordCount(md) < THIN_WORD_FLOOR) {
    const verdict = classifyShortExtraction({ markdown: md, rawHtml: data.content, description: data.description });
    if (verdict.kind !== 'short_real_article') {
      // Thin/wrong-node is deterministic given this page's current markup — record
      // it so the next run skips without re-fetching. TTL re-litigates eventually.
      recordDecline(vaultPath, url, verdict.reason);
      // Also queue it: the decline stops the re-fetch, but the source was still
      // wanted and only a human can clip it manually.
      recordIssue(vaultPath, {
        url,
        kind: verdict.kind === 'wrong_node' ? 'wrong-node' : 'thin',
        reason: verdict.reason,
      });
      const label = verdict.kind === 'wrong_node' ? 'possible extraction mismatch' : 'thin content';
      console.log(`${label} (clip manually; decline + triage recorded): ${url}`);
      return { status: 'thin', reason: verdict.reason };
    }
    // else: short_real_article — fall through and clip as a genuine, if brief, article.
  }

  const created = today();
  const hash = createHash('sha256').update(md).digest('hex');
  const fm = buildFrontmatter({
    title: data.title, source: url, author: data.author,
    published: data.published, created, quality, hash,
  });
  let slug = slugify(data.title);
  let file = join(vaultPath, 'raw', 'clippings', `${slug}.md`);
  if (existsSync(file)) {
    // Same-URL re-clips are already caught above by isDuplicateUrl, so a slug
    // clash here means a *different* page shares this title. Disambiguate via
    // the URL path before giving up as a duplicate.
    const altSlug = slugFromUrl(url);
    const altFile = join(vaultPath, 'raw', 'clippings', `${altSlug}.md`);
    if (existsSync(altFile)) { console.log(`exists (slug clash): ${slug}`); return { status: 'duplicate' }; }
    slug = altSlug;
    file = altFile;
  }

  writeFileSync(file, `${fm}\n\n${md}\n`);
  console.log(`clipped: raw/clippings/${slug}.md (quality=${quality})`);
  return { status: 'clipped', slug, file };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
