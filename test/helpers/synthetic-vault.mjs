import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { markdownPage } from '../../scripts/lib/graph.mjs';

// A seeded synthetic vault for tests that need many pages with realistic names: stems shared across folders,
// stems that differ only in letter case, titles and aliases that collide with stems, with each other and with
// full page paths, a `Name.md.md` file and a generated MOC. The same options always give the same files.
//
//   syntheticVault({ pages: 600, labels: 250, seed: 1 })    -> Map of relative path to Markdown text
//   syntheticVault({ pages: 4000, labels: 2000, folders: ['wiki/concepts', 'wiki/sources'] })
//   syntheticPages(options)                                -> the markdownPage records, in walk-like path order
//   writeSyntheticVault(dir, files)                         -> writes the Map under dir
//
// `labels` is the number of distinct title and alias values handed out (each label is used at least once).

const DEFAULT_FOLDERS = ['raw/clippings', 'wiki/sources', 'wiki/concepts', 'wiki/entities', 'wiki/authored/alpha', 'wiki/authored/beta', 'moc', 'log', '_templates'];

function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function syntheticVault({ pages = 600, labels = 250, seed = 1, folders = DEFAULT_FOLDERS } = {}) {
  const rand = prng(seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  // About a third as many stems as pages, so most stems are shared by several pages in different folders (and
  // enough of them that every page can have its own path).
  const stems = Array.from({ length: Math.max(4, Math.ceil(pages / 3), Math.ceil((2 * pages) / folders.length)) }, (_, i) => `Topic ${i}`);
  const paths = [];
  const taken = new Set(); // lower-cased: a case-insensitive file system holds one of "Topic 1.md" and "topic 1.md"
  const put = (path) => { if (!taken.has(path.toLowerCase())) { taken.add(path.toLowerCase()); paths.push(path); } };
  if (folders.includes('raw/clippings')) { put('raw/clippings/Build.md'); put('raw/clippings/build.md.md'); }
  if (folders.includes('moc')) put('moc/topic 1.md');
  while (paths.length < pages) {
    const stem = pick(stems);
    const spelled = rand() < 0.2 ? stem.toLowerCase() : rand() < 0.1 ? stem.toUpperCase() : stem;
    put(`${pick(folders)}/${spelled}.md`);
  }
  // Labels: plain words, stems of real pages (title and alias collisions with names), and full page paths with
  // and without the extension (the "canonical path wins" rule). They are distinct ignoring letter case.
  const labelValues = [];
  for (let i = 0; labelValues.length < labels; i++) {
    const kind = i % 5;
    const value = kind === 0 ? pick(stems)
      : kind === 1 ? pick(paths).replace(/\.md$/, '')
      : kind === 2 ? pick(paths)
      : `Label ${i}`;
    if (!labelValues.some((v) => v.toLowerCase() === value.toLowerCase())) labelValues.push(value);
  }
  // A reused label is sometimes spelled in another letter case, which names the same identity.
  const reuse = () => { const v = pick(labelValues); return rand() < 0.3 ? v.toUpperCase() : v; };
  const unused = [...labelValues];
  const meta = paths.map((path) => {
    let title = unused.length && rand() < 0.5 ? unused.pop() : rand() < 0.3 ? reuse() : null;
    if (!title && rand() < 0.2) title = path.split('/').pop().replace(/\.md$/, ''); // a title repeating its basename
    const aliases = [];
    for (let n = Math.floor(rand() * 3); n > 0; n--) aliases.push(unused.length ? unused.pop() : reuse());
    return { title, aliases };
  });
  // Any label left over goes on the last pages, so every label is used.
  for (let i = paths.length - 1; unused.length; i = (i - 1 + paths.length) % paths.length) meta[i].aliases.push(unused.pop());
  const files = new Map();
  paths.forEach((path, i) => {
    const { title, aliases } = meta[i];
    const lines = ['---'];
    if (title) lines.push(`title: "${title}"`);
    if (aliases.length) lines.push('aliases:', ...aliases.map((a) => `  - "${a}"`));
    if (path.startsWith('moc/')) lines.push('type: moc');
    lines.push('---', `# Page ${i}`, '', `Body of page ${i} links [[${pick(stems)}]].`, '');
    files.set(path, lines.join('\n'));
  });
  return files;
}

// The records buildGraph would produce for these files, in the sorted path order a directory walk gives.
export function syntheticPages(options) {
  const files = syntheticVault(options);
  return [...files.keys()].sort().map((path) => markdownPage(path, files.get(path)));
}

export function writeSyntheticVault(dir, files) {
  for (const [path, text] of files) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
}
