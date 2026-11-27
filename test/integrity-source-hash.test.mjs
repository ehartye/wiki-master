import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanIntegrity, integrityReport, deriveIntegrity } from '../scripts/lib/integrity.mjs';
import { buildGraph } from '../scripts/lib/graph.mjs';
import { readGraphCache } from '../scripts/lib/graph-cache-read.mjs';
import { writeGraphCache } from '../scripts/lib/graph-cache-write.mjs';

// health.mjs checks each clipping under raw/clippings/ against its recorded source-hash through verifyClippingHash.
// A real mismatch is the integrity defect `source-hash-mismatch`; a match is silent, and the two equivalent statuses
// (the same text with other line endings, or with one more final line break) are counted on one unscored line.

const HEALTH = fileURLToPath(new URL('../scripts/health.mjs', import.meta.url));
const sha = (s) => createHash('sha256').update(s).digest('hex');
const crlf = (s) => s.replace(/\r?\n/g, '\r\n');
const MD = '# Captured\n\nWords that were captured from the page.';
const clip = (hash, { md = MD, extra = '' } = {}) =>
  `---\ntitle: "T"\nsource: "https://example.test/page"\ncreated: 2026-01-01\n${extra}source-hash: ${hash}\ntags: [clippings]\n---\n\n${md}\n`;
// The old rule, before line endings were normalized: the framing stripped, carriage returns kept.
const oldRuleText = (fileText) => fileText.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').replace(/^\r?\n/, '').replace(/\n$/, '');
const allCrlf = crlf(clip('HASH'));
const SOURCE = '---\ntype: source\nstatus: maintained\nsources: ["[[raw/clippings/match.md]]"]\n---\n# Source\n\nA source page that summarizes the captured page in plain words, citing [[raw/clippings/match.md]].\n';

// One clipping of each status, a clipping with no hash, and a mismatching file outside raw/clippings/.
const EACH = {
  'wiki/sources/source.md': SOURCE,
  'raw/clippings/match.md': clip(sha(MD)),
  'raw/clippings/match-raw.md': allCrlf.replace('HASH', sha(oldRuleText(allCrlf))),
  'raw/clippings/crlf-variant.md': clip(sha(crlf(MD))),
  'raw/clippings/trailing-newline.md': clip(sha(`${MD}\n`)),
  'raw/clippings/nested/mismatch.md': clip(sha('Other words entirely.')),
  'raw/clippings/no-hash.md': clip('').replace('source-hash: \n', ''),
  'raw/research/elsewhere.md': clip(sha('Not this text.')),
};
const OLD = Date.now() / 1000 - 3600;

function fixture(t, files = EACH) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'wm-source-hash-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, text, time = OLD) => {
    const abs = join(root, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
    utimesSync(abs, time, time);
  };
  for (const [path, text] of Object.entries(files)) put(path, text);
  return { root, put };
}
const mismatches = (r) => r.issues.filter((i) => i.rule === 'source-hash-mismatch');
const run = (root, args = []) => spawnSync(process.execPath, [HEALTH, ...args], { encoding: 'utf8', env: { ...process.env, WIKI_MASTER_VAULT: root } });

test('a vault with one clipping of each status reports exactly one source-hash-mismatch, with its line and fix text', (t) => {
  const { root } = fixture(t);
  const r = scanIntegrity(root);
  const found = mismatches(r);
  assert.equal(found.length, 1, JSON.stringify(found));
  const [issue] = found;
  assert.equal(issue.source, 'raw/clippings/nested/mismatch.md');
  assert.equal(issue.line, 5, 'the line of the recorded source-hash');
  assert.match(issue.evidence, /^source-hash: [0-9a-f]{64}$/);
  assert.match(issue.verification, /clip\.mjs/);
  assert.match(issue.verification, /--recapture/, 'a web capture is recaptured');
  assert.ok(r.coverage.checks.includes('source-hash-mismatch'));
  assert.equal(r.status, 'defects');
  assert.equal(r.defectCount, r.issues.length);
  assert.deepEqual(r.clippingHashes, { checked: 5, match: 1, 'match-raw': 1, 'crlf-variant': 1, 'trailing-newline': 1, mismatch: 1 });
  assert.deepEqual(r.equivalentClippingHashes, [
    { page: 'raw/clippings/crlf-variant.md', status: 'crlf-variant' },
    { page: 'raw/clippings/trailing-newline.md', status: 'trailing-newline' },
  ]);
});

test('the mismatch is the only new defect: without that clipping the count is one lower and the rest are silent', (t) => {
  const withIt = scanIntegrity(fixture(t).root);
  const { 'raw/clippings/nested/mismatch.md': _, ...rest } = EACH;
  const without = scanIntegrity(fixture(t, rest).root);
  assert.equal(withIt.defectCount, without.defectCount + 1);
  assert.equal(mismatches(without).length, 0);
  assert.equal(without.clippingHashes.mismatch, 0);
});

// One mismatched clipping in a vault, with the frontmatter given; returns its issue.
function mismatchOf(t, name, frontmatter) {
  const text = `---\ntitle: "T"\n${frontmatter}created: 2026-01-01\nsource-hash: ${sha('Other words.')}\ntags: [clippings]\n---\n\n${MD}\n`;
  const { root } = fixture(t, { 'wiki/sources/source.md': SOURCE, 'raw/clippings/match.md': clip(sha(MD)), [name]: text });
  const [issue, ...more] = mismatches(scanIntegrity(root));
  assert.deepEqual(more, []);
  assert.equal(issue.source, name);
  return issue;
}

// Every route leaves the owner a re-adoption and a transfer they approve, and none edits the body.
const ownerPaths = (issue) => {
  assert.match(issue.verification, /adopt-clipping\.mjs/);
  assert.match(issue.verification, /--allow-hash-mismatch/);
  assert.match(issue.verification, /Never edit the body/);
};

test('a page a person saved (extraction: manual) is captured again from a newly saved copy, never fetched', (t) => {
  const issue = mismatchOf(t, 'raw/clippings/supplied.md', 'source: "https://example.test/changelog"\nextraction: manual\n');
  assert.equal(issue.capture, 'manual');
  assert.equal(issue.clipper, 'clip.mjs');
  assert.match(issue.verification, /may not be recapturable/);
  assert.match(issue.verification, /owner/);
  assert.ok(issue.verification.includes('`node scripts/clip.mjs <source> --from-file <path> --recapture`'), issue.verification);
  assert.match(issue.verification, /supply the original again[^;]*--from-file <path> --recapture/, 'supplying the original names the command');
  assert.doesNotMatch(issue.verification, /clip\.mjs <source> --recapture/, 'a fetch would replace the person-saved text with another page');
  ownerPaths(issue);
});

// No clipper writes extraction: user-supplied-*, and none writes a clipping whose source is not a web address.
for (const [kind, name, frontmatter] of [
  ['a supplied transcript of a web video', 'raw/clippings/talk.md', 'source: "https://video.example.test/watch?v=abc"\nextraction: user-supplied-transcript\n'],
  ['a hand-made clipping with no web source', 'raw/clippings/notes.md', 'source: "notes from a meeting"\n'],
]) {
  test(`${kind} names no clipper and no fetch route: owner review, the original supplied again, re-adoption`, (t) => {
    const issue = mismatchOf(t, name, frontmatter);
    assert.equal(issue.capture, 'manual');
    assert.equal(issue.clipper, null);
    assert.match(issue.verification, /no clipper/i);
    assert.match(issue.verification, /compare/);
    assert.match(issue.verification, /supply the original again/);
    assert.doesNotMatch(issue.verification, /scripts\/clip[-.]/, 'no clipper command');
    assert.doesNotMatch(issue.verification, /--recapture|--from-file/);
    ownerPaths(issue);
  });
}

// A web capture's fix names the clipper that matches it, from its source, its extraction or its folder, and says what
// running that clipper again does to this clipping.
const CLIPPERS = [
  ['a web page', 'raw/clippings/page.md', 'source: "https://example.test/page"\n', 'clip.mjs'],
  ['a GitHub file', 'raw/clippings/gh/o/r/README.md', 'source: "https://github.com/o/r/blob/main/README.md"\n', 'clip-gh.mjs'],
  ['a PDF by its address', 'raw/clippings/paper.md', 'source: "https://example.test/files/paper.pdf"\n', 'clip-pdf.mjs'],
  ['a PDF by its extraction', 'raw/clippings/scan.md', 'source: "https://example.test/files/scan"\nextraction: ocr\n', 'clip-pdf.mjs'],
  ['a Word document', 'raw/clippings/memo.md', 'source: "https://example.test/files/memo.docx"\n', 'clip-docx.mjs'],
  ['a slide deck', 'raw/clippings/deck.md', 'source: "https://example.test/files/deck.pptx"\n', 'clip-pptx.mjs'],
  ['a spreadsheet', 'raw/clippings/sheet.md', 'source: "https://example.test/files/sheet.xlsx"\n', 'clip-xlsx.mjs'],
  ['a Confluence page', 'raw/clippings/space.md', 'source: "https://example.atlassian.net/wiki/spaces/S/pages/1/Page"\n', 'clip-confluence.mjs'],
];
// The clippers that refuse a source address the vault already holds, which a mismatched clipping always holds.
const REFUSE_BY_SOURCE = new Set(['clip-pdf.mjs', 'clip-docx.mjs', 'clip-pptx.mjs', 'clip-xlsx.mjs', 'clip-confluence.mjs']);
for (const [kind, name, frontmatter, clipper] of CLIPPERS) {
  test(`the fix for ${kind} names ${clipper} and says what running it again does`, (t) => {
    const issue = mismatchOf(t, name, frontmatter);
    assert.equal(issue.capture, 'web');
    assert.equal(issue.clipper, clipper);
    assert.ok(issue.verification.includes(`node scripts/${clipper}`), issue.verification);
    for (const other of new Set(CLIPPERS.map((c) => c[3]))) if (other !== clipper) assert.ok(!issue.verification.includes(`scripts/${other}`), `${other} is not named`);
    assert.doesNotMatch(issue.verification, /may report/);
    if (clipper === 'clip.mjs') {
      assert.ok(issue.verification.includes('`node scripts/clip.mjs <source> --recapture`'));
      assert.match(issue.verification, /new dated clipping beside this one/);
      assert.match(issue.verification, /never edited/);
    } else if (clipper === 'clip-gh.mjs') {
      // clip-gh writes the file again under the same name when its text differs from every hash the vault holds.
      assert.match(issue.verification, /replaces this clipping in place/);
      assert.match(issue.verification, /only after/);
      assert.match(issue.verification, /recorded commit/);
      assert.doesNotMatch(issue.verification, /never edited|already clipped/);
    } else {
      assert.ok(REFUSE_BY_SOURCE.has(clipper));
      assert.match(issue.verification, /will report the source as already clipped/);
      assert.match(issue.verification, /purge[^.]*then[^.]*clip/i, 'purge it, then clip the source again');
      assert.doesNotMatch(issue.verification, /never edited/);
    }
    ownerPaths(issue);
  });
}

test('the report prints the mismatch with its fix and one count line for the equivalent statuses', (t) => {
  const { root } = fixture(t);
  const text = integrityReport(scanIntegrity(root));
  assert.match(text, /source-hash-mismatch raw\/clippings\/nested\/mismatch\.md:5/);
  assert.match(text, /Verify: .*--recapture/);
  const lines = text.split('\n').filter((l) => /crlf-variant/.test(l));
  assert.equal(lines.length, 1, text);
  assert.match(lines[0], /crlf-variant 1/);
  assert.match(lines[0], /trailing-newline 1/);
  assert.match(lines[0], /unscored/);
  const { 'raw/clippings/crlf-variant.md': a, 'raw/clippings/trailing-newline.md': b, ...plain } = EACH;
  assert.doesNotMatch(integrityReport(scanIntegrity(fixture(t, plain).root)), /crlf-variant|trailing-newline/, 'no line when none is equivalent');
});

test('health.mjs exits as it does for any other integrity defect, and lists the mismatch in text and JSON', (t) => {
  const { root } = fixture(t);
  const other = fixture(t, { 'wiki/concepts/unsourced.md': '---\ntype: concept\nstatus: maintained\nsources: []\n---\n# Unsourced\n\nA substantive concept page that has more than enough words to need evidence but cites nothing.\n' });
  const baseline = run(other.root);
  assert.match(baseline.stdout, /missing-evidence/);
  const text = run(root);
  assert.equal(text.status, baseline.status, text.stderr);
  assert.match(text.stdout, /source-hash-mismatch raw\/clippings\/nested\/mismatch\.md/);
  assert.match(text.stdout, /Verify: .*--recapture/);
  assert.match(text.stdout, /crlf-variant 1, trailing-newline 1 \(unscored/);
  const json = run(root, ['--json']);
  assert.equal(json.status, baseline.status, json.stderr);
  const r = JSON.parse(json.stdout);
  assert.equal(mismatches(r).length, 1);
  assert.equal(r.clippingHashes.checked, 5);
});

// ------------------------------------------------------------------ the graph cache --
const rel = (root, abs) => relative(root, abs).replaceAll('\\', '/');
function writeCache(root) {
  const builtAtMs = Date.now();
  return writeGraphCache(root, buildGraph(root, { derive: deriveIntegrity }).records, { builtAtMs });
}
function warm(root) {
  const reads = [];
  const readFile = (abs, encoding) => { reads.push(rel(root, abs)); return readFileSync(abs, encoding); };
  return { reads, scan: scanIntegrity(root, { cache: readGraphCache(root), readFile }) };
}

test('the cache keeps each clipping\'s status: a warm scan reads no file and equals a cold one', (t) => {
  const { root } = fixture(t);
  assert.ok(writeCache(root).written);
  const entries = JSON.parse(readFileSync(join(root, '.wiki-master/graph-cache.json'), 'utf8')).entries;
  assert.equal(entries['raw/clippings/nested/mismatch.md'].extra.sourceHashStatus, 'mismatch');
  assert.equal(entries['raw/clippings/crlf-variant.md'].extra.sourceHashStatus, 'crlf-variant');
  assert.equal(entries['raw/clippings/no-hash.md'].extra.sourceHashStatus, null);
  assert.equal(entries['raw/research/elsewhere.md'].extra, undefined, 'outside raw/clippings/ nothing is derived');
  const w = warm(root);
  assert.deepEqual(w.reads, []);
  assert.deepEqual(JSON.parse(JSON.stringify(w.scan)), JSON.parse(JSON.stringify(scanIntegrity(root))));
});

test('a clipping repaired after the refresh is re-read, alone, and its mismatch clears in the same warm run', (t) => {
  const { root, put } = fixture(t);
  writeCache(root);
  // The repaired file has the same size (one 64-digit hash for another), so only its new time tells the cache.
  put('raw/clippings/nested/mismatch.md', clip(sha(MD)), OLD + 60);
  const w = warm(root);
  assert.deepEqual(w.reads, ['raw/clippings/nested/mismatch.md']);
  assert.equal(mismatches(w.scan).length, 0);
  assert.equal(w.scan.clippingHashes.match, 2);
});

test('a cached clipping entry with the wrong extra shape is a miss: that file alone is read', (t) => {
  const { root } = fixture(t);
  writeCache(root);
  const file = join(root, '.wiki-master/graph-cache.json');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  data.entries['raw/clippings/match.md'].extra = { sourceHashStatus: 'maybe' };
  data.entries['raw/clippings/crlf-variant.md'].extra = { bodyLinks: [] };
  writeFileSync(file, JSON.stringify(data));
  const w = warm(root);
  assert.deepEqual(w.reads.sort(), ['raw/clippings/crlf-variant.md', 'raw/clippings/match.md']);
  assert.deepEqual(JSON.parse(JSON.stringify(w.scan)), JSON.parse(JSON.stringify(scanIntegrity(root))));
});

test('the refresh path keeps a clipping\'s status too: refreshCatalogs hands the derive to buildGraph whole', async (t) => {
  const { refreshCatalogs } = await import('../scripts/lib/catalogs.mjs');
  const { root } = fixture(t);
  const { records, builtAtMs, changed } = refreshCatalogs(root, { derive: deriveIntegrity });
  assert.equal(records.get('raw/clippings/nested/mismatch.md').extra.sourceHashStatus, 'mismatch');
  writeGraphCache(root, records, { builtAtMs, exclude: changed });
  const w = warm(root);
  assert.ok(!w.reads.some((path) => path.startsWith('raw/clippings/')), `no clipping is read again: ${w.reads}`);
  assert.equal(mismatches(w.scan).length, 1);
});
