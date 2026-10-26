import { basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CLI_SPECS } from './cli-specs.mjs';

// What a script does with an option it does not know. A mistyped option used to be ignored, so a script ran with
// the default the author did not mean, and `--help` was read as nothing (or, in a few scripts, as the thing to do).
// A script that adopts the guard calls `cliGuard(import.meta.url)` before any other work: `--help` or `-h` prints
// its usage and exits 0 having touched nothing, and an option it does not accept prints one line and exits 2.
// Only the command-line entry is checked, so a test or script that imports the module is unaffected.
//
// An option is a token that starts with `--`; `--name=value` and `--name value` both count as `name`. Everything
// after a bare `--` is not checked. Short options are not checked.

// The first token that is an option the spec does not list, or null.
export function unknownOption(argv, options) {
  const accepted = new Set(options);
  for (const token of argv) {
    if (token === '--') return null;
    if (!token.startsWith('--') || token === '--help') continue;
    const name = token.slice(2).split('=')[0];
    if (!accepted.has(name)) return token.split('=')[0];
  }
  return null;
}

export function rejection(name, options, token) {
  const accepted = options.length ? `accepted: ${options.map((o) => `--${o}`).join(', ')}` : 'it takes no options';
  return `${name}: unknown option ${token} (${accepted}; see --help)`;
}

export function cliGuard(moduleUrl, { argv = process.argv.slice(2), entry = process.argv[1], exit = (code) => process.exit(code), out = console.log, err = console.error } = {}) {
  if (!entry || moduleUrl !== pathToFileURL(entry).href) return;
  const name = basename(fileURLToPath(moduleUrl), '.mjs');
  const spec = CLI_SPECS[name];
  if (!spec) throw new Error(`cliGuard: no entry for ${name} in scripts/lib/cli-specs.mjs`);
  if (spec.usage && (argv.includes('--help') || argv.includes('-h'))) { out(spec.usage.join('\n')); exit(0); return; }
  const token = spec.options ? unknownOption(argv, spec.options) : null;
  if (token !== null) { err(rejection(name, spec.options, token)); exit(2); }
}
