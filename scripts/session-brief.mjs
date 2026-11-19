import { vaultPath as checkedPath } from './lib/vault-path.mjs';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { resolveOperationVault } from './lib/vault.mjs';
import { helpRequested, exitWithHelp } from './lib/help.mjs';
import { readBacklogItems } from './lib/backlog-read.mjs';
import { findProject, parseStatePage, buildBrief, formatBrief, validateProject } from './lib/session-brief.mjs';
import { repositoryFacts } from './lib/repository.mjs';
export { repositoryFacts } from './lib/repository.mjs';

// Read-only: finds the wiki project the current repository belongs to and prints its state. Nothing is written and no
// semantic index is touched.

const USAGE = [
  'usage: node scripts/session-brief.mjs [--project <slug>] [--repo <dir>] [--stale-days <n>] [--json]',
  '',
  'Finds the wiki project this repository belongs to and reads its optional reference/studio-state.md orientation:',
  'current focus, relevant records, dependencies and recent decisions. Historical state pages remain supported;',
  'legacy gate annotations are advisory, never approval requirements. Undated artifacts are unverified, not stale.',
  'Dated artifacts older than --stale-days days (default 30) and blocked backlog items are listed separately.',
  'The project is found from the repository: its `origin` remote or its folder name must match a `repo:` line on the',
  'project\'s overview page (wiki/authored/<project>/overview.md). --project names it directly.',
  'It exits 1 when no project, or more than one, matches, and 2 for bad input. It writes nothing.',
  'The vault is the one named by WIKI_MASTER_VAULT (default: ~/.wiki-master-vault).',
].join('\n');

class InputError extends Error {}

export function main(argv = process.argv.slice(2), { cwd = process.cwd(), today = new Date() } = {}) {
  let values;
  try { ({ values } = parseArgs({ args: argv, options: { project: { type: 'string' }, repo: { type: 'string' }, 'stale-days': { type: 'string' }, json: { type: 'boolean' } } })); }
  catch (error) { throw new InputError(error.message.split('\n')[0]); }
  let staleDays = 30;
  if (values['stale-days'] !== undefined) {
    if (!/^\d+$/.test(values['stale-days'])) throw new InputError('--stale-days takes a whole number of days');
    staleDays = Number(values['stale-days']);
  }
  const vault = resolveOperationVault('documentation', { requireAvailable: false, repo: values.repo, cwd });
  const vaultPath = vault.path;
  if (values.project && vault.context.project && values.project !== vault.context.project) throw new InputError('Explicit project conflicts with the configured repository project');
  values.project ??= vault.context.project ?? undefined;
  const facts = repositoryFacts(values.repo ? resolve(cwd, values.repo) : cwd);
  let chosen;
  if (values.project !== undefined) {
    try { validateProject(values.project); } catch (error) { throw new InputError(error.message); }
    const path = `wiki/authored/${values.project}`;
    try { if (!statSync(checkedPath(vaultPath, ...path.split('/'))).isDirectory()) throw new Error('not a directory'); }
    catch { throw new InputError(`no project folder ${path} in the vault`); }
    chosen = { project: values.project, path, by: 'flag' };
  } else {
    const { matches } = findProject(vaultPath, facts);
    if (matches.length !== 1) return { exit: 1, output: noMatch(matches, facts, values.json) };
    chosen = matches[0];
  }
  const statePath = checkedPath(vaultPath, ...chosen.path.split('/'), 'reference', 'studio-state.md');
  const brief = existsSync(statePath)
    ? buildBrief({ state: parseStatePage(readFileSync(statePath, 'utf8')), items: readBacklogItems(vaultPath, `${chosen.path}/backlog`), today, staleDays })
    : null;
  if (values.json) return { exit: 0, output: JSON.stringify({ project: chosen.project, path: chosen.path, by: chosen.by, statePage: brief ? `${chosen.path}/reference/studio-state.md` : null, ...(brief ?? {}) }, null, 2) };
  return { exit: 0, output: formatBrief({ ...chosen, brief, staleDays }) };
}

function noMatch(matches, facts, json) {
  if (json) return JSON.stringify({ project: null, matches, remote: facts.remote, folder: facts.folder }, null, 2);
  if (matches.length > 1) {
    return ['more than one wiki project claims this repository:', ...matches.map((m) => `  - ${m.project} (${m.path}, matched by ${m.by})`),
      'Remove the `repo:` line from the ones that do not own it, or run again with --project <slug>.'].join('\n');
  }
  const value = facts.remote ?? facts.folder;
  return [`no wiki project is bound to this repository (remote: ${facts.remote ?? 'none'}, folder: ${facts.folder}).`,
    'To bind it, add a `repo:` line to the project\'s overview page (wiki/authored/<project>/overview.md), for example:',
    `  repo: ${value}`,
    'or run again with --project <slug>.'].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (helpRequested()) exitWithHelp(USAGE);
  else {
    try {
      const out = main();
      console.log(out.output);
      process.exitCode = out.exit;
    } catch (error) {
      console.error(`session-brief: ${error.message}`);
      process.exitCode = 2;
    }
  }
}
