import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolveVault, obsidian, assertRunning } from './lib/vault.mjs';
import { embed as ollamaEmbed, isAvailable, cosine } from './lib/embed.mjs';

const DEFAULT_THRESHOLD = 0.5;

function centroid(vecs) {
  const n = vecs.length;
  const out = new Array(vecs[0].length).fill(0);
  for (const v of vecs) for (let i = 0; i < v.length; i++) out[i] += v[i] / n;
  return out;
}

export async function computeDrift(pages, { embedFn, threshold = DEFAULT_THRESHOLD } = {}) {
  const drifted = [], evaluated = [];
  for (const page of pages) {
    if (!page.sources || page.sources.length === 0) continue;
    const pageVec = await embedFn(page.body);
    const srcVecs = [];
    for (const s of page.sources) srcVecs.push(await embedFn(s.content));
    const sim = cosine(pageVec, centroid(srcVecs));
    evaluated.push({ path: page.path, sim });
    if (sim < threshold) drifted.push({ path: page.path, sim });
  }
  return { drifted, evaluated, skipped: false };
}

// Hash-keyed embedding cache so unchanged text is not re-embedded.
function loadCache(dir) {
  const f = join(dir, 'embeddings.json');
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
}
function saveCache(dir, cache) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'embeddings.json'), JSON.stringify(cache));
}
function hash(text) { return createHash('sha256').update(text).digest('hex'); }

export async function main() {
  if (!(await isAvailable())) {
    console.log('drift skipped (embedder unavailable)');
    return { drifted: [], evaluated: [], skipped: true };
  }
  assertRunning();
  const { path: vaultPath } = resolveVault();
  const cacheDir = join(vaultPath, '.wiki-master');
  const cache = loadCache(cacheDir);
  const cachedEmbed = async (text) => {
    const k = hash(text);
    if (cache[k]) return cache[k];
    const v = await ollamaEmbed(text);
    cache[k] = v;
    return v;
  };
  // Gather synthesis/concept pages and their linked raw sources.
  const files = obsidian(['files', 'ext=md']).split(/\r?\n/).filter(Boolean);
  const pages = [];
  for (const rel of files) {
    if (!/^wiki\/(concepts|syntheses)\//.test(rel)) continue;
    const full = join(vaultPath, rel);
    const body = readFileSync(full, 'utf8');
    const sourceRels = [...body.matchAll(/sources:\s*\[(.*?)\]/gs)]
      .flatMap((m) => [...m[1].matchAll(/\[\[([^\]]+)\]\]/g)].map((x) => x[1]));
    const sources = [];
    for (const srcName of sourceRels) {
      try {
        const p = obsidian(['file', `file=${srcName}`, 'path']).trim();
        sources.push({ path: p, content: readFileSync(join(vaultPath, p), 'utf8') });
      } catch { /* unresolved source link; skip */ }
    }
    pages.push({ path: rel, body, sources });
  }
  const r = await computeDrift(pages, { embedFn: cachedEmbed });
  saveCache(cacheDir, cache);
  if (r.drifted.length === 0) console.log('drift: no pages diverged from their sources');
  for (const d of r.drifted) console.log(`  drift ${d.sim.toFixed(2)}  ${d.path}`);
  return r;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
