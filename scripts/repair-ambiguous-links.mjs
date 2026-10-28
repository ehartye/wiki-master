// Repair `ambiguous-link` issues that have exactly one safe answer, and report the rest with the reason.
//
// A bare wikilink such as [[architecture]] is ambiguous when two pages share the name. The one rule applied
// on its own: the page lives in a project's folder (wiki/authored/<project>/) and exactly one candidate does
// too, so the link means that project's page. It is rewritten to the full path with the displayed text kept.
// Everything else (a hub MOC and a page sharing a name, a shared page outside every project, several
// candidates in one project, a title shared by two clippings, a line inside a generated catalog) is reported
// with its class and reason, never guessed. A reviewed mapping can settle the ones that need a reading.
//
//   node scripts/repair-ambiguous-links.mjs                       # dry run: the plan and the report
//   node scripts/repair-ambiguous-links.mjs --apply
//   node scripts/repair-ambiguous-links.mjs --project=<slug>      # bound the run to one project's pages
//   node scripts/repair-ambiguous-links.mjs --exclude=<prefix>    # leave pages an application reads alone (repeatable)
//   node scripts/repair-ambiguous-links.mjs --mapping=<file.json> # [{ "target", "path", "page"? }] reviewed answers
//   node scripts/repair-ambiguous-links.mjs --json
//
// Links in code spans, fences, comments and generated catalog fences stay as written. Only wikilinks change,
// which is checked line by line; `updated` is set to the run date and `reviewed` is left alone.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { scanIntegrity } from './lib/integrity.mjs';
import { classifyAmbiguous, projectOf, repointBareLinks, onlyWikilinksChanged, bumpUpdated, hasGeneratedFence } from './lib/ambiguous-repair.mjs';
import { cliGuard, optionValues } from './lib/cli-guard.mjs';
cliGuard(import.meta.url);

const lower = (s) => String(s).trim().toLowerCase();
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function repairAmbiguousLinks(vaultPath, { apply = false, project, exclude = [], mapping = [], today = localDay() } = {}) {
  const issues = scanIntegrity(vaultPath).issues.filter((i) => i.rule === 'ambiguous-link');
  const texts = new Map();
  const text = (page) => { if (!texts.has(page)) texts.set(page, readFileSync(join(vaultPath, page), 'utf8')); return texts.get(page); };
  const context = (page, line) => (text(page).split('\n')[(line ?? 1) - 1] ?? '').replace(/\r$/, '').trim().slice(0, 160);

  const wantedByPage = new Map(); // page -> Map(lower target -> { path, class })
  const reported = [];
  const excluded = [];
  const report = (issue, cls, reason) => reported.push({ page: issue.source, target: issue.target, class: cls, reason, candidates: issue.candidates ?? [], line: issue.line, context: context(issue.source, issue.line) });

  for (const issue of issues) {
    if (project && projectOf(issue.source) !== project) continue;
    if (exclude.some((prefix) => issue.source.startsWith(prefix))) { excluded.push({ page: issue.source, target: issue.target, reason: 'excluded by --exclude (a consumer may read this page by title)' }); continue; }
    const reviewed = mapping.find((m) => lower(m.target) === lower(issue.target) && (!m.page || issue.source === m.page || (m.page.endsWith('/') && issue.source.startsWith(m.page))));
    let chosen = null;
    if (reviewed) {
      if (!(issue.candidates ?? []).includes(reviewed.path)) { report(issue, 'mapping-refused', `the mapped path ${reviewed.path} is not a candidate for this link`); continue; }
      chosen = { path: reviewed.path, class: 'mapped' };
    } else {
      const cls = classifyAmbiguous(issue);
      if (cls.class !== 'same-project') { report(issue, cls.class, cls.reason); continue; }
      chosen = { path: cls.path, class: 'same-project' };
    }
    if (!wantedByPage.has(issue.source)) wantedByPage.set(issue.source, new Map());
    wantedByPage.get(issue.source).set(lower(issue.target), { ...chosen, issue });
  }

  const planned = [];
  const repointed = []; // one entry per page and target
  let fixed = 0, pages = 0;
  for (const [page, wanted] of wantedByPage) {
    const original = text(page);
    const result = repointBareLinks(original, new Map([...wanted].map(([k, v]) => [k, v.path])));
    // A target with no rewritable occurrence is wholly inside code, a comment or a generated catalog.
    for (const [k, v] of wanted) {
      const probe = repointBareLinks(original, new Map([[k, v.path]]));
      if (!probe.count) report(v.issue, hasGeneratedFence(original) ? 'catalog-line' : 'no-live-occurrence', hasGeneratedFence(original)
        ? 'the occurrences are inside a generated catalog; regenerate it (refresh-catalogs.mjs) instead of editing it'
        : 'every occurrence is inside code, a comment or a generated fence');
    }
    if (!result.count) continue;
    if (!onlyWikilinksChanged(result.changes)) { for (const [, v] of wanted) report(v.issue, 'verification-failed', 'a changed line differs by more than its wikilinks; left alone'); continue; }
    for (const c of result.changes) planned.push({ page, line: c.line, before: c.before, after: c.after });
    for (const [k, v] of wanted) if (repointBareLinks(original, new Map([[k, v.path]])).count) repointed.push({ page, target: v.issue.target, path: v.path, class: v.class });
    fixed += result.count;
    pages += 1;
    if (apply) writeFileSync(join(vaultPath, page), bumpUpdated(result.text, today));
  }
  return { applied: apply, fixed, pages, planned, repointed, reported, excluded };
}

export function main(argv = process.argv.slice(2)) {
  const opts = (name) => optionValues(argv, name);
  const { path: vaultPath } = resolveVault();
  const mappingFile = opts('mapping')[0];
  const mapping = mappingFile ? JSON.parse(readFileSync(mappingFile, 'utf8')) : [];
  const r = repairAmbiguousLinks(vaultPath, { apply: argv.includes('--apply'), project: opts('project')[0], exclude: opts('exclude'), mapping });
  if (argv.includes('--json')) { console.log(JSON.stringify(r, null, 2)); return r; }
  console.log(JSON.stringify({ type: 'repair-ambiguous-links', applied: r.applied, links: r.fixed, pages: r.pages, reported: r.reported.length, excluded: r.excluded.length }));
  for (const c of r.planned.slice(0, 40)) console.log(`  ${c.page}:${c.line}\n    - ${c.before}\n    + ${c.after}`);
  if (r.planned.length > 40) console.log(`  ... and ${r.planned.length - 40} more changed line(s)`);
  const byClass = {};
  for (const x of r.reported) (byClass[x.class] ??= []).push(x);
  for (const [cls, list] of Object.entries(byClass)) {
    console.log(`\nReported, not changed: ${cls} (${list.length}) -- ${list[0].reason}`);
    for (const x of list.slice(0, 8)) console.log(`  ${x.page}:${x.line} [[${x.target}]] candidates: ${x.candidates.join(', ')}\n    ${x.context}`);
    if (list.length > 8) console.log(`  ... and ${list.length - 8} more`);
  }
  if (r.excluded.length) console.log(`\nExcluded: ${r.excluded.length} link(s) on pages matching --exclude`);
  if (!r.applied) console.error('dry run -- re-run with --apply to rewrite the links');
  return r;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
