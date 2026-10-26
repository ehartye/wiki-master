import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { resolveVault } from './lib/vault.mjs';
import { helpRequested, exitWithHelp } from './lib/help.mjs';
import { validateProject } from './lib/catalog-options.mjs';
import { readBacklogItems } from './lib/backlog-read.mjs';
import { findProject, parseStatePage, buildBrief, formatBrief } from './lib/session-brief.mjs';

// Read-only: finds the wiki project the current repository belongs to and prints its state. No operation is opened,
// nothing is written, no semantic index is touched.

const USAGE = [
  'usage: node scripts/session-brief.mjs [--project <slug>] [--repo <dir>] [--stale-days <n>] [--json]',
  '',
  'Finds the wiki project this repository belongs to and prints its state page in three lines (phase and tier, next',
  'step, blocked by), then the artifacts not verified for more than --stale-days days (default 30), the blocked',
  'backlog items, and the open questions past their gate.',
  'The project is found from the repository: its `origin` remote or its folder name must match a `repo:` line on the',
  'project\'s overview page (wiki/authored/<project>/overview.md). --project names it directly.',
  'It exits 1 when no project, or more than one, matches, and 2 for bad input. It writes nothing.',
  'The vault is the one named by WIKI_MASTER_VAULT (default: ~/.wiki-master-vault).',
].join('\n');

class InputError extends Error {}

function git(dir, ...args) {
  try { return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { return null; }
}

export function repositoryFacts(dir) {
  const remote = git(dir, 'remote', 'get-url', 'origin');
  const top = git(dir, 'rev-parse', '--show-toplevel');
  return { remote, folder: basename(top ?? resolve(dir)) };
}

export function main(argv = process.argv.slice(2), { cwd = process.cwd(), today = new Date() } = {}) {
  let values;
  try { ({ values } = parseArgs({ args: argv, options: { project: { type: 'string' }, repo: { type: 'string' }, 'stale-days': { type: 'string' }, json: { type: 'boolean' } } })); }
  catch (error) { throw new InputError(error.message.split('\n')[0]); }
  let staleDays = 30;
  if (values['stale-days'] !== undefined) {
    if (!/^\d+$/.test(values['stale-days'])) throw new InputError('--stale-days takes a whole number of days');
    staleDays = Number(values['stale-days']);
  }
  const vaultPath = resolveVault().path;
  const facts = repositoryFacts(values.repo ? resolve(cwd, values.repo) : cwd);
  let chosen;
  if (values.project !== undefined) {
    try { validateProject(values.project); } catch (error) { throw new InputError(error.message); }
    const path = `wiki/authored/${values.project}`;
    try { if (!statSync(join(vaultPath, ...path.split('/'))).isDirectory()) throw new Error('not a directory'); }
    catch { throw new InputError(`no project folder ${path} in the vault`); }
    chosen = { project: values.project, path, by: 'flag' };
  } else {
    const { matches } = findProject(vaultPath, facts);
    if (matches.length !== 1) return { exit: 1, output: noMatch(matches, facts, values.json) };
    chosen = matches[0];
  }
  const statePath = join(vaultPath, ...chosen.path.split('/'), 'reference', 'studio-state.md');
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
