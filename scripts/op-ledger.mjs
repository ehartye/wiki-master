import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { isGitRepo, statusPorcelain } from './lib/git.mjs';
import { dirtySet, deltaPaths } from './lib/op.mjs';
import { LedgerError, readLedger } from './lib/ledger.mjs';
import { openOperationProblem, readWritten, recordWritten } from './lib/op-ledger.mjs';
import { cliGuard, optionValue } from './lib/cli-guard.mjs';
cliGuard(import.meta.url);

// The ledger an operation closes with, built from what its writers recorded instead of assembled by hand.
//
//   add   records paths a writer made with its own file tools (a page, a log entry, a delegated worker's output) in the
//         operation's ledger. The clippers, log-entry, refresh-catalogs and index-gen record theirs with --since.
//   show  prints the JSON array that op-commit, refresh-catalogs and validate-authored take as --paths-file, and checks it
//         against the working tree before the close, when it can still be mended: a path op-commit would refuse, a path that
//         is not dirty, and every path this operation made dirty that nobody recorded. It never claims those last ones: the
//         delta alone cannot tell this operation's files from another writer's, and a forgotten log entry looks the same.

const VALUE_OPTIONS = new Set(['since', 'from', 'out']);

export function showLedger(vaultPath, token, { statusImpl = statusPorcelain } = {}) {
  const problem = openOperationProblem(vaultPath, token);
  if (problem) return { ok: false, reason: problem };
  const paths = readWritten(vaultPath, token);
  if (!paths.length) return { ok: false, reason: `nothing recorded for operation ${token} yet: the writers record with --since ${token}, and a page you wrote yourself is added with op-ledger.mjs add` };
  let record;
  try { record = JSON.parse(readFileSync(join(vaultPath, '.wiki-master', 'ops', `${token}.json`), 'utf8')); } catch { record = {}; }
  const before = new Set(Array.isArray(record.dirty) ? record.dirty : []);
  if (!isGitRepo(vaultPath)) return { ok: true, paths, checked: false, preexisting: [], clean: [], unclaimed: [] };
  const after = dirtySet(statusImpl(vaultPath));
  const claimed = new Set(paths);
  return {
    ok: true, paths, checked: true,
    preexisting: paths.filter((p) => before.has(p) && after.has(p)),
    clean: paths.filter((p) => !after.has(p)),
    unclaimed: deltaPaths(before, after).filter((p) => !claimed.has(p)),
  };
}

function parse(rest) {
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (token === '--') { positional.push(...rest.slice(i + 1)); break; }
    if (token.startsWith('--')) {
      if (!token.includes('=') && VALUE_OPTIONS.has(token.slice(2)) && rest[i + 1] !== undefined && !rest[i + 1].startsWith('--')) i++;
    } else positional.push(token);
  }
  return positional;
}

const list = (label, paths, advice) => (paths.length ? [`${label} (${paths.length}): ${advice}`, ...paths.map((p) => `  ${p}`)] : []);

export function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  const fail = (message) => { console.error(`op-ledger: ${message}`); process.exitCode = 1; };
  if (command !== 'add' && command !== 'show') {
    fail('usage: node scripts/op-ledger.mjs add --since <token> (<path>... | --from <JSON-file>)   |   show --since <token> [--out <file>]');
    return;
  }
  const token = optionValue(rest, 'since');
  if (!token) { fail('--since <token> is required: the token op-begin printed'); return; }
  const { path: vaultPath } = resolveVault();
  try {
    if (command === 'add') {
      const given = parse(rest);
      const from = optionValue(rest, 'from');
      if (from !== undefined) {
        if (!from) throw new LedgerError('--from needs a JSON file');
        const fromFile = readLedger(from);
        if (!Array.isArray(fromFile)) throw new LedgerError(`${from} must hold a JSON array of paths`);
        given.push(...fromFile);
      }
      const stored = recordWritten(vaultPath, token, given);
      console.log(`recorded ${stored.length} path(s) for operation ${token}:\n${stored.map((p) => `  ${p}`).join('\n')}`);
      return;
    }
    const r = showLedger(vaultPath, token);
    if (!r.ok) { fail(r.reason); return; }
    const out = optionValue(rest, 'out');
    const json = `${JSON.stringify(r.paths, null, 2)}\n`;
    if (out) { writeFileSync(out, json); console.log(`wrote ${r.paths.length} path(s) to ${out}`); } else process.stdout.write(json);
    const notes = [
      ...list('already dirty before op-begin', r.preexisting, 'op-commit refuses these; if this operation wrote them, run op-commit again with --include <path> for each, otherwise take them out of the ledger'),
      ...list('not changed now', r.clean, 'written and then reverted, or a mistyped path; op-commit will leave them out'),
      ...list('unclaimed', r.unclaimed, 'changed since op-begin and not recorded; if this operation wrote one, record it with op-ledger.mjs add; another writer\'s files stay out of the commit'),
    ];
    if (!r.checked) notes.push('the vault is not a git repository: the ledger was not checked against a working tree');
    if (notes.length) console.error(notes.join('\n'));
  } catch (error) {
    fail(error.message);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
