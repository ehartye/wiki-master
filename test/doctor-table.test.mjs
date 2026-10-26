import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOLS, CLIPPERS, OTHER, HINTS, NOT_REQUIREMENTS, POPPLER_EXTRAS } from '../scripts/lib/doctor-table.mjs';
import { PYTHON_CANDIDATES } from '../scripts/clip-pptx.mjs';

// The doctor's table is the one list of what each command needs. This pins it to the code: a script that starts
// a program the table does not name fails here, and a table entry no script starts is a phantom.

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === 'triage-ui' ? [] : files(full);
    return /\.(mjs|cjs)$/.test(name) ? [full] : [];
  });
}
const sources = files(SCRIPTS).map((f) => ({ f, text: readFileSync(f, 'utf8') }));

// execFileSync('git', ...), spawnSync('pdftotext', ...): a literal program name as the first argument.
const SPAWN = /\b(?:execFileSync|execFile|spawnSync|spawn|serializedExecFileSync)\(\s*['"]([A-Za-z0-9._-]+)['"]/g;
const spawned = new Set();
for (const { text } of sources) for (const m of text.matchAll(SPAWN)) spawned.add(m[1]);

test('the scan finds the programs the clippers are known to start', () => {
  for (const known of ['git', 'pandoc', 'gh', 'pdftotext', 'soffice']) assert.ok(spawned.has(known), `${known} not found by the scan`);
});

test('every program a script starts by name is in the table', () => {
  const named = new Set([...Object.values(TOOLS).map((t) => t.command), ...NOT_REQUIREMENTS, ...POPPLER_EXTRAS]);
  const missing = [...spawned].filter((c) => !named.has(c));
  assert.deepEqual(missing, [], `programs started by a script but not named in scripts/lib/doctor-table.mjs: ${missing.join(', ')}`);
});

test('every program in the table appears by name in a script', () => {
  const all = sources.map((s) => s.text).join('\n');
  for (const t of Object.values(TOOLS)) assert.ok(all.includes(`'${t.command}'`), `${t.command} is in the table but no script names it`);
  for (const t of POPPLER_EXTRAS) assert.ok(all.includes(`'${t}'`), `${t} is listed as a poppler extra but no script names it`);
});

test('the interpreter candidates the pptx clipper tries are exported for the doctor', () => {
  assert.ok(Array.isArray(PYTHON_CANDIDATES) && PYTHON_CANDIDATES.length >= 2);
});

test('every command in the table is a script, every requirement is defined, and each has a hint', () => {
  for (const [name, spec] of Object.entries(CLIPPERS)) {
    if (name !== 'vault') assert.ok(existsSync(join(SCRIPTS, `${name}.mjs`)), `${name}.mjs does not exist`);
    for (const id of [...spec.required, ...spec.optional]) {
      assert.ok(id in TOOLS || id in OTHER, `${name} needs ${id}, which the table does not define`);
      assert.ok(TOOLS[id]?.hint || HINTS[id], `${id} has no hint`);
    }
    assert.ok(spec.required.length, `${name} has no required entry`);
  }
});

test('every requirement is used by some command', () => {
  const used = new Set(Object.values(CLIPPERS).flatMap((s) => [...s.required, ...s.optional]));
  for (const id of [...Object.keys(TOOLS), ...Object.keys(OTHER)]) assert.ok(used.has(id), `${id} is defined but no command needs it`);
});

test('the poppler programs figure extraction resolves are all in the table or the extras', () => {
  const text = readFileSync(join(SCRIPTS, 'lib', 'pdf-figures.mjs'), 'utf8');
  const named = new Set([...Object.values(TOOLS).map((t) => t.command), ...POPPLER_EXTRAS]);
  const tokens = [...new Set([...text.matchAll(/'(pdf[a-z]{2,10})'/g)].map((m) => m[1]))];
  assert.ok(tokens.includes('pdfimages') && tokens.includes('pdftoppm'), 'the scan did not find the programs');
  assert.deepEqual(tokens.filter((t) => !named.has(t)), []);
});
