import { readFileSync, existsSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { classifyRenderOutcome } from './lib/render.mjs';
import { isBlocked } from './lib/blocklist.mjs';
import { isDuplicateUrl } from './lib/url.mjs';
import { loadDeclines, isDeclined, recordDecline } from './lib/decline.mjs';
import { recordIssue } from './lib/triage.mjs';
import { normalizeTopic, parseTopicArg } from './lib/topic.mjs';

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

export function buildFrontmatter({ title, source, author, published, created, quality, hash, fidelity, extraction, topic }) {
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
// Run through the shell (execSync) so Windows resolves the `defuddle.cmd` npm shim
// via PATHEXT; execFile can't launch .cmd. The URL is validated as a real URL in
// main() and double-quoted, so it is safe to interpolate.
export function defuddleAttempts(url) {
  const q = `"${url}"`;
  const ua = `"${DEFAULT_USER_AGENT}"`;
  const lang = `--lang ${CLIP_LANG}`;
  return ['defuddle parse', 'npx --yes defuddle parse'].flatMap((launch) => [
    `${launch} ${q} --json ${lang} --user-agent ${ua}`,
    `${launch} ${q} --json ${lang}`,
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

export function runDefuddleJson(url, { run = execDefuddle } = {}) {
  let lastErr;
  for (const cmd of defuddleAttempts(url)) {
    try {
      return JSON.parse(run(cmd));
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

const RENDER_CLI = join(dirname(fileURLToPath(import.meta.url)), 'render-page.mjs');

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
    const data = JSON.parse(run(`${defuddleLauncher()} parse "${htmlFile}" --json --lang ${CLIP_LANG}`));
    return { ok: true, data, finalUrl: meta.finalUrl };
  } catch (e) {
    return { ok: false, kind: 'failed', reason: `rendered, but extraction failed: ${String(e.message || e).split('\n')[0]}` };
  } finally {
    rmSync(htmlFile, { force: true });
  }
}

// Whichever launcher works here — mirrors the two rungs of defuddleAttempts so a
// globally-installed Defuddle is preferred and npx is the fallback.
let cachedLauncher;
function defuddleLauncher() {
  if (cachedLauncher) return cachedLauncher;
  try {
    execSync('defuddle --version', { stdio: 'ignore' });
    cachedLauncher = 'defuddle';
  } catch {
    cachedLauncher = 'npx --yes defuddle';
  }
  return cachedLauncher;
}

function defuddleReachable() {
  for (const cmd of ['defuddle --version', 'npx --yes defuddle --version']) {
    try { execSync(cmd, { stdio: 'ignore' }); return true; } catch { /* try next */ }
  }
  return false;
}

export function main(argv) {
  const url = argv[0];
  if (!url) { console.error('usage: clip.mjs <url> [--quality=high|medium|low] [--topic="..."] [--decline="reason"]'); process.exit(2); }
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
  // 'text' when the static ladder produced the content, 'rendered' when a browser
  // had to. Recorded in frontmatter so a reader knows the text came out of a live
  // DOM rather than the served html — the same role `extraction: ocr` plays for
  // clip-pdf, and read the same way by triage (a method, not a defect).
  let extraction = 'text';
  try { data = runDefuddleJson(url); }
  catch {
    // Distinguish "Defuddle not installed" (fatal) from "this URL failed" (skip, so
    // batch runs continue).
    if (!defuddleReachable()) {
      console.error(`Defuddle CLI not found. Install it: npm i -g defuddle`);
      process.exit(1);
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

  let md = data.contentMarkdown || data.content || '';
  // A thin extraction off the STATIC html is the exact signature of a page whose
  // article is built client-side: docs.mealie.io serves 299 words of markup that
  // Defuddle reduces to "Back to top". Re-reading it from a rendered DOM is the
  // only way to tell "nothing there" apart from "nothing there yet". Skipped when
  // the render rung already supplied this text — it does not get a second turn.
  // Whether the browser rung got to weigh in on this URL at all. It has already
  // run (and succeeded) when extraction === 'rendered'; otherwise it is set by
  // the thin-path attempt just below.
  let renderRan = extraction === 'rendered';
  if (wordCount(md) < THIN_WORD_FLOOR && !renderRan) {
    const r = renderAttempt(url);
    renderRan = !r.unavailable;
    const rendered = r.ok ? (r.data.contentMarkdown || r.data.content || '') : '';
    if (wordCount(rendered) >= THIN_WORD_FLOOR) {
      data = r.data;
      md = rendered;
      extraction = 'rendered';
    }
  }

  if (wordCount(md) < THIN_WORD_FLOOR) {
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

  const created = today();
  const hash = createHash('sha256').update(md).digest('hex');
  const fm = buildFrontmatter({
    title: data.title, source: url, author: data.author,
    published: data.published, created, quality, hash, topic, extraction,
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
