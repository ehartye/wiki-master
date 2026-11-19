import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { cliGuard } from './lib/cli-guard.mjs';
import { resolveContext } from './lib/context.mjs';

cliGuard(import.meta.url);

export function main(argv = process.argv.slice(2), { env = process.env, cwd = process.cwd() } = {}) {
  const { values } = parseArgs({ args: argv, options: { purpose: { type: 'string' }, repo: { type: 'string' }, select: { type: 'string' }, json: { type: 'boolean' } } });
  const context = resolveContext(env, { purpose: values.purpose, repo: values.repo, select: values.select, cwd });
  if (values.json) return JSON.stringify(context, null, 2);
  const target = v => `${v.id}: ${v.path} (selector: ${v.selector}; ${v.available ? 'available' : 'unavailable'})`;
  return [`Purpose: ${context.purpose}`, `Registry: ${context.configPath ?? 'legacy default'}`, `Project configuration: ${context.projectConfigPath ?? 'none'}${context.inheritedProjectConfig ? ' (inherited)' : ''}`, `Project: ${context.project ?? 'unbound'}`, `Documentation: ${target(context.documentation)}`, ...(context.documentation.projectPath ? [`Project folder: ${context.documentation.projectPath}`] : []), 'Research:', ...context.research.map(v => `  ${target(v)}`), `Selected: ${context.selected?.id ?? 'selection required'}`, ...context.diagnostics].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(main()); }
  catch (error) { console.error(error.message); process.exitCode = error.exitCode ?? 2; }
}
