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
import { unquoteValue } from './lib/known-urls.mjs';
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

// Every line of a key, in order. A web clipper emits `topic:` and `quality:` with nothing after them, and an older run may have
// left a key twice, so a key can have several lines and some of them empty.
const keyLines = (name) => new RegExp(`^${name}:[ 	]*(.*?)[ 	]*$`, 'gm');

// The unquoted value of one such line; '' for an empty value, for `""` and for `''`, which all say the key is not filled in.
// The same reader the dedup and recapture lookups use, so what is adopted here is found there.
const unquote = unquoteValue;

// The value of the first line of the key that has one, or null when the key is absent or every line of it is empty.
const scalar = (block, name) => {
  for (const m of block.matchAll(keyLines(name))) { const value = unquote(m[1]); if (value) return value; }
  return null;
};

// Put `line` where the first empty line of the key is, so the key is never written twice; null when no line is empty. Any
// other empty line of the key goes too: the pipeline's parser takes the LAST copy of a repeated key, so one left behind
// would read back as empty and the stamp would be silently ineffective. A line that has a value is never touched.
const fillEmpty = (block, name, line) => {
  const own = new RegExp(`^${name}:[ \t]*(.*?)[ \t]*\r?$`);
  let done = false;
  const out = [];
  for (const l of block.split('\n')) {
    const m = own.exec(l);
    if (!m || unquote(m[1])) { out.push(l); continue; }
    if (done) continue;
    done = true;
    out.push(l.endsWith('\r') ? `${line}\r` : line);
  }
  return done ? out.join('\n') : null;
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
  // Read as UTF-8 a leading byte-order mark stays in the text and hides the opening ---; it is named, not tolerated.
  if (text.charCodeAt(0) === 0xFEFF) refuse(`${arg}: the file starts with a byte-order mark (BOM), so its frontmatter cannot be read; save it as UTF-8 without one`);
  const fm = text.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!fm) refuse(`${arg}: no frontmatter, so there is nothing to stamp`);
  const block = fm[2];
  if (scalar(block, 'source') === null) refuse(`${arg}: no source: line, so this is not a clipping of a page`);
  const heldQuality = scalar(block, 'quality');
  if (heldQuality === null && quality === undefined) refuse(`${arg}: no quality in the file and no --quality given; pass --quality=${TIERS.join('|')}`);

  const newline = fm[1].endsWith('\r\n') ? '\r\n' : '\n';
  // A missing field takes the place of the key's empty line when the file has one, and is appended otherwise.
  let edited = block;
  const appended = [];
  const added = [];
  const conflicts = [];
  const want = (field, value, held, render) => {
    if (held !== null) { if (held !== value) conflicts.push({ field, held, wanted: value }); return; }
    const line = render(value);
    const filled = fillEmpty(edited, field, line);
    if (filled === null) appended.push(line); else edited = filled;
    added.push(field);
  };
  if (quality !== undefined) want('quality', quality, heldQuality, (v) => `quality: ${v}`);
  if (topic !== null) want('topic', topic, normalizeTopic(scalar(block, 'topic') ?? ''), (v) => `topic: ${JSON.stringify(v)}`);
  want('source-hash', clippingHash(text), scalar(block, 'source-hash'), (v) => `source-hash: ${v}`);

  const next = added.length ? fm[1] + edited + appended.map((l) => newline + l).join('') + fm[3] + text.slice(fm[0].length) : text;
  return { path: file, arg, next, text, added, conflicts };
}

// A file named twice (or spelled two ways) is one file: planned, written and reported once.
const seen = new Set();
const plans = paths.map(plan).filter((p) => { const key = realpathSync.native(p.path); return !seen.has(key) && seen.add(key); });
const files = plans.map((p) => {
  if (apply && p.next !== p.text) writeFileSync(p.path, p.next);
  const status = p.next !== p.text ? 'adopted' : 'unchanged';
  return { path: p.arg, status, added: p.added, conflicts: p.conflicts };
});

console.log(JSON.stringify({ type: 'adopt-clipping', applied: apply, files }));
for (const f of files) for (const c of f.conflicts) console.error(`conflict: ${f.path}: ${c.field} is ${c.held}, not ${c.wanted}; left as it is`);
if (!apply && files.some((f) => f.status === 'adopted')) console.error('dry run — re-run with --apply to stamp');
