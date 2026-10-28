import { parseArgs } from 'node:util';

// A project maps to a vault-relative directory (including nested project tiers).
export function validateProject(project) {
  if (project === undefined) return;
  if (typeof project !== 'string' || !project || project.includes('\\') || project.includes(':') ||
      project.includes('\0') || project.split('/').some(p => !p || p === '.' || p === '..' || p.startsWith('.'))) {
    throw new Error('project must be a nonempty vault-relative project slug');
  }
}

// `since` is opt-in: only refresh-catalogs records what it wrote in an operation's ledger. The two generators it batches
// reject --since like any option they do not know, instead of accepting it and recording nothing.
export function catalogArgs(argv, { since = false } = {}) {
  const { values } = parseArgs({ args: argv, options: {
    apply: { type: 'boolean' }, project: { type: 'string' }, 'paths-file': { type: 'string' }, diff: { type: 'boolean' },
    ...(since ? { since: { type: 'string' } } : {}),
  } });
  validateProject(values.project);
  return { apply: values.apply ?? false, project: values.project, pathsFile: values['paths-file'], diff: values.diff ?? false, since: values.since };
}
