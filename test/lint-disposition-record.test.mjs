import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DISPOSITIONS_FILE, matchByQuote } from '../scripts/lib/lint-dispositions.mjs';

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

// --by-quote=<file> records verdicts by page and quote, so a reviewer who read the findings before adding a source to a
// page records them under their current ids without a second lint run. An entry is never guessed: one that matches more
// than one finding is refused.

function entriesFile(t, entries) {
  const dir = mkdtempSync(join(TEMP, 'wm-lint-entries-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'entries.json');
  writeFileSync(file, typeof entries === 'string' ? entries : JSON.stringify(entries));
  return file;
}
const pick = ({ page, quote }) => ({ page, quote });

test('matchByQuote: whitespace-collapsed equality on the entry\'s page, a "..." prefix only when nothing is equal, one distinct id', () => {
  const F = (id, page, quote, tier = 'unverified') => ({ id, page, quote, tier });
  const findings = [
    F('a1', 'p.md', 'the slow brown fox'), F('a2', 'p.md', 'the slow brown cat'), F('a1', 'p.md', 'the slow brown fox'),
    F('b1', 'q.md', 'the slow brown fox'), F('s1', 'p.md', 'the lazy dog', 'style'), F('c1', 'p.md', 'the slow brown fox...'),
  ];
  const entries = [
    { page: 'p.md', quote: '  the slow\n brown   fox ' }, // equal after collapsing, twice on the page with one id
    { page: 'p.md', quote: 'the slow brown ...' }, // a prefix of three different quotes
    { page: 'p.md', quote: 'the slow brown c...' }, // a prefix of one
    { page: 'p.md', quote: 'the slow brown fox...' }, // equal to a quote that ends in "...", so not read as a prefix
    { page: 'r.md', quote: 'the slow brown fox' }, // no finding on that page
    { page: 'p.md', quote: 'the lazy dog' }, // a style finding is not a quote finding
  ];
  const { matched, missing, ambiguous } = matchByQuote(findings, entries);
  assert.deepEqual(matched.map((m) => [m.index, m.finding.id]), [[0, 'a1'], [2, 'a2'], [3, 'c1']]);
  assert.deepEqual(missing.map((m) => m.index), [4, 5]);
  assert.deepEqual(ambiguous.map((m) => [m.index, m.count]), [[1, 3]]);
  assert.equal(missing[0].entry, entries[4]);
});

test('--by-quote records entries read before a source was added, under the current ids, with no scope option', (t) => {
  const v = vault(t);
  const before = lintJson(v.root).findings;
  assert.equal(before.length, 4);
  const file = entriesFile(t, before.map(pick));
  v.addSource('alpha');
  v.addSource('beta');
  const r = record(v.root, [`--by-quote=${file}`]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /recorded 4 verdict\(s\)/);
  const written = lines(v.file);
  assert.equal(written.length, 4);
  const oldIds = new Set(before.map((f) => f.id));
  assert.ok(written.every((l) => !oldIds.has(l.id)), 'no line is under an old id');
  assert.deepEqual(lintJson(v.root).findings, [], 'every current finding is now reviewed');
});

test('an entry that matches nothing is named; it fails the call without --skip-missing and is skipped with it', (t) => {
  const v = vault(t);
  writeFileSync(v.file, SEED);
  const entries = [...lintJson(v.root).findings.map(pick), { page: 'wiki/concepts/beta.md', quote: 'A sentence that no page of this vault quotes anywhere at all' }];
  const file = entriesFile(t, entries);
  const fail = record(v.root, [`--by-quote=${file}`]);
  assert.equal(fail.status, 2, fail.stdout);
  assert.equal(fail.stderr.trim().split('\n').length, 1, fail.stderr);
  assert.match(fail.stderr, /entry 4 \(wiki\/concepts\/beta\.md: "A sentence that no page of this vault quotes anywhere at all", 0 matches\)/);
  assert.match(fail.stderr, /--skip-missing/);
  assert.equal(readFileSync(v.file, 'utf8'), SEED);
  const skip = record(v.root, [`--by-quote=${file}`, '--skip-missing']);
  assert.equal(skip.status, 0, skip.stderr);
  assert.match(skip.stdout, /recorded 4 verdict\(s\)/);
  assert.match(skip.stdout, /^skipped 1 entr\(ies\) with no matching finding$/m);
  assert.match(skip.stdout, /^ {2}entry 4 \(wiki\/concepts\/beta\.md: "A sentence that no page of this vault quotes anywhere at all", 0 matches\)$/m);
  assert.equal(lines(v.file).length, 5);
});

test('an entry ending in "..." whose prefix starts two quotes on its page is refused as ambiguous, naming the count', (t) => {
  const v = vault(t);
  const page = 'wiki/concepts/alpha.md';
  const shared = { page, quote: 'The slow brown fox jumps over the lazy ...' };
  const unique = { page, quote: 'The slow brown fox jumps over the lazy cat...' };
  const file = entriesFile(t, [shared, unique]);
  const fail = record(v.root, [`--by-quote=${file}`]);
  assert.equal(fail.status, 2, fail.stdout);
  assert.match(fail.stderr, /entry 0 \(wiki\/concepts\/alpha\.md: "The slow brown fox jumps over the lazy \.\.\.", 2 matches\)/);
  assert.throws(() => readFileSync(v.file), /ENOENT/, 'nothing was written');
  const skip = record(v.root, [`--by-quote=${file}`, '--skip-missing']);
  assert.equal(skip.status, 0, skip.stderr);
  assert.match(skip.stdout, /^refused 1 ambiguous entr\(ies\)$/m);
  assert.match(skip.stdout, /^ {2}entry 0 \(wiki\/concepts\/alpha\.md: "The slow brown fox jumps over the lazy \.\.\.", 2 matches\)$/m);
  const written = lines(v.file);
  assert.equal(written.length, 1);
  assert.equal(written[0].quote, 'The slow brown fox jumps over the lazy cat near the river');
});

test('the same quote written twice on one page records one line', (t) => {
  const v = vault(t);
  const q = 'The quick brown fox jumps over the lazy hound near the river';
  v.concept('gamma', `Gamma says "${q}" and later says "${q}" again.`);
  const file = entriesFile(t, [{ page: 'wiki/concepts/gamma.md', quote: q }]);
  const r = record(v.root, [`--by-quote=${file}`]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(lines(v.file).length, 1);
});

test('a saved lint.mjs --json findings array is accepted as the file', (t) => {
  const v = vault(t);
  const saved = JSON.parse(spawnSync(process.execPath, [join(SCRIPTS, 'lint.mjs'), '--json'], { encoding: 'utf8', env: env(v.root) }).stdout).findings;
  // Saved with a byte-order mark, as some Windows shells write a redirected file.
  const file = entriesFile(t, `\uFEFF${JSON.stringify(saved, null, 2)}`);
  const r = record(v.root, [`--by-quote=${file}`]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(lines(v.file).length, 4);
});

test('--by-quote matches quote findings only: a style flag\'s page and words are reported missing', (t) => {
  const v = vault(t);
  v.synth('joint', 'It rose, but only slightly.');
  const flag = lintJson(v.root).style.find((f) => f.category === 'connective');
  assert.ok(flag, 'the fixture has a style flag');
  const file = entriesFile(t, [{ page: flag.page, quote: flag.word }, { page: flag.page, quote: `${flag.category}: ${flag.word}` }]);
  const r = record(v.root, [`--by-quote=${file}`]);
  assert.equal(r.status, 2, r.stdout);
  assert.match(r.stderr, /entry 0 \(wiki\/syntheses\/joint\.md: .*0 matches\).*entry 1 \(wiki\/syntheses\/joint\.md: .*0 matches\)/);
});

test('--ids and --by-quote together record both, the ids in their own scope', (t) => {
  const v = vault(t);
  v.synth('joint', 'It rose, but only slightly.');
  const listed = lintJson(v.root);
  const flag = listed.style.find((f) => f.category === 'connective');
  const quote = listed.findings.find((f) => f.page === 'wiki/concepts/beta.md');
  const file = entriesFile(t, [pick(quote)]);
  const r = record(v.root, [`--ids=${flag.id}`, '--page=wiki/syntheses/joint.md', `--by-quote=${file}`]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(lines(v.file).map((l) => l.id).sort(), [flag.id, quote.id].sort());
});

test('a --by-quote file inside the vault is refused with exit 2 and the dispositions file is byte-identical', (t) => {
  const v = vault(t);
  writeFileSync(v.file, SEED);
  const inside = join(v.root, 'entries.json');
  writeFileSync(inside, JSON.stringify(lintJson(v.root).findings.map(pick)));
  const r = record(v.root, [`--by-quote=${inside}`]);
  assert.equal(r.status, 2, r.stdout);
  assert.equal(r.stderr.trim(), `lint-disposition: --by-quote file must be outside the vault: ${inside}`);
  assert.equal(readFileSync(v.file, 'utf8'), SEED);
});

test('a --by-quote file reached through a directory link into the vault is refused by its real path', (t) => {
  const v = vault(t);
  writeFileSync(v.file, SEED);
  mkdirSync(join(v.root, 'scratch'));
  writeFileSync(join(v.root, 'scratch', 'entries.json'), JSON.stringify(lintJson(v.root).findings.map(pick)));
  const outside = mkdtempSync(join(TEMP, 'wm-lint-record-link-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  const link = join(outside, 'link');
  symlinkSync(join(v.root, 'scratch'), link, 'junction');
  const viaLink = join(link, 'entries.json');
  const r = record(v.root, [`--by-quote=${viaLink}`]);
  assert.equal(r.status, 2, r.stdout);
  assert.equal(r.stderr.trim(), `lint-disposition: --by-quote file must be outside the vault: ${viaLink}`);
  assert.equal(readFileSync(v.file, 'utf8'), SEED);
});

test('an entry whose quote is only "..." matches nothing, even on a page with one finding', (t) => {
  const v = vault(t);
  v.concept('solo', 'Solo says "The quick brown fox jumps over the lazy hound near the river" once.');
  assert.equal(lintJson(v.root).findings.filter((f) => f.page === 'wiki/concepts/solo.md').length, 1, 'the page has one finding');
  const file = entriesFile(t, [{ page: 'wiki/concepts/solo.md', quote: '...' }]);
  const r = record(v.root, [`--by-quote=${file}`]);
  assert.equal(r.status, 2, r.stdout);
  assert.match(r.stderr, /entry 0 \(wiki\/concepts\/solo\.md: "\.\.\.", 0 matches\)/);
  assert.throws(() => readFileSync(v.file), /ENOENT/, 'nothing was written');
});

test('a --by-quote file that is not an array of {page, quote} objects exits 2, names the bad entry, and writes nothing', (t) => {
  const v = vault(t);
  writeFileSync(v.file, SEED);
  const good = { page: 'wiki/concepts/alpha.md', quote: 'The slow brown fox jumps over the lazy dog near the river' };
  const cases = [
    ['{"page":"a.md","quote":"q"}', /JSON array/],
    ['not json', /--by-quote/],
    ['[]', /no entries/],
    [JSON.stringify([good, { page: 'wiki/concepts/alpha.md' }]), /entry 1 /],
    [JSON.stringify([good, good, { page: 3, quote: 'q' }]), /entry 2 /],
    [JSON.stringify([null]), /entry 0 /],
  ];
  for (const [body, pattern] of cases) {
    const r = record(v.root, [`--by-quote=${entriesFile(t, body)}`]);
    assert.equal(r.status, 2, body);
    assert.equal(r.stderr.trim().split('\n').length, 1, r.stderr);
    assert.match(r.stderr, pattern, body);
  }
  const absent = record(v.root, [`--by-quote=${join(TEMP, 'wm-no-such-entries-file.json')}`]);
  assert.equal(absent.status, 2);
  assert.equal(readFileSync(v.file, 'utf8'), SEED);
});

test('--by-quote refuses a scope option without --ids, and a style-only verdict', (t) => {
  const v = vault(t);
  const file = entriesFile(t, lintJson(v.root).findings.map(pick));
  const scoped = record(v.root, [`--by-quote=${file}`, '--whole-vault']);
  assert.equal(scoped.status, 2, scoped.stdout);
  assert.match(scoped.stderr, /scope/);
  const styleOnly = spawnSync(process.execPath, [join(SCRIPTS, 'lint-disposition.mjs'), 'record', '--disposition=source-wording', '--reviewer=tester', `--by-quote=${file}`], { encoding: 'utf8', env: env(v.root) });
  assert.equal(styleOnly.status, 2, styleOnly.stdout);
  assert.match(styleOnly.stderr, /style flags only/);
  assert.throws(() => readFileSync(v.file), /ENOENT/);
});
