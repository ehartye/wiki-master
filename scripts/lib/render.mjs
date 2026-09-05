import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// The last rung of the clip ladder: run the page in a real browser, then hand
// the rendered HTML back to Defuddle. Two failure classes need it, and the
// static ladder in clip.mjs can reach neither.
//
//  1. CLIENT-RENDERED PAGES. Defuddle fetches HTML and parses it; it never runs
//     JavaScript. dev.epicgames.com returns 200 with ~30KB of Angular shell and
//     THREE words of text. There is no extraction heuristic that recovers an
//     article which is not in the document.
//
//  2. ANTI-BOT GATES. Cloudflare answers undici with "Just a moment...".
//
// The measured, non-obvious part: a HEADLESS browser fixes only the first class.
// On 2026-09-05 headless Chrome still sat on Cloudflare's interstitial at 37
// words for tripo3d.ai and gamedriver.io, and dev.epicgames.com served headless
// an outright 403 page. The same navigations HEADFUL returned 3,420 / 1,310
// words and a 200. Whatever the gates fingerprint, headlessness is part of it,
// and the bundled Chromium passed exactly where system Chrome did -- so it is
// the headful-ness that matters, not the build.
//
// Headful would normally mean a window stealing focus in the middle of a batch
// discover run, which is unacceptable. Parking it offscreen keeps the real
// window that the gates want without putting it in front of the user.
const OFFSCREEN_ARGS = [
  '--window-position=-32000,-32000',
  '--window-size=1280,900',
  // Chrome otherwise advertises navigator.webdriver to every page it loads.
  '--disable-blink-features=AutomationControlled',
];

// Rendering is 2-4s per page against ~1s for the static ladder, so this rung
// only ever runs after that ladder has already failed. These bound the tail:
// a page that has not settled by now is one whose remaining requests are
// analytics and lazy images, not article text.
export const NAV_TIMEOUT_MS = 30000;
export const IDLE_TIMEOUT_MS = 10000;

// Titles the gate itself serves. These are checked BEFORE the HTTP status,
// because a challenge is served with a 200 as readily as a 403 (measured:
// gamedriver.io 403, then 200 on retry, same interstitial both times).
const CHALLENGE_TITLE =
  /just a moment|checking your browser|attention required|access denied|verify you are (a )?human|are you a robot|ddos protection|enable javascript and cookies/i;

// Whole path segments that mean "this is not the page, this is what happened".
// Only consulted for a destination the caller did not ask for -- a legitimate
// article can live at /blog/404-errors-explained.
const ERROR_PATH_SEGMENTS = new Set([
  '400', '401', '403', '404', '410', '500',
  'error', 'errors', 'not-found', 'notfound', 'pagenotfound',
  'login', 'signin', 'sign-in', 'auth', 'denied', 'blocked',
]);

// The identity a redirect has to preserve. Comparing whole URLs is far too
// strict -- counterpointresearch.com moves /insight/<slug> to /en/insights/<slug>
// (a locale prefix and a pluralized collection) and that is still the article
// asked for. Comparing the last meaningful segment is what actually separates
// "the URL was rewritten" from "the URL was replaced": Epic's stale doc link
// lands on `unreal-engine-5-8-documentation`, which shares nothing with the
// `using-spring-arm-components` that was requested.
//
// null for a bare origin (ampcode.com -> ampcode.com/), which therefore skips
// the guard entirely: a homepage has no slug to lose.
export function pathSlug(url) {
  let pathname;
  try {
    ({ pathname } = new URL(url));
  } catch {
    return null;
  }
  const segs = pathname.split('/').filter(Boolean);
  if (!segs.length) return null;
  let last = decodeURIComponent(segs[segs.length - 1]);
  last = last.replace(/\.[a-z0-9]{1,5}$/i, '');
  const norm = last.toLowerCase().replace(/[^a-z0-9]/g, '');
  return norm || null;
}

// Rendering does not just recover pages -- it makes pages SUCCEED that the
// static ladder correctly failed on, and that is the hazard this function
// exists to contain. A stale Epic doc URL renders 443 words of fluent prose
// that is the documentation index, not the article. Clipped unguarded, the
// vault would hold the index under the article's URL and cite it as that
// article forever: wrong content wearing right frontmatter, which is strictly
// worse than the failed fetch it replaced.
export function classifyRenderOutcome({ requestedUrl, finalUrl, status, title, words }) {
  const wanted = pathSlug(requestedUrl);
  const moved = wanted !== null && wanted !== pathSlug(finalUrl);

  if (CHALLENGE_TITLE.test(String(title || ''))) {
    return {
      ok: false,
      kind: 'blocked',
      reason: `bot challenge unsolved (${String(title).trim().slice(0, 40)}) — clip manually from a signed-in browser`,
    };
  }

  if (status === 404 || status === 410) {
    return {
      ok: false,
      kind: 'gone',
      reason: `page not found (HTTP ${status}) — the source is dead, not blocked`,
    };
  }

  if (moved) {
    const destSeg = String(finalUrl)
      .replace(/[?#].*$/, '')
      .split('/')
      .filter(Boolean)
      .pop()
      ?.toLowerCase() ?? '';
    if (ERROR_PATH_SEGMENTS.has(destSeg)) {
      const gone = /^(404|410|not-?found|pagenotfound)$/.test(destSeg);
      return {
        ok: false,
        kind: gone ? 'gone' : 'blocked',
        reason: `redirected to an error page (${finalUrl}) — served as HTTP ${status}`,
      };
    }
    return {
      ok: false,
      kind: 'failed',
      reason: `redirect landed on a different page (${finalUrl}) — the requested page has moved or been retired`,
    };
  }

  if (status === 401 || status === 403) {
    return { ok: false, kind: 'blocked', reason: `access denied (HTTP ${status})` };
  }
  if (status >= 400) {
    return { ok: false, kind: 'failed', reason: `render returned HTTP ${status}` };
  }

  return { ok: true, words };
}

// Chrome, Edge, or whatever Playwright already downloaded -- the gates care that
// a browser is headful, not which build it is, so anything Chromium-shaped will
// do and requiring a specific one would fail hosts that have the other.
export function findBrowser({ env = process.env, os = platform(), home = homedir() } = {}) {
  if (env.WIKI_MASTER_BROWSER) {
    return existsSync(env.WIKI_MASTER_BROWSER) ? env.WIKI_MASTER_BROWSER : null;
  }

  const candidates = [];
  if (os === 'win32') {
    const pf = env['ProgramFiles'] || 'C:\\Program Files';
    const pf86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    candidates.push(
      join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    );
  } else if (os === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    );
  } else {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser'
    );
  }

  for (const c of candidates) if (existsSync(c)) return c;

  // Fall back to a Playwright download if one is already on the box. The cache
  // layout is chromium-<rev>/chrome-<platform>/<exe>, and the platform folder
  // name has changed across releases (chrome-win, then chrome-win64), so the
  // directory is scanned rather than assumed.
  const cache =
    env.PLAYWRIGHT_BROWSERS_PATH ||
    (os === 'win32'
      ? join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'ms-playwright')
      : os === 'darwin'
        ? join(home, 'Library', 'Caches', 'ms-playwright')
        : join(home, '.cache', 'ms-playwright'));
  if (!existsSync(cache)) return null;
  const exe = os === 'win32' ? 'chrome.exe' : os === 'darwin' ? 'Chromium' : 'chrome';
  let dirs;
  try {
    dirs = readdirSync(cache)
      .filter((d) => d.startsWith('chromium-'))
      .sort()
      .reverse();
  } catch {
    return null;
  }
  for (const d of dirs) {
    let inner;
    try {
      inner = readdirSync(join(cache, d)).filter((x) => x.startsWith('chrome-'));
    } catch {
      continue;
    }
    for (const i of inner) {
      const p =
        os === 'darwin'
          ? join(cache, d, i, 'Chromium.app', 'Contents', 'MacOS', exe)
          : join(cache, d, i, exe);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

// Distinguishes "this rung cannot run here" from "this page failed". The first
// is a setup problem the user can fix once and must therefore be NAMED, not
// swallowed into a per-URL failure that looks like the site's fault.
export class RenderUnavailable extends Error {}

function npmGlobalRoot() {
  try {
    return execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

// playwright-core is optional, so it may be installed anywhere -- and the place
// this plugin's own advice sends people is the one place a plain import cannot
// look. `npm i -g playwright-core` puts it in the global root, which is not on
// any module resolution path; verified as ERR_MODULE_NOT_FOUND with the package
// sitting in the directory `npm root -g` prints. A CLI like Defuddle escapes
// this because PATH finds it; a library import does not have that luxury.
//
// Local first regardless, so a vendored or repo-local copy always wins, and the
// global root is only shelled for when there is nothing else -- `npm root -g`
// costs ~200ms and this rung is already the slow path.
export async function loadChromium({
  importer = (s) => import(s),
  globalRoot = npmGlobalRoot,
  exists = existsSync,
} = {}) {
  try {
    const m = await importer('playwright-core');
    if (m.chromium || m.default?.chromium) return m.chromium ?? m.default.chromium;
  } catch {
    /* fall through to the global root */
  }
  const root = globalRoot();
  if (root) {
    // index.mjs FIRST, and the difference is not cosmetic: playwright-core ships
    // both entries, and under import() the ESM one yields a real `chromium`
    // named export while the CJS one yields only `default.chromium`. Taking
    // `.chromium` off the CJS entry returns undefined, which then fails four
    // layers away as "Cannot read properties of undefined (reading 'launch')" —
    // a message that says nothing about the entry point that caused it.
    for (const file of ['index.mjs', 'index.js']) {
      const p = join(root, 'playwright-core', file);
      if (!exists(p)) continue;
      try {
        const m = await importer(pathToFileURL(p).href);
        const chromium = m.chromium ?? m.default?.chromium;
        if (chromium) return chromium;
      } catch {
        /* try the next entry */
      }
    }
  }
  throw new RenderUnavailable(
    'playwright-core is not installed. Install it to enable the browser-render rung: npm i -g playwright-core'
  );
}

// Returns the fully rendered HTML plus everything classifyRenderOutcome needs to
// judge it. A <base href> is injected against the FINAL url because the caller
// writes this to a temp file for Defuddle, and a file-parsed document resolves
// every relative link against the file path otherwise -- silently turning an
// article's links into dead local paths.
export async function renderPage(url, { launcher, executablePath } = {}) {
  const chromium = launcher ?? (await loadChromium());
  const exe = executablePath ?? findBrowser();
  if (!exe) {
    throw new RenderUnavailable(
      'No Chromium-based browser found. Install Chrome or Edge, or set WIKI_MASTER_BROWSER to a browser executable.'
    );
  }

  const browser = await chromium.launch({
    executablePath: exe,
    headless: false,
    args: OFFSCREEN_ARGS,
  });
  try {
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    // networkidle is a best-effort settle, never a requirement: pages with a
    // live socket or a polling analytics beacon never go idle, and their article
    // text was in the DOM long before the timeout.
    try {
      await page.waitForLoadState('networkidle', { timeout: IDLE_TIMEOUT_MS });
    } catch {
      /* settled enough */
    }

    const finalUrl = page.url();
    const title = await page.title();
    const words = await page.evaluate(() => (document.body?.innerText.match(/\S+/g) || []).length);
    let html = await page.content();
    html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${finalUrl.replace(/"/g, '&quot;')}">`);
    return { html, finalUrl, status: res?.status() ?? 0, title, words };
  } finally {
    await browser.close().catch(() => {});
  }
}
