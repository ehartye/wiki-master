// Given a wiki page path — typically piped straight from search.mjs's own
// stdout (`path:line` for a chunk hit, bare `path` for a keyword hit) — walks
// the citation graph to its actual raw/ evidence and prints it, so "jump to
// the raw details from a search result" is one command instead of a manual
// open-the-page-read-its-frontmatter-open-the-linked-file trace.
//
// Deliberately reuses evidencePaths() (lib/graph.mjs) rather than
// reimplementing the walk: that function already does exactly this BFS
// (page -> its cited wiki/sources/ page -> that page's own raw/ clippings,
// depth-capped, cycle-safe) for lint.mjs and repair-quote-provenance.mjs, and
// a second, subtly-different implementation here would be a real risk (two
// definitions of "evidence" quietly drifting apart). Every classification
// below mirrors an existing, already-scored vocabulary in
// computeGraphMetrics — declaredNoProvenance, unreachableProvenance — so a
// page that health.mjs already reports as a gap reads as that same kind of
// gap here, not a second, disagreeing verdict.
//
//   node scripts/resolve-evidence.mjs "wiki/sources/Foo.md:23"
//   node scripts/search.mjs "topic" --include-raw | node scripts/resolve-evidence.mjs
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { buildGraph, buildNameIndex, evidencePaths } from './lib/graph.mjs';

// search.mjs only ever appends `:<line>` for a chunk-semantic hit (never for
// a keyword-only or --include-raw hit) — see its own renderResult(). No
// vault-managed filename can itself end in `:<digits>` (slugify() maps `:`
// to `-` everywhere a clip is written), so stripping this suffix is always
// safe and never mistakes a real path for one.
export function stripLineSuffix(input) {
  return String(input ?? '').trim().replace(/:\d+$/, '');
}

// Pure classification, no I/O: given pre-built graph data and one input
// string, decides which of five states applies. Never guesses a raw/ path
// that evidencePaths() itself did not return — the same "report for review,
// don't invent" discipline repair-provenance-links.mjs already established
// for citation repair applies here to citation READING too.
export function resolveEvidence(input, { pageByPath, byName }) {
  const path = stripLineSuffix(input);

  // raw/ IS the evidence -- there is nothing further to resolve. Checked
  // before the graph lookup: a raw/ file is walked by buildGraph() too (it
  // has its own page entry), but short-circuiting here means this state
  // never depends on that entry existing or being well-formed.
  if (path.startsWith('raw/')) return { path, status: 'is-raw' };

  const page = pageByPath.get(path);
  if (!page) return { path, status: 'not-found' };

  const evidence = evidencePaths(page, byName, pageByPath);
  const rawPaths = evidence.filter((p) => p.startsWith('raw/'));
  const sourcePaths = evidence.filter((p) => p.startsWith('wiki/sources/'));

  if (rawPaths.length) return { path, status: 'resolved', rawPaths, sourcePaths };

  // Only reached with zero raw/ evidence: a legitimate, disclosed absence
  // (wiki/authored/'s sources: []) reads as by-design, never as the same
  // defect an actually-broken citation trail would be.
  if (page.declaresNoSources) return { path, status: 'declared-no-provenance' };

  return { path, status: 'unreachable', sourcePaths };
}

// Pure formatting, mirroring search.mjs's own renderResult(): resolution
// logic and its human-readable rendering are separate, independently
// testable concerns.
export function formatEvidenceReport(result) {
  const { path, status } = result;
  switch (status) {
    case 'is-raw':
      return [path, '  this IS raw evidence — nothing further to resolve'];
    case 'not-found':
      return [path, '  not found in the vault graph'];
    case 'declared-no-provenance':
      return [path, '  declares no provenance (sources: []) — by design, no raw/ counterpart to resolve'];
    case 'unreachable': {
      const lines = [path, '  NO raw evidence reachable — citation may be broken (see health.mjs\'s provenanceGaps / unreachableProvenance)'];
      if (result.sourcePaths?.length) {
        lines.push('  reached source page(s) with no further raw citation:', ...result.sourcePaths.map((p) => `    ${p}`));
      }
      return lines;
    }
    case 'resolved': {
      const lines = [path, '  raw evidence:', ...result.rawPaths.map((p) => `    ${p}`)];
      if (result.sourcePaths?.length) {
        lines.push('  via source page(s):', ...result.sourcePaths.map((p) => `    ${p}`));
      }
      return lines;
    }
    default:
      return [path, `  unknown status: ${status}`];
  }
}

// Reads stdin asynchronously rather than via `readFileSync(0)`: confirmed
// live that the synchronous read hits Node's `EAGAIN: resource temporarily
// unavailable` on macOS specifically when the pipe's other end is ALSO a
// live Node process still writing/flushing (`node search.mjs ... | node
// resolve-evidence.mjs` — this script's own primary documented use case) --
// a synchronous read races a non-blocking pipe fd in exactly that shape.
// Async iteration goes through libuv's real async I/O path instead of a
// bare read syscall, and does not hit this.
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c)))).toString('utf8');
}

export async function main(argv) {
  const { path: vaultPath } = resolveVault();
  const { pages } = buildGraph(vaultPath);
  const byName = buildNameIndex(pages);
  const pageByPath = new Map(pages.map((p) => [p.path, p]));

  let inputs = argv.filter(Boolean);
  if (!inputs.length && !process.stdin.isTTY) {
    // Piped usage: `node search.mjs "q" --include-raw | node resolve-evidence.mjs`.
    // search.mjs's own stdout carries only result paths (its status line and
    // every diagnostic go to stderr, by design), so every non-blank line
    // here is a real hit.
    inputs = (await readStdin()).split('\n').map((l) => l.trim()).filter(Boolean);
  }
  if (!inputs.length) {
    console.error('usage: node scripts/resolve-evidence.mjs "<wiki-page-path>[:line]" [...more]');
    console.error('       node scripts/search.mjs "<query>" | node scripts/resolve-evidence.mjs');
    process.exit(1);
  }

  for (const input of inputs) {
    const result = resolveEvidence(input, { pageByPath, byName });
    for (const line of formatEvidenceReport(result)) console.log(line);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
