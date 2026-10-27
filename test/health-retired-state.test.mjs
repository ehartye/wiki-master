import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { scanIntegrity, integrityReport } from '../scripts/lib/integrity.mjs';
import { runReclips } from '../scripts/lib/reclip.mjs';
import { validateAuthored } from '../scripts/validate-authored.mjs';

// A note can say it is a lead and not evidence ("must not be cited as support"). Until now health could not hold that
// decision: the note reported as missing evidence on every run, and nothing flagged the pages that still cited it.
// `citation-status: retired` is that state. It is not `restricted`: quarantine writes `restricted` on a page that
// leans on a quarantined clipping, and that page is working documentation that must stay under the evidence check.

const WORDS = 'This page makes a substantive claim that a reader could quote and rely on later. '.repeat(3);
const page = (fm, body = WORDS) => `---\n${fm}\n---\n\n${body}\n`;

function vault(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'wm-retired-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const all = {
    'raw/clippings/c.md': '---\ntitle: "C"\nsource: "https://example.org/c"\n---\n\nRaw body of the clipping with several words in it.\n',
    'wiki/sources/real.md': page('type: source\nstatus: maintained\nsources: ["[[raw/clippings/c.md]]"]'),
    ...files,
  };
  for (const [rel, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}
const retired = (extra = '') => page(`type: source\nstatus: maintained\ncitation-status: retired\nsources: []${extra}`);
const rule = (r, name) => r.issues.filter((i) => i.rule === name);

test('an unmarked note with no evidence is missing evidence; a retired one is not', (t) => {
  const plain = scanIntegrity(vault(t, { 'wiki/sources/note.md': page('type: source\nstatus: maintained\nsources: []') }));
  assert.deepEqual(rule(plain, 'missing-evidence').map((i) => i.source), ['wiki/sources/note.md']);
  const marked = scanIntegrity(vault(t, { 'wiki/sources/note.md': retired() }));
  assert.deepEqual(rule(marked, 'missing-evidence'), []);
  assert.equal(marked.defectCount, 0);
});

test('a page that cites a retired page through sources is reported once, naming both', (t) => {
  const r = scanIntegrity(vault(t, {
    'wiki/sources/note.md': retired(),
    'wiki/concepts/Claim.md': page('type: concept\nstatus: maintained\nsources: ["[[wiki/sources/real.md]]", "[[wiki/sources/note.md]]"]'),
  }));
  const hits = rule(r, 'cites-retired-page');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].source, 'wiki/concepts/Claim.md');
  assert.equal(hits[0].retiredPath, 'wiki/sources/note.md');
  assert.match(hits[0].verification, /retired/);
  assert.equal(r.defectCount, 1, 'the page still has its real evidence, so this is its only defect');
});

test('a factual body citation of a retired source page is reported too', (t) => {
  const r = scanIntegrity(vault(t, {
    'wiki/sources/note.md': retired(),
    'wiki/concepts/Claim.md': page('type: concept\nstatus: maintained\nsources: ["[[wiki/sources/real.md]]"]',
      'The measured value was 42 percent, per [[wiki/sources/note.md]], and a reader may rely on it. ' + WORDS),
  }));
  assert.equal(rule(r, 'cites-retired-page').length, 1);
});

test('a plain navigation link to a retired page is not a citation', (t) => {
  const r = scanIntegrity(vault(t, {
    'wiki/concepts/Old Lead.md': page('type: concept\nstatus: maintained\ncitation-status: retired\nsources: []'),
    'wiki/concepts/Claim.md': page('type: concept\nstatus: maintained\nsources: ["[[wiki/sources/real.md]]"]',
      'For history see [[Old Lead]]. ' + WORDS),
  }));
  assert.deepEqual(rule(r, 'cites-retired-page'), []);
});

test('a map page that lists a retired note is navigation, not a citation', (t) => {
  const r = scanIntegrity(vault(t, {
    'wiki/sources/note.md': retired(),
    'moc/Topic.md': page('type: synthesis\nstatus: maintained\nsources: []', '- [[wiki/sources/note.md]] lists the measured limits.\n- [[wiki/sources/real.md]] holds the evidence.'),
  }));
  assert.deepEqual(rule(r, 'cites-retired-page'), []);
});

test('a retired page citing another retired page is not reported', (t) => {
  const r = scanIntegrity(vault(t, {
    'wiki/sources/a.md': retired(),
    'wiki/sources/b.md': page('type: source\nstatus: maintained\ncitation-status: retired\nsources: ["[[wiki/sources/a.md]]"]'),
  }));
  assert.deepEqual(rule(r, 'cites-retired-page'), []);
});

test('evidence is not credited through a retired page', (t) => {
  const r = scanIntegrity(vault(t, {
    'wiki/sources/note.md': page('type: source\nstatus: maintained\ncitation-status: retired\nsources: ["[[raw/clippings/c.md]]"]'),
    'wiki/concepts/Claim.md': page('type: concept\nstatus: maintained\nsources: ["[[wiki/sources/note.md]]"]'),
  }));
  assert.deepEqual(rule(r, 'missing-evidence').map((i) => i.source), ['wiki/concepts/Claim.md']);
  assert.equal(rule(r, 'cites-retired-page').length, 1);
});

test('restricted and quarantined pages are not touched by the retired rules', (t) => {
  const r = scanIntegrity(vault(t, {
    'wiki/sources/lean.md': page('type: source\nstatus: maintained\ncitation-status: restricted\nsources: []'),
    'wiki/concepts/Claim.md': page('type: concept\nstatus: maintained\nsources: ["[[wiki/sources/real.md]]", "[[wiki/sources/lean.md]]"]'),
  }));
  assert.deepEqual(rule(r, 'cites-retired-page'), []);
  assert.deepEqual(rule(r, 'missing-evidence').map((i) => i.source), ['wiki/sources/lean.md'], 'a restricted page stays under the evidence check');
});

test('a scoped scan reports the new issue only for the pages named', (t) => {
  const root = vault(t, {
    'wiki/sources/note.md': retired(),
    'wiki/concepts/Claim.md': page('type: concept\nstatus: maintained\nsources: ["[[wiki/sources/real.md]]", "[[wiki/sources/note.md]]"]'),
  });
  assert.equal(scanIntegrity(root, { sources: new Set(['wiki/concepts/Claim.md']) }).issues.length, 1);
  assert.equal(scanIntegrity(root, { sources: new Set(['wiki/sources/real.md']) }).issues.length, 0);
});

test('validate-authored names the retired page a ledger page cites', (t) => {
  const root = vault(t, {
    'wiki/sources/note.md': retired(),
    'wiki/authored/proj/notes/claim.md': page('type: authored\nstatus: draft\nproject: proj\nkind: note\nai-generated: true\nsources: ["[[wiki/sources/note.md]]"]'),
  });
  const result = validateAuthored(root, ['wiki/authored/proj/notes/claim.md']);
  const hit = result.defects.find((d) => d.rule === 'cites-retired-page');
  assert.ok(hit, JSON.stringify(result.defects));
  assert.equal(hit.path, 'wiki/authored/proj/notes/claim.md');
  assert.match(hit.message, /wiki\/sources\/note\.md/);
  assert.match(hit.message, /must not be cited/);
});

test('the report is unchanged when nothing is retired, and counts retired pages when something is', (t) => {
  const none = scanIntegrity(vault(t, {}));
  assert.equal(none.coverage.retired, 0);
  assert.doesNotMatch(integrityReport(none), /retired/i);
  const some = scanIntegrity(vault(t, { 'wiki/sources/note.md': retired() }));
  assert.equal(some.coverage.retired, 1);
  assert.match(integrityReport(some), /1 retired/);
});

test('re-clip quarantine does not overwrite a retired marker on a citing page', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'wm-retired-q-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ['raw/clippings', 'wiki/sources']) mkdirSync(join(root, dir), { recursive: true });
  const raw = `---\ntitle: "Example"\nsource: "https://example.org/source.pdf"\ncreated: 2025-01-01\ntags: [clippings]\nextraction: table-aware\nfidelity: tabular\nsource-hash: oldhash1\n---\n\n${'Reference text for the reader. '.repeat(30)}\n`;
  writeFileSync(join(root, 'raw/clippings/example.md'), raw);
  writeFileSync(join(root, 'wiki/sources/example.md'), '---\ntype: source\ncitation-status: retired\nsources: ["[[raw/clippings/example.md]]"]\nsource-hashes: [oldhash1]\n---\n\nPrior summary.\n');
  const result = await runReclips({ vaultPath: root, apply: true, includeTabular: true, onFailure: 'quarantine', obtain: async () => { throw new Error('source unavailable'); } });
  assert.equal(result.quarantined, 1);
  const cited = readFileSync(join(root, 'wiki/sources/example.md'), 'utf8');
  assert.match(cited, /^citation-status: retired$/m);
  assert.doesNotMatch(cited, /^citation-status: restricted$/m);
  assert.match(cited, /Do not cite/i, 'the warning is still added');
});
