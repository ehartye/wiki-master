// Which search tier will actually answer, and what each missing channel
// costs. This exists because the failure mode of wiki-master's search is
// *silence*: every tier degrades to a working answer, so a query returns
// plausible results whether it ran the strongest tier or the weakest. The
// user cannot tell, and neither can an agent. Kept free of I/O so the ladder
// can be tested against every combination without a live Ollama, index, or
// Obsidian.
//
// qmd was measured, rejected and uninstalled (design spec section 4) -- it
// was BM25-only despite the tier name, sat above the actually-hybrid tier in
// the ladder, and retrieved worse than the truncated page-level path it was
// meant to replace. The remaining channels are Obsidian keyword and the
// Ollama-backed chunk-semantic index.
//
// Mirrors scripts/search.mjs's `search()` ladder: Ollama reachable AND the
// chunk index built -> hybrid (keyword + chunk-semantic, RRF-fused);
// anything else -> lexical (Obsidian keyword alone). Any change to that
// ladder changes this. The one deliberate divergence: `search()`'s own
// `ollamaAvailable` dep only proves the SERVER answers (isAvailable()), so a
// reachable-but-modelless Ollama would let it compute `hybrid` while every
// embed 404s underneath. assessTiers checks modelPresent() separately and
// reports the HONEST tier (lexical) for that state, flagging it
// `misreports: true` -- the one case where trusting reachability alone would
// print a label that is actively false, not merely weak.
export function assessTiers({ ollama = {}, index = {} } = {}) {
  const gaps = [];

  let ollamaOk = false;
  if (!ollama.reachable) {
    gaps.push({
      channel: 'ollama',
      state: 'not running',
      buys: 'semantic ranking fused with keyword results',
      fix: 'ollama serve',
    });
  } else if (!ollama.modelPresent) {
    gaps.push({
      channel: 'ollama',
      state: `model "${ollama.model}" not pulled`,
      buys: 'semantic ranking -- isAvailable() alone cannot see this, so without this check a query could be labelled hybrid while semantic contributes nothing',
      fix: `ollama pull ${ollama.model}`,
      misreports: true,
    });
  } else {
    ollamaOk = true;
  }

  // Index gaps are only meaningful once Ollama itself is healthy -- building
  // or refreshing the index requires Ollama (index-embed.mjs's own preflight
  // check), so surfacing "index is stale" while Ollama is down would point
  // at a fix that cannot succeed yet. Fix Ollama first.
  let indexOk = false;
  if (ollamaOk) {
    if (!index.available) {
      gaps.push({
        channel: 'index',
        state: 'missing or empty',
        buys: 'semantic ranking fused with keyword results',
        fix: 'node scripts/index-embed.mjs',
      });
    } else {
      indexOk = true;
      const filesChanged = index.filesChanged ?? 0;
      if (filesChanged > 0) {
        // Not misreports: keyed by chunk-content hash (design spec section
        // 5.2), the index can only ever be INCOMPLETE, never wrong. An
        // edited chunk simply misses the cache and gets re-embedded next
        // refresh -- unlike a real index (e.g. the rejected qmd collection),
        // which goes stale silently and serves outdated hits.
        gaps.push({
          channel: 'index',
          state: `${filesChanged} file(s) changed since last refresh`,
          buys: 'coverage of the vault as it is right now',
          fix: 'node scripts/index-embed.mjs',
        });
      }
      const missing = index.coverage?.missing ?? 0;
      if (missing > 0) {
        gaps.push({
          channel: 'index',
          state: `${missing} chunk(s) not yet embedded`,
          buys: 'complete semantic coverage of the pages already indexed',
          fix: 'node scripts/index-embed.mjs',
        });
      }
    }
  }

  const tier = ollamaOk && indexOk ? 'hybrid' : 'lexical';
  return { tier, gaps };
}

// The full capability block is worth reading once; on every subsequent query
// it becomes noise, and noise is how a warning stops being read. The one-line
// statusLine still fires every query (see search.mjs) -- this only gates the
// full block.
export const NOTICE_WINDOW_HOURS = 4;

export function shouldAnnounceFull(lastNoticeIso, now, windowHours = NOTICE_WINDOW_HOURS) {
  if (!lastNoticeIso) return true;
  const then = Date.parse(lastNoticeIso);
  if (Number.isNaN(then)) return true;
  return now - then >= windowHours * 3600_000;
}

// One line, always printed, naming the tier and -- when degraded -- every
// active gap. Never silent: a caller that reads only this line still learns
// the answer was not the best available, and why.
export function statusLine({ tier, gaps }, { chunks } = {}) {
  if (!gaps.length) {
    return chunks != null ? `(${tier} · ${chunks} chunks)` : `(${tier})`;
  }
  const reasons = gaps.map((g) => `${g.channel} ${g.state}`).join(' · ');
  return `(${tier} — ${reasons} · run --health)`;
}

// The block printed once per notice window (see shouldAnnounceFull): every
// gap, what it costs, and the exact command to fix it -- read once, not
// re-read every query.
export function fullReport({ tier, gaps }, { chunks } = {}) {
  if (!gaps.length) {
    const suffix = chunks != null ? ` (${chunks} chunks indexed)` : '';
    return `wiki-master search health: ${tier} -- all channels available${suffix}.`;
  }
  const lines = [`wiki-master search health: ${tier} (degraded)`];
  for (const g of gaps) {
    lines.push(`  ${g.channel}: ${g.state}`);
    lines.push(`    costs: ${g.buys}`);
    lines.push(`    fix:   ${g.fix}`);
  }
  lines.push('Run `node scripts/search.mjs --health` any time for the full report, or `--setup` for a remediation plan.');
  return lines.join('\n');
}

// A remediation PLAN, not an executor: exact commands, in the order the
// gaps were detected (which is dependency order -- see assessTiers' own
// comment on why index gaps wait for Ollama), with a repeated fix listed
// once. Printing without running is deliberate: auto-provisioning behind the
// user's back was rejected earlier in this project's history (see the
// now-removed qmd tier's QMD_COLLECTION comment) -- confirmation belongs in
// the conversation with the user, not inside a script that could run
// unattended.
export function setupPlan({ gaps }) {
  if (!gaps.length) return 'wiki-master search: all channels healthy -- nothing to set up.';
  const seen = new Set();
  const steps = [];
  for (const g of gaps) {
    if (seen.has(g.fix)) continue;
    seen.add(g.fix);
    steps.push(g.fix);
  }
  const lines = ['wiki-master search setup -- run in order:'];
  steps.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
  return lines.join('\n');
}
