import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { buildGraph } from './lib/graph.mjs';
import { checkLedgerPaths, readLedger } from './lib/ledger.mjs';
import { classifyQuotes, checkStyle } from './lint.mjs';
import {
  DISPOSITIONS, DISPOSITIONS_FILE, STYLE_ONLY_DISPOSITIONS, appendDispositions, pruneDispositions, recordFor,
} from './lib/lint-dispositions.mjs';
import { cliGuard } from './lib/cli-guard.mjs';
cliGuard(import.meta.url);

// Records what a person decided about lint findings (see lib/lint-dispositions.mjs), or removes the records of a page that
// is gone. It is the only writer of lint-dispositions.jsonl, and lint.mjs stays read-only. The file lives at the vault root
// and is tracked, so it is listed in a ledger like any page.

class InputError extends Error {}

function record(values, vaultPath) {
  const ids = String(values.ids ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!ids.length) throw new InputError('record needs --ids=<id>[,<id>...] (the ids lint.mjs --ids prints)');
  if (!DISPOSITIONS.includes(values.disposition)) throw new InputError(`--disposition must be one of ${DISPOSITIONS.join(', ')}`);
  if (!String(values.reviewer ?? '').trim()) throw new InputError('record needs --reviewer=<name>');
  const scopes = ['page', 'paths-file', 'whole-vault'].filter((k) => values[k] !== undefined);
  if (scopes.length !== 1) throw new InputError('record needs exactly one scope: --page=<path>, --paths-file=<ledger> or --whole-vault');
  let pages;
  if (values.page !== undefined) pages = new Set([values.page]);
  else if (values['paths-file'] !== undefined) pages = new Set(checkLedgerPaths(readLedger(values['paths-file'])));
  const graph = buildGraph(vaultPath);
  const { findings } = classifyQuotes(vaultPath, graph, pages ? { pages } : {});
  // A style pointer is recorded the same way: its "quote" is the category and the flagged words, its evidence the hash of
  // the sentence it was raised on, and its tier "style".
  const style = checkStyle(vaultPath, graph, pages ? { pages } : {}).map((f) => ({ id: f.id, page: f.page, quote: `${f.category}: ${f.word}`, evidenceHash: f.evidenceHash, tier: 'style' }));
  const byId = new Map([...style, ...findings].map((f) => [f.id, f]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) throw new InputError(`no finding with id ${missing.join(', ')} in that scope (the quote, the flagged sentence or the evidence may have changed, or its page is outside the scope; run lint.mjs --ids again)`);
  if (STYLE_ONLY_DISPOSITIONS.includes(values.disposition)) {
    const quotes = ids.filter((id) => byId.get(id).tier !== 'style');
    if (quotes.length) throw new InputError(`${values.disposition} is a verdict for style flags only, and ${quotes.join(', ')} ${quotes.length === 1 ? 'is a quote finding' : 'are quote findings'}`);
  }
  const date = new Date().toISOString().slice(0, 10);
  appendDispositions(join(vaultPath, DISPOSITIONS_FILE), ids.map((id) => recordFor(byId.get(id), { disposition: values.disposition, reviewer: values.reviewer, note: values.note, date })));
  return `recorded ${ids.length} verdict(s) in ${DISPOSITIONS_FILE} (${values.disposition}): ${ids.join(', ')}`;
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
