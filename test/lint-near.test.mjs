import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// `lint.mjs --near` is an opt-in view of the unverified tier: for each unverified quote of six or more
// words it prints the best raw-clipping alignment at 0.85 or better as a word diff, and says which kind of
// document it matched. It changes no tier and the default output and JSON are untouched without the flag.

const LINT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'lint.mjs');
const SOURCE = 'In the interview he said that one may not really knowing what the simulation did at that point in the demo.';

function vault(t, pages) {
  const root = mkdtempSync(join(tmpdir(), 'wm-lint-near-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const d of ['raw/clippings', 'wiki/concepts', 'wiki/sources']) mkdirSync(join(root, d), { recursive: true });
  const put = (p, text) => writeFileSync(join(root, p), text);
  put('index.md', '---\ntype: synthesis\n---\n# Index\n');
  put('raw/clippings/interview.md', `---\ntitle: "Interview"\nsource: "https://example.com/interview"\ncreated: 2026-10-26\ntags: [clippings]\nquality: high\n---\n${SOURCE}\n`);
  // A wiki summary that paraphrases a different sentence: it matches a quote closely but is not evidence.
  put('wiki/sources/interview-page.md', '---\ntype: source\ncreated: 2026-10-26\nstatus: maintained\nsources: ["[[interview]]"]\nai-generated: true\n---\n# Interview Page\nThe committee quietly shelved the proposals indefinitely after the vote.\n');
  for (const [name, body] of Object.entries(pages)) {
    put(`wiki/concepts/${name}.md`, `---\ntype: concept\ncreated: 2026-10-26\nstatus: maintained\nsources: ["[[interview-page]]"]\nai-generated: true\n---\n# ${name}\n${body}\n`);
  }
  return root;
}
const run = (root, ...args) => {
  const env = { ...process.env, WIKI_MASTER_VAULT: root };
  delete env.NODE_TEST_CONTEXT;
  return execFileSync(process.execPath, [LINT, ...args], { encoding: 'utf8', env });
};
const PAGES = {
  grochola: 'He said "not know what the sim did" in the interview.',
  coined: 'The parent asks "will this make my child different from the alternative at all" in the first session.',
  summary: 'The page says "the committee quietly shelved the proposal indefinitely after the vote" in passing.',
  short: 'He said "not know what the sim" in the interview.',
};

test('--near lists an altered quote as a word diff against its raw clipping and names the kind of document', t => {
  const out = run(vault(t, PAGES), '--near');
  assert.match(out, /Near matches/);
  assert.match(out, /wiki\/concepts\/grochola\.md/);
  assert.match(out, /raw\/clippings\/interview\.md \(raw clipping\)/);
  assert.match(out, /not \{\+really\+\} know~knowing what the sim~simulation did/);
});

test('--near does not list a coined question, a five-word quote, or a quote that matches only a wiki summary', t => {
  const out = run(vault(t, PAGES), '--near');
  const near = out.slice(out.indexOf('Near matches'));
  assert.doesNotMatch(near, /coined\.md/);
  assert.doesNotMatch(near, /short\.md/, 'under six words is not listed');
  assert.doesNotMatch(near, /summary\.md/, 'a wiki page is not evidence, so it is not listed as a match');
  assert.match(near, /1 more match only a wiki page/);
});

test('--near --json adds a near block with kind, score, document and diff, and only then', t => {
  const root = vault(t, PAGES);
  const plain = JSON.parse(run(root, '--json'));
  assert.equal('near' in plain, false, 'no flag, no near block');
  const json = JSON.parse(run(root, '--json', '--near'));
  assert.deepEqual(json.near.listed.map((x) => x.page.split('/').pop()), ['grochola.md']);
  const [hit] = json.near.listed;
  assert.equal(hit.kind, 'raw clipping');
  assert.equal(hit.document, 'raw/clippings/interview.md');
  assert.equal(hit.score, 1);
  assert.match(hit.diff, /\{\+really\+\}/);
  assert.equal(json.near.summaryOnly, 1);
  assert.equal(json.near.threshold, 0.85);
  assert.equal(json.tiers.unverified, plain.tiers.unverified, 'no tier changes');
});

test('--near honours --page, and a long diff is printed whole, not clipped', t => {
  const long = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega';
  const root = vault(t, { ...PAGES, long: `He said "${long.replace('kappa', 'KAPPA2')}" at the end.` });
  writeFileSync(join(root, 'raw/clippings/greek.md'), `---\ntitle: "Greek"\nsource: "https://example.com/greek"\ncreated: 2026-10-26\ntags: [clippings]\nquality: high\n---\nThe sequence runs ${long.replace('kappa', 'kappa really')} and ends.\n`);
  writeFileSync(join(root, 'wiki/sources/interview-page.md'), '---\ntype: source\ncreated: 2026-10-26\nstatus: maintained\nsources: ["[[interview]]", "[[greek]]"]\nai-generated: true\n---\n# Interview Page\nThe committee quietly shelved the proposals indefinitely after the vote.\n');
  const only = run(root, '--near', '--page=grochola');
  assert.match(only, /wiki\/concepts\/grochola\.md/);
  assert.doesNotMatch(only.slice(only.indexOf('Near matches')), /long\.md/);
  const all = run(root, '--near');
  const diffLine = all.split('\n').find((l) => l.includes('omicron'));
  assert.ok(diffLine && diffLine.includes('omega'), `the diff line must not be clipped: ${diffLine}`);
});

test('--near output is deterministic', t => {
  const root = vault(t, PAGES);
  assert.equal(run(root, '--near'), run(root, '--near'));
  assert.equal(run(root, '--json', '--near'), run(root, '--json', '--near'));
});

test('without --near the text output has no near section', t => {
  assert.doesNotMatch(run(vault(t, PAGES)), /Near matches/);
});
