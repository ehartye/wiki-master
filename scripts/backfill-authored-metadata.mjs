// One-time backfill of project:/kind:/decision-status: onto the pre-existing
// wiki/authored/ files. See
// docs/superpowers/specs/2026-08-11-authored-project-docs-design.md §8.
//
// Deterministic and mechanical — filename shape (and, for a bare project-name
// file, a structural body check) decides everything; nothing is guessed.
// Idempotent: a page that already carries a field is left untouched, so this
// can be re-run safely as new authored pages are added without a project:/
// kind: of their own yet.
//
//   node scripts/backfill-authored-metadata.mjs           # dry run
//   node scripts/backfill-authored-metadata.mjs --apply
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveVault } from './lib/vault.mjs';
import {
  classifyAuthoredProject, classifyAuthoredKind, classifyDecisionStatus, insertAuthoredMetadata,
} from './lib/authored-classify.mjs';

const apply = process.argv.includes('--apply');
const { path: vault } = resolveVault();
const dir = join(vault, 'wiki', 'authored');

const plan = [];
for (const entry of readdirSync(dir, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
  const filename = entry.name.slice(0, -3);
  const abs = join(dir, entry.name);
  const text = readFileSync(abs, 'utf8');
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');

  const project = classifyAuthoredProject(filename);
  const kind = classifyAuthoredKind(filename, body);
  const decisionStatus = classifyDecisionStatus(kind, body);

  const out = insertAuthoredMetadata(text, { project, kind, decisionStatus });
  if (out === text) continue; // already set, or nothing classified
  plan.push({ path: `wiki/authored/${entry.name}`, project, kind, decisionStatus });
  if (apply) writeFileSync(abs, out);
}

console.log(JSON.stringify({ type: 'backfill-authored-metadata', applied: apply, planned: plan.length }));
for (const p of plan) {
  console.log(`  ${p.path}  ->  project=${p.project ?? '(none)'} kind=${p.kind ?? '(none)'}${p.decisionStatus ? ` decision-status=${p.decisionStatus}` : ''}`);
}
if (!apply) console.error('dry run — re-run with --apply to write the frontmatter');
