import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { classifyQuotes } from '../scripts/lint.mjs';
import { buildGraph } from '../scripts/lib/graph.mjs';

// A source page that names its document ("This is Epic Games documentation, "World Partition in Unreal
// Engine"...") quotes a string that exists only in the clipping's `title:` line. The check searched the
// body, so the quote landed in the unverified tier, the one tier meant as a worklist of possible fidelity
// problems: 94 of 1,646 quotes were accurate titles. A quote that is wholly a cited clipping's title is
// now counted on its own and not listed. Nothing else changes tier.

const LINT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'lint.mjs');
const TITLE = 'World Partition in Unreal Engine | Unreal Engine 5.8 Documentation';
const BODY = 'World Partition divides the world into a grid of cells that stream in and out as the player moves.';

function vault(t, { title = TITLE, body = BODY, pages = {}, extraClippings = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'wm-lint-title-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const d of ['raw/clippings', 'wiki/concepts', 'wiki/sources']) mkdirSync(join(root, d), { recursive: true });
  const clip = (name, ttl, text) => writeFileSync(join(root, `raw/clippings/${name}.md`),
    `---\ntitle: ${JSON.stringify(ttl)}\nsource: "https://example.com/${name}"\ncreated: 2026-10-26\ntags: [clippings]\nquality: high\n---\n${text}\n`);
  writeFileSync(join(root, 'index.md'), '---\ntype: synthesis\n---\n# Index\n');
  clip('wp', title, body);
  for (const [name, [ttl, text]] of Object.entries(extraClippings)) clip(name, ttl, text);
  writeFileSync(join(root, 'wiki/sources/wp-page.md'), '---\ntype: source\ncreated: 2026-10-26\nstatus: maintained\nsources: ["[[wp]]"]\nai-generated: true\n---\n# WP Page\nA summary of the clipping.\n');
  for (const [name, text] of Object.entries(pages)) {
    writeFileSync(join(root, 'wiki/concepts', `${name}.md`),
      `---\ntype: concept\ncreated: 2026-10-26\nstatus: maintained\nsources: ["[[wp-page]]"]\nai-generated: true\n---\n# ${name}\n${text}\n`);
  }
  return root;
}
const lint = (root) => classifyQuotes(root, buildGraph(root));

test('a quote that is a cited clipping\'s title is counted as a title match, not listed as unverified', t => {
  const root = vault(t, { pages: { epic: 'This is Epic Games vendor documentation, "World Partition in Unreal Engine", describing the feature.' } });
  const r = lint(root);
  assert.deepEqual(r.findings, [], JSON.stringify(r.findings));
  assert.equal(r.title, 1);
  assert.equal(r.verbatim, 0, 'a title match is its own count, not a verbatim one');
  assert.equal(r.examined, r.verbatim + r.title + r.findings.length, 'every examined quote is accounted for once');
});

test('a title with one word changed stays unverified', t => {
  const root = vault(t, { pages: { epic: 'The vendor documentation, "World Partitions in Unreal Engine", describes the feature.' } });
  const r = lint(root);
  assert.equal(r.title, 0);
  assert.deepEqual(r.findings.map((f) => f.tier), ['unverified']);
});

test('only the title of a clipping the page cites counts', t => {
  const root = vault(t, {
    extraClippings: { other: ['Nanite Virtualized Geometry in Unreal Engine', 'Unrelated body text about geometry and detail.'] },
    pages: { epic: 'The vendor documentation, "Nanite Virtualized Geometry in Unreal Engine", describes the feature.' },
  });
  const r = lint(root);
  assert.equal(r.title, 0, 'the page does not cite the clipping that holds this title');
  assert.deepEqual(r.findings.map((f) => f.tier), ['unverified']);
});

test('a quote that already verifies, or sorts into convention or gapped, keeps its tier', t => {
  // Every quote below is also a substring of the clipping's title. Only the one that would be unverified
  // may move to the title count; the others must keep the tier they had.
  const root = vault(t, {
    title: 'We conclude that in the field of public education the doctrine of separate but equal has no place',
    body: 'We conclude that in the field of public educa tion. Later: the doctrine of separate see footnote but equal has no place. A summary of the clipping.',
    pages: {
      convention: 'The Court wrote "We conclude that in the field of public education" in its opinion.',
      gapped: 'The Court wrote "the doctrine of separate but equal has no place" in its opinion.',
    },
  });
  const r = lint(root);
  const tiers = Object.fromEntries(r.findings.map((f) => [f.page.split('/').pop(), f.tier]));
  assert.equal(tiers['convention.md'], 'convention', JSON.stringify(r.findings));
  assert.equal(tiers['gapped.md'], 'gapped', JSON.stringify(r.findings));
  assert.equal(r.title, 0);
});

test('a quote that verifies verbatim is not touched by the title check', t => {
  const root = vault(t, { title: 'A summary of the clipping and more', pages: { plain: 'The page says "World Partition divides the world into a grid of cells" in passing.' } });
  const r = lint(root);
  assert.deepEqual(r.findings, []);
  assert.equal(r.verbatim, 1);
  assert.equal(r.title, 0);
});

test('the summary line and the JSON report how many quotes matched a title', t => {
  const root = vault(t, { pages: { epic: 'This is vendor documentation, "World Partition in Unreal Engine", describing the feature.' } });
  const env = { ...process.env, WIKI_MASTER_VAULT: root };
  delete env.NODE_TEST_CONTEXT;
  const text = execFileSync(process.execPath, [LINT], { encoding: 'utf8', env });
  assert.match(text, /matched a clipping title: 1 /);
  assert.match(text, /Quote tiers: \d+ examined, \d+ verbatim, \d+ convention, \d+ gapped, \d+ unverified\n/, 'the summary line keeps its format');
  const json = JSON.parse(execFileSync(process.execPath, [LINT, '--json'], { encoding: 'utf8', env }));
  assert.equal(json.tiers.title, 1);
  assert.equal(json.tiers.unverified, 0);
});
