// The last step of every authoring task: regenerates the catalogs and refreshes the semantic index for the whole vault.
// It checks its prerequisites first and writes nothing unless all of them hold. Catalogs run before embedding because
// writing a catalog changes its modification time, and embedding reads those times.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { unknownOption, rejection, cliGuard } from './lib/cli-guard.mjs';
import { embed as ollamaEmbed } from './lib/embed.mjs';
import { refreshCatalogs } from './lib/catalogs.mjs';
import { refreshIndex, statusReport, progressPrinter } from './lib/embedding.mjs';
import { checkPrerequisites } from './lib/prerequisites.mjs';
cliGuard(import.meta.url);

const NAME = 'refresh-index';
const OPTIONS = ['rebuild', 'status'];
const dirOf = (vaultPath) => join(vaultPath, '.wiki-master');

function reportStatus(hooks, { out }) {
  try {
    // A vault that cannot be chosen or read is a thing to report here, never a failure.
    const { path } = hooks.vault ?? resolveVault(process.env, { onRefuse: () => {} });
    const r = statusReport({ vaultPath: path, dir: dirOf(path) });
    const state = r.damaged ? 'damaged' : r.files === 0 && r.filesChanged > 0 ? 'not built' : r.filesChanged || r.filesRemoved || r.missing ? 'stale' : 'current';
    const repair = r.damaged ? ` (${r.damaged}): run refresh-index.mjs --rebuild` : '';
    out(`${NAME} --status: ${state}${repair} -- ${r.files} file(s), ${r.chunks} chunk(s) (${r.embedded} embedded, ${r.missing} missing), ` +
      `${r.filesChanged} file(s) changed and ${r.filesRemoved} removed since the last refresh`);
  } catch (error) {
    out(`${NAME} --status: unavailable -- ${error.message}. If the index files are damaged, refresh-index.mjs --rebuild replaces them.`);
  }
  return 0;
}

function reportFailures(failures, { err }) {
  err(`${NAME}: not refreshed, and nothing was written. ${failures.length} prerequisite(s) failed:`);
  for (const { problem, fix } of failures) err(`  - ${problem} ${fix}`);
  err('Offer the user these fixes rather than applying them unasked, and report the task as written but not refreshed.');
}

function runCatalogs(vaultPath, { out, err }) {
  const { changed, unrecognized } = refreshCatalogs(vaultPath, { apply: true });
  if (unrecognized) err(`${unrecognized.length} backlog item(s) have a status outside the vocabulary and are listed under "Unrecognized status": ${unrecognized.join(', ')}`);
  out(`${NAME}: catalogs: ${changed.length} file(s) changed`);
}

async function runEmbedding(vaultPath, rebuild, hooks, { out, err }) {
  const { embedFn = (text) => ollamaEmbed(text), probes = {} } = hooks;
  const r = await refreshIndex({
    vaultPath, dir: dirOf(vaultPath), rebuild, embedFn, onProgress: progressPrinter(err),
    checkAvailable: probes.ollamaUp, checkModel: probes.modelPulled, model: probes.model,
  });
  out(`${NAME}: search index: ${r.persisted ? 'saved' : 'nothing to save'} -- ${r.filesChanged} file(s) changed, ` +
    `${r.chunksEmbedded} chunk(s) embedded, ${r.chunksPruned} pruned, ${r.chunksTotal} total, ${(r.elapsedMs / 1000).toFixed(1)}s`);
  if (!r.chunksFailed) return 0;
  err(`${NAME}: ${r.chunksFailed} chunk(s) failed to embed and are missing from the search index. Rerun refresh-index.mjs; the catalogs written stay.`);
  for (const fail of r.failures.slice(0, 5)) err(`  - ${fail.hash.slice(0, 12)} (${fail.chars} chars): ${fail.error}`);
  if (r.failures.length > 5) err(`  ... and ${r.failures.length - 5} more`);
  return 1;
}

// Returns the exit code. `hooks` replaces the real vault, probes, embedder and output, for tests.
export async function main(argv = process.argv.slice(2), hooks = {}) {
  const { out = console.log, err = console.error } = hooks;
  const io = { out, err };
  const unknown = unknownOption(argv, OPTIONS);
  if (unknown !== null) {
    err(rejection(NAME, OPTIONS, unknown));
    return 2;
  }
  if (argv.includes('--status')) return reportStatus(hooks, io);

  const vault = hooks.vault ?? resolveVault();
  const { failures, notes } = await checkPrerequisites({ vault, probes: hooks.probes });
  for (const note of notes) err(`${NAME}: ${note}`);
  if (failures.length) {
    reportFailures(failures, io);
    return 1;
  }

  try {
    runCatalogs(vault.path, io);
  } catch (error) {
    err(`${NAME}: the catalogs could not be refreshed: ${error.message}. Rerun refresh-index.mjs after fixing that.`);
    return 1;
  }
  try {
    return await runEmbedding(vault.path, argv.includes('--rebuild'), hooks, io);
  } catch (error) {
    const next = error.code === 'INDEX_CORRUPT' ? '' : ' Rerun refresh-index.mjs.';
    err(`${NAME}: the catalogs are written, but the search index is not: ${error.message}.${next}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = await main(); }
  catch (error) { console.error(`${NAME}: ${error.message}`); process.exitCode = 2; }
}
