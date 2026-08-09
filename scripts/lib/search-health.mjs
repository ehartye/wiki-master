// Which search tier will actually answer, and what each missing tier costs.
//
// This exists because the failure mode of wiki-master's search is *silence*:
// every tier degrades to a working answer, so a query returns plausible results
// whether it ran the strongest tier or the weakest. The user cannot tell, and
// neither can an agent. Kept free of I/O so the ladder can be tested against
// every combination without a live qmd, Ollama, or Obsidian.

// Mirrors search.mjs's `search()` exactly. Any change there changes this.
//   qmd (if installed AND its collection exists) -> hybrid (keyword + semantic,
//   if Ollama reachable AND the model is pulled) -> keyword
export function assessTiers({ qmd = {}, ollama = {} } = {}) {
  const gaps = [];

  // --- semantic -----------------------------------------------------------
  let semantic = false;
  if (!ollama.reachable) {
    gaps.push({
      tier: 'ollama',
      state: 'not running',
      buys: 'semantic ranking fused with keyword results',
      fix: 'ollama serve',
    });
  } else if (!ollama.modelPresent) {
    // The only case where the tier LABEL is false rather than merely weak.
    // isAvailable() checks that the server answers, not that the model exists,
    // so search() reports `hybrid`, every embed call 404s, semanticSearch skips
    // each page in turn, and the caller gets keyword results labelled hybrid.
    gaps.push({
      tier: 'ollama',
      state: `model "${ollama.model}" not pulled`,
      buys: 'semantic ranking — search currently CLAIMS hybrid but semantic contributes nothing',
      fix: `ollama pull ${ollama.model}`,
      misreports: true,
    });
  } else {
    semantic = true;
  }

  // --- qmd ----------------------------------------------------------------
  let qmdUsable = false;
  if (!qmd.installed) {
    gaps.push({
      tier: 'qmd',
      state: 'not installed',
      buys: 'the strongest tier — hybrid BM25 + vector over the whole wiki',
      fix: 'npm i -g @tobilu/qmd   (needs Node >=22)',
    });
  } else if (!qmd.collectionExists) {
    // qmdProbe() only runs `qmd --version`, so an installed-but-unconfigured qmd
    // is tried first, returns nothing, and falls through — costing a subprocess
    // on every query while contributing nothing.
    gaps.push({
      tier: 'qmd',
      state: 'installed, but no wiki-master collection',
      buys: 'the strongest tier — currently probed on every query and always empty',
      fix: 'node search.mjs --setup',
    });
  } else {
    qmdUsable = true;
    // Unlike the Ollama cache — which is content-hash keyed and therefore can
    // only ever be slow, never wrong — a qmd collection is a real index. It
    // goes stale silently and will serve outdated hits or miss new pages.
    if (qmd.staleCount > 0) {
      gaps.push({
        tier: 'qmd',
        state: `${qmd.staleCount} file(s) changed since the last embed`,
        buys: 'accurate top-tier results — stale entries serve outdated text and new pages are invisible',
        fix: 'qmd embed',
        misreports: true,
      });
    }
  }

  const tier = qmdUsable ? 'qmd' : semantic ? 'hybrid' : 'keyword';
  return { tier, gaps, semantic, qmdUsable };
}

// Coverage of the Ollama embedding cache. Takes precomputed hashes so it stays
// pure. `orphaned` are vectors whose page no longer has that content — an edit
// or deletion — which the cache never evicts, so it grows without bound.
export function embeddingCoverage(pageHashes, cacheKeys) {
  const cached = new Set(cacheKeys);
  const live = new Set(pageHashes);
  const missing = pageHashes.filter((h) => !cached.has(h));
  let orphaned = 0;
  for (const k of cached) if (!live.has(k)) orphaned += 1;
  return {
    total: pageHashes.length,
    cached: pageHashes.length - missing.length,
    uncached: missing.length,
    orphaned,
  };
}

// The full capability block is worth reading once; on every subsequent query it
// becomes noise, and noise is how a warning stops being read. A one-line
// reminder still fires each time (see search.mjs) — this only gates the block.
export const NOTICE_WINDOW_HOURS = 4;

export function shouldAnnounceFull(lastNoticeIso, now, windowHours = NOTICE_WINDOW_HOURS) {
  if (!lastNoticeIso) return true;
  const then = Date.parse(lastNoticeIso);
  if (Number.isNaN(then)) return true;
  return now - then >= windowHours * 3600_000;
}

// One line, always printed, naming the tier and — when degraded — what is off.
// Never silent: a caller that reads only this line still learns the answer was
// not the best available.
export function statusLine({ tier, gaps }) {
  if (!gaps.length) return `(${tier} — all tiers available)`;
  const off = gaps.map((g) => g.tier);
  const unique = [...new Set(off)];
  return `(${tier} — ${unique.join(' and ')} degraded · run search.mjs --health)`;
}
