// Bring a hand-clipped file into the pipeline: stamp the `source-hash` a clipper would have written for the same text, and
// fill `quality` and `topic` when the file has none. Only the frontmatter changes; the body stays byte-identical.
//
//   node scripts/adopt-clipping.mjs <path>... [--topic=<t>] [--quality=<tier>]           # dry run
//   node scripts/adopt-clipping.mjs <path>... [--topic=<t>] [--quality=<tier>] --apply
//
// Exact named files under raw/clippings/ only, never a sweep. Every path is checked before any file is written, so one
// refused path leaves the others as they were.
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { resolveVault, isUnder } from './lib/vault.mjs';
import { clippingHash } from './lib/clipping-hash.mjs';
import { normalizeTopic } from './lib/topic.mjs';
import { optionValue, cliGuard } from './lib/cli-guard.mjs';
cliGuard(import.meta.url);

const TIERS = ['high', 'medium', 'low'];
const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const refuse = (message) => { console.error(`adopt-clipping: ${message}`); process.exit(2); };

const paths = [];
for (let i = 0; i < argv.length; i++) {
  const token = argv[i];
  if (token === '--topic' || token === '--quality') i++;
  else if (!token.startsWith('--')) paths.push(token);
}
if (!paths.length) refuse('name at least one clipping under raw/clippings/ (see --help)');

const quality = optionValue(argv, 'quality');
if (quality !== undefined && !TIERS.includes(quality)) refuse(`--quality must be one of ${TIERS.join(', ')}`);
const topicArg = optionValue(argv, 'topic');
const topic = topicArg === undefined ? null : normalizeTopic(topicArg);
if (topicArg !== undefined && !topic) refuse('--topic needs a value');

const { path: vault } = resolveVault();
const clippingsDir = join(vault, 'raw', 'clippings');

// The unquoted value of a frontmatter line, or null when the key is absent or empty.
const scalar = (block, name) => {
  const m = block.match(new RegExp(`^${name}:[ \t]*(.*?)[ \t]*$`, 'm'));
  if (!m || m[1] === '') return null;
  if (m[1].startsWith('"')) { try { return String(JSON.parse(m[1])); } catch { /* fall through to the raw text */ } }
  return m[1].replace(/^'|'$/g, '');
};

function plan(arg) {
  // A relative path is the caller's own; one that only exists beside the vault root is that file.
  const abs = resolve(arg);
  const file = !existsSync(abs) && existsSync(resolve(vault, arg)) ? resolve(vault, arg) : abs;
  if (!isUnder(file, clippingsDir) || file === resolve(clippingsDir)) refuse(`${arg}: only files under raw/clippings/ can be adopted`);
  if (!existsSync(file) || !statSync(file).isFile()) refuse(`${arg}: no such file`);
  if (!file.toLowerCase().endsWith('.md')) refuse(`${arg}: only Markdown clippings can be adopted`);
  // A link inside raw/clippings must not lead out of it.
  if (!isUnder(realpathSync(file), clippingsDir)) refuse(`${arg}: only files under raw/clippings/ can be adopted`);

  const text = readFileSync(file, 'utf8');
  const fm = text.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!fm) refuse(`${arg}: no frontmatter, so there is nothing to stamp`);
  const block = fm[2];
  if (scalar(block, 'source') === null) refuse(`${arg}: no source: line, so this is not a clipping of a page`);
  const heldQuality = scalar(block, 'quality');
  if (heldQuality === null && quality === undefined) refuse(`${arg}: no quality in the file and no --quality given; pass --quality=${TIERS.join('|')}`);

  const newline = fm[1].endsWith('\r\n') ? '\r\n' : '\n';
  const lines = [];
  const conflicts = [];
  const want = (field, value, held, render) => {
    if (held === null) lines.push(render(value));
    else if (held !== value) conflicts.push({ field, held, wanted: value });
  };
  if (quality !== undefined) want('quality', quality, heldQuality, (v) => `quality: ${v}`);
  if (topic !== null) want('topic', topic, normalizeTopic(scalar(block, 'topic') ?? '') , (v) => `topic: ${JSON.stringify(v)}`);
  want('source-hash', clippingHash(text), scalar(block, 'source-hash'), (v) => `source-hash: ${v}`);

  const next = lines.length ? fm[1] + block + newline + lines.join(newline) + fm[3] + text.slice(fm[0].length) : text;
  return { path: file, arg, next, text, added: lines.map((l) => l.slice(0, l.indexOf(':'))), conflicts };
}

const plans = paths.map(plan);
const files = plans.map((p) => {
  if (apply && p.next !== p.text) writeFileSync(p.path, p.next);
  const status = p.next !== p.text ? 'adopted' : 'unchanged';
  return { path: p.arg, status, added: p.added, conflicts: p.conflicts };
});

console.log(JSON.stringify({ type: 'adopt-clipping', applied: apply, files }));
for (const f of files) for (const c of f.conflicts) console.error(`conflict: ${f.path}: ${c.field} is ${c.held}, not ${c.wanted}; left as it is`);
if (!apply && files.some((f) => f.status === 'adopted')) console.error('dry run — re-run with --apply to stamp');
