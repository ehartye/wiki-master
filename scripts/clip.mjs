import { readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { isBlocked } from './lib/blocklist.mjs';
import { isDuplicateUrl } from './lib/url.mjs';
import { loadDeclines, isDeclined, recordDecline } from './lib/decline.mjs';

const THIN_WORD_FLOOR = 100;

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

export { normalizeUrl, isDuplicateUrl } from './lib/url.mjs';

function yaml(v) { return JSON.stringify(String(v)); }

export function buildFrontmatter({ title, source, author, published, created, quality, hash }) {
  const lines = ['---'];
  lines.push(`title: ${yaml(title)}`);
  lines.push(`source: ${yaml(source)}`);
  if (author) lines.push(`author: ${yaml(author)}`);
  if (published) lines.push(`published: ${published}`);
  lines.push(`created: ${created}`);
  lines.push('tags: [clippings]');
  lines.push(`quality: ${quality}`);
  lines.push(`source-hash: ${hash}`);
  lines.push('---');
  return lines.join('\n');
}

function wordCount(md) { return (md.match(/\S+/g) || []).length; }
function today() { return new Date().toISOString().slice(0, 10); }

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
  const cmds = [`defuddle parse ${q} --json`, `npx --yes defuddle parse ${q} --json`];
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
    console.log(`clip failed (likely blocked/paywalled — clip manually): ${url}`);
    return { status: 'failed' };
  }

  const md = data.contentMarkdown || data.content || '';
  if (wordCount(md) < THIN_WORD_FLOOR) {
    // Thin is deterministic (the page IS a SPA/paywall shell) — record it so the
    // next run skips without re-fetching. TTL re-litigates eventually. Transient
    // fetch failures above are deliberately NOT recorded: they may recover.
    recordDecline(vaultPath, url, 'thin content (SPA/paywall shell)');
    console.log(`thin content (clip manually; decline recorded): ${url}`);
    return { status: 'thin' };
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
