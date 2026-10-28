// The options each script accepts and its usage text, for `cliGuard` (cli-guard.mjs). The seven clippers keep theirs
// in clip-args.mjs. A script with no `usage` here prints its own help; the guard then only rejects unknown options.
// A new option has to be added here or the script rejects it.

const DRY = 'Dry run: prints what it would change. Add --apply to write.';
const VAULT = 'The vault is the one named by WIKI_MASTER_VAULT (default: ~/.wiki-master-vault).';

export const CLI_SPECS = {
  'backfill-authored-metadata': {
    options: ['apply'],
    usage: ['usage: node scripts/backfill-authored-metadata.mjs [--apply]', '', 'One-time backfill of project:, kind: and decision-status: onto the existing wiki/authored/ pages.', DRY, VAULT],
  },
  'backfill-source-hashes': {
    options: ['apply'],
    usage: ['usage: node scripts/backfill-source-hashes.mjs [--apply]', '', 'One-time migration: records each legacy wiki/sources page\'s clipping hashes in a source-hashes: field.', DRY, VAULT],
  },
  'build-keyword-eval': {
    options: ['vault', 'seed', 'per-category', 'out'],
    usage: ['usage: node scripts/build-keyword-eval.mjs [--vault <dir>] [--seed <n>] [--per-category <n>] [--out <file>]', '', 'Builds the keyword-engine evaluation question set from the vault: questions only a keyword channel can answer.'],
  },
  'clip-and-repoint': {
    options: ['from', 'apply', 'limit'],
    usage: ['usage: node scripts/clip-and-repoint.mjs --from=<dir holding the binaries> [--apply] [--limit=N]', '', 'Repair pass: clips each binary a wiki/sources page cites into a .md clipping, in place from the directory given, then repoints the summary at the clipping and stamps its source-hashes.', DRY, VAULT],
  },
  'dedupe-clippings': {
    options: ['apply'],
    usage: ['usage: node scripts/dedupe-clippings.mjs [--apply]', '', 'Removes raw clippings that duplicate another clipping\'s content hash, keeping the copy the vault cites. Groups without a clear keeper are reported, never guessed at.', DRY, VAULT],
  },
  health: {
    options: ['json', 'legacy', 'backlog'],
    usage: ['usage: node scripts/health.mjs [--json | --legacy | --backlog]', '', 'Reports wiki integrity: open defects, unresolved navigation and the unscored notes. --json prints the full worklist, --legacy the historical score, --backlog only the ingest backlog. Choose one.', 'Read-only.', VAULT],
  },
  'log-entry': {
    options: ['op', 'title'],
    usage: ['usage: node scripts/log-entry.mjs --op <op> --title "<title>"   (entry body on stdin)', '', 'Writes one uniquely named log/YYYY-MM-DD-HHmmss-<op>-<slug>.md. Write it after op-begin and list it in the operation\'s ledger.', VAULT],
  },
  'op-abort': {
    options: ['since'],
    usage: ['usage: node scripts/op-abort.mjs --since <token>', '', 'Drops one operation token without committing: for the session that holds it and stopped early. It removes only the token named; the files the operation wrote stay in the working tree, uncommitted.', VAULT],
  },
  'op-begin': {
    options: ['op'],
    usage: ['usage: node scripts/op-begin.mjs --op <op>', '', 'Opens a vault operation: records what is already uncommitted and prints the token that op-commit takes as --since.', VAULT],
  },
  'op-commit': {
    options: ['op', 'title', 'since', 'paths-file', 'include', 'include-from', 'evidence-map'],
    usage: ['usage: node scripts/op-commit.mjs --op <op> --title "<title>" --since <token> [--paths-file <JSON-file>] [--include <path>]... [--include-from <JSON-file>] [--evidence-map <JSON-file>]', '', 'Commits one operation\'s changes and closes its token. With --paths-file only the ledger\'s paths are committed; a ledger path that was already uncommitted when the operation opened is refused unless --include (or --include-from) adopts it. Never pushes.', VAULT],
  },
  purge: {
    options: ['plan', 'apply', 'reconcile', 'restore', 'seeds'],
    usage: ['usage: node scripts/purge.mjs [--plan | --apply | --reconcile | --restore] "<topic>" [--seeds a.md,b.md]', '', 'Plans (default), applies, reconciles or restores the removal of a topic from the wiki and its evidence. Applying needs a reviewed plan.', VAULT],
  },
  'refresh-fidelity': {
    options: ['apply', 'ocr-floor', 'inventory'],
    usage: ['usage: node scripts/refresh-fidelity.mjs [--ocr-floor | --inventory] [--apply]', '', 'Re-assesses each clipping\'s cached fidelity verdict from its stored markdown and clears flags that no longer hold. A clipping whose flag rests on its extraction (a table mode, or OCR) is preserved.', '--ocr-floor instead lists the OCR clippings that carry no fidelity grade and, with --apply, sets fidelity: ocr on them. An existing grade is never replaced.', '--inventory instead lists the PDF clippings, not yet marked degraded, whose letter inventory now looks broken (a letter that every Latin-script text has is nearly absent). It only lists, and refuses --apply.', DRY, VAULT],
  },
  'rename-doubled-extension-clippings': {
    options: ['apply', 'exclude', 'flag', 'list-out', 'paths-out'],
    usage: ['usage: node scripts/rename-doubled-extension-clippings.mjs [--apply] [--exclude=<path>]... [--flag=<path>]... [--list-out <file>] [--paths-out <file>]', '', 'Renames raw clippings whose names double the extension (README.md.md) and repoints the citations to them.', DRY, 'It refuses to apply while a file it would change has uncommitted edits. --paths-out writes the changed paths for op-commit --paths-file.', VAULT],
  },
  'rename-unsafe-clippings': {
    options: ['apply', 'exclude', 'flag', 'list-out', 'paths-out'],
    usage: ['usage: node scripts/rename-unsafe-clippings.mjs [--apply] [--exclude=<path>]... [--flag=<path>]... [--list-out <file>] [--paths-out <file>]', '', 'Gives raw clippings a name Obsidian will index and a wikilink can carry, and repoints the citations that name them.', DRY, 'It refuses to apply while a file it would change has uncommitted edits. --paths-out writes the changed paths for op-commit --paths-file.', VAULT],
  },
  'render-page': {
    options: [],
    usage: ['usage: node scripts/render-page.mjs <url> <out.html>', '', 'Renders one page in a browser and writes its HTML to <out.html>. clip.mjs runs this as a subprocess for pages that need JavaScript.'],
  },
  'repair-ambiguous-links': {
    options: ['apply', 'json', 'project', 'exclude', 'mapping'],
    usage: ['usage: node scripts/repair-ambiguous-links.mjs [--apply] [--json] [--project=<slug>] [--exclude=<path>]... [--mapping=<JSON-file>]', '', 'Repoints the ambiguous bare links that have exactly one safe answer (a project page with one candidate in its own project) and reports every other one with its reason.', DRY, VAULT],
  },
  'repair-inline-sources': {
    options: ['apply'],
    usage: ['usage: node scripts/repair-inline-sources.mjs [--apply]', '', 'Repairs sources: frontmatter that is not valid YAML list syntax (inline and block shapes that Obsidian reports as a type mismatch).', DRY, VAULT],
  },
  'repair-missing-hash': {
    options: ['apply'],
    usage: ['usage: node scripts/repair-missing-hash.mjs [--apply]', '', 'Stamps a source-hash onto raw clippings that predate the field, so they can be hash-joined to their summaries.', DRY, VAULT],
  },
  'repair-provenance-links': {
    options: ['apply'],
    usage: ['usage: node scripts/repair-provenance-links.mjs [--apply]', '', 'Repoints a summary page\'s citation that names a clipping by its original title to the slugified file the clipper stored.', DRY, VAULT],
  },
  'repair-quote-provenance': {
    options: ['apply'],
    usage: ['usage: node scripts/repair-quote-provenance.mjs [--apply]', '', 'Records the source a page already rests on when it quotes a clipping verbatim but declares no path to it. A quote that matches nothing is left alone.', DRY, VAULT],
  },
  'repair-sources-order': {
    options: ['apply'],
    usage: ['usage: node scripts/repair-sources-order.mjs [--apply]', '', 'One-time repair of sources: block lists that had source-hashes: inserted between the key and its first item.', DRY, VAULT],
  },
  'repair-wrapped-links': {
    options: ['apply'],
    usage: ['usage: node scripts/repair-wrapped-links.mjs [--apply]', '', 'Repairs wikilinks split across a line break by hard-wrapped prose, where the repair is a lossless whitespace collapse.', DRY, VAULT],
  },
  'resolve-evidence': {
    options: [],
    usage: ['usage: node scripts/resolve-evidence.mjs <page-path>...   (or page paths on stdin)', '', 'Walks the citation graph from each wiki page to its raw evidence and prints it, so a search hit leads to the original text in one command.', 'Read-only.', VAULT],
  },
  'scan-private-terms': {
    options: ['json', 'known', 'root', 'terms-file'],
    usage: ['usage: node scripts/scan-private-terms.mjs [--root <dir>] [--terms-file <file>] [--known <file>] [--json]', '', 'Scans the tracked and untracked files of a repository for private names (home paths, machine names, invisible characters, and the terms in the file named by --terms-file or WIKI_MASTER_PRIVATE_TERMS_FILE). Prints file:line and a count, never the matched text. Exits 1 on a hit or a stale --known entry.'],
  },
  // Scripts whose own parser refuses an unknown option (test/cli-guard.test.mjs checks that): the guard only
  // answers `--help` for them, so the accepted options are not repeated here.
  'backlog-gen': {
    usage: ['usage: node scripts/backlog-gen.mjs [--apply] [--project <slug>]', '', 'Regenerates the fenced backlog catalog of each project\'s roadmap.md from its backlog items.', DRY, 'It takes neither --diff nor --paths-file; refresh-catalogs.mjs does.', VAULT],
  },
  'backlog-list': {
    usage: ['usage: node scripts/backlog-list.mjs [--project <slug>] [--backlog-status <list>] [--startable] [--json]', '', 'Lists backlog items by lifecycle status, one row per item (project, status, path, title, what it waits on). --startable lists the planned items whose prerequisites are all closed; --backlog-status takes in-progress, planned, blocked, shipped, dropped or unrecognized, comma separated.', 'Read-only.', VAULT],
  },
  drift: {
    usage: ['usage: node scripts/drift.mjs [--coverage] [--json] [--limit <n>]', '', 'Checks wiki pages against their sources for drift using the embedding index. --coverage reports how many pages were evaluated; zero evaluated pages cannot show that the wiki has no drift. --limit caps the pages checked.', 'Read-only.', VAULT],
  },
  'evaluate-retrieval': {
    usage: ['usage: node scripts/evaluate-retrieval.mjs --questions <file> [--vault <dir>] [--split all|development|heldout] [--search-module <file>] [--output <file>] [--json] [--keyword-only]', '', 'Scores search against a labelled question set: page recall, precision, reciprocal rank, passage hit rate and evidence recall. --keyword-only builds the search context as if the semantic service were down.', 'Read-only on the vault.'],
  },
  'evaluate-skill-behavior': {
    usage: ['usage: node scripts/evaluate-skill-behavior.mjs --scenarios <file> (--traces <file> | --with <file> --without <file>) [--output <file>]', '', 'Scores recorded agent traces against skill-behavior scenarios, or compares a run with the skill to a run without it.'],
  },
  'extract-page': {
    usage: ['usage: node scripts/extract-page.mjs --payload <base64url-JSON> [--lang en] [--user-agent <ua>] [--check-runtime]', '', 'Internal: extracts one page for clip.mjs from an encoded payload and prints the result as JSON. --check-runtime only checks that the HTML extraction runtime loads.'],
  },
  'identity-audit': {
    usage: ['usage: node scripts/identity-audit.mjs [--vault <dir>] [--limit <n>] [--json]', '', 'Reports identity findings for review (pages that may name the same thing). A finding is never permission to merge or rename a page.', 'Read-only.', VAULT],
  },
  'moc-authored-gen': {
    usage: ['usage: node scripts/moc-authored-gen.mjs [--apply] [--project <slug>]', '', 'Regenerates the fenced project map moc/<project>.md from the project\'s pages.', DRY, 'It takes neither --diff nor --paths-file; refresh-catalogs.mjs does.', VAULT],
  },
  'op-cleanup': {
    usage: ['usage: node scripts/op-cleanup.mjs [--hours <n>] [--apply]', '', 'Removes operation tokens left behind by operations that never closed. A token older than --hours (default 24, at least 1) is stale; a recent token is never removed.', DRY, VAULT],
  },
  'refresh-catalogs': {
    usage: ['usage: node scripts/refresh-catalogs.mjs [--project <slug>] [--apply] [--paths-file <ledger>] [--diff]', '', 'Regenerates a project\'s roadmap catalog, project map and the global index from one vault graph.', 'The default is a dry run whose "changed" list is what an apply would change; --diff adds the lines each file would lose and gain on stderr. --paths-file is the operation\'s ownership ledger: another writer\'s uncommitted pages stay out.', VAULT],
  },
  relationships: {
    usage: ['usage: node scripts/relationships.mjs [--vault <dir>] [--limit <n>] [--seed <page>] [--since <date>] [--semantic] [--json]', '', 'Proposes relationship candidates between pages from shared sources and neighbors. A candidate is a reason to inspect two pages, never proof of a relationship.', 'Read-only.', VAULT],
  },
  search: {
    usage: ['usage: node scripts/search.mjs "<question>" [--json] [--limit N] [--project P] [--type T] [--status S] [--include-raw]', '       node scripts/search.mjs --health | --setup', '', 'Searches the wiki with keyword, identity and semantic channels and prints ranked pages with citations. --health reports which channels are available; --setup prints how to enable the missing ones.', 'Read-only.', VAULT],
  },
  'validate-authored': {
    usage: ['usage: node scripts/validate-authored.mjs --paths-file <ledger.json> [--json] [--terms-file <file>] [--terms-projects <list>]', '', 'Checks the frontmatter, placement and links of exactly the pages one authoring task wrote (the ledger: a JSON array of vault-relative paths). Prints one "path:line rule message" line per defect; exit 0 is clean, 1 means defects, 2 an unusable ledger or vault.', 'Read-only.', VAULT],
  },
  'wiki-sync': {
    usage: ['usage: node scripts/wiki-sync.mjs [--commit-local]', '', 'Brings the vault and its shared remote to the same state: rebases onto the upstream, pushes, and checks the remote has the commits, or says exactly why it could not. --commit-local first commits the vault\'s uncommitted changes itself; it refuses while an operation is open.', VAULT],
  },
  triage: { options: ['remote'] },
  init: { options: [] },
  lint: { options: ['json', 'full', 'near', 'tier', 'page', 'paths-file', 'updated-since', 'ids', 'include-reviewed'] },
  'lint-disposition': {
    options: ['ids', 'disposition', 'reviewer', 'note', 'page', 'paths-file', 'whole-vault', 'apply'],
    usage: [
      'usage: node scripts/lint-disposition.mjs record --ids=<id>[,<id>...] --disposition=<verdict> --reviewer=<name> [--note=<text>] (--page=<path> | --paths-file=<ledger> | --whole-vault)',
      '       node scripts/lint-disposition.mjs prune [--apply]',
      '',
      'Records that a person read lint findings and what they decided, in lint-dispositions.jsonl at the vault root, so the next lint run does not list them again.',
      'The ids come from `lint.mjs --ids`. A verdict is one of own-wording, mention, title, markup, accepted, fixed. The scope says where to look for the ids;',
      'a finding whose quote or raw evidence has changed has a new id and needs a new verdict.',
      'prune lists (dry run) or with --apply removes the records of a page that no longer exists.',
      VAULT,
    ],
  },
  stale: { options: [] },
  'index-embed': { options: ['rebuild', 'status', 'concurrency'] },
};
