import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { helpRequested, exitWithHelp } from './lib/help.mjs';
import { parseTerms, scanRepo, BUILTIN_RULES } from './lib/private-terms.mjs';

const USAGE = [
  'usage: node scripts/scan-private-terms.mjs [--root <dir>] [--terms-file <path>] [--known <path>] [--json]',
  '',
  'Scans the tracked and untracked (not ignored) text files of a git repository for names that belong in the wiki,',
  'not in a public repository: the owner\'s private terms (from the terms file) and built-in patterns for home',
  'directories, GPU models and invisible characters. Reports path, line and rule number, never the matched text.',
  '  --root <dir>        the repository to scan (default: the current directory)',
  '  --terms-file <path> one term per line (case-insensitive substring) or a /pattern/flags regular expression;',
  '                      default: WIKI_MASTER_PRIVATE_TERMS_FILE, then PRIVATE_TERMS_FILE; none means built-ins only',
  '  --known <path>      files whose hits are still to be sanitised, one path or directory prefix per line (# comments):',
  '                      their hits are counted but do not fail the scan, and an entry with no hit left does',
  '  --json              machine-readable output',
  'Exit 0: no hits. Exit 1: hits. Exit 2: unusable terms file or repository.',
].join('\n');

function option(argv, name) {
  const at = argv.indexOf(name);
  if (at < 0) return undefined;
  const v = argv[at + 1];
  if (!v || v.startsWith('--')) throw new Error(`${name} needs a value`);
  return v;
}

export function main(argv = process.argv.slice(2), env = process.env) {
  let root, termsFile, rules, knownFile, known = [];
  try {
    root = option(argv, '--root') ?? process.cwd();
    termsFile = option(argv, '--terms-file') ?? env.WIKI_MASTER_PRIVATE_TERMS_FILE ?? env.PRIVATE_TERMS_FILE;
    knownFile = option(argv, '--known');
    if (knownFile) {
      try { known = readFileSync(knownFile, 'utf8').split(String.fromCharCode(10)).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')); } catch { throw new Error('the known-files list cannot be read'); }
    }
    rules = [...BUILTIN_RULES];
    if (termsFile) {
      let text;
      try { text = readFileSync(termsFile, 'utf8'); } catch { throw new Error('the terms file cannot be read'); }
      rules.push(...parseTerms(text));
    }
  } catch (err) {
    console.error(`scan-private-terms: ${err.message}`);
    process.exitCode = 2;
    return;
  }
  let result;
  try { result = scanRepo(root, rules); } catch (err) {
    console.error('scan-private-terms: the repository cannot be listed (is it a git repository?)');
    process.exitCode = 2;
    return;
  }
  const covered = (file) => known.some((k) => file === k || (k.endsWith('/') && file.startsWith(k)));
  const hits = result.hits.filter((h) => !covered(h.file));
  const knownHits = result.hits.filter((h) => covered(h.file));
  const files = result.files;
  const stale = known.filter((k) => !result.hits.some((h) => h.file === k || (k.endsWith('/') && h.file.startsWith(k))));
  const count = hits.length;
  const byFile = new Set(hits.map((h) => h.file)).size;
  const knownSummary = { count: knownHits.length, files: new Set(knownHits.map((h) => h.file)).size };
  if (argv.includes('--json')) console.log(JSON.stringify({ count, files, hits, ...(knownFile ? { known: knownSummary, stale } : {}) }, null, 2));
  else {
    for (const h of hits) console.log(`${h.file}:${h.line} ${h.rule}`);
    for (const s of stale) console.log(`stale known entry: ${s} (no hit left; remove it from the list)`);
    console.log(`${count} hit(s) in ${byFile} file(s); ${files} file(s) scanned${termsFile ? '' : ' with the built-in patterns only (no terms file named)'}`);
    if (knownFile) console.log(`${knownSummary.count} known hit(s) in ${knownSummary.files} file(s) still to sanitise`);
  }
  if (count || stale.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (helpRequested()) exitWithHelp(USAGE);
  else main();
}
