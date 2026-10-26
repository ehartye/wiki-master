import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { classifyQuotes } from '../scripts/lint.mjs';
import { buildGraph } from '../scripts/lib/graph.mjs';
import { DISPOSITIONS_FILE, DISPOSITIONS, evidenceHashOf, findingId, loadDispositions, appendDispositions, reviewedBy } from '../scripts/lib/lint-dispositions.mjs';

// The lint reported 2,869 non-verbatim findings on 2026-10-23 and would report them again on the next run, because nothing
// recorded that a finding had been read. A reviewer can now record a verdict against a finding; the lint stops listing it
// while the page's quote and the raw evidence behind it are unchanged, and lists it again when either changes.

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const CLIP = 'The quick brown fox jumps over the lazy dog near the river bank every morning without fail.';
const BAD = '"The slow brown fox jumps over the lazy dog near the river"';
const BAD2 = '"The quick brown wolf jumps over the lazy dog near the river"';

function vault(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-lint-disp-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const d of ['raw/clippings', 'wiki/concepts', 'wiki/sources']) mkdirSync(join(root, d), { recursive: true });
  writeFileSync(join(root, 'index.md'), '---\ntype: synthesis\n---\n# Index\n');
  writeFileSync(join(root, 'raw/clippings/fox.md'), `---\ntitle: "Fox"\nsource: "https://example.com/fox"\ncreated: 2026-10-26\nquality: high\n---\n${CLIP}\n`);
  writeFileSync(join(root, 'wiki/sources/fox-page.md'), '---\ntype: source\ncreated: 2026-10-26\nstatus: maintained\nsources: ["[[fox]]"]\nai-generated: true\n---\n# Fox page\nA summary of the clipping.\n');
  const put = (name, text) => writeFileSync(join(root, `wiki/concepts/${name}.md`),
    `---\ntype: concept\ncreated: 2026-10-01\nupdated: 2026-10-20\nstatus: maintained\nsources: ["[[fox-page]]"]\nai-generated: true\n---\n# ${name}\n${text}\n`);
  put('alpha', `Alpha says ${BAD} in passing.`);
  put('beta', `Beta says ${BAD2} in passing.`);
  return { root, put, file: join(root, DISPOSITIONS_FILE) };
}
const lintRun = (root, args = []) => spawnSync(process.execPath, [join(SCRIPTS, 'lint.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, WIKI_MASTER_VAULT: root } });
const lintJson = (root, args = []) => JSON.parse(lintRun(root, ['--json', ...args]).stdout);
const dispRun = (root, args) => spawnSync(process.execPath, [join(SCRIPTS, 'lint-disposition.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, WIKI_MASTER_VAULT: root } });
const idOf = (root, page) => lintJson(root, ['--ids']).findings.find((f) => f.page === page).id;

test('the evidence hash covers the raw documents only, whatever their order, and changes when a clipping does', () => {
  const a = evidenceHashOf(['raw/clippings/a.md', 'raw/clippings/b.md', 'wiki/sources/s.md'], ['text a', 'text b', 'summary one']);
  assert.equal(a, evidenceHashOf(['raw/clippings/b.md', 'wiki/sources/s.md', 'raw/clippings/a.md'], ['text b', 'summary two', 'text a']), 'order, and a wiki page used as evidence, do not matter');
  assert.notEqual(a, evidenceHashOf(['raw/clippings/a.md', 'raw/clippings/b.md'], ['text a', 'text B']));
  assert.notEqual(a, evidenceHashOf(['raw/clippings/a.md'], ['text a']), 'a clipping added to or taken from the trail matters');
  assert.match(a, /^[0-9a-f]{16}$/);
});

test('a finding id follows the page, the quote (its spacing aside) and the evidence', () => {
  const base = { page: 'wiki/concepts/a.md', quote: 'the slow brown fox', evidenceHash: 'aaaa' };
  const id = findingId(base);
  assert.match(id, /^[0-9a-f]{12}$/);
  assert.equal(id, findingId({ ...base, quote: '  the slow   brown\nfox ' }));
  for (const change of [{ page: 'wiki/concepts/b.md' }, { quote: 'the slow brown wolf' }, { evidenceHash: 'bbbb' }]) assert.notEqual(id, findingId({ ...base, ...change }), JSON.stringify(change));
});

test('every finding carries its id, which is the id of its page, quote and evidence', (t) => {
  const v = vault(t);
  const { findings } = classifyQuotes(v.root, buildGraph(v.root));
  assert.equal(findings.length, 2);
  for (const f of findings) assert.equal(f.id, findingId(f));
});

test('records are read back, the latest of an id wins, and a corrupt or foreign line is skipped', (t) => {
  const v = vault(t);
  assert.equal(loadDispositions(v.file).size, 0, 'no file is no records');
  const rec = (o) => ({ v: 1, id: 'aaaaaaaaaaaa', page: 'p.md', quote: 'q', evidence: 'e', tier: 'unverified', disposition: 'own-wording', reviewer: 'r', date: '2026-10-26', ...o });
  appendDispositions(v.file, [rec({}), rec({ id: 'bbbbbbbbbbbb', disposition: 'mention' })]);
  appendDispositions(v.file, [rec({ disposition: 'accepted' })]);
  appendFileSync(v.file, 'not json\n{"v":2,"id":"cccccccccccc"}\n{"id":"dddddddddddd"}\n\n');
  const m = loadDispositions(v.file);
  assert.deepEqual([...m.keys()].sort(), ['aaaaaaaaaaaa', 'bbbbbbbbbbbb']);
  assert.equal(m.get('aaaaaaaaaaaa').disposition, 'accepted');
});

test('appendDispositions refuses a verdict outside the vocabulary and a missing reviewer', (t) => {
  const v = vault(t);
  assert.throws(() => appendDispositions(v.file, [{ v: 1, id: 'a', disposition: 'looks-fine', reviewer: 'r', date: '2026-10-26' }]), /disposition/);
  assert.throws(() => appendDispositions(v.file, [{ v: 1, id: 'a', disposition: 'accepted', reviewer: '', date: '2026-10-26' }]), /reviewer/);
  assert.equal(existsSync(v.file), false);
  assert.deepEqual(DISPOSITIONS, ['own-wording', 'mention', 'title', 'markup', 'accepted', 'fixed']);
});

test('reviewedBy: a verdict suppresses a finding unless it says "fixed", which a still-present finding contradicts', () => {
  const m = new Map([['aaaaaaaaaaaa', { disposition: 'accepted' }], ['bbbbbbbbbbbb', { disposition: 'fixed' }]]);
  assert.equal(reviewedBy(m, { id: 'aaaaaaaaaaaa' }).disposition, 'accepted');
  assert.equal(reviewedBy(m, { id: 'bbbbbbbbbbbb' }), null);
  assert.equal(reviewedBy(m, { id: 'cccccccccccc' }), null);
});

test('--ids adds each finding\'s id to the listing and the JSON, and nothing else is added', (t) => {
  const v = vault(t);
  const plain = lintJson(v.root);
  assert.ok(plain.findings.every((f) => !('id' in f) && !('evidenceHash' in f)), 'the default shape is unchanged');
  const withIds = lintJson(v.root, ['--ids']);
  assert.ok(withIds.findings.every((f) => /^[0-9a-f]{12}$/.test(f.id) && !('evidenceHash' in f)));
  assert.match(lintRun(v.root, ['--ids']).stdout, /\[[0-9a-f]{12}\]/);
  assert.doesNotMatch(lintRun(v.root).stdout, /\[[0-9a-f]{12}\]/);
});

test('with no record file the output has no reviewed line and no reviewed counts', (t) => {
  const v = vault(t);
  assert.doesNotMatch(lintRun(v.root).stdout, /[Rr]eviewed/);
  assert.equal('reviewed' in lintJson(v.root).tiers, false);
});

test('recording a verdict hides the finding on the next run, counts it, and lists it again on request', (t) => {
  const v = vault(t);
  const id = idOf(v.root, 'wiki/concepts/alpha.md');
  const r = dispRun(v.root, ['record', `--ids=${id}`, '--disposition=own-wording', '--reviewer=Reader One', '--note=the page\'s own example', '--page=wiki/concepts/alpha.md']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /recorded 1 verdict/);
  const j = lintJson(v.root);
  assert.deepEqual(j.findings.map((f) => f.page), ['wiki/concepts/beta.md']);
  assert.deepEqual(j.tiers.reviewed, { convention: 0, gapped: 0, unverified: 1 });
  assert.deepEqual(j.tiers.unreviewed, { convention: 0, gapped: 0, unverified: 1 });
  assert.equal(j.tiers.unverified, 2, 'the tier total still counts the reviewed finding');
  const text = lintRun(v.root).stdout;
  assert.match(text, /Reviewed \(lint-dispositions\.jsonl\): unverified 1; not yet reviewed: unverified 1/);
  assert.match(text, /Unverifiable quotes: 1$/m);
  const all = lintJson(v.root, ['--include-reviewed']);
  const shown = all.findings.find((f) => f.page === 'wiki/concepts/alpha.md');
  assert.equal(shown.reviewed.disposition, 'own-wording');
  assert.equal(shown.reviewed.reviewer, 'Reader One');
  assert.equal(shown.reviewed.date.length, 10);
  assert.match(readFileSync(v.file, 'utf8'), /"note":"the page's own example"/);
});

test('editing the quote lists the finding again', (t) => {
  const v = vault(t);
  dispRun(v.root, ['record', `--ids=${idOf(v.root, 'wiki/concepts/alpha.md')}`, '--disposition=accepted', '--reviewer=r', '--page=wiki/concepts/alpha.md']);
  assert.equal(lintJson(v.root).findings.some((f) => f.page === 'wiki/concepts/alpha.md'), false);
  v.put('alpha', 'Alpha says "The slow brown fox jumps over the lazy dog near the river bank" in passing.');
  assert.equal(lintJson(v.root).findings.some((f) => f.page === 'wiki/concepts/alpha.md'), true);
});

test('replacing the clipping lists the finding again', (t) => {
  const v = vault(t);
  dispRun(v.root, ['record', `--ids=${idOf(v.root, 'wiki/concepts/alpha.md')}`, '--disposition=accepted', '--reviewer=r', '--page=wiki/concepts/alpha.md']);
  writeFileSync(join(v.root, 'raw/clippings/fox.md'), `---\ntitle: "Fox"\nsource: "https://example.com/fox"\ncreated: 2026-10-26\nquality: high\n---\n${CLIP} A new closing sentence has been added by a re-clip.\n`);
  assert.equal(lintJson(v.root).findings.some((f) => f.page === 'wiki/concepts/alpha.md'), true);
});

test('a fixed verdict on a finding that is still there does not hide it', (t) => {
  const v = vault(t);
  dispRun(v.root, ['record', `--ids=${idOf(v.root, 'wiki/concepts/alpha.md')}`, '--disposition=fixed', '--reviewer=r', '--page=wiki/concepts/alpha.md']);
  assert.equal(lintJson(v.root).findings.some((f) => f.page === 'wiki/concepts/alpha.md'), true);
});

test('the later of two verdicts for one finding is the one that counts', (t) => {
  const v = vault(t);
  const id = idOf(v.root, 'wiki/concepts/alpha.md');
  dispRun(v.root, ['record', `--ids=${id}`, '--disposition=accepted', '--reviewer=r', '--page=wiki/concepts/alpha.md']);
  dispRun(v.root, ['record', `--ids=${id}`, '--disposition=fixed', '--reviewer=r', '--page=wiki/concepts/alpha.md']);
  assert.equal(lintJson(v.root).findings.some((f) => f.page === 'wiki/concepts/alpha.md'), true);
});

test('a reviewed finding is also left out of --near', (t) => {
  const v = vault(t);
  assert.ok(lintJson(v.root, ['--near']).near.listed.length >= 1);
  for (const page of ['alpha', 'beta']) dispRun(v.root, ['record', `--ids=${idOf(v.root, `wiki/concepts/${page}.md`)}`, '--disposition=accepted', '--reviewer=r', `--page=wiki/concepts/${page}.md`]);
  assert.equal(lintJson(v.root, ['--near']).near.listed.length, 0);
});

test('record needs a vocabulary verdict, a reviewer, a scope, and ids that the scope contains', (t) => {
  const v = vault(t);
  const id = idOf(v.root, 'wiki/concepts/alpha.md');
  const bad = [
    [`--ids=${id}`, '--disposition=looks-fine', '--reviewer=r', '--page=wiki/concepts/alpha.md'],
    [`--ids=${id}`, '--disposition=accepted', '--page=wiki/concepts/alpha.md'],
    [`--ids=${id}`, '--disposition=accepted', '--reviewer=r'],
    ['--disposition=accepted', '--reviewer=r', '--page=wiki/concepts/alpha.md'],
    [`--ids=${id}`, '--disposition=accepted', '--reviewer=r', '--page=wiki/concepts/beta.md'],
    ['--ids=000000000000', '--disposition=accepted', '--reviewer=r', '--page=wiki/concepts/alpha.md'],
    [`--ids=${id}`, '--disposition=accepted', '--reviewer=r', '--page=wiki/concepts/alpha.md', '--whole-vault'],
  ];
  for (const args of bad) {
    const r = dispRun(v.root, ['record', ...args]);
    assert.equal(r.status, 2, args.join(' '));
    assert.equal(r.stderr.trim().split('\n').length, 1, r.stderr);
  }
  assert.equal(existsSync(v.file), false, 'nothing was written');
  const unknown = dispRun(v.root, ['record', '--ids=000000000000', '--disposition=accepted', '--reviewer=r', '--page=wiki/concepts/alpha.md']);
  assert.match(unknown.stderr, /no finding with id 000000000000 in that scope/);
});

test('--whole-vault is the scope that needs no page, and a ledger is another', (t) => {
  const v = vault(t);
  const id = idOf(v.root, 'wiki/concepts/beta.md');
  assert.equal(dispRun(v.root, ['record', `--ids=${id}`, '--disposition=mention', '--reviewer=r', '--whole-vault']).status, 0);
  const ledger = join(v.root, '..', `l-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(ledger, JSON.stringify(['wiki/concepts/alpha.md']));
  const idA = idOf(v.root, 'wiki/concepts/alpha.md');
  assert.equal(dispRun(v.root, ['record', `--ids=${idA}`, '--disposition=markup', '--reviewer=r', `--paths-file=${ledger}`]).status, 0);
  assert.equal(lintJson(v.root).findings.length, 0);
  rmSync(ledger);
});

test('prune lists the records of a page that is gone, and --apply removes only those', (t) => {
  const v = vault(t);
  for (const page of ['alpha', 'beta']) dispRun(v.root, ['record', `--ids=${idOf(v.root, `wiki/concepts/${page}.md`)}`, '--disposition=accepted', '--reviewer=r', `--page=wiki/concepts/${page}.md`]);
  rmSync(join(v.root, 'wiki/concepts/beta.md'));
  const dry = dispRun(v.root, ['prune']);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /1 record\(s\) for a page that no longer exists/);
  assert.match(dry.stdout, /dry run/);
  assert.equal(loadDispositions(v.file).size, 2);
  const applied = dispRun(v.root, ['prune', '--apply']);
  assert.match(applied.stdout, /removed 1/);
  const left = [...loadDispositions(v.file).values()];
  assert.deepEqual(left.map((r) => r.page), ['wiki/concepts/alpha.md']);
});

test('the command refuses an unknown subcommand or option in one line', (t) => {
  const v = vault(t);
  for (const args of [[], ['frobnicate'], ['record', '--bogus']]) {
    const r = dispRun(v.root, args);
    assert.equal(r.status, 2, args.join(' '));
    assert.equal(r.stderr.trim().split('\n').length, 1, r.stderr);
  }
  assert.equal(dispRun(v.root, ['--help']).status, 0);
});
