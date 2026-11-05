// A thin command over lib/embedding.mjs, kept until a later change removes it.
//
//   node scripts/index-embed.mjs            # refresh: only changed files
//   node scripts/index-embed.mjs --rebuild  # re-chunk everything (vectors
//                                            #   for unchanged chunk CONTENT
//                                            #   are still reused -- only
//                                            #   the mtime/size shortcut is
//                                            #   discarded, not the cache)
//   node scripts/index-embed.mjs --status   # report coverage, embed nothing
//   node scripts/index-embed.mjs --concurrency=8

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { helpRequested, exitWithHelp } from './lib/help.mjs';
import { embed as ollamaEmbed } from './lib/embed.mjs';
import { refreshIndex, statusReport, progressPrinter } from './lib/embedding.mjs';
import { cliGuard } from './lib/cli-guard.mjs';
cliGuard(import.meta.url);

export { walkVault, readManifestFile, readVectorStore, persistIndex, statusReport, refreshIndex } from './lib/embedding.mjs';

function parseArgs(argv) {
  const rebuild = argv.includes('--rebuild');
  const status = argv.includes('--status');
  const concArg = argv.find((a) => a.startsWith('--concurrency='));
  const concurrency = concArg ? parseInt(concArg.split('=')[1], 10) : 4;
  return { rebuild, status, concurrency };
}

export async function main(argv = process.argv.slice(2)) {
  const { rebuild, status, concurrency } = parseArgs(argv);
  const { path: vaultPath } = resolveVault();
  const dir = join(vaultPath, '.wiki-master');

  if (status) {
    const r = statusReport({ vaultPath, dir });
    console.log(
      `index-embed --status: ${r.files} file(s), ${r.chunks} chunk(s) ` +
      `(${r.embedded} embedded, ${r.missing} missing) -- ` +
      `${r.filesChanged} file(s) changed, ${r.filesRemoved} removed since last refresh`
    );
    return r;
  }

  try {
    const r = await refreshIndex({ vaultPath, dir, rebuild, embedFn: (text) => ollamaEmbed(text), concurrency, onProgress: progressPrinter(console.error) });
    console.error(
      `index-embed: done in ${(r.elapsedMs / 1000).toFixed(1)}s -- ` +
      `${r.filesChanged} file(s) changed, ${r.chunksEmbedded} chunk(s) embedded, ` +
      `${r.chunksPruned} pruned, ${r.chunksTotal} total chunk(s) indexed`
    );
    // A partial build is a real outcome, not a footnote: the index persisted and
    // is usable, but it is INCOMPLETE, and saying so is the whole point of
    // tolerating the failure in the first place. Non-zero exit so a scripted
    // caller cannot read a partial build as a clean one.
    if (r.chunksFailed) {
      console.error(`index-embed: ${r.chunksFailed} chunk(s) FAILED to embed and are missing from the index:`);
      for (const fail of r.failures.slice(0, 5)) {
        console.error(`  - ${fail.hash.slice(0, 12)} (${fail.chars} chars): ${fail.error}`);
      }
      if (r.failures.length > 5) console.error(`  ... and ${r.failures.length - 5} more`);
      console.error('  they will be retried automatically on the next run.');
      process.exitCode = 1;
    }
    return r;
  } catch (err) {
    console.error(`index-embed: ${err.message}`);
    process.exitCode = 1;
    return null;
  }
}

const USAGE = [
  'usage: node scripts/index-embed.mjs [--rebuild] [--status] [--concurrency=<n>]',
  '',
  'Refreshes the semantic search index from the files that changed since its last run.',
  '  --rebuild          discard the index and embed every page again',
  '  --status           report the index state and exit without changing it',
  '  --concurrency=<n>  embedding requests in flight (default 4)',
  'The vault is the one named by WIKI_MASTER_VAULT (default: ~/.wiki-master-vault).',
].join('\n');

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (helpRequested()) exitWithHelp(USAGE);
  else main();
}
