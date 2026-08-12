import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { buildGraph, computeGraphMetrics, isContent } from './lib/graph.mjs';

// Health reads the vault filesystem directly — no Obsidian CLI. The CLI's
// orphan/deadend verdicts are computed WITH structural files' links included
// (index.md links everything, so nothing ever looks orphaned) and it offers no
// source-side exclusion, so its answer cannot be corrected after the fact.
export { isContent };

export function computeHealth({ orphans, deadEnds, brokenLinks, hubStubs, monolithCandidates = [], unparsedSources = [], unsummarizedSources = [], missingHash = [], backfillPending = 0, provenanceGaps = [], unreachableProvenance = [], declaredNoProvenance = [], declaredStubs = [], brokenClass = null }) {
  // Broken links are triaged (see classifyBrokenLinks): defects (typo/rename —
  // real bugs) and stale (abandoned low-demand forward-links) are penalized;
  // deferred forward-links are healthy by design and cost nothing. Callers
  // without a classification fall back to treating every broken link as a defect.
  const defects = brokenClass ? brokenClass.defects : brokenLinks;
  const stale = brokenClass ? brokenClass.stale : [];
  const deferred = brokenClass ? brokenClass.deferred : [];

  // Independent, individually-capped penalties, then summed (avoids saturation).
  const penalty =
    Math.min(30, defects.length * 3) +
    Math.min(15, stale.length * 2) +
    Math.min(25, orphans.length * 2) +
    Math.min(20, deadEnds.length * 2) +
    // hubStubs is REPORTED but deliberately NOT SCORED. It is the only signal here
    // that measures content rather than structure — "this page is unwritten" — and
    // it behaved badly as a grade:
    //  - Every other penalty is a broken or missing EDGE: objectively wrong, and
    //    fixable mechanically. A stub is the normal state of a growing wiki, and
    //    `status: stub` is a sanctioned value in the vault schema — the report even
    //    prints "declared stubs (not scored)", which scoring them contradicted.
    //  - It was the only category whose CHEAPEST fix makes the wiki worse. Clearing
    //    a hub-stub by deleting inbound links until it drops under HUB_MIN_BACKLINKS,
    //    or by padding it with unsourced prose, both scored better and both damage
    //    the vault. Everywhere else the cheapest fix is the correct fix.
    //  - The cap made it useless as a gradient anyway: at weight 5 capped at 15, a
    //    vault went 10 hub-stubs -> 3 hub-stubs with no score movement at all.
    //  - The provenance guardrail forbids the fast fix — you cannot write these
    //    without sources — so it penalized a state the contract bars you from
    //    clearing quickly.
    // It remains a real signal ("5+ pages route through an empty page"), so it is
    // surfaced as a WORKLIST in /wiki-triage instead, where it is actionable.
    // Health now means one clean thing: no broken edges.
    // A source page citing no raw file is a broken provenance contract: it
    // claims an ingest while leaving its clipping indistinguishable from one
    // never processed. Every citation in the wiki rests on this link, so it is
    // scored as a defect rather than filed as informational.
    Math.min(20, provenanceGaps.length * 4) +
    // Same contract, the other 90% of the vault: a concept/entity/synthesis that
    // cannot be walked back to raw/ is a claim with no trail, and the trail is
    // what every citation rests on. Scored lower than a source-page gap because
    // it is reachability, not a direct citation — the page may be one broken hop
    // from evidence rather than resting on nothing.
    Math.min(20, unreachableProvenance.length * 3);
  const score = Math.max(0, 100 - penalty);

  const list = (arr, fmt) => (arr.length ? `\n    ${arr.map(fmt).join('\n    ')}` : '');
  const DEFERRED_SHOWN = 20;
  const report =
    `Wiki health: ${score}/100 (scanned from filesystem)\n` +
    `  broken links: ${brokenLinks.length} (defect ${defects.length} · stale ${stale.length} · deferred ${deferred.length})` +
    (defects.length ? `\n  defects (fix — typo/rename):` : '') +
    list(defects, (b) => `${b.target}  <- ${b.source}${b.suggest ? `   (did you mean [[${b.suggest}]]?)` : b.wrapped ? '   (hard-wrapped wikilink — run scripts/repair-wrapped-links.mjs)' : ''}`) +
    (stale.length ? `\n  stale (prune or promote):` : '') +
    list(stale, (b) => `${b.target}  <- ${b.source}   (${b.ageDays}d, refs ${b.refs})`) +
    (deferred.length ? `\n  deferred (healthy forward-links):` : '') +
    list(deferred.slice(0, DEFERRED_SHOWN), (b) => `${b.target}  <- ${b.source}`) +
    (deferred.length > DEFERRED_SHOWN ? `\n    … and ${deferred.length - DEFERRED_SHOWN} more` : '') +
    `\n  orphans:      ${orphans.length}\n` +
    `  dead-ends:    ${deadEnds.length}\n` +
    `  hub-stubs:    ${hubStubs.length}` +
    (hubStubs.length ? `\n    ${hubStubs.join('\n    ')}` : '') +
    // Informational, like hub-stubs above — a wiki/authored/ page that has
    // stopped pruning itself (spec 2026-08-11-authored-project-docs-design.md
    // §5.4). Splitting one safely needs the judgment the score can't supply.
    `\n  monolith candidates: ${monolithCandidates.length}` +
    (monolithCandidates.length ? ` (large, repeatedly-updated wiki/authored/ pages — consider splitting)\n    ${monolithCandidates.join('\n    ')}` : '') +
    `\n  declared stubs (not scored): ${declaredStubs.length}` +
    (declaredStubs.length ? `\n    ${declaredStubs.join('\n    ')}` : '') +
    `\n  provenance gaps: ${provenanceGaps.length}` +
    (provenanceGaps.length ? ` (source pages citing no raw/ file)\n    ${provenanceGaps.join('\n    ')}` : '') +
    `\n  unreachable provenance: ${unreachableProvenance.length}` +
    (unreachableProvenance.length ? ` (cannot be walked back to raw/)\n    ${unreachableProvenance.join('\n    ')}` : '') +
    `\n  declared no provenance (not scored): ${declaredNoProvenance.length}` +
    (declaredNoProvenance.length ? `\n    ${declaredNoProvenance.join('\n    ')}` : '') +
    // Two distinct facts, reported separately. "Unparsed" alone invited the
    // reading that a cited-but-unsummarized source was handled.
    `\n  unparsed raw sources (nothing cites them): ${unparsedSources.length}` +
    (unparsedSources.length ? `\n    ${unparsedSources.join('\n    ')}` : '') +
    `\n  not ingested (no summary records their hash): ${unsummarizedSources.length}` +
    (unsummarizedSources.length ? `\n    ${unsummarizedSources.join('\n    ')}` : '') +
    // Data-quality, not ingest-state: a clipping with no source-hash cannot be
    // hash-joined at all, so it is surfaced for repair. Migration progress: source
    // pages that cite raw but have not yet recorded a hash (fallback still credits
    // them; the count reaches 0 when the vault is fully migrated).
    `\n  clippings missing source-hash (repair): ${missingHash.length}` +
    (missingHash.length ? `\n    ${missingHash.join('\n    ')}` : '') +
    `\n  source pages awaiting hash backfill: ${backfillPending}`;
  return { score, orphans, deadEnds, brokenLinks, hubStubs, monolithCandidates, unparsedSources, unsummarizedSources, missingHash, backfillPending, provenanceGaps, unreachableProvenance, declaredNoProvenance, declaredStubs, brokenClass, report };
}

// The ingest backlog is the first question /wiki-ingest asks, and in the full
// report its four lines sit last, under every deferred forward-link. --backlog
// prints just those lines so the answer is not buried.
export function backlogReport({ unparsedSources = [], unsummarizedSources = [], missingHash = [], backfillPending = 0 }) {
  const list = (arr) => (arr.length ? `\n    ${arr.join('\n    ')}` : '');
  return (
    `Ingest backlog\n` +
    `  not ingested (no summary records their hash): ${unsummarizedSources.length}` + list(unsummarizedSources) +
    `\n  unparsed raw sources (nothing cites them): ${unparsedSources.length}` + list(unparsedSources) +
    `\n  clippings missing source-hash (repair): ${missingHash.length}` + list(missingHash) +
    `\n  source pages awaiting hash backfill: ${backfillPending}`
  );
}

export function main() {
  const { path: vaultPath } = resolveVault();
  const metrics = computeGraphMetrics(buildGraph(vaultPath), { now: new Date() });
  if (process.argv.includes('--backlog')) {
    console.log(backlogReport(metrics));
    return metrics;
  }
  const r = computeHealth(metrics);
  console.log(r.report);
  return r;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
