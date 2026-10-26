import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// repair-quote-provenance.mjs reuses the lint's quote extraction, so the nested-quote scanner (0.54.1)
// could have changed what it proposes. Its dry run was never run against a nested quote. A quote that
// already verifies through a citation path needs no repair; a verbatim nested quote on a page with no
// path to the clipping is the one case it exists for.

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'repair-quote-provenance.mjs');
const BROWN = 'We conclude that in the field of public education the doctrine of “separate but equal” has no place.';
const page = (name, sources, body) => `---\ntype: concept\ncreated: 2026-10-26\nstatus: maintained\nsources: [${sources}]\nai-generated: true\n---\n# ${name}\n${body}\n`;

function vault(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-rqp-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const d of ['raw/clippings', 'wiki/concepts', 'wiki/sources']) mkdirSync(join(root, d), { recursive: true });
  const put = (path, text) => writeFileSync(join(root, path), text);
  put('index.md', '---\ntype: synthesis\n---\n# Index\n');
  put('raw/clippings/opinion.md', `---\ntitle: "Opinion"\nsource: "https://example.com/opinion"\ncreated: 2026-10-26\ntags: [clippings]\nquality: high\n---\nThe opinion states: ${BROWN} The Court went on to hold more besides this one sentence.\n`);
  put('wiki/sources/opinion-page.md', '---\ntype: source\ncreated: 2026-10-26\nstatus: maintained\nsources: ["[[opinion]]"]\nai-generated: true\n---\n# Opinion Page\nA summary of the opinion.\n');
  put('wiki/concepts/other.md', page('other', '', 'Unrelated.'));
  // Cites the summary, which cites the clipping: the nested quote verifies and its path exists.
  put('wiki/concepts/cited.md', page('cited', '"[[opinion-page]]"', `The Court wrote "${BROWN}" in its opinion.`));
  // Quotes the same sentence but names a different source: the clipping is not reachable.
  put('wiki/concepts/uncited.md', page('uncited', '"[[other]]"', `The Court wrote "${BROWN}" in its opinion.`));
  return root;
}

function dryRun(root) {
  const env = { ...process.env, WIKI_MASTER_VAULT: root };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  return { summary: JSON.parse(r.stdout.split('\n')[0]), out: r.stdout, err: r.stderr };
}

test('the dry run proposes nothing for a nested quote that already verifies, and only the page with no path to the clipping', t => {
  const { summary, out, err } = dryRun(vault(t));
  assert.equal(summary.applied, false);
  assert.equal(summary.pages, 1, out);
  assert.match(out, /wiki\/concepts\/uncited\.md/);
  assert.doesNotMatch(out, /wiki\/concepts\/cited\.md/);
  assert.match(err, /dry run/);
});

test('a dry run writes nothing', t => {
  const root = vault(t);
  const file = join(root, 'wiki/concepts/uncited.md');
  const before = readFileSync(file, 'utf8');
  dryRun(root);
  assert.equal(readFileSync(file, 'utf8'), before);
});
