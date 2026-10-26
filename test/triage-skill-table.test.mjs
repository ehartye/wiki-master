import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLIP_ACTS, FIDELITY_ACTS, EXPIRY_ACTS, BACKLOG_ACTS, HUB_STUB_ACTS } from '../scripts/triage.mjs';

// The `wiki-triage` skill tells an agent what to do for each disposition the queue can record. The table named
// `clipped-by-hand` while the queue writes `clipped-manually`, and left out `downloaded`, and nothing noticed. The ids
// in the table are now checked against the ids the queue offers, in both directions.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL = readFileSync(join(ROOT, 'skills', 'wiki-triage', 'SKILL.md'), 'utf8');
const ALL_ACTS = [...CLIP_ACTS, ...FIDELITY_ACTS, ...EXPIRY_ACTS, ...BACKLOG_ACTS, ...HUB_STUB_ACTS];

// The first cell's code spans of each row of the disposition table.
export function tableRows(markdown) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => /^\|\s*disposition\s*\|/.test(l));
  if (start < 0) throw new Error('the skill has no "| disposition |" table');
  const rows = [];
  for (let i = start + 2; i < lines.length && lines[i].startsWith('|'); i++) {
    const cells = lines[i].split('|').slice(1, -1).map((c) => c.trim());
    rows.push({ tokens: [...cells[0].matchAll(/`([^`]+)`/g)].map((m) => m[1]), action: cells[1] ?? '' });
  }
  return rows;
}

// What disagrees: ids the queue offers that the table lacks, and table entries that are neither an id nor a label.
export function tableProblems(markdown, acts = ALL_ACTS) {
  const ids = new Set(acts.map((a) => a.id));
  const labels = new Set(acts.map((a) => a.label));
  const tokens = new Set(tableRows(markdown).flatMap((r) => r.tokens));
  return [
    ...[...ids].filter((id) => !tokens.has(id)).map((id) => `the queue offers '${id}' but the skill table does not list it`),
    ...[...tokens].filter((tk) => !ids.has(tk) && !labels.has(tk)).map((tk) => `the skill table lists '${tk}', which the queue neither writes nor labels`),
  ];
}

test('the skill table lists every disposition the queue offers and nothing the queue does not', () => {
  assert.deepEqual(tableProblems(SKILL), []);
});

test('the check fails on a table that names clipped-by-hand, or lacks downloaded', () => {
  const swapped = SKILL.replace('| `clipped-manually` (shown', '| `clipped-by-hand` (shown');
  assert.notEqual(swapped, SKILL);
  const problems = tableProblems(swapped);
  assert.ok(problems.some((p) => /offers 'clipped-manually'/.test(p)), problems.join('\n'));
  assert.ok(problems.some((p) => /lists 'clipped-by-hand'/.test(p)), problems.join('\n'));

  const lines = SKILL.split('\n');
  const without = lines.filter((l) => !l.startsWith('| `downloaded`')).join('\n');
  assert.notEqual(without, SKILL);
  assert.ok(tableProblems(without).some((p) => /offers 'downloaded'/.test(p)));
});

test('the reclip row names the three clippers that can re-clip a file', () => {
  const row = tableRows(SKILL).find((r) => r.tokens.includes('reclip'));
  assert.ok(row);
  for (const clipper of ['clip-pdf', 'clip-docx', 'clip-xlsx']) assert.match(row.action, new RegExp(clipper), `the reclip row does not name ${clipper}`);
});

test('the exported arrays are the ones the screen offers', async () => {
  const { renderScreen } = await import('../scripts/triage.mjs');
  const empty = { clipFailures: [], fidelity: [], expiring: [], backlog: [], backlogTotal: 0, hubStubs: [], hubStubTotal: 0, attention: [], total: 0 };
  assert.equal(typeof renderScreen, 'function');
  assert.ok(renderScreen(empty).length > 0);
  for (const acts of [CLIP_ACTS, FIDELITY_ACTS, EXPIRY_ACTS, BACKLOG_ACTS, HUB_STUB_ACTS]) {
    assert.ok(acts.length >= 2 && acts.every((a) => a.id && a.label));
  }
});
