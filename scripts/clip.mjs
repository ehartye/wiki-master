import { existsSync, writeFileSync, readdirSync, readFileSync, rmSync, openSync, readSync, closeSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { CLIP_SPECS, guardClipArgs } from './lib/clip-args.mjs';
import { optionValue } from './lib/cli-guard.mjs';
import { classifyRenderOutcome } from './lib/render.mjs';
import { coverageWarnings, formatCoverage } from './lib/expand.mjs';
import { isBlocked } from './lib/blocklist.mjs';
import { isDuplicateUrl } from './lib/url.mjs';
import { knownSourceUrls, knownUrlIndex, urlKey, clippingsForUrl, newestCapture, RECAPTURE_NAME } from './lib/known-urls.mjs';
import { recordDecline } from './lib/decline.mjs';
import { urlCarriesSecret, secretRefusal, redactReasonText } from './lib/url-safety.mjs';
import { classifyInterstitial } from './lib/interstitial.mjs';
import { looksLikePlainTextUrl, fetchPlainText, fetchTwinText, plainTextPage, suppliedKind, suppliedFileProblem, readSuppliedFile } from './lib/plain-text.mjs';
import { declineGate } from './lib/decline-gate.mjs';
import { recordIssue, closeIssuesResolvedByClip } from './lib/triage.mjs';
import { normalizeTopic, parseTopicArg } from './lib/topic.mjs';
import { slugify, slugFromUrl, chooseClipSlug, clipSlugCandidates, firstHeading, uniqueTitle } from './lib/clip-slug.mjs';
import { findTwin, twinPage } from './lib/twin.mjs';
import { landingDocument, landingLine, landingReason } from './lib/landing.mjs';
import { unopenedTabsNote, retryKeptNote, shortfallNote } from './lib/clip-notes.mjs';
import { ledgerRow, redactAddress, ledgerFileProblem, ledgerAppendProblem, appendLedgerRow } from './lib/clip-ledger.mjs';

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

export function buildFrontmatter({ title, source, author, published, created, quality, hash, fidelity, fidelityChecks, fidelityIgnored, extraction, extractionRetry, topic, recaptureOf, suppliedSha256, expandCoverage, twinUrl, documentLink }) {
  const lines = ['---'];
  lines.push(`title: ${yaml(title)}`);
  lines.push(`source: ${yaml(source)}`);
  if (author) lines.push(`author: ${yaml(author)}`);
  if (published) lines.push(`published: ${published}`);
  lines.push(`created: ${created}`);
  // A dated second capture of a page already clipped names the capture it follows (the newest at the time), as a vault path.
  if (recaptureOf) lines.push(`recapture-of: ${yaml(recaptureOf)}`);
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
  // (Tesseract) instead of reading the PDF text layer; 'manual' when a person saved the page and supplied it
  // (--from-file). Omitted for the default.
  if (extraction && extraction !== 'text') lines.push(`extraction: ${extraction}`);
  // The page lost most of its text on the first read and a changed copy of its markup gave it back (lib/html-extract.mjs).
  // A separate key, so the `extraction:` values stay the closed set that triage matches exactly.
  if (extractionRetry) lines.push(`extraction-retry: ${extractionRetry}`);
  // Extraction fidelity is set by clip-pdf when pdftotext likely mangled math or
  // symbols — a signal to ingest to paraphrase, not quote. Omitted when high.
  if (fidelity && fidelity !== 'high') lines.push(`fidelity: ${fidelity}`);
  if (Number.isInteger(fidelityChecks)) lines.push(`fidelity-checks: ${fidelityChecks}`);
  // Headings the assessment set aside as page chrome (a feedback widget, a sidebar) rather than counting
  // them as lost. Recorded so the set-aside is visible in the clipping; omitted when there were none.
  if (Number.isInteger(fidelityIgnored) && fidelityIgnored > 0) lines.push(`fidelity-ignored: ${fidelityIgnored}`);
  // What an --expand read opened and found, one line a person can read. Its presence also keeps the repair tools off it.
  if (expandCoverage) lines.push(`expand-coverage: ${yaml(expandCoverage)}`);
  // Where the stored Markdown was served from, when it is the plain-text twin of `source` (extraction: plaintext-twin).
  if (twinUrl) lines.push(`twin-url: ${yaml(twinUrl)}`);
  // A short page whose substance is one link to a PDF (lib/landing.mjs): it is not evidence for the document's contents.
  if (documentLink) lines.push('landing-page: true', `document-link: ${yaml(documentLink)}`);
  // The hash of the bytes a person supplied (--from-file): source-hash describes the text stored, this the file it came from.
  if (suppliedSha256) lines.push(`supplied-sha256: ${suppliedSha256}`);
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

// A supplied text file is the page text as it is; its title is its first heading, else the last part of the address.
function suppliedTextPage(url, text) {
  return { title: firstHeading(text) || plainTextPage(url, '').title, contentMarkdown: text.trimEnd() };
}
// What the address says the page is, for the login-form check. The text's own heading would always find itself in the text.
function addressTitle(url) { return plainTextPage(url, '').title.replace(/[-_.+]+/g, ' '); }
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
      reason: 'likely wrong-node extraction (description has substantive text absent from the extracted article body — save the page from a signed-in browser and record it with clip.mjs <url> --from-file <path>)',
    };
  }
  return { kind: 'empty_shell', reason: 'thin content (SPA/paywall shell)' };
}

// Existing clipping source: URLs, for dedup. The reading lives in lib/known-urls.mjs, shared with the known-URL commands.
export { knownSourceUrls };

// The result of a duplicate (decision 14): the address is already clipped, so the ledger row carries the clipping that holds
// it instead of nulls, for the next step to read. `held` is a known-URL index entry (lib/known-urls.mjs), the newest capture
// when a page was recaptured; a clipping that is gone by now (a race) leaves the row with nulls.
export function duplicateResult(held) {
  if (!held) return { status: 'duplicate' };
  return { status: 'duplicate', existing: held.name, path: `raw/clippings/${held.file}`, quality: held.quality, sourceHash: held.sourceHash, topic: held.topic, extraction: held.extraction };
}
// The clipping that holds an address, or null: one reading of the vault serves the duplicate check and the row. A twin
// the clipping was stored from counts as its address (the index holds both).
const heldClipping = (vaultPath, address) => newestCapture(knownUrlIndex(vaultPath).get(urlKey(address)) ?? []);

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
// Local first, then the pinned package through npx, as extractionLaunchers does. The pin must match package.json's.
export function renderLaunchers() {
  return [`node "${RENDER_CLI}"`,
    `npx --yes --package=playwright-core@1.64.1 -- node "${RENDER_CLI}"`];
}

// npx and npm write to stderr too, sometimes after render-page's own line, so a whole-stream parse would lose it.
function lastJsonObject(stderr) {
  for (const line of String(stderr ?? '').split(/\r?\n/).reverse()) {
    try {
      const value = JSON.parse(line);
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch { /* npx or npm chatter */ }
  }
  return null;
}

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
//
// A render that timed out, was blocked or hit a 404 collapses it the same way:
// that is a fact about one attempt, not about the page's markup. So `renderRan`
// is true only for a browser that actually read the page.
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
export function renderAttempt(url, { run = execRender, tmp = tmpdir(), expand = false } = {}) {
  // Per-URL scratch path: two sessions clipping into one vault is normal here
  // (lib/triage.mjs), and a shared filename would let one render overwrite
  // another's page and file the wrong article under the wrong url.
  const htmlFile = join(tmp, `wm-render-${createHash('sha1').update(url).digest('hex').slice(0, 16)}.html`);
  const [local, pinned] = renderLaunchers();
  const target = `"${url}" "${htmlFile}"${expand ? ' --expand' : ''}`;
  let meta;
  let throughNpx = false;
  try {
    try {
      meta = JSON.parse(run(`${local} ${target}`));
    } catch (e) {
      if (lastJsonObject(e.stderr)?.missing !== 'playwright-core') throw e;
      throughNpx = true;
      meta = JSON.parse(run(`${pinned} ${target}`));
    }
  } catch (e) {
    // render-page.mjs exits 3 with {unavailable:true} when the rung cannot run
    // at all — no playwright-core, no browser. That is a setup problem the user
    // fixes once for every future URL, and reporting it per-URL as "the site
    // blocked us" would send them off to triage 60 sources by hand instead.
    // An npx that dies before render-page starts, as it does offline, leaves no
    // line of ours, and that says nothing about the page either.
    const payload = lastJsonObject(e.stderr);
    const firstLine = String(e.message || e).split('\n')[0];
    // npm ends with a pointer to its log file, so its first error line is the one that names the cause.
    const npmError = String(e.stderr || '').split(/\r?\n/).find((line) => line.startsWith('npm error'));
    const unavailable = payload ? payload.unavailable === true : throughNpx;
    // Which part is missing, as render-page.mjs names it. An npx that died without a line of ours could not fetch the package.
    const missing = unavailable ? (payload ? payload.missing : 'playwright-core') : undefined;
    return {
      ok: false,
      kind: 'failed',
      unavailable,
      ...(missing && { missing }),
      reason: redactReasonText(payload?.error || (throughNpx ? `render did not finish through npx: ${npmError || firstLine}` : `render failed: ${firstLine}`)),
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
    const coverage = meta.expansion ? { ...meta.expansion, tables: data.pageCounts?.tables ?? 0, code: data.pageCounts?.code ?? 0 } : undefined;
    return { ok: true, data, finalUrl: meta.finalUrl, ...(coverage ? { coverage } : {}) };
  } catch (e) {
    // The command text carries the page's final address as a base64 payload, so it never goes into the reason.
    const message = String(e.message || e).split('\n')[0].replace(/--payload\s+\S+/g, '--payload …');
    return { ok: false, kind: 'failed', reason: `rendered, but extraction failed: ${redactReasonText(message)}` };
  } finally {
    rmSync(htmlFile, { force: true });
  }
}

// landingDocument over the page's PDF links without any that carries a secret: an extractor that was handed one
// (a test, a browser route) must not turn it into the landing row's address.
const landingOf = (signals, words) => landingDocument(signals && { ...signals, pdfLinks: (signals.pdfLinks ?? []).filter((link) => !urlCarriesSecret(link)) }, words);

// An address on the page's own site that no page should answer: its origin and directory, the last path segment replaced by a name
// taken from the page's address, and no query.
export function probeUrl(url) {
  const u = new URL(url);
  const parts = u.pathname.split('/');
  const trailing = parts.length > 2 && parts.at(-1) === '';
  if (trailing) parts.pop();
  parts[parts.length - 1] = `wiki-master-probe-${createHash('sha256').update(url).digest('hex').slice(0, 8)}`;
  if (trailing) parts.push('');
  return `${u.origin}${parts.join('/')}`;
}

// True when the browser reads the same text at a made-up address as it did at the page: whitespace and case do not count. A
// failed or differing read of the made-up address (a not-found page, a 404) is the site telling the two addresses apart.
function servesOneShell(url, pageText, render) {
  const probe = render(probeUrl(url));
  if (!probe.ok) return false;
  const same = (t) => String(t ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  return same(stripArchiveChrome(probe.data.contentMarkdown || probe.data.content || '')) === same(pageText);
}

export function extractionAvailable() {
  for (const launch of extractionLaunchers()) {
    const cmd = `${launch} --check-runtime`;
    try { execSync(cmd, { stdio: 'ignore' }); return true; } catch { /* try next */ }
  }
  return false;
}

// `today` is the date a clipping is stamped with (YYYY-MM-DD); a test supplies its own, and its own `render` in place of a browser.
// `fetchTwin(url)` answers the plain-text twin probes with the same shape as `fetchText`, and is as offline as it when `extract` is injected.
// `sleep(ms)` is the wait between two requests to one host in a --list run; `runtimeAvailable()` says whether the extractor can run at all.
export function main(argv, { extract = runDefuddleJson, writeClipping = writeClippingExclusive, fetchText, fetchTwin, today: todayOf = today, render = renderAttempt, sleep = waitSync, runtimeAvailable = extractionAvailable } = {}) {
  // A caller that supplies its own extraction (a test) has not asked for the network: the plain-text fetch runs only with the real
  // extractor, or when it is supplied too.
  const readText = fetchText ?? (extract === runDefuddleJson ? fetchPlainText : () => ({ ok: false, reason: 'extraction is injected' }));
  const probeTwin = fetchTwin ?? (extract === runDefuddleJson ? fetchTwinText : () => ({ ok: false, reason: 'extraction is injected' }));
  if (argv.slice(1).includes('--list')) return refuse('--list must be the first argument');
  // --ledger is checked before anything is read, so a refused ledger leaves the vault as it was.
  const ledger = optionValue(argv, 'ledger');
  if (ledger !== undefined) {
    const problem = ledgerFileProblem(ledger, resolveVault().path);
    if (problem) return refuse(problem);
  }
  // A list that cannot be run is refused before the ledger is probed, because the probe creates the file and a refused run must not leave one.
  const list = argv[0] === '--list' ? readList(argv) : null;
  if (list?.error) return refuse(list.error);
  if (ledger !== undefined) {
    // A ledger that cannot be appended to is found now, not after the first clipping is written.
    const unwritable = ledgerAppendProblem(ledger);
    if (unwritable) return refuse(unwritable);
  }
  // A write that fails later is reported once; the run goes on without rows and ends with exit 2 (1 still wins for a missing runtime).
  let ledgerWorks = ledger !== undefined;
  const record = (result) => {
    if (!ledgerWorks) return;
    try { appendLedgerRow(ledger, ledgerRow(result)); } catch (e) {
      ledgerWorks = false;
      console.error(`--ledger: ${ledger} cannot be appended to (${e.code ?? e.message}); no more rows will be written and the run carries on`);
      process.exitCode = 2;
    }
  };
  const deps = { extract, writeClipping, readText, probeTwin, todayOf, render, sleep, runtimeAvailable, record };
  if (list) return runList(argv, deps, list);
  const url = argv[0];
  if (!url) { for (const line of CLIP_SPECS['clip'].usage) console.error(line); process.exit(2); }
  // A refused address is recorded without its secrets, or not at all when it is not an address.
  const refused = (error) => record({ url: redactAddress(url), topic: parseTopicArg(argv), status: 'error', error });
  try { new URL(url); } catch { console.error(`invalid url: ${url}`); refused('invalid url'); process.exit(2); }
  // A secret in the address would be queued in the triage log (which syncs), recorded in declined.json or written as source:.
  if (urlCarriesSecret(url)) {
    const refusal = secretRefusal(url, 'save the page from a signed-in browser and record it with clip.mjs <url-without-the-secret> --from-file <path>');
    console.error(refusal);
    refused(refusal);
    process.exit(2);
  }
  const { exit, requested, ...result } = clipUrl(url, argv, deps);
  // A missing extraction runtime is recorded like any outcome, then ends the command.
  record(result);
  if (exit === 1) process.exit(1);
  if (exit) process.exitCode = exit;
  return result;
}

// A refusal of the whole command: one line, exit 2, nothing read.
function refuse(error) {
  console.error(error);
  process.exitCode = 2;
  return { status: 'error', error };
}

// A real wait that does not spin: the thread sleeps on a value that never changes until the time is up.
function waitSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

// The options that name one page or lift a decline: each is refused with --list.
const LIST_REFUSES = ['from-file', 'slug', 'decline', 'override-decline', 'supersede-decline'];
const OUTCOME_ORDER = ['clipped', 'unchanged', 'duplicate', 'clash', 'declined', 'blocked', 'thin', 'failed', 'error'];

// What is wrong with one line of a list, or null. A message never repeats the line: it may hold a password.
function listLineProblem(line) {
  if (urlCarriesSecret(line)) return secretRefusal(line);
  try { if (/^https?:$/.test(new URL(line).protocol)) return null; } catch { /* not an address at all */ }
  return 'not an http or https address';
}

// The file of a `--list` run and its text, or the one-line refusal when the arguments or the file cannot be used. Nothing is created.
function readList(argv) {
  const file = argv[1];
  if (!file || file.startsWith('--')) return { error: '--list needs a file: clip.mjs --list <file> [options]' };
  for (let i = 2; i < argv.length; i++) {
    const name = argv[i].startsWith('--') ? argv[i].slice(2).split('=')[0] : null;
    if (argv[i] === '--ledger') { i++; continue; }
    if (name === null) return { error: `--list cannot be used with a URL on the command line: put the address in ${file}` };
    if (LIST_REFUSES.includes(name)) return { error: `--list cannot be used with --${name}` };
  }
  try { return { file, text: readFileSync(file, 'utf8') }; } catch (e) { return { error: `--list: cannot read ${file}: ${e.code ?? e.message}` }; }
}

// A render that comes back unavailable because the package could not be fetched (an npx that cannot reach the registry took about
// 71 seconds a URL offline) is not asked again for the rest of the run: every later render answers with the same result, and one line
// says so. A missing browser is quick and a timeout is about one page, so neither counts. The state is this run's and no more.
function skippingRenders(render) {
  let fetchFailed = null;
  let said = false;
  return (url, options) => {
    if (!fetchFailed) {
      const r = render(url, options);
      if (r?.unavailable === true && r.missing === 'playwright-core') fetchFailed = r;
      return r;
    }
    if (!said) { said = true; console.error('renders are being skipped for the rest of this run: the render package could not be fetched (pages are queued, not declined)'); }
    return { ...fetchFailed };
  };
}

// `clip.mjs --list <file> [options]`: each address of the file, in order and one at a time, clipped as `clip.mjs <url> [options]` would
// be. Only a missing extraction runtime ends the run early (exit 1), because it affects every address; every other outcome, a bad line
// among them, is counted and the run goes on.
function runList(argv, rootDeps, { text }) {
  const deps = { ...rootDeps, render: skippingRenders(rootDeps.render) };
  const lines = (text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text).split(/\r?\n/).map((line, i) => ({ n: i + 1, line: line.trim() })).filter(({ line }) => line && !line.startsWith('#'));
  const counts = new Map();
  const outcomes = [];
  // Hosts a request went to since the last wait for them.
  const awaiting = new Set();
  let stopped = null;
  for (const { n, line } of lines) {
    const problem = listLineProblem(line);
    let outcome;
    if (problem) {
      console.error(`line ${n}: ${problem}`);
      outcome = { url: redactAddress(line), topic: parseTopicArg(argv), status: 'error', error: problem };
    } else {
      const host = new URL(line).host;
      if (awaiting.delete(host)) deps.sleep(1000);
      outcome = clipUrl(line, argv, deps);
      if (outcome.requested) awaiting.add(host);
    }
    const { exit, requested, ...result } = outcome;
    deps.record(result);
    // The address that found the runtime missing has its row, but it is not counted among the URLs that were clipped or refused.
    if (exit === 1) { stopped = n; break; }
    outcomes.push(result);
    counts.set(result.status, (counts.get(result.status) ?? 0) + 1);
  }
  const order = [...counts.keys()].sort((a, b) => (OUTCOME_ORDER.indexOf(a) + 1 || 99) - (OUTCOME_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b));
  const done = stopped ? `stopped at line ${stopped}, after ${outcomes.length} URLs` : `${outcomes.length} URLs`;
  console.log(`list: ${done}${order.length ? `: ${order.map((k) => `${k} ${counts.get(k)}`).join(', ')}` : ''}`);
  if (stopped) process.exitCode = 1;
  return { status: stopped ? 'error' : 'list', counts: Object.fromEntries(order.map((k) => [k, counts.get(k)])), outcomes };
}

// One address, start to finish. It never exits and never sets the exit code: an outcome that should end the process says so in
// `exit` (2 for a refused command, 1 for an extraction runtime that is missing) and the caller decides.
// `requested` says whether a request went out to the address's host (true unless an outcome says otherwise), which is what the wait
// between two addresses on one host is owed for: a duplicate found after the plain-text twin probe or a lost write did request.
function clipUrl(url, argv, deps) {
  const outcome = clipCore(url, argv, deps);
  const topic = parseTopicArg(argv);
  return { url, ...(topic && { topic }), requested: true, ...outcome };
}

function clipCore(url, argv, { extract, writeClipping, readText, probeTwin, todayOf, render: renderPage, runtimeAvailable }) {
  // A reason from the browser can quote an address the page sent it to. It is made safe here, once, before anything prints or stores it.
  const render = (target, options) => {
    const r = renderPage(target, options);
    return typeof r?.reason === 'string' ? { ...r, reason: redactReasonText(r.reason) } : r;
  };
  const qArg = argv.find((a) => a.startsWith('--quality='));
  const quality = qArg ? qArg.split('=')[1] : 'medium';
  // One flag feeds both topic carriers: frontmatter on the clip path below,
  // and the triage log on every path that queues an issue instead. A caller
  // never has to know which population a URL is about to land in.
  const topic = parseTopicArg(argv);

  // --from-file: a page a person saved. The file must be one this clipper can read before anything else happens.
  const fromFile = optionValue(argv, 'from-file');
  // --expand needs a page a browser can open: a saved file isn't one, and a browser reads a PDF or a text file no better.
  const expand = argv.includes('--expand');
  if (expand && (fromFile !== undefined || looksLikePdfUrl(url) || looksLikePlainTextUrl(url))) {
    const error = fromFile !== undefined ? '--expand cannot be used with --from-file' : `--expand opens a page in a browser, and this URL serves a PDF or a text file: ${url}`;
    console.error(error);
    return { status: 'error', error, exit: 2, requested: false };
  }
  // --find-twin reads the clipping already in the vault and the live page; a supplied file or a browser read has neither.
  const findingTwin = argv.includes('--find-twin');
  if (findingTwin && (fromFile !== undefined || expand)) {
    const error = `--find-twin cannot be used with ${fromFile !== undefined ? '--from-file' : '--expand'}`;
    console.error(error);
    return { status: 'error', error, exit: 2, requested: false };
  }
  if (fromFile !== undefined) {
    const problem = suppliedFileProblem(fromFile);
    if (problem) { console.error(`--from-file: ${problem}`); return { status: 'error', error: problem, exit: 2, requested: false }; }
  }

  if (isBlocked(url)) { console.log(`blocked (unreliable domain): ${url}`); return { status: 'blocked', requested: false }; }

  const { path: vaultPath } = resolveVault();

  // Only a page that already clipped with a partial warning is worth a probe, and nothing is written whatever it finds.
  if (findingTwin) {
    const held = newestCapture(clippingsForUrl(vaultPath, url));
    if (held?.fidelity !== 'partial') {
      const reason = 'no clipping of it carries a partial fidelity warning';
      console.log(`no probe (${reason}): ${url}`);
      return { status: 'skipped', reason, requested: false };
    }
    let signals;
    try { signals = extract(url).pageSignals; } catch { /* the suffix and index probes need no page */ }
    const found = findTwin({ url, signals, fetchTwin: probeTwin });
    if (!found.ok) { console.log(`no plain-text twin found: ${url}`); return { status: 'no-twin' }; }
    console.log(`twin found (${wordCount(found.text)} words; nothing was written): ${found.url}`);
    return { status: 'twin', twinUrl: found.url };
  }

  // Explicit decline (Phase 2 reject): record the decision instead of clipping,
  // so the next discovery run does not re-litigate this URL.
  const declineArg = argv.find((a) => a.startsWith('--decline='));
  if (declineArg) {
    const reason = declineArg.slice('--decline='.length) || 'declined';
    recordDecline(vaultPath, url, reason);
    console.log(`declined (recorded): ${url} — ${reason}`);
    return { status: 'declined', reason, requested: false };
  }

  const gate = declineGate(vaultPath, url, argv);
  if (gate.blocked) {
    if (gate.error) { console.error(gate.error); return { status: 'error', error: gate.error, exit: 2, requested: false }; }
    console.log(gate.message);
    return { status: 'declined', reason: gate.message.split('\n')[0], requested: false };
  }

  // --recapture: a URL that is already clipped is fetched, extracted and checked like any clip, then written as a dated second
  // capture beside the first, or not written at all when the text has not changed. Only the flag skips the duplicate check.
  const recapture = argv.includes('--recapture');
  const capturesNow = () => (recapture ? clippingsForUrl(vaultPath, url) : []);
  const alreadyHeld = recapture ? null : heldClipping(vaultPath, url);
  if (alreadyHeld) {
    // A url already in the vault closes any row that says it could not be
    // fetched — that row is describing a source sitting on disk. This is the
    // 9-of-29 case from the 2026-09-05 replay, and leaving it open is how a
    // queue fills with entries nobody can action.
    closeIssuesResolvedByClip(vaultPath, url, 'duplicate');
    console.log(`duplicate (already clipped): ${url}`); return { ...duplicateResult(alreadyHeld), requested: false };
  }
  if (recapture && capturesNow().length === 0) console.log(`recapture: not clipped yet, clipping it normally: ${url}`);

  let data;
  // 'text' when the static ladder produced the content, 'rendered' when a browser
  // had to. Recorded in frontmatter so a reader knows the text came out of a live
  // DOM rather than the served html — the same role `extraction: ocr` plays for
  // clip-pdf, and read the same way by triage (a method, not a defect).
  let extraction = 'text';
  // A URL that looks like a text file (a checksum manifest, a pinned source file) is kept whole, in a fence: Defuddle cannot read
  // one, and a short one would be judged thin. A binary or oversized file is refused; anything else that is not text is the ladder's.
  let plain = null;
  // A supplied file is read under the same size and binary guards as a fetched text file. Nothing below fetches for it: the
  // URL is only the page's address.
  let manual = null;
  if (fromFile !== undefined) {
    const supplied = readSuppliedFile(fromFile);
    if (supplied.missing) {
      console.error(`--from-file: ${fromFile}: ${supplied.reason}`);
      return { status: 'error', error: supplied.reason, exit: 2, requested: false };
    }
    if (supplied.refused) {
      recordIssue(vaultPath, { url, kind: 'attention', reason: `supplied file refused: ${supplied.reason}`, topic });
      console.log(`not clipped (${supplied.reason}; triage recorded): ${url}`);
      return { status: 'thin', reason: supplied.reason, requested: false };
    }
    manual = { kind: suppliedKind(fromFile), text: supplied.text, sha256: supplied.sha256 };
    extraction = 'manual';
  }
  if (!manual && looksLikePlainTextUrl(url)) {
    plain = readText(url);
    if (plain.refused) {
      recordIssue(vaultPath, { url, kind: 'attention', reason: `plain-text capture refused: ${plain.reason}`, topic });
      console.log(`not clipped (${plain.reason}; triage recorded): ${url}`);
      return { status: 'thin', reason: plain.reason };
    }
    if (plain.ok) extraction = 'plaintext';
  }
  // Still NOT declined: a decline is a judgment, and a fetch failure is a fact about one attempt. A 180-day TTL would
  // bury a recoverable source.
  const queueRenderFailure = (r) => {
    // `unavailable` means the rung never ran (no playwright-core, no browser),
    // so nothing has been learned about this URL. Say so once, plainly, rather
    // than filing a setup problem as the site's fault on every URL in the batch.
    if (r.unavailable) console.error(`render rung unavailable: ${r.reason}`);
    const kind = r.unavailable ? 'failed' : r.kind;
    const reason = r.unavailable
      ? 'fetch failed (likely 403/paywall/transient; browser render unavailable)'
      : r.reason;
    recordIssue(vaultPath, { url, kind, reason, topic });
    console.log(`clip failed — ${reason} (queued for triage): ${url}`);
    return { status: 'failed', reason };
  };
  // The plain-text twin of a page that read thin or failed (lib/twin.mjs): Markdown a site serves beside the page, which keeps
  // the code a rendered read loses and costs a request instead of a browser. Not for a supplied file, --expand, or a URL that
  // is already text or a PDF. A twin the vault holds is a duplicate unless the clip is a recapture.
  let twinUrl = null;
  const twinFor = (pageData) => {
    if (manual || expand || plain || looksLikePlainTextUrl(url) || looksLikePdfUrl(url)) return null;
    const found = findTwin({ url, signals: pageData?.pageSignals, fetchTwin: probeTwin });
    if (!found.ok) return null;
    const heldTwin = recapture ? null : heldClipping(vaultPath, found.url);
    if (heldTwin) {
      closeIssuesResolvedByClip(vaultPath, url, 'duplicate');
      console.log(`duplicate (already clipped): ${found.url} (the plain-text twin of ${url})`);
      return { result: duplicateResult(heldTwin) };
    }
    twinUrl = found.url;
    return { data: { ...(pageData?.author && { author: pageData.author }), ...(pageData?.published && { published: pageData.published }), ...twinPage({ twin: found, pageTitle: pageData?.title, name: plainTextPage(url, '').title }) } };
  };
  // What --expand opened and found. It reads the browser or nothing: static text in its place would look like the full page.
  let coverage = null;
  if (expand) {
    const r = render(url, { expand: true });
    if (!r.ok) return queueRenderFailure(r);
    data = r.data;
    extraction = 'rendered';
    coverage = r.coverage ?? null;
  } else try { data = manual ? (manual.kind === 'html' ? extract(resolve(fromFile), { sourceUrl: url }) : suppliedTextPage(url, manual.text)) : plain?.ok ? plainTextPage(url, plain.text) : extract(url); }
  catch {
    // The extractor could not read the supplied page. It is the person's file, so there is no ladder to try: no fetch, no browser.
    if (manual) {
      const reason = 'the supplied page could not be read by the extractor';
      recordIssue(vaultPath, { url, kind: 'attention', reason, topic });
      console.log(`clip failed: ${reason} (queued for triage): ${url}`);
      return { status: 'failed', reason };
    }
    // Distinguish "Defuddle not installed" (fatal) from "this URL failed" (skip, so
    // batch runs continue).
    if (!runtimeAvailable()) {
      const error = 'HTML extraction runtime unavailable. Ensure Node.js and npm/npx are available; the clipper installs its pinned extraction packages automatically.';
      console.error(error);
      return { status: 'error', error, exit: 1 };
    }
    // A PDF is not a page this clipper can ever read, and rendering one only
    // buys a longer way to say so: arxiv.org/pdf/2404.03337 spent four Defuddle
    // attempts and a full browser launch to arrive at "rendered, but extraction
    // failed: Command failed: npx …", which names neither cause nor cure. Stop
    // here and name the tool that does handle it — the vault already holds
    // eight arxiv PDFs that clip-pdf extracted correctly.
    if (looksLikePdfUrl(url)) {
      const reason = `this url serves a PDF — clip it with: node scripts/clip-pdf.mjs "${url}"`;
      // Retryable, like the landing row: a later row for this URL without the tag would clear it, and a clip-pdf run closes it.
      recordIssue(vaultPath, { url, kind: 'attention', reason, topic, retryable: true });
      console.log(`clip failed — ${reason} (queued for triage): ${url}`);
      return { status: 'failed', reason };
    }

    // The static ladder never runs JavaScript, so its failures are dominated by
    // pages that HAVE no content until a browser builds it. Sampling 17 entries
    // out of this vault's own failed/thin queue on 2026-09-05, the browser rung
    // recovered 8 of them outright and correctly re-diagnosed most of the rest.
    const twin = twinFor(null);
    if (twin?.result) return twin.result;
    if (twin) { data = twin.data; extraction = 'plaintext-twin'; }
    else {
      const r = render(url);
      if (!r.ok) return queueRenderFailure(r);
      data = r.data;
      extraction = 'rendered';
    }
  }

  // Stripped before anything measures or hashes it: the word floor below must
  // judge the article, not the archive's banner, and the source-hash must
  // describe what the vault will actually quote.
  // Supplied text is the page as the person saved it, so the archive banner is not stripped from it.
  let md = manual?.kind === 'text' || extraction === 'plaintext-twin' ? data.contentMarkdown : stripArchiveChrome(data.contentMarkdown || data.content || '');
  // A thin extraction off the STATIC html is the exact signature of a page whose
  // article is built client-side: docs.mealie.io serves 299 words of markup that
  // Defuddle reduces to "Back to top". Re-reading it from a rendered DOM is the
  // only way to tell "nothing there" apart from "nothing there yet". Skipped when
  // the render rung already supplied this text — it does not get a second turn.
  // What the browser rung made of this URL. It has already run (and succeeded)
  // when extraction === 'rendered'; otherwise it is set by the thin-path attempt
  // just below. The verdict further down needs all of it: whether the browser
  // read the page, and if not, why.
  let renderResult = extraction === 'rendered' ? { ok: true } : null;
  // The text the browser read, kept past the choice below because a thin one is judged against another address on the same site.
  let renderedMd = extraction === 'rendered' ? md : null;
  const isPlain = () => extraction === 'plaintext' || extraction === 'plaintext-twin';
  // A short page whose substance is one PDF link is written as what it is, before the thin path can decline it. A page read by
  // --expand is not checked: the owner asked for its tabs, not for a verdict on what it links to.
  let landing = expand ? null : landingOf(data.pageSignals, wordCount(md));
  if (!landing && wordCount(md) < THIN_WORD_FLOOR && !renderResult && !isPlain() && !manual) {
    const twin = twinFor(data);
    if (twin?.result) return twin.result;
    if (twin) { data = twin.data; md = data.contentMarkdown; extraction = 'plaintext-twin'; }
  }
  if (!landing && wordCount(md) < THIN_WORD_FLOOR && !renderResult && !isPlain() && !manual) {
    renderResult = render(url);
    const rendered = renderResult.ok ? stripArchiveChrome(renderResult.data.contentMarkdown || renderResult.data.content || '') : '';
    if (renderResult.ok) renderedMd = rendered;
    const renderedLanding = renderResult.ok ? landingOf(renderResult.data.pageSignals, wordCount(rendered)) : null;
    if (wordCount(rendered) >= THIN_WORD_FLOOR || renderedLanding) {
      data = renderResult.data;
      md = rendered;
      extraction = 'rendered';
      landing = renderedLanding;
    }
  }

  if (!landing && wordCount(md) < THIN_WORD_FLOOR && !isPlain()) {
    const verdict = classifyShortExtraction({ markdown: md, rawHtml: data.content, description: data.description });
    if (verdict.kind !== 'short_real_article' && manual) {
      // A file a person supplied is never declined and never re-fetched: the row says what to supply instead.
      const reason = verdict.kind === 'wrong_node'
        ? 'the supplied page has a description whose text is not in the extracted body (likely the wrong part of the page); save the whole page'
        : `thin content: the supplied file has ${wordCount(md)} words (a page needs ${THIN_WORD_FLOOR})`;
      recordIssue(vaultPath, { url, kind: verdict.kind === 'wrong_node' ? 'wrong-node' : 'thin', reason, topic });
      console.log(`not clipped (${reason}; triage recorded, not declined): ${url}`);
      return { status: 'thin', reason };
    }
    if (verdict.kind !== 'short_real_article') {
      // The browser reached for the page and did not read it. Unlike `unavailable`,
      // this attempt learned something, so the row and the line say what.
      const unread = !renderResult.ok && !renderResult.unavailable;
      const notRead = `browser render did not read the page (${renderResult.reason})`;
      // A dead source is not a thin one, and advice to save it from a browser would be no use.
      if (unread && renderResult.kind === 'gone') {
        recordIssue(vaultPath, { url, kind: 'gone', reason: renderResult.reason, topic });
        console.log(`page gone: ${url}; triage recorded; not declined — ${notRead}`);
        return { status: 'failed', reason: renderResult.reason };
      }
      // Thin/wrong-node is deterministic given this page's current markup — once a
      // browser has read it, record it so the next run skips without re-fetching.
      // TTL re-litigates eventually.
      // An --expand read is asked for by name and its failures are queued; it leaves the verdict to a person.
      // A browser read the page and it is still a shell. If a made-up address on the same site reads the same, the site serves that
      // shell for any address and the read says nothing about this URL: it is queued and not declined. Only that verdict, only a
      // browser that read the page, and not an --expand read, which is never declined anyway.
      const unverified = !expand && verdict.kind === 'empty_shell' && renderResult.ok === true && servesOneShell(url, renderedMd, render);
      const declined = !expand && !unverified && shouldDeclineThin({ renderRan: renderResult.ok === true });
      if (declined) recordDecline(vaultPath, url, verdict.reason);
      // Also queue it: the decline stops the re-fetch, but the source was still
      // wanted and only a human can clip it manually.
      const reason = unread ? `${verdict.reason}; ${notRead}` : unverified ? `unverified URL: this site serves the same text for an address that does not exist, so it says nothing about this one (${verdict.reason})` : verdict.reason;
      recordIssue(vaultPath, {
        url,
        kind: verdict.kind === 'wrong_node' ? 'wrong-node' : 'thin',
        reason,
        topic,
      });
      const label = verdict.kind === 'wrong_node' ? 'possible extraction mismatch' : 'thin content';
      const route = 'save the page from a signed-in browser and record it with clip.mjs <url> --from-file <path>';
      const recorded = declined
        ? 'decline + triage recorded'
        : expand ? 'triage recorded; not declined — an --expand read'
        : unverified ? 'triage recorded; not declined — unverified URL: the site serves this text for any address' : 'triage recorded; not declined — browser render unavailable';
      console.log(unread
        ? `${label} (${route}): ${url}; triage recorded; not declined — ${notRead}`
        : `${label} (${route}; ${recorded}): ${url}`);
      return { status: 'thin', reason };
    }
    // else: short_real_article — fall through and clip as a genuine, if brief, article.
  }

  // A page with words enough to clear the floor can still be the gate and not the page: a login form, a consent wall, an age
  // check. Its own vocabulary, dense, with none of its title in the text, is the signal (lib/interstitial.mjs). It is queued
  // for a person and not declined: a wall is not a verdict on the source, and a signed-in browser can still clip it.
  const shell = isPlain() ? null : classifyInterstitial({ markdown: md, title: manual?.kind === 'text' ? addressTitle(url) : data.title });
  if (shell) {
    recordIssue(vaultPath, { url, kind: 'wrong-node', reason: shell.reason, topic });
    console.log(manual
      ? `not clipped (the supplied file is a login, consent or age-gate page, not the page; triage recorded, not declined): ${url}`
      : `login, consent or age-gate page (save the page from a signed-in browser and record it with clip.mjs <url> --from-file <path>; triage recorded, not declined): ${url}`);
    return { status: 'thin', reason: shell.reason };
  }

  if (coverage) {
    const short = coverageWarnings(coverage, md);
    if (short.length) data = { ...data, fidelityWarnings: [...(data.fidelityWarnings ?? []), ...short] };
  }
  const expandCoverage = coverage ? formatCoverage(coverage) : undefined;
  const clippingsDir = join(vaultPath, 'raw', 'clippings');
  const created = todayOf();
  const hash = createHash('sha256').update(md).digest('hex');
  // Text identical to any capture already holding this URL is not a new capture: nothing is written.
  const sameText = () => newestCapture(capturesNow().filter((e) => e.sourceHash === hash));
  // A tab this HTML shows no panel for. The extractor keeps every panel that is there, so only --expand can read these.
  const unopened = expand ? 0 : data.pageSignals?.tabControls ?? 0;
  // What the text kept of the page. Only a read that went through extractHtml has a visible-word count to compare with. A shortfall no
  // retry fixed is a note and not a warning: a short article beside a long comment thread trips the same trigger.
  const keptOfPage = () => {
    if (!Number.isInteger(data.visibleWords)) return {};
    const extracted = wordCount(md);
    if (data.extractionRetry) console.log(retryKeptNote(data.extractionRetry, extracted, data.visibleWords));
    else if (data.shortfall) console.log(shortfallNote(extracted, data.visibleWords));
    return { ...(data.extractionRetry && { extractionRetry: data.extractionRetry }), visibleWords: data.visibleWords, extractedWords: extracted };
  };
  const withNotes = (result) => {
    if (expandCoverage) result = { ...result, expandCoverage };
    else if (unopened > 0) {
      console.log(unopenedTabsNote(unopened));
      result = { ...result, unexpandedTabs: unopened };
    }
    return { ...result, sourceHash: hash, extraction, ...(twinUrl && { twinUrl }), ...(landing && { landing: true, documentLink: landing }), ...keptOfPage() };
  };
  const unchanged = (twin) => {
    closeIssuesResolvedByClip(vaultPath, url, 'duplicate');
    console.log(`unchanged (same text as raw/clippings/${twin.file}); nothing written`);
    return withNotes({ status: 'unchanged', existing: twin.name, path: `raw/clippings/${twin.file}` });
  };
  const twin = sameText();
  if (twin) return unchanged(twin);
  const recapturing = newestCapture(capturesNow()) !== null;
  // The Nth capture of one day is named and titled `(recaptured D)`, then `(recaptured D 2)`, `3`...: a second recapture the same day
  // is a new capture, and only a name the owner chose with --slug is exact.
  const suffixFor = (n) => (recapturing ? ` (recaptured ${created}${n > 1 ? ` ${n}` : ''})` : '');
  // The first free name from a fixed, deterministic list (see lib/clip-slug.mjs), written with an
  // exclusive create so a clip never overwrites a file another session just made. A name nobody can
  // take is a `clash`, never a `duplicate`: it is recorded and named so the document is not lost silently.
  const slugArg = (optionValue(argv, 'slug') ?? '').trim();
  const ownerSlug = slugArg ? slugify(slugArg) : null;
  // lowercase name -> the name as it is on disk, so a clash can name the file that is really there
  const names = new Map((existsSync(clippingsDir) ? readdirSync(clippingsDir) : []).filter((f) => f.toLowerCase().endsWith('.md')).map((f) => [f.slice(0, -3).toLowerCase(), f.slice(0, -3)]));
  const exists = (s) => names.has(s.toLowerCase());
  const heading = firstHeading(md);
  // The title and the file for the capture numbered `n` of its day. A title is an identity in this vault: a new clip does not take one
  // another clipping already holds, and a recapture's is the page's title with the same suffix as its name, so it is never the first
  // capture's title. Built again for the name that is finally chosen, and `recapture-of` names the newest capture at that moment.
  const build = (n) => {
    const previous = newestCapture(capturesNow());
    const title = uniqueTitle({ title: recapturing && data.title ? `${data.title}${suffixFor(n)}` : data.title, url, taken: clippingTitles(vaultPath) });
    const fm = buildFrontmatter({
      title, source: url, author: data.author, recaptureOf: previous ? `raw/clippings/${previous.file}` : undefined,
      published: data.published, created, quality, hash, topic, extraction, extractionRetry: data.extractionRetry, twinUrl: twinUrl ?? undefined, documentLink: landing ?? undefined, suppliedSha256: manual?.sha256,
      fidelity: data.fidelityWarnings?.length ? 'partial' : undefined, fidelityChecks: data.fidelityAssessment?.checked,
      fidelityIgnored: data.fidelityAssessment?.ignored?.length, expandCoverage,
    });
    return { title, content: `${fm}\n\n${md}\n` };
  };
  // A recapture's name is the first capture's name and the dated suffix, with the day's next free sequence when this URL already
  // holds that name; a name another document holds moves on to the next candidate.
  const pickRecapture = () => {
    const held = capturesNow();
    const mine = new Set(held.map((e) => e.name.toLowerCase()));
    const oldest = held.reduce((a, e) => (a === null || (e.created ?? '') < (a.created ?? '') || ((e.created ?? '') === (a.created ?? '') && e.name < a.name) ? e : a), null);
    const stem = oldest.name.replace(RECAPTURE_NAME, '');
    for (const base of [stem, ...clipSlugCandidates({ title: data.title, heading, url })]) {
      for (let n = 1; ; n++) {
        const name = `${base}${suffixFor(n)}`;
        if (mine.has(name.toLowerCase())) continue;
        if (!exists(name)) return { slug: name, sequence: n };
        break;
      }
    }
    return { clash: true, existing: `${stem}${suffixFor(1)}` };
  };
  let slug = null;
  let clashWith = null;
  let lostTo = null;
  for (let lost = 0; ;) {
    const pick = ownerSlug ? (exists(ownerSlug) ? { clash: true, existing: ownerSlug } : { slug: ownerSlug }) : recapturing ? pickRecapture() : chooseClipSlug({ title: build(1).title, heading, url, exists });
    if (pick.clash) { clashWith = names.get(pick.existing.toLowerCase()) ?? pick.existing; break; }
    if (writeClipping(clippingsDir, pick.slug, build(pick.sequence ?? 1).content)) { slug = pick.slug; break; }
    // Lost a race: the name was free when we looked and taken when we wrote.
    names.set(pick.slug.toLowerCase(), pick.slug);
    if (recapture) {
      // The winner may be a capture of this very text: then there is nothing new to write.
      const winner = sameText();
      if (winner) return unchanged(winner);
    } else if ((lostTo = heldClipping(vaultPath, url))) {
      closeIssuesResolvedByClip(vaultPath, url, 'duplicate');
      console.log(`duplicate (already clipped): ${url}`); return duplicateResult(lostTo);
    }
    if (++lost >= MAX_WRITE_ATTEMPTS) { clashWith = names.get(pick.slug.toLowerCase()) ?? pick.slug; break; }
  }
  if (slug === null) {
    const reason = `raw/clippings/${clashWith}.md already exists and no alternative name could be written; nothing was written`;
    recordIssue(vaultPath, { url, kind: 'attention', reason, topic, source: `raw/clippings/${clashWith}.md`, retryable: 'clash' });
    console.log(`clash: ${url}: ${reason} (choose a name with --slug=<name>)`);
    return { status: 'clash', existing: clashWith, path: `raw/clippings/${clashWith}.md`, reason };
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
  if (landing) {
    console.log(landingLine(landing));
    recordIssue(vaultPath, { url: landing, kind: 'attention', reason: landingReason(url, landing), topic, retryable: true });
  }
  gate.finish();
  return withNotes({ status: 'clipped', slug, file, path: `raw/clippings/${slug}.md`, quality, fidelity: data.fidelityWarnings?.length ? 'partial' : 'high' });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  guardClipArgs(process.argv.slice(2), CLIP_SPECS['clip']);
  main(process.argv.slice(2));
}
