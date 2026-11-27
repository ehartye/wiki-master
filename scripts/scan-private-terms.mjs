import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { helpRequested, exitWithHelp } from './lib/help.mjs';
import { parseTerms, scanRepo, builtinRules, readAllow, ALLOW_FILE, ListingError, WALK_SKIP } from './lib/private-terms.mjs';
import { cliGuard } from './lib/cli-guard.mjs';
import { CLI_SPECS } from './lib/cli-specs.mjs';
cliGuard(import.meta.url);

// The guard answers --help from cli-specs.mjs before this script runs, so the usage text lives there alone.
const USAGE = CLI_SPECS['scan-private-terms'].usage.join('\n');

function option(argv, name) {
  const at = argv.indexOf(name);
  if (at < 0) return undefined;
  const v = argv[at + 1];
  if (!v || v.startsWith('--')) throw new Error(`${name} needs a value`);
  return v;
}

export function main(argv = process.argv.slice(2), env = process.env) {
  let root, termsFile, rules, knownFile, known = [], allow;
  try {
    root = option(argv, '--root') ?? process.cwd();
    termsFile = option(argv, '--terms-file') ?? env.WIKI_MASTER_PRIVATE_TERMS_FILE ?? env.PRIVATE_TERMS_FILE;
    knownFile = option(argv, '--known');
    if (knownFile) {
      try { known = readFileSync(knownFile, 'utf8').split(String.fromCharCode(10)).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')); } catch { throw new Error('the known-files list cannot be read'); }
    }
    allow = readAllow(root); // a root that does not exist has no allow file; the listing says what is wrong with it
    rules = builtinRules(allow);
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
    console.error(`scan-private-terms: ${err instanceof ListingError ? err.message : `the root cannot be scanned: ${err.message}`}`);
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
  const walked = result.walked ? { listing: 'folder walk' } : {}; // a git listing's output is unchanged
  const used = rules.find((r) => r.id === 'home-path-relative').used;
  const unused = allow.filter((a) => !used.has(a.entry));
  const allowSummary = allow.length ? { allow: { entries: allow.length, unused: unused.map((a) => a.entry) } } : {}; // none without an allow file
  if (argv.includes('--json')) console.log(JSON.stringify({ count, files, hits, ...walked, ...(knownFile ? { known: knownSummary, stale } : {}), ...allowSummary }, null, 2));
  else {
    if (result.walked) console.log(`folder walk: no git listing was available (${result.walked}), so the folder was walked, skipping ${WALK_SKIP.join(', ')}, binary files and links that leave it`);
    for (const h of hits) console.log(`${h.file}:${h.line} ${h.rule}`);
    for (const s of stale) console.log(`stale known entry: ${s} (no hit left; remove it from the list)`);
    for (const a of unused) console.log(`unused allow entry: ${ALLOW_FILE}:${a.line} ${a.entry} (no text starts with it; remove it from the file)`);
    console.log(`${count} hit(s) in ${byFile} file(s); ${files} file(s) scanned${termsFile ? '' : ' with the built-in patterns only (no terms file named)'}`);
    if (knownFile) console.log(`${knownSummary.count} known hit(s) in ${knownSummary.files} file(s) still to sanitise`);
  }
  if (count || stale.length || unused.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (helpRequested()) exitWithHelp(USAGE);
  else main();
}
