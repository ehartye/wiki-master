import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { helpRequested, exitWithHelp } from './lib/help.mjs';
import { planBump, applyBump } from './lib/version-fields.mjs';

// Bumps the release version everywhere it is written (the nine fields of VERSION_FIELDS in seven manifests) and
// puts the matching heading at the top of CHANGELOG.md, so no file is forgotten and the heading and the fields
// never disagree. Dry run unless --apply.

const USAGE = [
  'usage: node scripts/bump-version.mjs <x.y.z> [--apply] [--date YYYY-MM-DD] [--changelog-entry <file>] [--root <dir>]',
  '',
  'Sets every version field listed in scripts/lib/version-fields.mjs to <x.y.z> and adds "## x.y.z - date" at the top',
  'of CHANGELOG.md (unless a heading for that version is already there). Files are edited as text, so their line',
  'endings and formatting stay; the result is parsed to prove that only the listed fields changed.',
  '  --apply                    write the files (default: show what would change)',
  '  --date YYYY-MM-DD          the heading date (default: today)',
  '  --changelog-entry <file>   the entry body to put under the heading (bullets); without it the heading is added',
  '                             empty and the drift test stays red until the entry is written',
  '  --root <dir>               the repository to change (default: the current directory)',
  'Refuses, and writes nothing, when the version fields already disagree, the new version is not greater, or a',
  'file holds another entry with the same version number.',
].join('\n');

const today = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export function main(argv = process.argv.slice(2)) {
  const option = (name) => {
    const at = argv.indexOf(name);
    if (at < 0) return undefined;
    const v = argv[at + 1];
    if (!v || v.startsWith('--')) throw new Error(`${name} needs a value`);
    return v;
  };
  try {
    const flagsWithValue = new Set(['--date', '--changelog-entry', '--root']);
    const positional = argv.filter((a, i) => !a.startsWith('--') && !flagsWithValue.has(argv[i - 1]));
    const unknown = argv.filter((a) => a.startsWith('--') && !['--apply', ...flagsWithValue].includes(a));
    if (unknown.length) throw new Error(`unknown option ${unknown.join(' ')}`);
    if (positional.length !== 1) throw new Error('give exactly one version, like 0.70.0');
    const to = positional[0];
    const date = option('--date') ?? today();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`--date must look like YYYY-MM-DD, not "${date}"`);
    const entryFile = option('--changelog-entry');
    const entry = entryFile ? readFileSync(entryFile, 'utf8') : undefined;
    const root = option('--root') ?? process.cwd();
    const plan = planBump(root, to, { date, entry });
    const apply = argv.includes('--apply');
    console.log(`${apply ? 'bumping' : 'would bump'} ${plan.from} -> ${plan.to}`);
    for (const w of plan.writes) console.log(`  ${w.file}: ${w.fields} field(s)`);
    console.log(`  CHANGELOG.md: ${plan.changelog.changed ? plan.changelog.state : 'a heading for this version is already there'}`);
    if (apply) {
      applyBump(root, plan);
      console.log('done');
      if (plan.changelog.changed && !entry) console.log('Write the changelog entry under the new heading; the drift test is red until it has a bullet.');
    } else {
      console.log('dry run: re-run with --apply to write these changes');
    }
  } catch (error) {
    console.error(`bump-version: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (helpRequested()) exitWithHelp(USAGE);
  else main();
}
