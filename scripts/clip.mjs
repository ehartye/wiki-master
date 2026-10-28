import { readFileSync, existsSync, writeFileSync, readdirSync, rmSync, openSync, readSync, closeSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { CLIP_SPECS, guardClipArgs } from './lib/clip-args.mjs';
import { classifyRenderOutcome } from './lib/render.mjs';
import { isBlocked } from './lib/blocklist.mjs';
import { isDuplicateUrl } from './lib/url.mjs';
import { recordDecline } from './lib/decline.mjs';
import { classifyInterstitial } from './lib/interstitial.mjs';
import { looksLikePlainTextUrl, fetchPlainText, plainTextPage } from './lib/plain-text.mjs';
import { declineGate } from './lib/decline-gate.mjs';
import { recordIssue, closeIssuesResolvedByClip } from './lib/triage.mjs';
import { normalizeTopic, parseTopicArg } from './lib/topic.mjs';
import { slugify, slugFromUrl, chooseClipSlug, firstHeading, uniqueTitle } from './lib/clip-slug.mjs';

export const THIN_WORD_FLOOR = 100;

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

// A short extraction carrying at least this many markdown headings, over at
// least this many words, is a structured reference page rather than an empty
// shell. See the note in classifyShortExtraction for why structure, not length,
// is what separates the two.
const STRUCTURED_MIN_HEADINGS = 3;
const STRUCTURED_MIN_WORDS = Math.floor(THIN_WORD_FLOOR / 5);

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

// Defuddle's own default is `Accept-Language: *` — "any language at all" — and some
// servers take that literally. Measured on ai.google.dev: six cookieless fetches of
// one page returned two English and four machine translations (zh-CN, ja, id, ar,
// each tagged `-x-mtfrom-en`); `--lang en` pinned it to English 6/6. A clipping gets
// quoted verbatim later, so a silently translated one is worse than a failed fetch —
// it is wrong content wearing the same frontmatter as right content. Change this if
// the vault is not English; it is the one knob.
const CLIP_LANG = 'en';

// slugify and slugFromUrl live in lib/clip-slug.mjs with the rest of the naming rule; same exports.
export { slugify, slugFromUrl };

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

export function buildFrontmatter({ title, source, author, published, created, quality, hash, fidelity, fidelityChecks, fidelityIgnored, extraction, topic }) {
  const lines = ['---'];
  lines.push(`title: ${yaml(title)}`);
  lines.push(`source: ${yaml(source)}`);
  if (author) lines.push(`author: ${yaml(author)}`);
  if (published) lines.push(`published: ${published}`);
  lines.push(`created: ${created}`);
  lines.push('tags: [clippings]');
  lines.push(`quality: ${quality}`);
  // The research topic this clipping was gathered for. Frontmatter is the
  // DURABLE carrier for topic (lib/topic.mjs): .wiki-master/ is gitignored, so
  // anything recorded there is local to one clone, while this travels with the
  // file to every machine. Omitted when a clip was not part of a research run —
  // an absent topic and an empty one must not be two different states.
  const t = normalizeTopic(topic);
  if (t) lines.push(`topic: ${yaml(t)}`);
  // How the text was obtained: 'ocr' when clip-pdf recognized rasterized pages
  // (Tesseract) instead of reading the PDF text layer. Omitted for the default.
  if (extraction && extraction !== 'text') lines.push(`extraction: ${extraction}`);
  // Extraction fidelity is set by clip-pdf when pdftotext likely mangled math or
  // symbols — a signal to ingest to paraphrase, not quote. Omitted when high.
  if (fidelity && fidelity !== 'high') lines.push(`fidelity: ${fidelity}`);
  if (Number.isInteger(fidelityChecks)) lines.push(`fidelity-checks: ${fidelityChecks}`);
  // Headings the assessment set aside as page chrome (a feedback widget, a sidebar) rather than counting
  // them as lost. Recorded so the set-aside is visible in the clipping; omitted when there were none.
  if (Number.isInteger(fidelityIgnored) && fidelityIgnored > 0) lines.push(`fidelity-ignored: ${fidelityIgnored}`);
  lines.push(`source-hash: ${hash}`);
  lines.push('---');
  return lines.join('\n');
}

// Web-archive services inject their own banner above the page they serve, and
// Defuddle has no reason to know it is not the article. Three clippings in this
// vault open with one, so anything quoting their first paragraph would be
// quoting archival boilerplate as if the source had written it — and the vault
// leans on archives heavily (9 web.archive.org and 2 wayback.archive-it.org
// urls in a single triage queue), so it recurs rather than being a one-off.
//
// Anchored to the START of the document, deliberately. A banner is only ever
// injected at the top, while an article ABOUT link rot may quote the same
// sentence in its body — stripping by content anywhere would silently edit the
// source. `index.php.md` also shows why this must run BEFORE the word floor:
// its banner plus terms-of-use text reached 385 words and sailed past a 100-word
// gate that exists precisely to reject pages with no article in them.
const ARCHIVE_CHROME = [
  // Archive-It. Ends at the media-item count, followed by the widget's stray
  // glyph lines (`<`, `×`, `\>`) which are controls, not content.
  /^\s*(?:hide\s+)?You are viewing an archived web page collected at the request of[\s\S]*?of this archived page\.(?:\s*Found \d+ archived media items out of \d+ total on this page\.)?(?:\s*(?:<|×|\\>))*\s*/i,
  // The Wayback Machine's single header line.
  /^\s*The Wayback Machine\s*-\s*https?:\/\/\S+\s*/i,
];

export function stripArchiveChrome(md) {
  let out = String(md ?? '');
  for (const re of ARCHIVE_CHROME) out = out.replace(re, '');
  return out.trim() === '' ? out.trim() : out.trimStart();
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

  // The <article>/<main> test above only fires when Defuddle's html BEGINS with
  // that tag, which a reference page whose extraction starts at a heading never
  // does. registry.khronos.org's XR_EXT_hand_tracking man page — 58 words under
  // four headings, complete and correct — was declined for 180 days and queued
  // for a human on exactly that technicality.
  //
  // Section structure is the better signal, because it is the one thing the
  // false positive cannot fake: an SPA shell is short BECAUSE it has no content,
  // so it has no sections either. docs.mealie.io, the case this must keep
  // rejecting, extracts to the three words "Back to top" under no headings at
  // all. Three headings rather than two keeps a lone "Sign in"/"Related" stub
  // from qualifying, and the word floor stops a bare table of contents.
  const headings = (String(markdown || '').match(/^#{1,6}\s+\S/gm) || []).length;
  if (headings >= STRUCTURED_MIN_HEADINGS && words >= STRUCTURED_MIN_WORDS) {
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

// The `title:` of every clipping, lowercased, so a new clip can avoid taking a title another clipping
// holds. Only the head of each file is read: the frontmatter is at the top.
export function clippingTitles(vaultPath) {
  const dir = join(vaultPath, 'raw', 'clippings');
  const titles = new Set();
  if (!existsSync(dir)) return titles;
  const buf = Buffer.alloc(32768);
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md')) continue;
    let head = '';
    try {
      const fd = openSync(join(dir, f), 'r');
      try { head = buf.toString('utf8', 0, readSync(fd, buf, 0, buf.length, 0)); } finally { closeSync(fd); }
    } catch { continue; }
    const m = head.match(/^title:[ \t]*(.*)$/m);
    if (!m) continue;
    let value = m[1].trim();
    if (value.startsWith('"')) { try { value = JSON.parse(value); } catch { /* keep the raw text */ } }
    if (value) titles.add(String(value).trim().toLowerCase());
  }
  return titles;
}

const MAX_WRITE_ATTEMPTS = 5;

// `--title=<text>` for the clippers whose title otherwise comes from the file name. An empty value keeps
// the fallback.
export function titleFromArgs(argv, fallback) {
  const arg = argv.find((a) => a.startsWith('--title='));
  const value = arg ? arg.slice('--title='.length).trim() : '';
  return value || fallback;
}

// The name for a document clipping (PDF, DOCX, PPTX, XLSX). Without --slug: the title's slug, made unique
// with the content hash as before. With --slug: exactly that name, and a name that is taken is a clash,
// recorded for triage, with nothing written and nothing suffixed.
export function chooseDocumentSlug({ vaultPath, argv, title, hash, taken, source, topic }) {
  const arg = argv.find((a) => a.startsWith('--slug='));
  const wanted = arg ? arg.slice('--slug='.length).trim() : '';
  if (!wanted) return { slug: disambiguateSlug(slugify(title), hash, (s) => taken.has(s.toLowerCase())) };
  const slug = slugify(wanted);
  if (!taken.has(slug.toLowerCase())) return { slug };
  const reason = `raw/clippings/${slug}.md already exists and no alternative name could be written; nothing was written`;
  recordIssue(vaultPath, { url: source, kind: 'attention', reason, topic, source: `raw/clippings/${slug}.md` });
  console.log(`clash: ${source}: ${reason}`);
  return { clash: true, existing: slug };
}

// Create `<slug>.md` only if no file of that name exists: a clip that loses a race to another session
// must not overwrite the winner. Returns false when the name was taken.
export function writeClippingExclusive(dir, slug, text) {
  try { writeFileSync(join(dir, `${slug}.md`), text, { flag: 'wx' }); return true; }
  catch (e) { if (e.code === 'EEXIST') return false; throw e; }
}

// The ladder crosses two axes: how to launch Defuddle, and whether to claim to be
// a browser. Both rungs of the second axis are required, because the two failures
// they fix are opposites.
//
// WITH the UA, ai.google.dev is unreachable — not blocked, looping. The site offers
// silent OAuth sign-in to anything it reads as a browser:
//   docs -> /oauth2authorize?prompt=none -> accounts.google.com
//        -> /oauth2callback?error=interaction_required -> docs -> ...
// A real browser escapes because its cookie jar carries `signin_details` forward and
// the server stops retrying; undici keeps no cookies across redirects, so it spins
// until "redirect count exceeded" and surfaces as the opaque `Error: fetch failed`.
// That took an entire class of Google developer documentation off the table.
//
// WITHOUT it, NCBI PMC serves a bot-check shell (see DEFAULT_USER_AGENT above).
//
// Order follows how each one fails. The PMC failure is SILENT — a short, valid
// payload Defuddle parses without complaint, so there is no error to fall back on —
// which means the UA has to be tried first or that fix is simply lost. The Google
// failure is LOUD, and loud is exactly what a fallback can catch. Bare is tried
// immediately after each launcher's UA attempt rather than after both, so the common
// case costs one extra local call instead of an `npx` cold start.
//
// The payload is base64url, not shell-interpolated source text. This also carries the
// original URL when extracting a rendered temporary file, so relative links stay correct.
const EXTRACT_CLI = join(dirname(fileURLToPath(import.meta.url)), 'extract-page.mjs');
function extractionLaunchers() {
  return [`"${process.execPath}" "${EXTRACT_CLI}"`,
    `npx --yes --package=defuddle@0.19.5 --package=linkedom@0.18.12 --package=turndown@7.2.0 -- node "${EXTRACT_CLI}"`];
}
export function defuddleAttempts(source, sourceUrl = source) {
  const payload = Buffer.from(JSON.stringify({ source, sourceUrl })).toString('base64url');
  return extractionLaunchers().flatMap(launch => [
    `${launch} --payload ${payload} --lang ${CLIP_LANG} --user-agent "${DEFAULT_USER_AGENT}"`,
    `${launch} --payload ${payload} --lang ${CLIP_LANG}`,
  ]);
}

const execDefuddle = (cmd) =>
  execSync(cmd, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });

// Same as execDefuddle but KEEPS stderr. The render rung reports why it failed
// as JSON on stderr — crucially, whether the rung could run at all — and
// discarding that stream (as the Defuddle path deliberately does, to keep npx
// chatter out of the log) collapsed every render failure into a bare "Command
// failed", hiding a real bug behind it for a full end-to-end run.
const execRender = (cmd) =>
  execSync(cmd, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

export function runDefuddleJson(url, { run = execDefuddle, sourceUrl = url } = {}) {
  let lastErr;
  for (const cmd of defuddleAttempts(url, sourceUrl)) {
    try {
      return JSON.parse(run(cmd));
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

const RENDER_CLI = join(dirname(fileURLToPath(import.meta.url)), 'render-page.mjs');

// Is this url a PDF? Judged from the url alone, deliberately: main() is
// synchronous, and a content-type probe on every clip would spend a request on
// the ~99% of urls that are ordinary pages to answer a question only the
// failure path ever asks.
//
// Two shapes, both taken from real vault sources: a path ending in `.pdf`
// (cambridgemaths.org/…/espresso_36.pdf) and a `/pdf/` path segment with no
// extension at all, which is how every arxiv PDF in raw/ is addressed
// (arxiv.org/pdf/2404.03337). Matching the segment rather than the substring is
// what keeps /pdfs and /pdfviewer/help out.
//
// A false positive costs nothing real: this is consulted ONLY after the HTML
// ladder has already failed, so the worst case is suggesting clip-pdf for a
// page that was never going to clip as HTML anyway.
export function looksLikePdfUrl(url) {
  let pathname;
  try {
    ({ pathname } = new URL(url));
  } catch {
    return false;
  }
  if (/\.pdf$/i.test(pathname)) return true;
  return pathname.split('/').some((seg) => seg.toLowerCase() === 'pdf');
}

// A thin extraction is normally cached as a decline, because thin-ness is
// deterministic given the page's markup: re-fetching cannot change the answer,
// so the next run should skip without paying for it.
//
// That justification collapses when the browser rung never ran. With it, the
// answer WOULD have been different -- measured on four of this vault's own
// thin/failed rows. Declining anyway buries a recoverable source for the full
// 180-day TTL on the strength of a package the user has simply not installed
// yet, and they would not discover it until long after fixing the setup. The
// URL still reaches triage either way; only the caching is withheld.
export function shouldDeclineThin({ renderRan }) {
  return renderRan === true;
}

// The rung after the static ladder: render the page in a real browser, judge the
// result, then hand the rendered DOM back to Defuddle. See lib/render.mjs for why
// a browser is needed at all and why it has to be headful.
//
// Order matters and is load-bearing. The GUARD RUNS BEFORE EXTRACTION, because
// rendering does not merely recover pages — it makes pages succeed that the
// static ladder correctly refused, and some of those successes are the wrong
// page. Extract first and a stale Epic doc URL yields 443 fluent words of the
// documentation index; there is nothing in that text to mark it as not being the
// article that was asked for, so it has to be refused on the redirect, before
// anyone can be tempted by the prose.
export function renderAttempt(url, { run = execRender, tmp = tmpdir() } = {}) {
  // Per-URL scratch path: two sessions clipping into one vault is normal here
  // (lib/triage.mjs), and a shared filename would let one render overwrite
  // another's page and file the wrong article under the wrong url.
  const htmlFile = join(tmp, `wm-render-${createHash('sha1').update(url).digest('hex').slice(0, 16)}.html`);
  let meta;
  try {
    meta = JSON.parse(run(`node "${RENDER_CLI}" "${url}" "${htmlFile}"`));
  } catch (e) {
    // render-page.mjs exits 3 with {unavailable:true} when the rung cannot run
    // at all — no playwright-core, no browser. That is a setup problem the user
    // fixes once for every future URL, and reporting it per-URL as "the site
    // blocked us" would send them off to triage 60 sources by hand instead.
    let payload = {};
    try { payload = JSON.parse(String(e.stderr || '')); } catch { /* not ours */ }
    return {
      ok: false,
      kind: 'failed',
      unavailable: payload.unavailable === true,
      reason: payload.error || `render failed: ${String(e.message || e).split('\n')[0]}`,
    };
  }

  const verdict = classifyRenderOutcome({ requestedUrl: url, ...meta });
  if (!verdict.ok) {
    rmSync(htmlFile, { force: true });
    return verdict;
  }

  // Re-extract with Defuddle rather than keeping the browser's innerText, so a
  // rendered clipping gets the same title/author/date parsing and boilerplate
  // removal as every other clipping in the vault.
  try {
    const data = runDefuddleJson(htmlFile, { run, sourceUrl: meta.finalUrl ?? url });
    return { ok: true, data, finalUrl: meta.finalUrl };
  } catch (e) {
    return { ok: false, kind: 'failed', reason: `rendered, but extraction failed: ${String(e.message || e).split('\n')[0]}` };
  } finally {
    rmSync(htmlFile, { force: true });
  }
}

export function extractionAvailable() {
  for (const launch of extractionLaunchers()) {
    const cmd = `${launch} --check-runtime`;
    try { execSync(cmd, { stdio: 'ignore' }); return true; } catch { /* try next */ }
  }
  return false;
}

export function main(argv, { extract = runDefuddleJson, writeClipping = writeClippingExclusive, fetchText } = {}) {
  // A caller that supplies its own extraction (a test) has not asked for the network: the plain-text fetch runs only with the real
  // extractor, or when it is supplied too.
  const readText = fetchText ?? (extract === runDefuddleJson ? fetchPlainText : () => ({ ok: false, reason: 'extraction is injected' }));
  const url = argv[0];
  if (!url) { for (const line of CLIP_SPECS['clip'].usage) console.error(line); process.exit(2); }
  try { new URL(url); } catch { console.error(`invalid url: ${url}`); process.exit(2); }
  const qArg = argv.find((a) => a.startsWith('--quality='));
  const quality = qArg ? qArg.split('=')[1] : 'medium';
  // One flag feeds both topic carriers: frontmatter on the clip path below,
  // and the triage log on every path that queues an issue instead. A caller
  // never has to know which population a URL is about to land in.
  const topic = parseTopicArg(argv);

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

  const gate = declineGate(vaultPath, url, argv);
  if (gate.blocked) {
    if (gate.error) { console.error(gate.error); process.exitCode = 2; return { status: 'error', error: gate.error }; }
    console.log(gate.message);
    return { status: 'declined' };
  }

  if (isDuplicateUrl(url, knownSourceUrls(vaultPath))) {
    // A url already in the vault closes any row that says it could not be
    // fetched — that row is describing a source sitting on disk. This is the
    // 9-of-29 case from the 2026-09-05 replay, and leaving it open is how a
    // queue fills with entries nobody can action.
    closeIssuesResolvedByClip(vaultPath, url, 'duplicate');
    console.log(`duplicate (already clipped): ${url}`); return { status: 'duplicate' };
  }

  let data;
  // 'text' when the static ladder produced the content, 'rendered' when a browser
  // had to. Recorded in frontmatter so a reader knows the text came out of a live
  // DOM rather than the served html — the same role `extraction: ocr` plays for
  // clip-pdf, and read the same way by triage (a method, not a defect).
  let extraction = 'text';
  // A URL that looks like a text file (a checksum manifest, a pinned source file) is kept whole, in a fence: Defuddle cannot read
  // one, and a short one would be judged thin. A binary or oversized file is refused; anything else that is not text is the ladder's.
  let plain = null;
  if (looksLikePlainTextUrl(url)) {
    plain = readText(url);
    if (plain.refused) {
      recordIssue(vaultPath, { url, kind: 'attention', reason: `plain-text capture refused: ${plain.reason}`, topic });
      console.log(`not clipped (${plain.reason}; triage recorded): ${url}`);
      return { status: 'thin', reason: plain.reason };
    }
    if (plain.ok) extraction = 'plaintext';
  }
  try { data = plain?.ok ? plainTextPage(url, plain.text) : extract(url); }
  catch {
    // Distinguish "Defuddle not installed" (fatal) from "this URL failed" (skip, so
    // batch runs continue).
    if (!extractionAvailable()) {
      console.error(`HTML extraction runtime unavailable. Ensure Node.js and npm/npx are available; the clipper installs its pinned extraction packages automatically.`);
      process.exit(1);
    }
    // A PDF is not a page this clipper can ever read, and rendering one only
    // buys a longer way to say so: arxiv.org/pdf/2404.03337 spent four Defuddle
    // attempts and a full browser launch to arrive at "rendered, but extraction
    // failed: Command failed: npx …", which names neither cause nor cure. Stop
    // here and name the tool that does handle it — the vault already holds
    // eight arxiv PDFs that clip-pdf extracted correctly.
    if (looksLikePdfUrl(url)) {
      const reason = 'this url serves a PDF — clip it with clip-pdf (download the file, then: node scripts/clip-pdf.mjs <file.pdf> --source="<url>")';
      recordIssue(vaultPath, { url, kind: 'attention', reason, topic });
      console.log(`clip failed — ${reason} (queued for triage): ${url}`);
      return { status: 'failed', reason };
    }

    // The static ladder never runs JavaScript, so its failures are dominated by
    // pages that HAVE no content until a browser builds it. Sampling 17 entries
    // out of this vault's own failed/thin queue on 2026-09-05, the browser rung
    // recovered 8 of them outright and correctly re-diagnosed most of the rest.
    const r = renderAttempt(url);
    if (r.ok) {
      data = r.data;
      extraction = 'rendered';
    } else {
      // `unavailable` means the rung never ran (no playwright-core, no browser),
      // so nothing has been learned about this URL. Say so once, plainly, rather
      // than filing a setup problem as the site's fault on every URL in the batch.
      if (r.unavailable) console.error(`render rung unavailable: ${r.reason}`);
      // Still NOT declined: a decline is a judgment, and a fetch failure is a
      // fact about one attempt. A 180-day TTL would bury a recoverable source.
      const kind = r.unavailable ? 'failed' : r.kind;
      const reason = r.unavailable
        ? 'fetch failed (likely 403/paywall/transient; browser render unavailable)'
        : r.reason;
      recordIssue(vaultPath, { url, kind, reason, topic });
      console.log(`clip failed — ${reason} (queued for triage): ${url}`);
      return { status: 'failed', reason };
    }
  }

  // Stripped before anything measures or hashes it: the word floor below must
  // judge the article, not the archive's banner, and the source-hash must
  // describe what the vault will actually quote.
  let md = stripArchiveChrome(data.contentMarkdown || data.content || '');
  // A thin extraction off the STATIC html is the exact signature of a page whose
  // article is built client-side: docs.mealie.io serves 299 words of markup that
  // Defuddle reduces to "Back to top". Re-reading it from a rendered DOM is the
  // only way to tell "nothing there" apart from "nothing there yet". Skipped when
  // the render rung already supplied this text — it does not get a second turn.
  // Whether the browser rung got to weigh in on this URL at all. It has already
  // run (and succeeded) when extraction === 'rendered'; otherwise it is set by
  // the thin-path attempt just below.
  let renderRan = extraction === 'rendered';
  if (wordCount(md) < THIN_WORD_FLOOR && !renderRan && extraction !== 'plaintext') {
    const r = renderAttempt(url);
    renderRan = !r.unavailable;
    const rendered = r.ok ? stripArchiveChrome(r.data.contentMarkdown || r.data.content || '') : '';
    if (wordCount(rendered) >= THIN_WORD_FLOOR) {
      data = r.data;
      md = rendered;
      extraction = 'rendered';
    }
  }

  if (wordCount(md) < THIN_WORD_FLOOR && extraction !== 'plaintext') {
    const verdict = classifyShortExtraction({ markdown: md, rawHtml: data.content, description: data.description });
    if (verdict.kind !== 'short_real_article') {
      // Thin/wrong-node is deterministic given this page's current markup — record
      // it so the next run skips without re-fetching. TTL re-litigates eventually.
      if (shouldDeclineThin({ renderRan })) recordDecline(vaultPath, url, verdict.reason);
      // Also queue it: the decline stops the re-fetch, but the source was still
      // wanted and only a human can clip it manually.
      recordIssue(vaultPath, {
        url,
        kind: verdict.kind === 'wrong_node' ? 'wrong-node' : 'thin',
        reason: verdict.reason,
        topic,
      });
      const label = verdict.kind === 'wrong_node' ? 'possible extraction mismatch' : 'thin content';
      const recorded = shouldDeclineThin({ renderRan })
        ? 'decline + triage recorded'
        : 'triage recorded; not declined — browser render unavailable';
      console.log(`${label} (clip manually; ${recorded}): ${url}`);
      return { status: 'thin', reason: verdict.reason };
    }
    // else: short_real_article — fall through and clip as a genuine, if brief, article.
  }

  // A page with words enough to clear the floor can still be the gate and not the page: a login form, a consent wall, an age
  // check. Its own vocabulary, dense, with none of its title in the text, is the signal (lib/interstitial.mjs). It is queued
  // for a person and not declined: a wall is not a verdict on the source, and a signed-in browser can still clip it.
  const shell = extraction === 'plaintext' ? null : classifyInterstitial({ markdown: md, title: data.title });
  if (shell) {
    recordIssue(vaultPath, { url, kind: 'wrong-node', reason: shell.reason, topic });
    console.log(`login, consent or age-gate page (clip manually; triage recorded, not declined): ${url}`);
    return { status: 'thin', reason: shell.reason };
  }

  const clippingsDir = join(vaultPath, 'raw', 'clippings');
  // A title is an identity in this vault: a new clip does not take one another clipping already holds.
  const title = uniqueTitle({ title: data.title, url, taken: clippingTitles(vaultPath) });
  const created = today();
  const hash = createHash('sha256').update(md).digest('hex');
  const fm = buildFrontmatter({
    title, source: url, author: data.author,
    published: data.published, created, quality, hash, topic, extraction,
    fidelity: data.fidelityWarnings?.length ? 'partial' : undefined, fidelityChecks: data.fidelityAssessment?.checked,
    fidelityIgnored: data.fidelityAssessment?.ignored?.length,
  });
  // The first free name from a fixed, deterministic list (see lib/clip-slug.mjs), written with an
  // exclusive create so a clip never overwrites a file another session just made. A name nobody can
  // take is a `clash`, never a `duplicate`: it is recorded and named so the document is not lost silently.
  const slugArg = argv.find((a) => a.startsWith('--slug='));
  const ownerSlug = slugArg && slugArg.slice('--slug='.length).trim() ? slugify(slugArg.slice('--slug='.length)) : null;
  // lowercase name -> the name as it is on disk, so a clash can name the file that is really there
  const names = new Map((existsSync(clippingsDir) ? readdirSync(clippingsDir) : []).filter((f) => f.toLowerCase().endsWith('.md')).map((f) => [f.slice(0, -3).toLowerCase(), f.slice(0, -3)]));
  const exists = (s) => names.has(s.toLowerCase());
  const heading = firstHeading(md);
  const content = `${fm}\n\n${md}\n`;
  let slug = null;
  let clashWith = null;
  for (let lost = 0; ;) {
    const pick = ownerSlug ? (exists(ownerSlug) ? { clash: true, existing: ownerSlug } : { slug: ownerSlug }) : chooseClipSlug({ title, heading, url, exists });
    if (pick.clash) { clashWith = names.get(pick.existing.toLowerCase()) ?? pick.existing; break; }
    if (writeClipping(clippingsDir, pick.slug, content)) { slug = pick.slug; break; }
    // Lost a race: the name was free when we looked and taken when we wrote.
    names.set(pick.slug.toLowerCase(), pick.slug);
    if (isDuplicateUrl(url, knownSourceUrls(vaultPath))) {
      closeIssuesResolvedByClip(vaultPath, url, 'duplicate');
      console.log(`duplicate (already clipped): ${url}`); return { status: 'duplicate' };
    }
    if (++lost >= MAX_WRITE_ATTEMPTS) { clashWith = names.get(pick.slug.toLowerCase()) ?? pick.slug; break; }
  }
  if (slug === null) {
    const reason = `raw/clippings/${clashWith}.md already exists and no alternative name could be written; nothing was written`;
    recordIssue(vaultPath, { url, kind: 'attention', reason, topic, source: `raw/clippings/${clashWith}.md`, retryable: 'clash' });
    console.log(`clash: ${url}: ${reason} (choose a name with --slug=<name>)`);
    return { status: 'clash', existing: clashWith };
  }
  const file = join(clippingsDir, `${slug}.md`);
  // Written first, closed second: a row must never be marked resolved by a clip
  // that then failed to land. Ordering it this way makes the worst case a stale
  // OPEN row (visible, re-runnable) instead of a silently closed one.
  closeIssuesResolvedByClip(vaultPath, url, 'clipped');
  if (data.fidelityWarnings?.length) {
    const reason = `Possible selective extraction loss: ${data.fidelityWarnings.map(w => `${w.kind}: ${w.label}`).join('; ').slice(0, 1500)}`;
    recordIssue(vaultPath, { url, kind: 'fidelity', reason, topic, source: `raw/clippings/${slug}.md` });
    console.error(`fidelity warning (queued for triage): ${reason}`);
  }
  const ignored = data.fidelityAssessment?.ignored ?? [];
  if (ignored.length) console.error(`fidelity: ignored ${ignored.length} page-chrome heading(s), not counted as loss: ${ignored.map((x) => x.label).join('; ').slice(0, 500)}`);
  console.log(`clipped: raw/clippings/${slug}.md (quality=${quality})`);
  gate.finish();
  return { status: 'clipped', slug, file };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  guardClipArgs(process.argv.slice(2), CLIP_SPECS['clip']);
  main(process.argv.slice(2));
}
