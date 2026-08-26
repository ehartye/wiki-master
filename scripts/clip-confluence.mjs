import { existsSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { resolveVault } from './lib/vault.mjs';
import { isDuplicateUrl } from './lib/url.mjs';
import { loadDeclines, isDeclined, recordDecline } from './lib/decline.mjs';
import { existingClippingWithHash, readClippingHashes } from './lib/dedupe.mjs';
import { slugify, buildFrontmatter, knownSourceUrls, disambiguateSlug } from './clip.mjs';
import { parseTopicArg } from './lib/topic.mjs';

const THIN_WORD_FLOOR = 100;
const THIN_PLACEHOLDER = /this page has no readable content/i;

function wordCount(md) { return (md.match(/\S+/g) || []).length; }
function today() { return new Date().toISOString().slice(0, 10); }

// Locate an installed confluencer plugin's scripts/ dir. wiki-master and
// confluencer are SEPARATE, independently-installed plugins -- unlike
// clip-pptx's python-pptx (a generic, stateless library wiki-master bundles
// its own glue for, keeping wiki-master portable), confluencer is a whole
// configured, authenticated Atlassian integration (base URL, account email,
// API token, connectivity) that would be wrong to re-implement or vendor here.
// So this reaches across to another plugin ON PURPOSE, and does it by search
// rather than a hardcoded path, because neither plugin knows the other's
// install location at authoring time (no plugin-root env var is set for
// either, per Copilot CLI's plugin model) -- the one thing every Copilot CLI
// plugin install DOES share is landing under ~/.copilot/installed-plugins/.
// An explicit WIKI_MASTER_CONFLUENCER_SCRIPTS always wins (same env-var-first
// idiom as resolveVault in lib/vault.mjs), for a dev checkout or a
// non-standard install; unlike resolveVault, it is not existence-checked here
// either, for the same reason -- resolution and validation stay separate, and
// the caller below is what actually needs the answer.
export function findConfluencerScripts({ env = process.env, home = homedir() } = {}) {
  if (env.WIKI_MASTER_CONFLUENCER_SCRIPTS) return env.WIKI_MASTER_CONFLUENCER_SCRIPTS;
  const root = join(home, '.copilot', 'installed-plugins');
  if (!existsSync(root)) return null;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = join(root, entry.name, 'confluencer', 'scripts');
    if (existsSync(join(candidate, 'page.mjs'))) return candidate;
  }
  return null;
}

// Parse confluencer's page.mjs provenance header (its own README documents
// this shape): a `# Title` line, a "Space: X · Page ID: Y · Version: Z ·
// Updated: <iso>" line, a "URL: <url>" line, a blank line, then "---" before
// the body. Pure/exported so the parser is testable against a captured
// fixture without shelling out to another plugin's script.
export function parseConfluencePage(raw) {
  const lines = String(raw || '').split('\n');
  const title = (lines[0] || '').replace(/^#\s*/, '').trim() || 'untitled';
  const meta = lines[1] || '';
  const space = /Space:\s*([^·]+)/.exec(meta)?.[1]?.trim() || null;
  const pageId = /Page ID:\s*([^·]+)/.exec(meta)?.[1]?.trim() || null;
  const version = /Version:\s*([^·]+)/.exec(meta)?.[1]?.trim() || null;
  const updated = /Updated:\s*(\S+)/.exec(meta)?.[1]?.trim() || null;
  const url = /^URL:\s*(\S+)/m.exec(raw)?.[1]?.trim() || null;
  const sepIndex = lines.findIndex((l) => l.trim() === '---');
  const body = sepIndex >= 0 ? lines.slice(sepIndex + 1).join('\n').trim() : '';
  return { title, space, pageId, version, updated, url, body };
}

// Build the clipping note. Pure: no IO, no confluencer call -- the testable
// core. Mirrors docxClipContent/pdfClipContent: the canonical stored artifact
// is the Markdown confluencer already produced (never a re-fetch, never a
// PDF export -- see the skill doc for why a PDF round-trip was rejected for
// this vault's table-heavy Confluence corpus), so the vault stays greppable,
// diffable, and answerable. No fidelity/extraction fields: like clip-docx's
// pandoc, confluencer hands back clean Markdown with nothing to flag.
export function confluenceClipContent({ title, source, body, quality = 'medium', created = today(), topic } = {}) {
  const md = String(body || '').replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const hash = createHash('sha256').update(md).digest('hex');
  const fm = buildFrontmatter({ title, source, created, quality, hash, topic });
  return { md, wordCount: wordCount(md), hash, body: `${fm}\n\n${md}\n` };
}

// `node` (not `pandoc`/`pdftotext`) is the external process here, and it is
// the same runtime already executing this file -- no PATHEXT/.cmd-shim hazard
// the way a globally-installed CLI tool has, so a plain execFileSync suffices.
function runConfluencerPage(scriptsDir, target, { run = execFileSync } = {}) {
  return run('node', [join(scriptsDir, 'page.mjs'), target, '--markdown'], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
}

export function main(argv) {
  const target = argv[0];
  if (!target) {
    console.error('usage: clip-confluence.mjs <confluence-url-or-page-id> [--quality=high|medium|low]');
    console.error('                                 [--topic="<research topic>"] [--decline="reason"]');
    console.error('       clip-confluence.mjs --doctor   (check whether confluencer is installed)');
    console.error('');
    console.error('  --topic  the research run this clip belongs to. Recorded going forward only:');
    console.error('           without it, /wiki-triage can never group this clipping by run.');
    process.exit(2);
  }

  // --doctor: report whether the (optional, separately-installed) confluencer
  // plugin is reachable, and if so, hand off to ITS OWN doctor for the parts
  // only confluencer knows about (auth, config, connectivity). wiki-master
  // has no business diagnosing another plugin's credentials.
  if (target === '--doctor') {
    const scriptsDir = findConfluencerScripts();
    if (!scriptsDir) {
      console.log('confluencer: NOT FOUND (looked in ~/.copilot/installed-plugins/*/confluencer/scripts/page.mjs');
      console.log('and $WIKI_MASTER_CONFLUENCER_SCRIPTS). clip-confluence.mjs will decline gracefully until');
      console.log('the confluencer plugin is installed.');
      return { status: 'confluencer-missing' };
    }
    console.log(`confluencer: found at ${scriptsDir}`);
    const doctor = join(scriptsDir, 'doctor.mjs');
    if (!existsSync(doctor)) {
      console.log('(no doctor.mjs in that install to hand off to -- skipping the auth/config check)');
      return { status: 'ok', scriptsDir };
    }
    try {
      console.log(execFileSync('node', [doctor], { encoding: 'utf8' }));
    } catch (err) {
      console.log((err.stdout || '') + (err.stderr || err.message || ''));
    }
    return { status: 'ok', scriptsDir };
  }

  const qArg = argv.find((a) => a.startsWith('--quality='));
  const quality = qArg ? qArg.split('=')[1] : 'medium';
  const topic = parseTopicArg(argv);

  const { path: vaultPath } = resolveVault();

  // --decline never fetches -- it only needs an identity to record against,
  // exactly like clip.mjs and clip-docx.mjs, so it works with no dependency
  // on confluencer being installed at all.
  const declineArg = argv.find((a) => a.startsWith('--decline='));
  if (declineArg) {
    const reason = declineArg.slice('--decline='.length) || 'declined';
    recordDecline(vaultPath, target, reason);
    console.log(`declined (recorded): ${target} — ${reason}`);
    return { status: 'declined' };
  }

  const declines = loadDeclines(vaultPath);
  if (isDeclined(target, declines)) {
    const e = declines.find((d) => isDeclined(target, [d]));
    console.log(`declined previously (${e.date}: ${e.reason}): ${target}`);
    return { status: 'declined' };
  }

  if (isDuplicateUrl(target, knownSourceUrls(vaultPath))) {
    console.log(`duplicate (already clipped): ${target}`); return { status: 'duplicate' };
  }

  // The graceful-failure path this skill exists for: confluencer is a
  // separate, OPTIONAL plugin, so its absence is expected on some machines,
  // not an error in wiki-master. Detect it before shelling out, so the
  // failure is one clear line -- never a raw ENOENT, and never a fabricated
  // clipping standing in for content nobody actually fetched.
  const scriptsDir = findConfluencerScripts();
  if (!scriptsDir) {
    console.error(`confluencer plugin not found — cannot clip: ${target}`);
    console.error('Looked in ~/.copilot/installed-plugins/*/confluencer/scripts/page.mjs and');
    console.error('$WIKI_MASTER_CONFLUENCER_SCRIPTS. Install confluencer, or point');
    console.error('WIKI_MASTER_CONFLUENCER_SCRIPTS at its scripts/ directory, then re-run.');
    console.error('Nothing was written; run with --doctor any time to check again.');
    return { status: 'confluencer-missing' };
  }

  let raw;
  try {
    raw = runConfluencerPage(scriptsDir, target);
  } catch (err) {
    // page.mjs itself failed (bad id, auth, network, config) -- surface the
    // real stderr rather than guessing, and point at confluencer's OWN
    // doctor script. Diagnosing another plugin's auth is not wiki-master's
    // job; routing to the right tool is.
    const doctor = join(scriptsDir, 'doctor.mjs');
    const detail = (err.stderr || err.message || '').toString().trim().split('\n').slice(0, 5).join('\n');
    console.error(`confluencer page.mjs failed for: ${target}`);
    if (detail) console.error(detail);
    console.error(existsSync(doctor)
      ? `Run: node "${doctor}" to diagnose (auth/config/connectivity).`
      : "Run the confluence skill's doctor script to diagnose (auth/config/connectivity).");
    return { status: 'failed' };
  }

  const parsed = parseConfluencePage(raw);
  if (!parsed.url) {
    console.error(`could not parse a page URL from confluencer's output for: ${target}`);
    return { status: 'failed' };
  }

  const isThin = wordCount(parsed.body) < THIN_WORD_FLOOR || THIN_PLACEHOLDER.test(parsed.body);
  if (isThin) {
    // A parent/index page with no body prose (just child links) is a common,
    // legitimate shape in Confluence, not a fetch failure -- decline it like
    // any other thin extraction so it is not retried blindly.
    recordDecline(vaultPath, parsed.url, 'thin content (Confluence page has no readable body — likely a parent/index page)');
    console.log(`thin content (decline recorded): ${parsed.url}`);
    return { status: 'thin' };
  }

  const clip = confluenceClipContent({ title: parsed.title, source: parsed.url, body: parsed.body, quality, topic });

  const dir = join(vaultPath, 'raw', 'clippings');

  // Content-hash dedup catches what the URL check above cannot: re-clipping
  // via a bare page ID after the vault already holds this page's URL, or a
  // genuinely unedited page re-fetched a second time.
  //
  // KNOWN LIMITATION, not fixed here: Confluence pages mutate in place at a
  // stable URL (we watched one page's Version climb from 1 to 10 across a
  // single afternoon). isDuplicateUrl is keyed on bare URL, so intentionally
  // re-clipping an UPDATED page reads as "duplicate (already clipped)" and is
  // silently skipped, same as it would for any live web page that changed
  // since its last clip -- this is not new to Confluence, but Confluence
  // pages hit it far more often than the static PDFs/papers this dedup layer
  // was designed around. If re-clipping updated pages becomes a real
  // workflow, the fix is version-aware dedup (key on URL+Version, not URL
  // alone) -- deliberately not built here to keep this change scoped to what
  // was asked.
  const already = existingClippingWithHash(readClippingHashes(dir), clip.hash);
  if (already) {
    console.log(`exists (same content): ${already}`);
    return { status: 'duplicate', file: already };
  }

  const taken = new Set(readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3).toLowerCase()));
  const slug = disambiguateSlug(slugify(parsed.title), clip.hash, (s) => taken.has(s.toLowerCase()));
  const file = join(dir, `${slug}.md`);

  writeFileSync(file, clip.body);
  console.log(`clipped: raw/clippings/${slug}.md (quality=${quality}, confluence, space=${parsed.space || '?'}, v${parsed.version || '?'})`);
  return { status: 'clipped', slug, file, space: parsed.space, pageId: parsed.pageId, version: parsed.version };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
