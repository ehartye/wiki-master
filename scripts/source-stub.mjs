// Print the provenance frontmatter of a new source page for the clippings it summarizes, so nobody copies a
// source-hash by hand.
//
//   node scripts/source-stub.mjs <clipping>...
//   node scripts/source-stub.mjs --paths-file <ledger.json>
//
// Read-only. `sources` cites each clipping by its vault path, as a quoted wikilink, in the order given; `source-hashes`
// holds each clipping's RECORDED source-hash in the same order, read the way the graph reads it, because the ingest
// backlog joins on that value (lib/graph.mjs). A hash recomputed from the text would not join for a clipping whose hash
// was recorded over another form of the same text.
//
// Every clipping is checked before anything is printed. One outside raw/clippings/, missing, with no source-hash, or
// whose text is not the text its hash was recorded over (verifyClippingHash: mismatch) is refused: each is named on
// stderr, nothing goes to stdout, and the exit code is 1. An equivalent status (crlf-variant, trailing-newline) is a note
// on stderr and the clipping is cited. Exit 2 is bad input.
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveOperationVault } from './lib/vault.mjs';
import { canonicalDestination, containsPath } from './lib/vault-path.mjs';
import { verifyClippingHash, EQUIVALENT_HASH_STATUSES } from './lib/clipping-hash.mjs';
import { markdownPage } from './lib/graph.mjs';
import { checkLedgerPaths, readLedger, LedgerError } from './lib/ledger.mjs';
import { localDate } from './lib/local-date.mjs';
import { optionValues, cliGuard } from './lib/cli-guard.mjs';
cliGuard(import.meta.url);

const NOTE = {
  'crlf-variant': 'its source-hash was recorded over the same text with CRLF line endings',
  'trailing-newline': 'its source-hash was recorded over the same text with one more final line break',
};

const toSlash = (p) => p.split(sep).join('/');

// Why one clipping cannot be cited, or null with its vault path, recorded hash and status.
function check(vault, file) {
  const clippings = resolve(vault, 'raw', 'clippings');
  const inside = (p, dir) => containsPath(dir, p) && resolve(p) !== resolve(dir);
  // By the path as given or by where it really is (a vault reached through a link, such as macOS's temp folder).
  if (!inside(resolve(file), clippings) && !inside(canonicalDestination(file), canonicalDestination(clippings))) return { problem: 'it is outside raw/clippings/; only a clipping there is cited this way' };
  if (!existsSync(file)) return { problem: 'no such file' };
  const real = realpathSync.native(file);
  // A link inside raw/clippings must not lead out of it.
  if (!inside(real, canonicalDestination(clippings))) return { problem: 'it leads outside raw/clippings/; only a clipping there is cited this way' };
  if (!statSync(real).isFile()) return { problem: 'it is not a file' };
  if (!real.toLowerCase().endsWith('.md')) return { problem: 'it is not a Markdown clipping, and only a clipping\'s Markdown is summarized' };
  const path = toSlash(relative(canonicalDestination(vault), real));
  const text = readFileSync(real, 'utf8');
  // The value the ingest backlog joins on, so "no source-hash" means here what it means in health.
  const recorded = markdownPage(path, text).sourceHash;
  if (!recorded) return { problem: 'it has no source-hash; stamp one first (adopt-clipping.mjs for a hand-clipped file, repair-missing-hash.mjs for an older clipping)' };
  const status = verifyClippingHash(text, recorded);
  if (status === 'mismatch') return { problem: 'its text is not the text its source-hash was recorded over (mismatch); health.mjs lists it as source-hash-mismatch with the fix' };
  return { path, recorded, status };
}

/**
 * The block for `items` ({ arg, file }: what the caller named and the file it resolved to), or the refusals.
 * @returns {{ block: string, notes: string[], refused: string[] }} `block` is '' when anything is refused
 */
export function sourceStub(vault, items, { today = localDate() } = {}) {
  const cited = [];
  const notes = [];
  const refused = [];
  const seen = new Set();
  for (const { arg, file } of items) {
    const r = check(vault, file);
    if (r.problem) { refused.push(`${arg}: ${r.problem}`); continue; }
    const key = r.path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cited.push(r);
    if (EQUIVALENT_HASH_STATUSES.includes(r.status)) notes.push(`${r.path}: ${r.status}: ${NOTE[r.status]}; it is cited with the hash as recorded`);
  }
  if (refused.length) return { block: '', notes, refused };
  const block = [
    '---',
    'type: source',
    `created: ${today}`,
    `updated: ${today}`,
    'status: draft',
    `sources: [${cited.map((c) => JSON.stringify(`[[${c.path}]]`)).join(', ')}]`,
    `source-hashes: [${cited.map((c) => c.recorded).join(', ')}]`,
    'ai-generated: true',
    '---',
    '',
  ].join('\n');
  return { block, notes, refused };
}

class InputError extends Error {}

function itemsFrom(argv, vault) {
  const ledgers = optionValues(argv, 'paths-file');
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--paths-file') { if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) i++; }
    else if (!token.startsWith('--')) positional.push(token);
  }
  if (ledgers.length && positional.length) throw new InputError('name the clippings or give --paths-file, not both');
  if (ledgers.length > 1) throw new InputError('give --paths-file once');
  if (ledgers.length) {
    if (!ledgers[0]) throw new InputError('--paths-file needs a ledger file (a JSON array of vault-relative paths)');
    try {
      return checkLedgerPaths(readLedger(ledgers[0]), vault).map((p) => ({ arg: p, file: resolve(vault, p) }));
    } catch (error) {
      if (error instanceof LedgerError) throw new InputError(error.message);
      throw error;
    }
  }
  if (!positional.length) throw new InputError('name at least one clipping under raw/clippings/, or give --paths-file (see --help)');
  // A relative path is the caller's own when it names a file there, and otherwise a vault path.
  return positional.map((arg) => {
    const own = resolve(arg);
    return { arg, file: isAbsolute(arg) || existsSync(own) ? own : resolve(vault, arg) };
  });
}

export function main(argv = process.argv.slice(2)) {
  const { path: vault } = resolveOperationVault('research');
  let items;
  try { items = itemsFrom(argv, vault); }
  catch (error) {
    if (!(error instanceof InputError)) throw error;
    console.error(`source-stub: ${error.message}`);
    process.exitCode = 2;
    return;
  }
  const { block, notes, refused } = sourceStub(vault, items);
  for (const line of refused) console.error(`refused: ${line}`);
  if (refused.length) {
    console.error(`source-stub: ${refused.length} clipping(s) refused; nothing printed`);
    process.exitCode = 1;
    return;
  }
  for (const line of notes) console.error(`note: ${line}`);
  process.stdout.write(block);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
