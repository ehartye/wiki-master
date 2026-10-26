import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { helpRequested, exitWithHelp } from './lib/help.mjs';
import { TOOLS, OTHER, HINTS, CLIPPERS, NPM_PACKAGES } from './lib/doctor-table.mjs';
import { resolveTool } from './lib/pdf-figures.mjs';
import { extractionRuntime } from './lib/html-extract.mjs';
import { loadChromium, findBrowser } from './lib/render.mjs';
import { pickPython, PYTHON_CANDIDATES } from './clip-pptx.mjs';
import { findConfluencerScripts } from './clip-confluence.mjs';

// A read-only report of what each command of the plugin needs from this machine, and what it found. It starts each
// program once with its version flag (never the Obsidian CLI, which talks to the running app), imports no vault,
// resolves no vault and writes nothing. The table it reads is scripts/lib/doctor-table.mjs.

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const firstLine = (text) => String(text ?? '').split(/\r?\n/).map((l) => l.trim()).find(Boolean)?.slice(0, 100) ?? null;

function realRun(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'] });
  // ENOENT is the only answer that means "not there"; a nonzero version exit still means installed.
  return { ran: !(r.error && r.error.code === 'ENOENT') && !r.error, status: r.status, text: `${r.stdout ?? ''}\n${r.stderr ?? ''}` };
}

function realWhich(cmd, { env = process.env, exists = existsSync } = {}) {
  const exts = process.platform === 'win32' ? ['', ...(env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').map((e) => e.toLowerCase())] : [''];
  for (const dir of (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const full = join(dir, cmd + ext);
      if (exists(full)) return full;
    }
  }
  return null;
}

function realPackageVersions() {
  const require = createRequire(import.meta.url);
  const out = {};
  for (const name of NPM_PACKAGES) {
    try {
      let dir = dirname(require.resolve(name));
      for (let i = 0; i < 6; i++, dir = dirname(dir)) {
        const file = join(dir, 'package.json');
        if (!existsSync(file)) continue;
        const pkg = JSON.parse(readFileSync(file, 'utf8'));
        if (pkg.name === name) { out[name] = pkg.version; break; }
      }
    } catch { /* not resolvable from here: the runtime check reports it */ }
  }
  return out;
}

export function realDeps() {
  const run = realRun;
  return {
    run,
    which: (cmd) => realWhich(cmd),
    poppler: (name) => resolveTool(name),
    python: () => pickPython(PYTHON_CANDIDATES, (cmd, args) => run(cmd, args).status === 0),
    htmlRuntime: () => { try { extractionRuntime(); return { ok: true }; } catch (error) { return { ok: false, message: error.message }; } },
    playwright: async () => { try { await loadChromium(); return { ok: true }; } catch (error) { return { ok: false, message: error.message }; } },
    browser: () => findBrowser(),
    confluencer: () => findConfluencerScripts(),
    packageVersions: realPackageVersions,
    nodeVersion: process.version,
  };
}

// Probes every requirement once. Each result is { ok, path?, version?, detail?, hint? }.
export async function gather(deps = realDeps()) {
  const out = {};
  for (const [id, tool] of Object.entries(TOOLS)) {
    if (tool.args === null) {
      const path = deps.which(tool.command);
      out[id] = path ? { ok: true, path } : { ok: false, hint: tool.hint };
    } else if (tool.poppler) {
      const cmd = deps.poppler(id);
      if (!cmd) { out[id] = { ok: false, hint: tool.hint }; continue; }
      const r = deps.run(cmd, tool.args);
      out[id] = { ok: true, path: deps.which(cmd) ?? cmd, version: firstLine(r.text) };
    } else {
      const r = deps.run(tool.command, tool.args);
      out[id] = r.ran ? { ok: true, path: deps.which(tool.command), version: firstLine(r.text) } : { ok: false, hint: tool.hint };
    }
  }
  const py = deps.python();
  out.python = py.cmd ? { ok: true, path: deps.which(py.cmd) ?? py.cmd, detail: py.cmd } : { ok: false, hint: HINTS.python };
  out['python-pptx'] = py.pptx ? { ok: true, detail: `in ${py.cmd}` } : { ok: false, hint: HINTS['python-pptx'], ...(py.cmd ? { detail: `${py.cmd} has no python-pptx` } : {}) };
  const html = deps.htmlRuntime();
  const versions = deps.packageVersions();
  out['html-runtime'] = html.ok
    ? { ok: true, detail: NPM_PACKAGES.map((n) => `${n} ${versions[n] ?? '?'}`).join(', ') }
    : { ok: false, hint: HINTS['html-runtime'], detail: html.message };
  const pw = await deps.playwright();
  out['playwright-core'] = pw.ok ? { ok: true } : { ok: false, hint: HINTS['playwright-core'], detail: pw.message };
  const browser = deps.browser();
  out.browser = browser ? { ok: true, path: browser } : { ok: false, hint: HINTS.browser };
  const confluencer = deps.confluencer();
  out.confluencer = confluencer ? { ok: true, path: confluencer } : { ok: false, hint: HINTS.confluencer };
  return out;
}

// Which version this copy is and which one the host has installed. A session started before an update keeps
// advertising the old skill folder until a reload, so a copy that is not the installed one says so.
export function installInfo({ root = ROOT, claudeDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), exists = existsSync, readFile = (p) => readFileSync(p, 'utf8') } = {}) {
  let version = null;
  try { version = JSON.parse(readFile(join(root, 'package.json'))).version ?? null; } catch { /* no package.json */ }
  const development = exists(join(root, '.git'));
  let installed = null;
  try {
    const record = JSON.parse(readFile(join(claudeDir, 'plugins', 'installed_plugins.json'))).plugins ?? {};
    const key = Object.keys(record).find((k) => k.startsWith('wiki-master@'));
    const entry = key ? [].concat(record[key])[0] : null;
    if (entry) installed = { version: entry.version ?? null, installPath: entry.installPath ?? null };
  } catch { /* no host record */ }
  let note;
  if (!installed) note = 'no installed copy is recorded for this host (run from a checkout, or the host keeps no record)';
  else if (development) note = `running from a development checkout (version ${version}); the installed copy is ${installed.version}`;
  else if (version === installed.version) note = null;
  else note = `this copy is ${version} but the installed version is ${installed.version}: a session started earlier may still advertise the old skill folders; run /reload-plugins`;
  return { runFrom: { root, version, development }, installed, note };
}

// `names` is the commands the caller asked about. Naming none reports them all and never fails; naming some fails
// when a required entry of one of them is missing. An optional entry only widens what a command can do.
export function evaluate(results, names = []) {
  const unknown = names.filter((n) => !(n in CLIPPERS));
  if (unknown.length) return { exit: 2, clippers: [], unknown };
  const clippers = Object.entries(CLIPPERS).map(([name, spec]) => {
    const missing = spec.required.filter((id) => !results[id]?.ok);
    const optionalMissing = spec.optional.filter((id) => !results[id]?.ok);
    return { name, summary: spec.summary, requested: names.includes(name), ok: missing.length === 0, missing, optionalMissing };
  });
  const failed = clippers.some((c) => c.requested && !c.ok);
  return { exit: failed ? 1 : 0, clippers };
}

export function renderReport({ info, results, evaluation, nodeVersion }) {
  const lines = ['wiki-master doctor (read-only)', ''];
  lines.push(`this copy: ${info.runFrom.version ?? 'unknown version'} at ${info.runFrom.root}`);
  lines.push(`installed: ${info.installed ? `${info.installed.version}${info.installed.installPath ? ` at ${info.installed.installPath}` : ''}` : 'no record'}`);
  if (info.note) lines.push(`note: ${info.note}`);
  lines.push(`node ${nodeVersion.replace(/^v/, '')} (needed to run every script)`, '');
  const describe = (id) => {
    const r = results[id];
    const label = id in TOOLS ? id : id;
    if (r.ok) return `  ok       ${label}${r.path ? `  ${r.path}` : ''}${r.version ? `  (${r.version})` : ''}${r.detail ? `  ${r.detail}` : ''}`;
    return `  MISSING  ${label}${r.detail ? `: ${r.detail}` : ''}${r.hint ? `\n           fix: ${r.hint}` : ''}`;
  };
  for (const c of evaluation.clippers) {
    lines.push(`${c.name}: ${c.summary}${c.requested ? ' [asked about]' : ''} - ${c.ok ? 'ready' : `NOT READY (missing ${c.missing.join(', ')})`}${c.optionalMissing.length ? `; optional missing: ${c.optionalMissing.join(', ')}` : ''}`);
    const spec = CLIPPERS[c.name];
    for (const id of spec.required) lines.push(describe(id));
    for (const id of spec.optional) lines.push(`${describe(id)}${results[id].ok ? '' : '   (optional)'}`);
  }
  return lines.join('\n');
}

const USAGE = [
  'usage: node scripts/doctor.mjs [command ...] [--json]',
  '',
  'Reports, for each command of the plugin, the programs and packages it needs from this machine, the path and',
  'version found, and how to fix what is missing. It starts each program once with its version flag, never the',
  'Obsidian CLI, and it writes nothing and uses no vault.',
  'Name commands to ask about them (' + Object.keys(CLIPPERS).join(', ') + '): the exit status is 1 when a',
  'required entry of one of them is missing. With no names it reports everything and exits 0.',
  '--json prints one object: this copy and the installed version, every requirement, every command, and the exit code.',
].join('\n');

export async function main(argv = process.argv.slice(2), deps = realDeps()) {
  const names = argv.filter((a) => !a.startsWith('-'));
  const flags = argv.filter((a) => a.startsWith('-'));
  const bad = flags.filter((f) => f !== '--json');
  if (bad.length) return { exit: 2, error: `doctor: unknown option ${bad[0]} (see --help)` };
  const results = await gather(deps);
  const evaluation = evaluate(results, names);
  if (evaluation.unknown) return { exit: evaluation.exit, error: `doctor: unknown command ${evaluation.unknown.join(', ')}; the commands are ${Object.keys(CLIPPERS).join(', ')}` };
  const info = installInfo();
  if (flags.includes('--json')) {
    return { exit: evaluation.exit, output: JSON.stringify({ thisCopy: info.runFrom, installed: info.installed, note: info.note, node: deps.nodeVersion, requirements: results, commands: evaluation.clippers, exit: evaluation.exit }, null, 2) };
  }
  return { exit: evaluation.exit, output: renderReport({ info, results, evaluation, nodeVersion: deps.nodeVersion }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (helpRequested()) exitWithHelp(USAGE);
  else {
    const out = await main();
    if (out.error) console.error(out.error);
    else console.log(out.output);
    process.exitCode = out.exit;
  }
}
