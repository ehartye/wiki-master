import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { isContent } from './lib/graph.mjs';
import { scanIntegrity } from './lib/integrity.mjs';
import { parseNote } from './lib/note.mjs';
import { DEPENDS_ON_KEY, dependsOnEntries, analyzeBacklog } from './lib/backlog-deps.mjs';
import { readBacklogItems } from './lib/backlog-read.mjs';
import {
  AUTHORED_ROOT, BACKLOG_STATUSES, DECISION_STATUSES, KINDS, KIND_STATUS_KEY, PROJECT_KEYS, REQUIRED_KEYS,
  placement, projectProblem,
} from './lib/authored-contract.mjs';

// Read-only check of exactly the pages one authoring task wrote. The ledger is the
// JSON array of vault-relative paths that op-commit and refresh-catalogs take.
// Nothing is written: no cache, no .wiki-master directory, no temp file.
//
//   node validate-authored.mjs --paths-file <ledger.json> [--json]
//
// Exit 0 clean, 1 defects, 2 bad input. The integrity scan still reads the whole
// vault because ambiguity is vault-wide; only the report is scoped to the ledger.

export class InputError extends Error {}

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// The same shape op-commit enforces for an explicit operation scope.
export function checkLedger(paths) {
  if (!Array.isArray(paths) || !paths.length) throw new InputError('the ledger must be a non-empty JSON array of vault-relative paths');
  for (const p of paths) {
    if (typeof p !== 'string' || !p || p.includes('\\') || p.includes('\0') || /^[A-Za-z]:/.test(p) ||
        p.split('/').some(part => !part || part === '.' || part === '..')) {
      throw new InputError(`invalid ledger path ${JSON.stringify(p)}: use vault-relative paths with / separators and no empty, "." or ".." segment, drive prefix or NUL`);
    }
  }
  return [...new Set(paths)];
}

// Does the file exist under exactly this spelling? A case-insensitive file system
// would open a wrongly cased path, but the integrity scan keys pages by their real
// spelling, so every link check on that page would silently vanish.
function existsExactly(vaultPath, path, listings) {
  let dir = vaultPath;
  for (const part of path.split('/')) {
    let names = listings.get(dir);
    if (!names) {
      try { names = new Set(readdirSync(dir)); } catch { return false; }
      listings.set(dir, names);
    }
    if (!names.has(part)) return false;
    dir = join(dir, part);
  }
  try { return statSync(dir).isFile(); } catch { return false; }
}

const withoutBom = text => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

// File line (1-based) of each frontmatter key; parseNote reads values but not lines.
function keyLines(markdown) {
  const lines = new Map();
  const block = withoutBom(markdown).match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!block) return lines;
  block[1].split(/\r?\n/).forEach((text, i) => { const key = text.match(/^([\w-]+):/)?.[1]; if (key) lines.set(key, i + 2); });
  return lines;
}

const isFilled = (key, value) => (key === 'sources' && Array.isArray(value)) || (Array.isArray(value) ? value.length > 0 : typeof value === 'string' && value.trim() !== '');
const show = value => (typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value ?? ''));

function frontmatterDefects(path, markdown) {
  const place = placement(path);
  if (!place) return [];
  const { metadata } = parseNote(markdown);
  const lines = keyLines(markdown);
  const out = [];
  const add = (key, rule, message) => out.push({ path, line: lines.get(key) ?? 1, rule, message });
  const value = key => metadata[key];

  const required = [...REQUIRED_KEYS];
  if (place.project) required.push(...PROJECT_KEYS);
  const kind = isFilled('kind', value('kind')) ? value('kind') : null;
  if (kind && Object.hasOwn(KIND_STATUS_KEY, kind)) required.push(KIND_STATUS_KEY[kind]);
  for (const key of required) {
    if (isFilled(key, value(key))) continue;
    const state = lines.has(key) ? 'empty' : 'missing';
    add(key, 'missing-key', `key "${key}" is ${state}${key === 'sources' ? '; write "sources: []" when the page rests on no external source' : ''}`);
  }

  const oneOf = (key, allowed) => {
    if (isFilled(key, value(key)) && !allowed.includes(value(key))) add(key, 'bad-value', `${key} ${show(value(key))} is not one of ${allowed.join(', ')}`);
  };
  oneOf('type', ['authored']);
  oneOf('kind', KINDS);
  oneOf('ai-generated', ['true', 'false']);
  oneOf('decision-status', DECISION_STATUSES);
  oneOf('backlog-status', BACKLOG_STATUSES);

  if (kind && place.expectedKind && kind !== place.expectedKind) {
    const where = place.folder ? `pages in ${place.folder}/ are` : `${path.split('/').pop()} is`;
    add('kind', 'kind-folder-mismatch', `kind ${show(kind)} but ${where} kind "${place.expectedKind}"`);
  }
  if (isFilled('project', value('project'))) {
    const problem = projectProblem(value('project'), place);
    if (problem) add('project', 'project-folder-mismatch', problem);
  }
  return out;
}

// A backlog item's prerequisites are resolved among the items of its own project only, so reading
// that one backlog folder (readBacklogItems) is enough: no second whole-vault graph is built.
const slug = path => path.slice(path.lastIndexOf('/') + 1).replace(/.md$/, '');
const DEPENDENCY_PROBLEMS = {
  dangling: ['dependency-dangling', target => `[[${target}]] matches no backlog item in this project`],
  'cross-project': ['dependency-cross-project', target => `[[${target}]] is in another project; a dependency must be an item of the same project`],
  self: ['dependency-self', () => 'an item cannot depend on itself'],
};

function dependencyDefects(vaultPath, texts) {
  const out = [];
  const analyses = new Map();
  const analysisFor = (path, metadata) => {
    const place = placement(path);
    const dir = place?.project ? `${AUTHORED_ROOT}${place.project}/backlog` : null;
    if (!analyses.has(dir)) {
      const items = dir ? readBacklogItems(vaultPath, dir) : [];
      analyses.set(dir, { items, analysis: null });
    }
    const entry = analyses.get(dir);
    if (!entry.items.some(it => it.path === path)) entry.items.push({ path, backlogStatus: metadata['backlog-status'], metadata });
    entry.analysis ??= analyzeBacklog(entry.items);
    return entry.analysis;
  };
  for (const [path, markdown] of texts) {
    const { metadata } = parseNote(markdown);
    if (!Object.hasOwn(metadata, DEPENDS_ON_KEY)) continue;
    const { entries, malformed } = dependsOnEntries(metadata);
    if (!entries.length && !malformed.length) continue;
    const line = keyLines(markdown).get(DEPENDS_ON_KEY) ?? 1;
    const add = (rule, message) => out.push({ path, line, rule, message });
    if (metadata.kind !== 'backlog-item') {
      add('dependency-misplaced', `${DEPENDS_ON_KEY} is read only on backlog items (kind: backlog-item), so these prerequisites are ignored`);
      continue;
    }
    for (const raw of malformed) add('dependency-malformed', `${DEPENDS_ON_KEY} entry ${JSON.stringify(raw)} is not a [[wikilink]]; write quoted wikilinks, e.g. ${DEPENDS_ON_KEY}: ["[[other-item]]"]`);
    const analysis = analysisFor(path, metadata);
    for (const dep of analysis.byPath.get(path).deps) {
      if (dep.problem) add(DEPENDENCY_PROBLEMS[dep.problem][0], DEPENDENCY_PROBLEMS[dep.problem][1](dep.target));
    }
    for (const cycle of analysis.cycles) {
      if (cycle.slice(0, -1).includes(path)) add('dependency-cycle', `dependency cycle: ${cycle.map(slug).join(' -> ')}`);
    }
  }
  return out;
}

const also = lines => (lines.length > 1 ? ` (lines ${lines.join(', ')})` : '');
const flat = text => String(text).replace(/\r?\n/g, '\\n');
const clip = (text, max = 80) => (text.length > max ? `${text.slice(0, max - 3)}...` : text);

function linkDefects(scan, ledger) {
  const out = [];
  const take = (item, rule, message) => out.push({ path: item.source, line: item.line, rule, message: message + also(item.lines) });
  for (const issue of scan.issues) {
    if (!ledger.has(issue.source)) continue;
    if (issue.rule === 'ambiguous-link') take(issue, 'ambiguous-link', `[[${issue.target}]] matches ${issue.candidates.length} pages (${issue.candidates.join(', ')}); qualify the path`);
    else if (issue.rule === 'malformed-link') take(issue, 'malformed-link', `${clip(flat(issue.evidence))} is malformed (unclosed, empty, or split across lines)`);
    else if (issue.rule === 'unresolved-citation') take(issue, 'unresolved-citation', `${issue.channel} citation [[${issue.target}]] matches no page`);
    else take(issue, issue.rule, issue.evidence);
  }
  // health leaves these as unscored forward links; a task must not leave a dead link.
  for (const link of scan.forwardLinks) {
    if (ledger.has(link.source)) take(link, 'unresolved-link', `[[${link.target}]] matches no page`);
  }
  return out;
}

export function validateAuthored(vaultPath, paths) {
  const entries = checkLedger(paths);
  try { if (!statSync(vaultPath).isDirectory()) throw new Error('not a directory'); }
  catch { throw new InputError(`vault not found: ${vaultPath}`); }
  const defects = [];
  const present = new Set();
  const texts = new Map();
  const listings = new Map();
  let checked = 0, skipped = 0;
  for (const path of entries) {
    // Not wiki content: raw evidence, logs, templates, the root catalog files, anything
    // that is not Markdown, and dot-prefixed paths the vault walk never sees.
    if (!isContent(path) || path.split('/').some(part => part.startsWith('.'))) { skipped++; continue; }
    checked++;
    if (!existsExactly(vaultPath, path, listings)) {
      defects.push({ path, line: 1, rule: 'missing-file', message: 'no file at this exact path (the letter case must match too)' });
      continue;
    }
    try { texts.set(path, readFileSync(join(vaultPath, path), 'utf8')); }
    catch (error) { defects.push({ path, line: 1, rule: 'missing-file', message: `file cannot be read (${error.code ?? error.message})` }); continue; }
    present.add(path);
  }
  for (const [path, markdown] of texts) defects.push(...frontmatterDefects(path, markdown));
  defects.push(...dependencyDefects(vaultPath, texts));
  if (present.size) defects.push(...linkDefects(scanIntegrity(vaultPath), present));
  defects.sort((a, b) => compare(a.path, b.path) || a.line - b.line || compare(a.rule, b.rule) || compare(a.message, b.message));
  return { version: 1, checked, skipped, defects };
}

function readLedgerFile(file) {
  let text;
  try { text = readFileSync(file, 'utf8'); }
  catch (error) { throw new InputError(`cannot read --paths-file ${file}: ${error.code ?? error.message}`); }
  try { return JSON.parse(withoutBom(text)); }
  catch (error) { throw new InputError(`--paths-file ${file} is not valid JSON: ${error.message}`); }
}

export function summary(result) {
  return `validate-authored: ${result.checked} pages checked, ${result.defects.length} defects${result.skipped ? `, ${result.skipped} skipped` : ''}`;
}

// Returns the exit code; the process-level guard below sets it.
export function main(argv = process.argv.slice(2)) {
  try {
    const { values } = parseArgs({ args: argv, options: { 'paths-file': { type: 'string' }, json: { type: 'boolean' } } });
    if (!values['paths-file']) throw new InputError('--paths-file <JSON array of vault-relative paths> is required (usage: node validate-authored.mjs --paths-file <ledger.json> [--json])');
    const result = validateAuthored(resolveVault().path, readLedgerFile(values['paths-file']));
    if (values.json) console.log(JSON.stringify(result, null, 2));
    else {
      for (const d of result.defects) console.log(`${d.path}:${d.line} ${d.rule} ${d.message}`);
      console.log(summary(result));
    }
    return result.defects.length ? 1 : 0;
  } catch (error) {
    console.error(`validate-authored: ${error.message}`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();
