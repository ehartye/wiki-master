// Whether op-commit should refresh the semantic index after an operation,
// and what to tell the user when it should not.
//
// op-commit is the single choke point every mutating operation passes
// through (ingest, relink, purge, a filed query), so one call here keeps the
// index current for all of them -- the alternative was a refresh line in each
// skill's markdown, which is four places to forget instead of one. The index
// lives under the vault's gitignored `.wiki-master/`, so a refresh riding
// along with a commit cannot pollute it.
//
// Kept free of I/O for the same reason search-health.mjs is: the decision has
// four outcomes and all four need testing without a live Ollama.
//
// Nothing here can fail a commit. The refresh runs AFTER the commit lands and
// every outcome below is advisory -- a degraded search is a smaller problem
// than an operation that reports failure over work that actually succeeded.
export function planAutoRefresh({ ollama = {}, indexPresent = false } = {}) {
  const skip = (reason, notice) => ({ run: false, reason, notice });

  // Checked BEFORE Ollama, unlike search-health.mjs's assessTiers. This one
  // is a local file check while the Ollama probes are network round-trips,
  // so a vault that has never built an index pays nothing on every commit.
  // It costs the user no clarity either: the remedy below is index-embed,
  // and refreshIndex preflights Ollama itself with its own message.
  //
  // Deliberately reported rather than performed. An incremental refresh is a
  // fraction of a second; a cold build is minutes (54s over 1,821 files, and
  // that is not the ceiling). Silently starting one would stall an operation
  // the user believed had finished, with nothing on screen to explain it.
  if (!indexPresent) {
    return skip('index-not-built',
      'no semantic index yet — a first build takes minutes, so it is not started automatically. Run `node scripts/index-embed.mjs` once to enable semantic search.');
  }
  if (!ollama.reachable) {
    return skip('ollama-not-running',
      'semantic index not refreshed — Ollama is not running. Search stays lexical until `ollama serve`, then `node scripts/index-embed.mjs`.');
  }
  // isAvailable() proves the server answers, not that the model was pulled;
  // without this check every embed in the refresh would 404 one at a time.
  // Same divergence, same reason, as search-health.mjs's assessTiers.
  if (!ollama.modelPresent) {
    return skip('model-not-pulled',
      `semantic index not refreshed — the "${ollama.model}" model is not pulled. Run \`ollama pull ${ollama.model}\`, then \`node scripts/index-embed.mjs\`.`);
  }
  return { run: true, reason: null, notice: null };
}
