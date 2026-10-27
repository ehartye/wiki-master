import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runReclips } from '../scripts/lib/reclip.mjs';
import { clippingKind, retainedShare, readPageForReclip, MIN_RETAINED } from '../scripts/lib/reclip-html.mjs';
import { scanIntegrity } from '../scripts/lib/integrity.mjs';
import { extractHtml } from '../scripts/lib/html-extract.mjs';
import { loadIssueLog, openIssues } from '../scripts/lib/triage.mjs';

// A page clipped before an extractor fix cannot be repaired: clip.mjs refuses a URL it already holds, and the only
// repair route, apply-reclips, read PDFs only. The HTML mode runs the same transaction (journal, ledger, dry run,
// quarantine) over a page read again through the current extraction. A page, unlike a PDF, can have changed since
// it was clipped, so a replacement that loses too much of the old text is refused.

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (text) => createHash('sha256').update(text).digest('hex');
const SENTENCES = Array.from({ length: 60 }, (_, i) => `Section ${i} explains how the service handles request number ${i} and what a client should expect back.`);
const OLD_BODY = SENTENCES.join('\n\n');
const EXAMPLE = '```\ncurl -X POST https://api.example.org/run -d @body.json\n```';
const NEW_BODY = `${OLD_BODY}\n\n${EXAMPLE}`;
const OLD_HASH = sha(OLD_BODY);
const URL_ = 'https://docs.example.org/api/run';

const rawClipping = (extra = '') => `---\ntitle: "Run API"\nsource: "${URL_}"\nauthor: "Docs team"\npublished: 2024-05-01\ncreated: 2025-01-01\ntags: [clippings]\nquality: medium\ntopic: "API review"\n${extra}source-hash: ${OLD_HASH}\n---\n\n${OLD_BODY}\n`;
function vault(t, { raw = rawClipping() } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wm-reclip-html-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const d of ['raw/clippings', 'wiki/sources']) mkdirSync(join(dir, d), { recursive: true });
  writeFileSync(join(dir, 'raw/clippings/run-api.md'), raw);
  writeFileSync(join(dir, 'wiki/sources/run-api.md'), `---\ntype: source\nstatus: maintained\nsources: ["[[raw/clippings/run-api.md]]"]\nsource-hashes: [${OLD_HASH}]\n---\n\nSummary of the run API with enough words in it to count as a substantive page for the integrity scan.\n`);
  return dir;
}
const page = (body, extra = {}) => async () => ({ md: body, wordCount: (body.match(/\S+/g) || []).length, hash: sha(body), fidelity: 'high', extraction: undefined, fidelityChecks: 12, fidelityIgnored: 0, ...extra });
const read = (dir, rel) => readFileSync(join(dir, rel), 'utf8');
const spy = (fn) => { const f = (...a) => { f.calls++; return fn(...a); }; f.calls = 0; return f; };
const forbidden = () => { throw new Error('the PDF route must not be used for an HTML clipping'); };

test('clippingKind routes by what the clipping says it is', () => {
  const doc = (fm) => `---\ntitle: "T"\n${fm}\n---\n\nbody\n`;
  assert.equal(clippingKind(doc('source: "https://docs.example.org/page"')), 'html');
  assert.equal(clippingKind(doc('source: "https://docs.example.org/page"\nextraction: rendered')), 'html');
  assert.equal(clippingKind(doc('source: "https://docs.example.org/page"\nfidelity: partial\nfidelity-checks: 9')), 'html');
  for (const extraction of ['ocr', 'table-aware', 'table-flattened']) assert.equal(clippingKind(doc(`source: "https://docs.example.org/page"\nextraction: ${extraction}`)), 'pdf', extraction);
  assert.equal(clippingKind(doc('source: "https://docs.example.org/page"\nfidelity: tabular')), 'pdf');
  assert.equal(clippingKind(doc('source: "https://example.org/files/paper.pdf"')), 'pdf');
  assert.equal(clippingKind(doc('source: "https://arxiv.org/pdf/2404.03337"')), 'pdf');
  assert.equal(clippingKind(doc('source: "C:/Users/me/paper.pdf"')), 'pdf', 'a local file is not a page');
  assert.equal(clippingKind(doc('source: "C:/Users/me/report.docx"')), 'pdf', 'a local document is not a page');
  assert.equal(clippingKind(doc('source: "/home/me/saved-page"')), 'pdf', 'a local path with no extension is not a page');
  assert.equal(clippingKind(doc('source: "https://docs.example.org/page"'), 'pdf'), 'pdf', 'an explicit kind wins');
  assert.equal(clippingKind(doc('source: "https://example.org/files/paper.pdf"'), 'html'), 'html', 'an explicit kind wins');
});

test('retainedShare: the share of the old text that the new text still holds', () => {
  assert.equal(retainedShare(OLD_BODY, OLD_BODY), 1);
  assert.equal(retainedShare(OLD_BODY, NEW_BODY), 1, 'a superset keeps everything');
  assert.equal(retainedShare(OLD_BODY, ''), 0);
  const half = SENTENCES.slice(0, 30).join('\n\n') + '\n\n' + Array.from({ length: 30 }, (_, i) => `Entirely different material number ${i} about unrelated subjects and other products.`).join('\n\n');
  const share = retainedShare(OLD_BODY, half);
  assert.ok(share > 0.4 && share < 0.6, `about half survives, got ${share}`);
  assert.equal(retainedShare('too short to compare', 'anything else'), 1, 'under one window there is nothing to lose');
  assert.equal(retainedShare(OLD_BODY, NEW_BODY.toUpperCase().replaceAll('**', '')), 1, 'case and markup do not count as loss');
});

test('MIN_RETAINED is a share between zero and one', () => {
  assert.ok(MIN_RETAINED > 0 && MIN_RETAINED < 1);
});

test('readPageForReclip: a clean static read becomes a clip with no extraction mark', async () => {
  const clip = await readPageForReclip(URL_, { extract: () => ({ contentMarkdown: NEW_BODY, fidelityWarnings: [], fidelityAssessment: { checked: 12, ignored: [] } }) });
  assert.equal(clip.md, NEW_BODY);
  assert.equal(clip.hash, sha(NEW_BODY));
  assert.equal(clip.fidelity, 'high');
  assert.equal(clip.extraction, undefined);
  assert.equal(clip.fidelityChecks, 12);
  assert.equal(clip.fidelityIgnored, 0);
});

test('readPageForReclip: warnings make it partial; ignored page chrome is counted', async () => {
  const clip = await readPageForReclip(URL_, { extract: () => ({ contentMarkdown: NEW_BODY, fidelityWarnings: [{ kind: 'heading', label: 'Example' }], fidelityAssessment: { checked: 12, ignored: [{ label: 'Was this helpful?' }] } }) });
  assert.equal(clip.fidelity, 'partial');
  assert.equal(clip.fidelityIgnored, 1);
});

test('readPageForReclip: a thin static read is tried once more through the browser, and says so', async () => {
  const render = spy(() => ({ ok: true, data: { contentMarkdown: NEW_BODY, fidelityWarnings: [], fidelityAssessment: { checked: 3, ignored: [] } } }));
  const clip = await readPageForReclip(URL_, { extract: () => ({ contentMarkdown: 'Back to top' }), render });
  assert.equal(render.calls, 1);
  assert.equal(clip.extraction, 'rendered');
  assert.equal(clip.md, NEW_BODY);
});

test('readPageForReclip: a static read that fails is recovered by the browser and marked rendered', async () => {
  const clip = await readPageForReclip(URL_, {
    extract: () => { throw new Error('403'); },
    render: () => ({ ok: true, data: { contentMarkdown: NEW_BODY, fidelityWarnings: [], fidelityAssessment: { checked: 4, ignored: [] } } }),
  });
  assert.equal(clip.extraction, 'rendered');
  assert.equal(clip.md, NEW_BODY);
});

test('readPageForReclip: a read that is thin and cannot be rendered is an error, not a clip', async () => {
  await assert.rejects(readPageForReclip(URL_, { extract: () => ({ contentMarkdown: 'Back to top' }), render: () => ({ ok: false, unavailable: true, reason: 'no browser' }) }), /thin|no browser/i);
});

test('readPageForReclip: a fetch that fails statically and cannot be rendered is an error', async () => {
  await assert.rejects(readPageForReclip(URL_, { extract: () => { throw new Error('403'); }, render: () => ({ ok: false, reason: 'blocked' }) }), /blocked|403/);
});

test('readPageForReclip: a PDF address is refused and the PDF route is named', async () => {
  await assert.rejects(readPageForReclip('https://example.org/files/paper.pdf', { extract: () => { throw new Error('should not fetch'); } }), /PDF/);
});

test('dry run plans the page and writes nothing', async (t) => {
  const dir = vault(t);
  const before = read(dir, 'raw/clippings/run-api.md');
  const readPage = spy(page(NEW_BODY));
  const r = await runReclips({ vaultPath: dir, targets: ['raw/clippings/run-api.md'], readPage, obtain: forbidden });
  assert.equal(r.selected, 1);
  assert.deepEqual(r.results.map((x) => x.status), ['planned']);
  assert.equal(readPage.calls, 0, 'a dry run does not fetch');
  assert.equal(read(dir, 'raw/clippings/run-api.md'), before);
  assert.equal(existsSync(join(dir, '.wiki-master', 'reclip-transactions')), false);
});

test('apply replaces the body, keeps the metadata, follows the hash and leaves no journal', async (t) => {
  const dir = vault(t);
  const readPage = spy(page(NEW_BODY));
  const r = await runReclips({ vaultPath: dir, apply: true, targets: ['raw/clippings/run-api.md'], readPage, obtain: forbidden, extract: forbidden });
  assert.equal(readPage.calls, 1);
  assert.equal(r.reclipped, 1);
  assert.deepEqual(r.failed, []);
  assert.deepEqual(r.conflicts, []);
  assert.equal(r.results[0].status, 'reclipped');
  assert.equal(r.results[0].retained, 1);
  const raw = read(dir, 'raw/clippings/run-api.md');
  assert.ok(raw.includes(EXAMPLE), 'the restored example is in the clipping');
  assert.ok(raw.endsWith(`\n${NEW_BODY}\n`));
  for (const line of ['title: "Run API"', `source: "${URL_}"`, 'author: "Docs team"', 'published: 2024-05-01', 'created: 2025-01-01', 'tags: [clippings]', 'quality: medium', 'topic: "API review"']) assert.ok(raw.includes(line), line);
  assert.match(raw, new RegExp(`^source-hash: ${sha(NEW_BODY)}$`, 'm'));
  assert.doesNotMatch(raw, new RegExp(OLD_HASH));
  assert.match(raw, /^fidelity-checks: 12$/m);
  assert.doesNotMatch(raw, /^fidelity:/m);
  assert.doesNotMatch(raw, /^extraction:/m);
  const summary = read(dir, 'wiki/sources/run-api.md');
  assert.match(summary, new RegExp(`source-hashes: \\[${sha(NEW_BODY)}\\]`), 'the summary follows the new hash');
  assert.deepEqual(readdirSync(join(dir, '.wiki-master', 'reclip-transactions')), [], 'the journal is removed');
});

// The case the item was filed for: a page clipped before the extractor learned to keep REST examples. The old body is
// today's extraction with its fenced examples removed (what the older extractor wrote); the new body is the real
// extraction of the fixture page, through the same ladder the clipper uses.
test('a REST page clipped before the example fix gets its examples back, and the summary follows', async (t) => {
  const html = readFileSync(join(root, 'test', 'fixtures', 'documentation', 'github-rest-workflow-runs.html'), 'utf8').replace(/\r\n/g, '\n');
  const pageUrl = 'https://docs.github.com/en/rest/actions/workflow-runs';
  const current = await extractHtml(html, pageUrl);
  const oldBody = current.contentMarkdown.replace(/```[a-z]*\n[\s\S]*?```/g, '').replace(/\n{3,}/g, '\n\n').trim();
  assert.ok(oldBody.length < current.contentMarkdown.length, 'the fixture has examples to lose');
  const oldHash = sha(oldBody);
  const dir = mkdtempSync(join(tmpdir(), 'wm-reclip-rest-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const d of ['raw/clippings', 'wiki/sources']) mkdirSync(join(dir, d), { recursive: true });
  writeFileSync(join(dir, 'raw/clippings/runs.md'), `---\ntitle: "List workflow runs"\nsource: "${pageUrl}"\ncreated: 2025-01-01\ntags: [clippings]\nquality: medium\nsource-hash: ${oldHash}\n---\n\n${oldBody}\n`);
  writeFileSync(join(dir, 'wiki/sources/runs.md'), `---\ntype: source\nstatus: maintained\nsources: ["[[raw/clippings/runs.md]]"]\nsource-hashes: [${oldHash}]\n---\n\nSummary of the workflow runs endpoint with enough words in it to count as substantive.\n`);
  const r = await runReclips({ vaultPath: dir, apply: true, targets: ['raw/clippings/runs.md'], readPage: (u) => readPageForReclip(u, { extract: async () => extractHtml(html, u) }), obtain: forbidden });
  assert.deepEqual([r.reclipped, r.failed.length, r.conflicts.length], [1, 0, 0], JSON.stringify(r));
  const raw = read(dir, 'raw/clippings/runs.md');
  assert.match(raw, /```curl\n/);
  assert.match(raw, /```json\n/);
  assert.ok(r.results[0].retained >= MIN_RETAINED, `retained ${r.results[0].retained}`);
  assert.ok(read(dir, 'wiki/sources/runs.md').includes(sha(current.contentMarkdown)), 'the summary follows the new hash');
  assert.doesNotMatch(raw, new RegExp(oldHash));
});

test('the vault stays as healthy after the replacement as before it', async (t) => {
  const dir = vault(t);
  const before = scanIntegrity(dir);
  await runReclips({ vaultPath: dir, apply: true, targets: ['raw/clippings/run-api.md'], readPage: page(NEW_BODY), obtain: forbidden });
  const after = scanIntegrity(dir);
  assert.equal(after.defectCount, before.defectCount);
});

test('a page full of query strings is not mistaken for a mangled PDF text layer', async (t) => {
  const dir = vault(t);
  const queries = Array.from({ length: 14 }, (_, i) => `Call GET /v1/items?limit=${i} then /v1/users?page=${i} for the next set.`).join('\n\n');
  const r = await runReclips({ vaultPath: dir, apply: true, targets: ['raw/clippings/run-api.md'], readPage: page(`${NEW_BODY}\n\n${queries}`), obtain: forbidden });
  assert.deepEqual([r.reclipped, r.failed.length], [1, 0], JSON.stringify(r.failed));
});

test('a read that still carries warnings replaces the body but goes to review', async (t) => {
  const dir = vault(t);
  const r = await runReclips({ vaultPath: dir, apply: true, targets: ['raw/clippings/run-api.md'], readPage: page(NEW_BODY, { fidelity: 'partial', fidelityIgnored: 2 }), obtain: forbidden });
  assert.match(read(dir, 'raw/clippings/run-api.md'), /^fidelity-ignored: 2$/m, 'page chrome set aside is recorded');
  assert.equal(r.reclipped, 1);
  assert.equal(r.needsReview.length, 1);
  assert.equal(r.results[0].status, 'needs-review');
  assert.match(read(dir, 'raw/clippings/run-api.md'), /^fidelity: partial$/m);
  assert.equal(openIssues(loadIssueLog(dir)).filter((i) => i.kind === 'fidelity').length, 1);
});

test('a page that has changed too much is not replaced', async (t) => {
  const dir = vault(t);
  const before = read(dir, 'raw/clippings/run-api.md');
  const summaryBefore = read(dir, 'wiki/sources/run-api.md');
  const different = Array.from({ length: 70 }, (_, i) => `The vendor rewrote this page and entry ${i} now describes a different product with new terms and new pricing.`).join('\n\n');
  const r = await runReclips({ vaultPath: dir, apply: true, targets: ['raw/clippings/run-api.md'], readPage: page(different), obtain: forbidden });
  assert.equal(r.reclipped, 0);
  assert.equal(r.failed.length, 1);
  assert.match(r.failed[0].reason, /changed/i);
  assert.match(r.failed[0].reason, /retain/i);
  assert.equal(read(dir, 'raw/clippings/run-api.md'), before, 'the evidence is untouched');
  assert.equal(read(dir, 'wiki/sources/run-api.md'), summaryBefore, 'the summary still points at the old hash');
  assert.equal(openIssues(loadIssueLog(dir)).filter((i) => i.kind === 'fidelity').length, 1, 'fidelity review reopens, as for a failed PDF repair');
});

test('a page that reads exactly as it was clipped is left alone and reported as unchanged', async (t) => {
  const dir = vault(t);
  const before = read(dir, 'raw/clippings/run-api.md');
  const summaryBefore = read(dir, 'wiki/sources/run-api.md');
  const r = await runReclips({ vaultPath: dir, apply: true, targets: ['raw/clippings/run-api.md'], readPage: page(OLD_BODY), obtain: forbidden });
  assert.deepEqual([r.reclipped, r.alreadyResolved, r.failed.length, r.conflicts.length], [0, 1, 0, 0]);
  assert.equal(r.results[0].status, 'unchanged');
  assert.equal(read(dir, 'raw/clippings/run-api.md'), before, 'no rewrite, no journal, no review row');
  assert.equal(read(dir, 'wiki/sources/run-api.md'), summaryBefore);
  assert.equal(existsSync(join(dir, '.wiki-master', 'reclip-transactions')), false);
  assert.equal(openIssues(loadIssueLog(dir)).length, 0);
});

test('a read that fails is reported and nothing changes', async (t) => {
  const dir = vault(t);
  const before = read(dir, 'raw/clippings/run-api.md');
  const r = await runReclips({ vaultPath: dir, apply: true, targets: ['raw/clippings/run-api.md'], readPage: async () => { throw new Error('HTTP 403'); }, obtain: forbidden });
  assert.equal(r.failed.length, 1);
  assert.match(r.failed[0].reason, /403/);
  assert.equal(read(dir, 'raw/clippings/run-api.md'), before);
});

test('a PDF clipping still takes the PDF route and never reads a page', async (t) => {
  const dir = vault(t, { raw: rawClipping('extraction: table-aware\nfidelity: tabular\n') });
  const readPage = spy(page(NEW_BODY));
  const obtain = spy(async () => { throw new Error('Original source file unavailable'); });
  const r = await runReclips({ vaultPath: dir, apply: true, targets: ['raw/clippings/run-api.md'], readPage, obtain });
  assert.equal(readPage.calls, 0);
  assert.equal(obtain.calls, 1);
  assert.equal(r.failed.length, 1);
});

test('kind: html reads the page of a clipping the router would call a PDF', async (t) => {
  const dir = vault(t, { raw: rawClipping('fidelity: tabular\n') });
  const readPage = spy(page(NEW_BODY));
  const r = await runReclips({ vaultPath: dir, apply: true, kind: 'html', targets: ['raw/clippings/run-api.md'], readPage, obtain: forbidden });
  assert.equal(readPage.calls, 1);
  assert.equal(r.reclipped, 1);
});

test('an invalid kind is refused before anything happens', async (t) => {
  const dir = vault(t);
  await assert.rejects(runReclips({ vaultPath: dir, kind: 'docx', targets: ['raw/clippings/run-api.md'] }), /kind/i);
});

test('a failed HTML repair can be quarantined like a PDF one', async (t) => {
  const dir = vault(t);
  const r = await runReclips({ vaultPath: dir, apply: true, onFailure: 'quarantine', targets: ['raw/clippings/run-api.md'], readPage: async () => { throw new Error('HTTP 410'); }, obtain: forbidden });
  assert.equal(r.quarantined, 1);
  assert.match(read(dir, 'raw/clippings/run-api.md'), /^citation-status: quarantined$/m);
  assert.match(read(dir, 'wiki/sources/run-api.md'), /Do not cite/);
});

test('apply-reclips takes --kind and refuses a value it does not know', () => {
  const run = (...args) => spawnSync(process.execPath, [join(root, 'scripts', 'apply-reclips.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, WIKI_MASTER_VAULT: mkdtempSync(join(tmpdir(), 'wm-empty-')) } });
  const bad = run('--kind', 'docx');
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /kind/i);
  const ok = run('--kind', 'html');
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(run('--help').stdout, /--kind/);
});
