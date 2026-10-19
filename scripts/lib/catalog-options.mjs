import { parseArgs } from 'node:util';

// A project maps to a vault-relative directory (including nested project tiers).
export function validateProject(project) {
  if (project === undefined) return;
  if (typeof project !== 'string' || !project || project.includes('\\') || project.includes(':') ||
      project.includes('\0') || project.split('/').some(p => !p || p === '.' || p === '..' || p.startsWith('.'))) {
    throw new Error('project must be a nonempty vault-relative project slug');
  }
}

export function catalogArgs(argv) {
  const { values } = parseArgs({ args: argv, options: {
    apply: { type: 'boolean' }, project: { type: 'string' }, 'paths-file': { type: 'string' },
  } });
  validateProject(values.project);
  return { apply: values.apply ?? false, project: values.project, pathsFile: values['paths-file'] };
}
