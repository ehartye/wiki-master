// Preserving the FIGURES of a PDF.
//
// clip-pdf stores a PDF's text layer as Markdown and throws the rest away. For a
// paper whose evidence is a graph, that is the evidence. This module renders
// whole pages to PNG so the figure survives next to the clipping, in the vault's
// existing `raw/figures/<slug>.png` + `<slug>.md` convention.
//
// It renders PAGES, it does not crop: a page is the unit poppler can hand back
// without understanding the layout, and a faithful full page beats a confident
// wrong crop. Sidecars record `crop: full` so a later hand-cropped figure is
// distinguishable from a machine render.
//
// Which pages carry a figure is a heuristic, deliberately simple and
// deterministic (see selectVectorPages), because a PDF graph is usually VECTOR
// drawing, not an embedded image: `pdfimages` alone sees none of it.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export const FIGURE_DPI = 200;
export const DEFAULT_FIGURES_MAX = 40;

// ---- heuristic thresholds (documented in skills/clip-pdf/SKILL.md) -----------
// A raster counts when it is at least this big in pixels AND, where pdfimages
// reports resolution, at least this big on the page. Below that it is an icon,
// a bullet, a rule or a logo.
export const MIN_RASTER_PX = 100;
export const MIN_RASTER_INCHES = 0.75;
// An image object that sits on at least this share of pages (and 3+ pages) is
// running chrome - a logo in the header - not a figure.
export const CHROME_PAGE_SHARE = 0.5;
// Vector drawing operations outside glyph definitions. Ordinary prose pages sit
// at 0-10 (a header rule, a table border); a box-and-arrow diagram is 30+, a plotted graph hundreds.
export const VECTOR_MIN_PATHS = 30;
// A page with this many drawing paths is a figure however much text it also has.
export const VECTOR_DENSE_PATHS = 600;
// "Low text" = fewer non-space characters than this share of the document median.
export const LOW_TEXT_RATIO = 0.8;

// ---- argument parsing --------------------------------------------------------

export function parsePageList(spec) {
  const s = String(spec).trim();
  if (!/^\d+(-\d+)?(,\d+(-\d+)?)*$/.test(s)) {
    throw new Error(`invalid page list "${spec}" - use auto, all, or pages like 3,5-7`);
  }
  const pages = new Set();
  for (const part of s.split(',')) {
    const [a, b] = part.split('-').map(Number);
    const hi = b ?? a;
    if (a < 1 || hi < a) throw new Error(`invalid page range "${part}" in "${spec}"`);
    if (hi - a > 5000) throw new Error(`page range "${part}" is implausibly large`);
    for (let p = a; p <= hi; p++) pages.add(p);
  }
  return [...pages].sort((x, y) => x - y);
}

// Returns { enabled, mode: 'auto'|'all'|'list', pages, max, only, clipping, allowMismatch }.
// Throws on a malformed value: silently ignoring `--figures=3,x` and rendering
// the wrong pages is worse than refusing.
export function parseFigureArgs(argv) {
  const out = { enabled: false, mode: 'auto', pages: null, max: DEFAULT_FIGURES_MAX, only: false, clipping: null, allowMismatch: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--figures') out.enabled = true;
    else if (a.startsWith('--figures=')) {
      out.enabled = true;
      const v = a.slice('--figures='.length).trim();
      if (v === '' || v === 'auto') out.mode = 'auto';
      else if (v === 'all') out.mode = 'all';
      else { out.mode = 'list'; out.pages = parsePageList(v); }
    } else if (a.startsWith('--figures-max=')) {
      const n = Number(a.slice('--figures-max='.length));
      if (!Number.isInteger(n) || n < 1) throw new Error(`--figures-max needs a positive integer, got "${a.slice(14)}"`);
      out.max = n;
    } else if (a === '--figures-only') { out.only = true; out.enabled = true; }
    else if (a.startsWith('--clipping=')) out.clipping = a.slice('--clipping='.length);
    else if (a === '--clipping') {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('--clipping needs a path');
      out.clipping = argv[++i];
    } else if (a === '--allow-pdf-mismatch') out.allowMismatch = true;
  }
  if (out.only && !out.clipping) throw new Error('--figures-only needs --clipping <path-to-existing-clipping>');
  if (out.clipping && !out.only) throw new Error('--clipping only applies with --figures-only');
  return out;
}

// ---- pure detection ----------------------------------------------------------

// `pdfimages -list` rows. Poppler: page num type width height color comp bpc enc
// interp objectID(2 tokens) x-ppi y-ppi size ratio. Xpdf omits the ppi columns,
// so they are optional and parsed defensively.
export function parsePdfimagesList(text) {
  const rows = [];
  for (const line of String(text).split(/\r?\n/)) {
    const t = line.trim().split(/\s+/);
    if (t.length < 10 || !/^\d+$/.test(t[0]) || !/^\d+$/.test(t[1])) continue;
    const num = (v) => (/^\d+(\.\d+)?$/.test(v ?? '') ? Number(v) : null);
    rows.push({
      page: Number(t[0]), type: t[2], width: Number(t[3]), height: Number(t[4]),
      object: t[10] !== undefined ? `${t[10]}:${t[11] ?? 0}` : null,
      xppi: t.length >= 16 ? num(t[12]) : null, yppi: t.length >= 16 ? num(t[13]) : null,
    });
  }
  return rows;
}

// Pages carrying a real embedded raster: type `image` (not smask/mask/stencil),
// not tiny, and not a header logo repeated down the document.
export function selectRasterPages(rows, pageCount) {
  const real = rows.filter((r) => {
    if (r.type !== 'image') return false;
    if (r.width < MIN_RASTER_PX || r.height < MIN_RASTER_PX) return false;
    if (r.xppi > 0 && r.yppi > 0 && (r.width / r.xppi < MIN_RASTER_INCHES || r.height / r.yppi < MIN_RASTER_INCHES)) return false;
    return true;
  });
  const pagesByObject = new Map();
  for (const r of real) {
    if (!r.object) continue;
    if (!pagesByObject.has(r.object)) pagesByObject.set(r.object, new Set());
    pagesByObject.get(r.object).add(r.page);
  }
  const chrome = new Set();
  for (const [obj, pages] of pagesByObject) {
    if (pages.size >= 3 && pages.size >= pageCount * CHROME_PAGE_SHARE) chrome.add(obj);
  }
  return [...new Set(real.filter((r) => !chrome.has(r.object)).map((r) => r.page))].sort((a, b) => a - b);
}

// Drawing elements on a page from `pdftocairo -svg`, EXCLUDING glyph and clip
// definitions: text rendered from a font is `<use>` references to <defs>, so it
// adds nothing here, while a plotted curve or axis is a real <path> in the body.
export function countSvgDrawing(svg) {
  const body = String(svg)
    .replace(/<defs\b[\s\S]*?<\/defs>/g, '')
    .replace(/<clipPath\b[\s\S]*?<\/clipPath>/g, '')
    .replace(/<mask\b[\s\S]*?<\/mask>/g, '')
    .replace(/<pattern\b[\s\S]*?<\/pattern>/g, '');
  return (body.match(/<(?:path|rect|line|polyline|polygon|circle|ellipse)\b/g) || []).length;
}

export function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// stats: [{ page, chars, paths }]. A page is vector-figure material when it has
// real drawing (>= VECTOR_MIN_PATHS) AND is text-light relative to its own
// document (no text layer at all, or under LOW_TEXT_RATIO of the median) - or is
// so densely drawn (>= VECTOR_DENSE_PATHS) that text beside it cannot explain it.
//
// A document whose text was converted to outlines (no text layer anywhere) has a
// median of 0: every drawn page is then selected, which is right - none of that
// page's content survives text extraction.
// Known false positive: a page that is mostly a large ruled table.
export function selectVectorPages(stats) {
  const med = median(stats.map((s) => s.chars));
  return stats
    .filter((s) => s.paths >= VECTOR_MIN_PATHS && (s.chars === 0 || s.chars < LOW_TEXT_RATIO * med || s.paths >= VECTOR_DENSE_PATHS))
    .map((s) => s.page)
    .sort((a, b) => a - b);
}

// Combine into the final ordered selection. `raster` and `vector` are page arrays.
// Returns { pages: [{ page, kinds: [...] }], total, capped }.
export function planFigurePages({ mode, pageCount, requested = null, raster = [], vector = [], max = DEFAULT_FIGURES_MAX }) {
  let chosen;
  if (mode === 'all') chosen = Array.from({ length: pageCount }, (_, i) => i + 1);
  else if (mode === 'list') {
    const bad = requested.filter((p) => p > pageCount);
    if (bad.length) throw new Error(`page ${bad.join(', ')} is beyond the document's ${pageCount} pages`);
    chosen = requested;
  } else chosen = [...new Set([...raster, ...vector])].sort((a, b) => a - b);
  const rs = new Set(raster), vs = new Set(vector);
  const all = chosen.map((page) => ({ page, kinds: [rs.has(page) && 'raster', vs.has(page) && 'vector'].filter(Boolean) }));
  const pages = all.slice(0, max);
  return { pages, total: all.length, capped: all.length > pages.length };
}

export function describeFigurePage({ page, title, kinds }) {
  const found = kinds.length ? kinds.join(' + ') : 'none detected (page selected by request, vector drawing not assessed)';
  return `Page ${page} of ${title}: rendered at ${FIGURE_DPI} dpi; figure candidates detected: ${found}.`;
}

const q = (v) => JSON.stringify(String(v));

export function figureSidecar({ title, source, page, sha256, captured, clippingPath, kinds }) {
  return [
    '---',
    `source: ${q(source)}`,
    `page: ${page}`,
    'crop: full',
    `dpi: ${FIGURE_DPI}`,
    `sha256: ${sha256}`,
    `captured: ${captured}`,
    `clipping: ${q(`[[${clippingPath}]]`)}`,
    'ai-generated: false',
    '---',
    `# ${title}, page ${page}`,
    '',
    describeFigurePage({ page, title, kinds }),
    '',
  ].join('\n');
}

// ---- clipping frontmatter ----------------------------------------------------

export function frontmatterOf(text) {
  const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : '';
}

export function fmScalar(fm, key) {
  const m = fm.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'));
  if (!m) return undefined;
  const v = m[1].trim();
  if (v.startsWith('"')) { try { return JSON.parse(v); } catch { return v.slice(1, -1); } }
  return v.replace(/^'(.*)'$/, '$1');
}

function existingFigureList(fm) {
  const flow = fm.match(/^figures:[ \t]*\[(.*)\][ \t]*$/m);
  if (flow) return [...flow[1].matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|([^,\s][^,]*)/g)].map((m) => (m[1] !== undefined ? JSON.parse(`"${m[1]}"`) : (m[2] ?? m[3]).trim())).filter(Boolean);
  const block = fm.match(/^figures:[ \t]*\r?\n((?:[ \t]+-[ \t]*.+\r?\n?)+)/m);
  if (block) return [...block[1].matchAll(/-[ \t]*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S.*?))[ \t]*$/gm)].map((m) => (m[1] !== undefined ? JSON.parse(`"${m[1]}"`) : (m[2] ?? m[3]))).filter(Boolean);
  return [];
}

const pageOf = (p) => Number(p.match(/-p(\d+)\.md$/)?.[1] ?? Infinity);

// Add `figures:` to a clipping's FRONTMATTER ONLY. The body is returned
// byte-for-byte: raw/ is immutable and `source-hash` is a hash of the body. The
// key is appended after the existing keys (never ahead of `source-hash`, which
// readers find within the first 800 bytes). Existing entries are kept and merged.
// Returns the new text, or the same string when nothing changes.
export function setClippingFigures(text, figurePaths) {
  const m = String(text).match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!m) throw new Error('clipping has no frontmatter');
  const nl = m[1].endsWith('\r\n') ? '\r\n' : '\n';
  const fm = m[2];
  const merged = [...new Set([...existingFigureList(fm), ...figurePaths])].sort((a, b) => pageOf(a) - pageOf(b) || (a < b ? -1 : a > b ? 1 : 0));
  const line = `figures: [${merged.map(q).join(', ')}]`;
  const flowRe = /^figures:[ \t]*\[.*\][ \t]*$/m;
  const blockRe = /^figures:[ \t]*\r?\n(?:[ \t]+-[ \t]*.+(?:\r?\n|$))+/m;
  let nextFm;
  if (flowRe.test(fm)) nextFm = fm.replace(flowRe, line);
  else if (blockRe.test(fm)) nextFm = fm.replace(blockRe, line + nl).replace(/(\r?\n)+$/, '');
  else nextFm = `${fm}${nl}${line}`;
  if (nextFm === fm) return text;
  return m[1] + nextFm + m[3] + text.slice(m[0].length);
}

// ---- external tools ----------------------------------------------------------

// poppler for Windows via winget lives outside PATH until a new shell starts.
export function wingetPopplerBins(env = process.env, { list = readdirSync, exists = existsSync } = {}) {
  const base = env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages');
  if (!base || !exists(base)) return [];
  const out = [];
  try {
    for (const pkg of list(base).filter((d) => /^oschwartz10612\.Poppler/i.test(d)).sort()) {
      const root = join(base, pkg);
      for (const sub of list(root).filter((d) => /^poppler-/i.test(d)).sort().reverse()) {
        for (const rel of [['Library', 'bin'], ['bin']]) {
          const dir = join(root, sub, ...rel);
          if (exists(dir)) out.push(dir);
        }
      }
    }
  } catch { /* unreadable package dir: treat as absent */ }
  return out;
}

// Same probe style the rest of clip-pdf uses (bare name via execFileSync, a
// nonzero exit still means installed), then the winget location. Returns the
// command to execute, or null.
export function resolveTool(name, { run = execFileSync, env = process.env, bins = wingetPopplerBins(env), exists = existsSync } = {}) {
  const works = (cmd) => {
    try { run(cmd, ['-v'], { stdio: 'ignore' }); return true; } catch (e) { return e.code !== 'ENOENT'; }
  };
  if (works(name)) return name;
  for (const dir of bins) {
    for (const f of [`${name}.exe`, name]) {
      const full = join(dir, f);
      if (exists(full) && works(full)) return full;
    }
  }
  return null;
}

// Probing spawns a process per tool (~0.2s each on Windows), so the default
// probe is made once per process. Passing options bypasses the cache.
let defaultTools;
export function resolveFigureTools(opts) {
  if (!opts && defaultTools) return defaultTools;
  const found = Object.fromEntries(['pdftoppm', 'pdfimages', 'pdftocairo', 'pdfinfo', 'pdftotext'].map((n) => [n, resolveTool(n, opts)]));
  if (!opts) defaultTools = found;
  return found;
}

export const POPPLER_HINT = 'Install poppler: winget install oschwartz10612.Poppler (Windows), brew install poppler (macOS), apt install poppler-utils (Linux).';

const sh = (run, cmd, args, o = {}) => run(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, ...o });

export function pdfPageCount(pdf, tools, run = execFileSync) {
  if (tools.pdfinfo) {
    const m = sh(run, tools.pdfinfo, [pdf]).match(/^Pages:\s+(\d+)/m);
    if (m) return Number(m[1]);
  }
  if (tools.pdftotext) return sh(run, tools.pdftotext, ['-q', '-enc', 'UTF-8', pdf, '-']).split('\f').length - 1;
  return 0;
}

// Non-space characters per page, from the text layer.
export function pageCharCounts(pdf, tools, run = execFileSync) {
  const pages = sh(run, tools.pdftotext, ['-q', '-enc', 'UTF-8', pdf, '-']).split('\f');
  if (pages.length && !pages[pages.length - 1].trim()) pages.pop();
  return pages.map((t) => (t.match(/\S/g) || []).length);
}

// Detect figure pages. Degrades per missing tool and says so in `notes`.
export function detectFigurePages(pdf, pageCount, tools, run = execFileSync) {
  const notes = [];
  let raster = [];
  if (tools.pdfimages) {
    try { raster = selectRasterPages(parsePdfimagesList(sh(run, tools.pdfimages, ['-list', pdf])), pageCount); }
    catch (e) { notes.push(`pdfimages failed (${String(e.message).split('\n')[0]}); embedded rasters not assessed`); }
  } else notes.push(`pdfimages not found; embedded rasters not assessed. ${POPPLER_HINT}`);

  let vector = [];
  if (tools.pdftocairo && tools.pdftotext) {
    try {
      const chars = pageCharCounts(pdf, tools, run);
      const rs = new Set(raster);
      const stats = [];
      // Raster pages are already selected, so the (slower) SVG probe skips them.
      for (let p = 1; p <= pageCount; p++) {
        let paths = 0;
        if (!rs.has(p)) {
          try { paths = countSvgDrawing(sh(run, tools.pdftocairo, ['-svg', '-f', String(p), '-l', String(p), pdf, '-'], { timeout: 120000 })); }
          catch { paths = 0; }
        }
        stats.push({ page: p, chars: chars[p - 1] ?? 0, paths });
      }
      vector = selectVectorPages(stats).filter((p) => !rs.has(p));
    } catch (e) { notes.push(`vector probe failed (${String(e.message).split('\n')[0]}); vector drawings not assessed`); }
  } else notes.push(`pdftocairo/pdftotext not found; vector drawings not assessed. ${POPPLER_HINT}`);
  return { raster, vector, notes };
}

// ---- existing figures --------------------------------------------------------

// sha256 -> sidecar path, over every sidecar already in raw/figures (hand-made
// ones included), so a page identical to a known figure is not stored twice.
export function readFigureIndex(figuresDir) {
  const byHash = new Map();
  if (!existsSync(figuresDir)) return byHash;
  for (const f of readdirSync(figuresDir).filter((x) => x.endsWith('.md'))) {
    const fm = frontmatterOf(readFileSync(join(figuresDir, f), 'utf8'));
    const h = fmScalar(fm, 'sha256')?.toLowerCase();
    if (h) byHash.set(h, `raw/figures/${f}`);
  }
  return byHash;
}

const sha256File = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const today = () => new Date().toISOString().slice(0, 10);

// Render the chosen pages into <vault>/raw/figures and return the sidecar paths
// that belong to this clipping. Never throws for a missing tool: returns
// { status: 'skipped', message }.
export function renderFigures({ pdfPath, vaultPath, clippingPath, title, source, selection, tools = resolveFigureTools(), run = execFileSync, log = console.log, captured = today() }) {
  if (!tools.pdftoppm) {
    return { status: 'skipped', message: `figures skipped: pdftoppm not found. ${POPPLER_HINT}`, figures: [] };
  }
  let pageCount;
  try { pageCount = pdfPageCount(pdfPath, tools, run); } catch { pageCount = 0; }
  if (!pageCount) return { status: 'skipped', message: 'figures skipped: could not read the PDF page count (is the PDF intact? pdfinfo/pdftotext missing?)', figures: [] };

  let raster = [], vector = [], notes = [];
  if (selection.mode === 'auto') ({ raster, vector, notes } = detectFigurePages(pdfPath, pageCount, tools, run));
  else if (tools.pdfimages) {
    try { raster = selectRasterPages(parsePdfimagesList(sh(run, tools.pdfimages, ['-list', pdfPath])), pageCount); } catch { /* informational only */ }
  }
  const plan = planFigurePages({ mode: selection.mode, pageCount, requested: selection.pages, raster, vector, max: selection.max });
  for (const n of notes) log(`figures: ${n}`);
  if (!plan.pages.length) {
    log('figures: no figure pages detected (use --figures=all or a page list to render pages anyway)');
    return { status: 'none', pageCount, plan, figures: [], notes };
  }
  if (plan.capped) log(`figures: ${plan.total} pages selected, rendering the first ${plan.pages.length} (cap). Override with --figures-max=N.`);

  const dir = join(vaultPath, 'raw', 'figures');
  mkdirSync(dir, { recursive: true });
  const slug = clippingPath.replace(/^.*\//, '').replace(/\.md$/, '');
  const index = readFigureIndex(dir);
  const tmp = mkdtempSync(join(tmpdir(), 'clip-figures-'));
  const result = { written: [], unchanged: [], duplicates: [], kept: [], failed: [] };
  const figures = [];
  try {
    for (const { page, kinds } of plan.pages) {
      const name = `${slug}-p${page}`;
      const rel = `raw/figures/${name}.md`;
      const pngOut = join(dir, `${name}.png`), mdOut = join(dir, `${name}.md`);
      try {
        run(tools.pdftoppm, ['-r', String(FIGURE_DPI), '-png', '-f', String(page), '-l', String(page), '-singlefile', pdfPath, join(tmp, name)], { stdio: 'ignore', windowsHide: true });
      } catch (e) { result.failed.push({ page, error: String(e.message).split('\n')[0] }); continue; }
      const tmpPng = join(tmp, `${name}.png`);
      if (!existsSync(tmpPng)) { result.failed.push({ page, error: 'pdftoppm wrote no image' }); continue; }
      const sha = sha256File(tmpPng);

      if (existsSync(mdOut)) {
        const fm = frontmatterOf(readFileSync(mdOut, 'utf8'));
        if (fmScalar(fm, 'crop') && fmScalar(fm, 'crop') !== 'full') { result.kept.push(rel); figures.push(rel); continue; } // someone cropped this by hand
        if (fmScalar(fm, 'sha256')?.toLowerCase() === sha && existsSync(pngOut) && sha256File(pngOut) === sha) { result.unchanged.push(rel); figures.push(rel); continue; }
      } else {
        const dup = index.get(sha);
        if (dup) { result.duplicates.push({ page, of: dup }); continue; }
      }
      copyFileSync(tmpPng, pngOut);
      writeFileSync(mdOut, figureSidecar({ title, source, page, sha256: sha, captured, clippingPath, kinds }));
      index.set(sha, rel);
      result.written.push(rel);
      figures.push(rel);
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }

  return { status: 'ok', pageCount, plan, figures, ...result, notes };
}

export function figureSummary(r) {
  if (r.status !== 'ok') return r.message || 'figures: none';
  const parts = [`${r.written.length} written`];
  if (r.unchanged.length) parts.push(`${r.unchanged.length} unchanged`);
  if (r.kept.length) parts.push(`${r.kept.length} hand-cropped kept`);
  if (r.duplicates.length) parts.push(`${r.duplicates.length} skipped as duplicate image (${r.duplicates.map((d) => `p${d.page}=${d.of}`).join(', ')})`);
  if (r.failed.length) parts.push(`${r.failed.length} failed (${r.failed.map((f) => `p${f.page}: ${f.error}`).join('; ')})`);
  return `figures: pages ${r.plan.pages.map((p) => p.page).join(',')} -> ${parts.join(', ')}`;
}
