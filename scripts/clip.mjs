import { readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { isBlocked } from './lib/blocklist.mjs';

const THIN_WORD_FLOOR = 100;

export function slugify(title) {
  const s = (title || '')
    .replace(/[\\/:*?"<>|#^[\]]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .trim();
  return s.slice(0, 120).replace(/[-\s]+$/, '') || 'untitled';
}

export function normalizeUrl(u) {
  try {
    const x = new URL(u);
    x.hash = '';
    return (x.origin + x.pathname).replace(/\/$/, '');
  } catch {
    return (u || '');
  }
}

export function isDuplicateUrl(url, knownUrls) {
  const n = normalizeUrl(url).toLowerCase();
  return knownUrls.some((k) => normalizeUrl(k).toLowerCase() === n);
}

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

function runDefuddleJson(url) {
  const attempt = (cmd, args) =>
    execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  let out;
  try {
    out = attempt('defuddle', ['parse', url, '--json']);
  } catch {
    out = attempt('npx', ['--yes', 'defuddle', 'parse', url, '--json']);
  }
  return JSON.parse(out);
}

export function main(argv) {
  const url = argv[0];
  if (!url) { console.error('usage: clip.mjs <url> [--quality=high|medium|low]'); process.exit(2); }
  const qArg = argv.find((a) => a.startsWith('--quality='));
  const quality = qArg ? qArg.split('=')[1] : 'medium';

  if (isBlocked(url)) { console.log(`blocked (unreliable domain): ${url}`); return { status: 'blocked' }; }

  const { path: vaultPath } = resolveVault();
  if (isDuplicateUrl(url, knownSourceUrls(vaultPath))) {
    console.log(`duplicate (already clipped): ${url}`); return { status: 'duplicate' };
  }

  let data;
  try { data = runDefuddleJson(url); }
  catch (e) {
    console.error(`defuddle failed for ${url}: ${e.message}\nInstall it: npm i -g defuddle`);
    process.exit(1);
  }

  const md = data.contentMarkdown || data.content || '';
  if (wordCount(md) < THIN_WORD_FLOOR) {
    console.log(`thin content (clip manually): ${url}`); return { status: 'thin' };
  }

  const created = today();
  const hash = createHash('sha256').update(md).digest('hex');
  const fm = buildFrontmatter({
    title: data.title, source: url, author: data.author,
    published: data.published, created, quality, hash,
  });
  const slug = slugify(data.title);
  const file = join(vaultPath, 'raw', 'clippings', `${slug}.md`);
  if (existsSync(file)) { console.log(`exists (slug clash): ${slug}`); return { status: 'duplicate' }; }

  writeFileSync(file, `${fm}\n\n${md}\n`);
  console.log(`clipped: raw/clippings/${slug}.md (quality=${quality})`);
  return { status: 'clipped', slug, file };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
