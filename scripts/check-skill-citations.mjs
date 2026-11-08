// Report `wiki-master:<name>` citations that name no current skill of this plugin, in the directories given.
// A skill rename leaves other plugins citing the old name, and nothing fails: the citation just stops working.
// The current names are this plugin's skills/ folders; a replacement comes from docs/skill-migration.md when its
// table maps the old name to exactly one current skill. Reads only; writes nothing.
//
//   node scripts/check-skill-citations.mjs <dir>... [--include-history]
//
// Exit 0: no stale citation. Exit 1: at least one. Exit 2: no directory, or one that is not a directory.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cliGuard } from './lib/cli-guard.mjs';
import { CLI_SPECS } from './lib/cli-specs.mjs';
cliGuard(import.meta.url);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.git']);
const HISTORY = 'docs/superpowers/';
const CITATION = /(?<![A-Za-z0-9_-])wiki-master:([a-z][a-z0-9-]*[a-z0-9])/g;

export function currentSkills(root = ROOT) {
  const dir = join(root, 'skills');
  return new Set(readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(join(dir, e.name, 'SKILL.md'))).map((e) => e.name));
}

// Old name -> current name, from every table row whose first cell is a single skill name.
export function replacements(current, text) {
  const seen = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 2) continue;
    const old = /^`?([a-z][a-z0-9-]*)`?$/.exec(cells[0])?.[1];
    const next = /wiki-[a-z0-9-]+/.exec(cells[1])?.[0];
    if (!old || !next || current.has(old) || !current.has(next)) continue;
    if (!seen.has(old)) seen.set(old, new Set());
    seen.get(old).add(next);
  }
  return new Map([...seen].filter(([, s]) => s.size === 1).map(([k, s]) => [k, [...s][0]]));
}

function* files(dir, base, includeHistory) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      const rel = `${relative(base, p).split(sep).join('/')}/`;
      if (!includeHistory && (rel.startsWith(HISTORY) || rel.includes(`/${HISTORY}`))) continue;
      yield* files(p, base, includeHistory);
    } else if (e.isFile() && /\.(md|json)$/i.test(e.name)) yield p;
  }
}

export function scan(dirs, { includeHistory = false, root = ROOT } = {}) {
  const current = currentSkills(root);
  const migration = join(root, 'docs', 'skill-migration.md');
  const map = replacements(current, existsSync(migration) ? readFileSync(migration, 'utf8') : '');
  const findings = [];
  let scanned = 0;
  for (const dir of dirs) {
    for (const file of files(dir, dir, includeHistory)) {
      scanned++;
      readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
        for (const m of line.matchAll(CITATION)) {
          if (current.has(m[1])) continue;
          findings.push({ file, line: i + 1, name: m[1], replacement: map.get(m[1]) ?? null });
        }
      });
    }
  }
  return { findings, scanned };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const includeHistory = args.includes('--include-history');
  const dirs = args.filter((a) => !a.startsWith('--'));
  const usage = () => console.error(CLI_SPECS['check-skill-citations'].usage[0]);
  if (!dirs.length) { usage(); process.exit(2); }
  const bad = dirs.find((d) => !existsSync(d) || !statSync(d).isDirectory());
  if (bad) { console.error(`check-skill-citations: ${bad} is not a directory`); usage(); process.exit(2); }
  const { findings, scanned } = scan(dirs, { includeHistory });
  for (const f of findings) console.log(`${f.file}:${f.line}: wiki-master:${f.name} is not a current skill${f.replacement ? `; use wiki-master:${f.replacement}` : ''}`);
  console.log(`${findings.length} stale citation${findings.length === 1 ? '' : 's'} in ${scanned} file${scanned === 1 ? '' : 's'}${includeHistory ? '' : ` (${HISTORY} skipped; --include-history reads it)`}`);
  process.exit(findings.length ? 1 : 0);
}
