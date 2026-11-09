import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { isUnder, resolveVault } from './lib/vault.mjs';
import { buildGraph } from './lib/graph.mjs';
import { checkLedgerPaths, readLedger } from './lib/ledger.mjs';
import { classifyQuotes, checkStyle } from './lint.mjs';
import {
  DISPOSITIONS, DISPOSITIONS_FILE, STYLE_ONLY_DISPOSITIONS, appendDispositions, matchByQuote, pruneDispositions, recordFor,
} from './lib/lint-dispositions.mjs';
import { cliGuard } from './lib/cli-guard.mjs';
cliGuard(import.meta.url);

// Records what a person decided about lint findings (see lib/lint-dispositions.mjs), or removes the records of a page that
// is gone. It is the only writer of lint-dispositions.jsonl, and lint.mjs stays read-only. The file lives at the vault root
// and is tracked, so it is listed in a ledger like any page.

class InputError extends Error {}

// The entries of a --by-quote file: a JSON array of objects with a string page and quote. Other fields are ignored, so a
// findings array saved from `lint.mjs --json` (and filtered) is accepted as it is. A file inside the vault is refused,
// by its real path: a scratch list of findings there would be synchronized with the pages.
function readEntries(file, vaultPath) {
  if (!file) throw new InputError('--by-quote needs a file: --by-quote=<entries.json>');
  let real;
  try { real = realpathSync(file); } catch (error) { throw new InputError(`cannot read the --by-quote file ${file} (${error.code ?? error.message})`); }
  if (isUnder(real, vaultPath)) throw new InputError(`--by-quote file must be outside the vault: ${file}`);
  let entries;
  try { entries = JSON.parse(readFileSync(real, 'utf8').replace(/^\uFEFF/, '')); } catch (error) { throw new InputError(`the --by-quote file ${file} is not JSON (${error.message.split('\n')[0]})`); }
  if (!Array.isArray(entries)) throw new InputError(`the --by-quote file ${file} must hold a JSON array of {"page", "quote"} objects`);
  if (!entries.length) throw new InputError(`the --by-quote file ${file} holds no entries`);
  const text = (x) => typeof x === 'string' && x.trim() !== '';
  entries.forEach((e, i) => {
    if (!e || typeof e !== 'object' || !text(e.page) || !text(e.quote)) throw new InputError(`--by-quote entry ${i} needs a string page and a string quote`);
  });
  return entries.map(({ page, quote }) => ({ page, quote }));
}

// How an entry that matched nothing, or more than one finding, is named: its index, page, the first 60 characters of its
// quote and the number of findings it matched.
const describe = ({ index, entry, count }) => `entry ${index} (${entry.page}: "${entry.quote.replace(/\s+/g, ' ').trim().slice(0, 60)}", ${count} matches)`;

function record(values, vaultPath) {
  const ids = [...new Set(String(values.ids ?? '').split(',').map((s) => s.trim()).filter(Boolean))];
  const byQuote = values['by-quote'] !== undefined;
  if (!ids.length && !byQuote) throw new InputError('record needs --ids=<id>[,<id>...] (the ids lint.mjs --ids prints) or --by-quote=<file>');
  if (!DISPOSITIONS.includes(values.disposition)) throw new InputError(`--disposition must be one of ${DISPOSITIONS.join(', ')}`);
  if (!String(values.reviewer ?? '').trim()) throw new InputError('record needs --reviewer=<name>');
  // The scope says where to look for the ids. --by-quote looks on each entry's own page and takes no scope.
  const scopes = ['page', 'paths-file', 'whole-vault'].filter((k) => values[k] !== undefined);
  if (ids.length && scopes.length !== 1) throw new InputError('record needs exactly one scope: --page=<path>, --paths-file=<ledger> or --whole-vault');
  if (!ids.length && scopes.length) throw new InputError(`--${scopes[0]} is the scope of --ids; --by-quote looks on each entry's page and takes no scope`);
  const entries = byQuote ? readEntries(values['by-quote'], vaultPath) : [];
  let idPages = null; // null: the whole vault
  if (values.page !== undefined) idPages = new Set([values.page]);
  else if (values['paths-file'] !== undefined) idPages = new Set(checkLedgerPaths(readLedger(values['paths-file'])));
  const pages = ids.length && !idPages ? null : new Set([...(idPages ?? []), ...entries.map((e) => e.page)]);
  const graph = buildGraph(vaultPath);
  const { findings } = classifyQuotes(vaultPath, graph, pages ? { pages } : {});
  // A style pointer is recorded the same way: its "quote" is the category and the flagged words, its evidence the hash of
  // the sentence it was raised on, and its tier "style".
  const style = ids.length ? checkStyle(vaultPath, graph, idPages ? { pages: idPages } : {}).map((f) => ({ id: f.id, page: f.page, quote: `${f.category}: ${f.word}`, evidenceHash: f.evidenceHash, tier: 'style' })) : [];
  const byId = new Map([...style, ...findings.filter((f) => !idPages || idPages.has(f.page))].map((f) => [f.id, f]));
  const missing = ids.filter((id) => !byId.has(id));
  const { matched, missing: unmatched, ambiguous } = matchByQuote(findings, entries);
  // Without --skip-missing one miss fails the call and nothing is written, as before; with it the others are recorded.
  if ((missing.length || unmatched.length || ambiguous.length) && !values['skip-missing']) {
    const problems = [
      ...(missing.length ? [`no finding with id ${missing.join(', ')} in that scope (the quote, the flagged sentence or the evidence may have changed, or its page is outside the scope; run lint.mjs --ids again)`] : []),
      ...(unmatched.length ? [`no quote finding matches --by-quote ${unmatched.map(describe).join(', ')}`] : []),
      ...(ambiguous.length ? [`more than one quote finding matches --by-quote ${ambiguous.map(describe).join(', ')}`] : []),
    ];
    throw new InputError(`${problems.join('; ')}; nothing was recorded (--skip-missing records the others)`);
  }
  const notes = [
    ...(missing.length ? [`skipped ${missing.length} id(s) with no current finding in that scope: ${missing.join(', ')}`] : []),
    ...(unmatched.length ? [`skipped ${unmatched.length} entr(ies) with no matching finding`, ...unmatched.map((m) => `  ${describe(m)}`)] : []),
    ...(ambiguous.length ? [`refused ${ambiguous.length} ambiguous entr(ies)`, ...ambiguous.map((m) => `  ${describe(m)}`)] : []),
  ];
  // One line per finding, whether it was named by id, by several entries, or both.
  const found = new Map(ids.filter((id) => byId.has(id)).map((id) => [id, byId.get(id)]));
  for (const { finding } of matched) found.set(finding.id, finding);
  if (!found.size) throw new InputError(['nothing recorded', ...notes].join('\n'));
  if (STYLE_ONLY_DISPOSITIONS.includes(values.disposition)) {
    const quotes = [...found.values()].filter((f) => f.tier !== 'style').map((f) => f.id);
    if (quotes.length) throw new InputError(`${values.disposition} is a verdict for style flags only, and ${quotes.join(', ')} ${quotes.length === 1 ? 'is a quote finding' : 'are quote findings'}`);
  }
  const date = new Date().toISOString().slice(0, 10);
  appendDispositions(join(vaultPath, DISPOSITIONS_FILE), [...found.values()].map((f) => recordFor(f, { disposition: values.disposition, reviewer: values.reviewer, note: values.note, date })));
  return [`recorded ${found.size} verdict(s) in ${DISPOSITIONS_FILE} (${values.disposition}): ${[...found.keys()].join(', ')}`, ...notes].join('\n');
}

function prune(values, vaultPath) {
  const file = join(vaultPath, DISPOSITIONS_FILE);
  const { removed } = pruneDispositions(file, (page) => existsSync(join(vaultPath, ...page.split('/'))), { apply: !!values.apply });
  if (!removed) return `${DISPOSITIONS_FILE}: no record is for a page that no longer exists`;
  return values.apply ? `${DISPOSITIONS_FILE}: removed ${removed} record(s) for a page that no longer exists`
    : `${DISPOSITIONS_FILE}: ${removed} record(s) for a page that no longer exists; dry run, re-run with --apply to remove them`;
}

export function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: {
      ids: { type: 'string' }, disposition: { type: 'string' }, reviewer: { type: 'string' }, note: { type: 'string' },
      page: { type: 'string' }, 'paths-file': { type: 'string' }, 'whole-vault': { type: 'boolean' }, apply: { type: 'boolean' },
      'skip-missing': { type: 'boolean' }, 'by-quote': { type: 'string' },
    } });
  } catch (error) { throw new InputError(error.message.split('\n')[0]); }
  const [command, ...extra] = parsed.positionals;
  if (extra.length || !['record', 'prune'].includes(command)) throw new InputError('the command is record or prune (see --help)');
  const { path: vaultPath } = resolveVault();
  const message = command === 'record' ? record(parsed.values, vaultPath) : prune(parsed.values, vaultPath);
  console.log(message);
  return message;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); }
  catch (error) { console.error(`lint-disposition: ${error.message}`); process.exitCode = 2; }
}
