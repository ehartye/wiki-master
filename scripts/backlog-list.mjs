import { statSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { readBacklogItems } from './lib/backlog-read.mjs';
import { analyzeBacklog } from './lib/backlog-deps.mjs';
import { BACKLOG_STATUS_ORDER, projectKey } from './lib/authored-group.mjs';
import { cliGuard } from './lib/cli-guard.mjs';
cliGuard(import.meta.url);

// Lists backlog items by their lifecycle (`backlog-status`), which is not the page `status`
// (draft or maintained) that a plain search for `status:` finds. Read-only, scoped to
// wiki/authored/, and it does not build the whole-vault graph.
//
//   node backlog-list.mjs [--project <name>] [--backlog-status <a,b,...>] [--startable] [--json]
//
// --backlog-status takes the five lifecycle words and the pseudo-status `unrecognized` (an item
// whose status is outside that vocabulary, or missing: the items a generated roadmap lists under
// "Unrecognized status"). --startable keeps planned items with no unmet prerequisite, whether or
// not they declare any. Exit 0 (also when nothing matches), 2 for bad input.

export class InputError extends Error {}

const UNRECOGNIZED = 'unrecognized';
const AUTHORED = 'wiki/authored';
const slug = (path) => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');

export function listBacklog(vaultPath, { project, backlogStatus, startable = false } = {}) {
  try { if (!statSync(vaultPath).isDirectory()) throw new Error('not a directory'); }
  catch { throw new InputError(`vault not found: ${vaultPath}`); }
  const wanted = backlogStatus?.length ? new Set(backlogStatus) : null;
  const items = readBacklogItems(vaultPath, AUTHORED);

  // Prerequisites resolve inside one project, so each project is analyzed on its own.
  const byProject = new Map();
  for (const it of items) {
    const home = it.project ?? (it.path.includes('/backlog/') ? it.path.slice(AUTHORED.length + 1, it.path.indexOf('/backlog/')) : '');
    it.home = home;
    const key = projectKey(home) ?? '';
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key).push(it);
  }
  const analyses = new Map([...byProject].map(([key, group]) => [key, analyzeBacklog(group)]));

  const rank = (s) => { const i = BACKLOG_STATUS_ORDER.indexOf(s); return i < 0 ? BACKLOG_STATUS_ORDER.length : i; };
  const wantedProject = project === undefined ? null : projectKey(project);
  const rows = [];
  for (const it of items) {
    const key = projectKey(it.home) ?? '';
    if (wantedProject !== null && key !== wantedProject) continue;
    const known = BACKLOG_STATUS_ORDER.includes(it.backlogStatus);
    if (wanted && !wanted.has(known ? it.backlogStatus : UNRECOGNIZED)) continue;
    const a = analyses.get(key).byPath.get(it.path);
    const row = {
      project: it.home, backlogStatus: it.backlogStatus, path: it.path, title: it.title,
      dependsOn: a.deps.map((d) => d.target),
      unmet: [...a.unmet.map((d) => d.path ?? d.target), ...a.malformed],
      startable: it.backlogStatus === 'planned' && a.unmet.length === 0 && a.malformed.length === 0,
    };
    if (startable && !row.startable) continue;
    rows.push(row);
  }
  return rows.sort((a, b) => {
    const pa = projectKey(a.project) ?? '', pb = projectKey(b.project) ?? '';
    return pa < pb ? -1 : pa > pb ? 1 : rank(a.backlogStatus) - rank(b.backlogStatus) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  });
}

function parseStatuses(value) {
  const words = value.split(',').map((s) => s.trim()).filter(Boolean);
  const allowed = [...BACKLOG_STATUS_ORDER, UNRECOGNIZED];
  const bad = words.filter((w) => !allowed.includes(w));
  if (bad.length || !words.length) throw new InputError(`--backlog-status takes ${BACKLOG_STATUS_ORDER.join(', ')} or ${UNRECOGNIZED}, comma separated${bad.length ? `; not understood: ${bad.join(', ')}` : ''}`);
  return words;
}

export function main(argv = process.argv.slice(2), out = (line) => console.log(line)) {
  try {
    const { values } = parseArgs({ args: argv, options: {
      project: { type: 'string' }, 'backlog-status': { type: 'string' }, startable: { type: 'boolean' }, json: { type: 'boolean' },
    } });
    const rows = listBacklog(resolveVault().path, {
      project: values.project,
      backlogStatus: values['backlog-status'] === undefined ? undefined : parseStatuses(values['backlog-status']),
      startable: values.startable ?? false,
    });
    if (values.json) out(JSON.stringify(rows, null, 2));
    else for (const r of rows) {
      const waiting = r.unmet.length ? `waiting on ${r.unmet.map(slug).join(', ')}` : '';
      out([r.project, r.backlogStatus ?? 'none', r.path, r.title.replace(/\t/g, ' '), waiting].join('\t'));
    }
    return 0;
  } catch (error) {
    console.error(`backlog-list: ${error.message}`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main();
