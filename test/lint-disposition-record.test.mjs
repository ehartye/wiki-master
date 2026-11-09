import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DISPOSITIONS_FILE } from '../scripts/lib/lint-dispositions.mjs';

// A quote finding's id includes the raw evidence behind its page, so adding a source to a page gives every quote on it a
// new id. A `record` call that named one such id used to fail whole, and the reviewer had to run the full lint again to
// record the rest. --skip-missing records the ids that still exist and names the others.

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const TEMP = realpathSync(tmpdir());
const CLIP = 'The quick brown fox jumps over the lazy dog near the river bank every morning without fail.';
const SEED = '{"v":1,"id":"aaaaaaaaaaaa","page":"wiki/concepts/gone.md","quote":"q","evidence":"e","tier":"unverified","disposition":"accepted","reviewer":"r","date":"2026-11-01"}\n';

function vault(t) {
  const root = mkdtempSync(join(TEMP, 'wm-lint-record-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const d of ['raw/clippings', 'wiki/concepts', 'wiki/sources', 'wiki/syntheses']) mkdirSync(join(root, d), { recursive: true });
  writeFileSync(join(root, 'index.md'), '---\ntype: synthesis\n---\n# Index\n');
  const clipping = (name, body) => {
    writeFileSync(join(root, `raw/clippings/${name}.md`), `---\ntitle: "${name}"\nsource: "https://example.test/${name}"\ncreated: 2026-10-26\nquality: high\n---\n${body}\n`);
    writeFileSync(join(root, `wiki/sources/${name}-page.md`), `---\ntype: source\ncreated: 2026-10-26\nstatus: maintained\nsources: ["[[${name}]]"]\nai-generated: true\n---\n# ${name} page\nA summary of the clipping.\n`);
  };
  clipping('fox', CLIP);
  const fm = (type, sources) => `---\ntype: ${type}\ncreated: 2026-10-01\nupdated: 2026-10-20\nstatus: maintained\nsources: [${sources.map((s) => `"[[${s}]]"`).join(', ')}]\nai-generated: true\n---\n`;
  const concept = (name, text, sources = ['fox-page']) => writeFileSync(join(root, `wiki/concepts/${name}.md`), `${fm('concept', sources)}# ${name}\n${text}\n`);
  const synth = (name, text) => writeFileSync(join(root, `wiki/syntheses/${name}.md`), `${fm('synthesis', ['fox-page'])}# ${name}\n${text}\n`);
  // Two pages with two changed quotes each. The two on alpha share their first eight words.
  concept('alpha', 'Alpha says "The slow brown fox jumps over the lazy dog near the river" and "The slow brown fox jumps over the lazy cat near the river" in passing.');
  concept('beta', 'Beta says "The quick brown wolf jumps over the lazy dog near the river" and "The quick brown fox jumps over the sleepy dog near the river" too.');
  // Adds a clipping to a page's sources: every quote id on that page changes, and the quotes stay unverified.
  const addSource = (page) => {
    clipping('hare', 'A hare sat in a field of clover all afternoon and watched the clouds go by.');
    const file = join(root, `wiki/concepts/${page}.md`);
    writeFileSync(file, readFileSync(file, 'utf8').replace('sources: ["[[fox-page]]"]', 'sources: ["[[fox-page]]", "[[hare-page]]"]'));
  };
  return { root, concept, synth, addSource, file: join(root, DISPOSITIONS_FILE) };
}
const env = (root) => ({ ...process.env, WIKI_MASTER_VAULT: root });
const lintJson = (root, args = []) => JSON.parse(spawnSync(process.execPath, [join(SCRIPTS, 'lint.mjs'), '--json', '--ids', ...args], { encoding: 'utf8', env: env(root) }).stdout);
const record = (root, args) => spawnSync(process.execPath, [join(SCRIPTS, 'lint-disposition.mjs'), 'record', '--disposition=accepted', '--reviewer=tester', ...args], { encoding: 'utf8', env: env(root) });
const idsOn = (root, page) => lintJson(root).findings.filter((f) => f.page === page).map((f) => f.id);
const lines = (file) => readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

// Three ids, the last stale after a source was added to beta, and a file that already holds a line.
function staleCall(t) {
  const v = vault(t);
  const [a1, a2] = idsOn(v.root, 'wiki/concepts/alpha.md');
  const [b1] = idsOn(v.root, 'wiki/concepts/beta.md');
  v.addSource('beta');
  assert.ok(!idsOn(v.root, 'wiki/concepts/beta.md').includes(b1), 'the added source gave beta\'s quotes new ids');
  writeFileSync(v.file, SEED);
  return { v, a1, a2, b1 };
}

test('without --skip-missing a stale id fails the whole call as before, names the id, and writes nothing', (t) => {
  const { v, a1, a2, b1 } = staleCall(t);
  const r = record(v.root, [`--ids=${a1},${a2},${b1}`, '--whole-vault']);
  assert.equal(r.status, 2, r.stdout);
  assert.equal(r.stderr.trim().split('\n').length, 1, r.stderr);
  assert.match(r.stderr, new RegExp(`no finding with id ${b1} in that scope \\(the quote, the flagged sentence or the evidence may have changed`));
  assert.doesNotMatch(r.stderr, new RegExp(`${a1}|${a2}`), 'only the stale id is named');
  assert.match(r.stderr, /--skip-missing/, 'the message says how to record the others');
  assert.equal(readFileSync(v.file, 'utf8'), SEED, 'the dispositions file is byte-identical');
});

test('with --skip-missing the ids that still exist are recorded and the stale one is named', (t) => {
  const { v, a1, a2, b1 } = staleCall(t);
  const r = record(v.root, [`--ids=${a1},${a2},${b1}`, '--whole-vault', '--skip-missing']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /recorded 2 verdict\(s\)/);
  assert.match(r.stdout, new RegExp(`^skipped 1 id\\(s\\) with no current finding in that scope: ${b1}$`, 'm'));
  const written = lines(v.file);
  assert.equal(written.length, 3, 'two lines appended after the one that was there');
  assert.deepEqual(written.slice(1).map((l) => l.id), [a1, a2]);
  assert.ok(readFileSync(v.file, 'utf8').startsWith(SEED));
});

test('with --skip-missing and every id stale, nothing is recorded and the call exits 2', (t) => {
  const { v, b1 } = staleCall(t);
  const r = record(v.root, [`--ids=${b1}`, '--whole-vault', '--skip-missing']);
  assert.equal(r.status, 2, r.stdout);
  assert.match(r.stderr, /nothing recorded/);
  assert.match(r.stderr, new RegExp(`skipped 1 id\\(s\\) with no current finding in that scope: ${b1}`));
  assert.equal(readFileSync(v.file, 'utf8'), SEED);
});
