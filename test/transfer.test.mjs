import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { clipperText, verifyClippingHash } from '../scripts/lib/clipping-hash.mjs';
import { buildGraph, computeGraphMetrics } from '../scripts/lib/graph.mjs';

// The transfer command at its seam: two registered fixture vaults in a temp folder, the CLI run as a child, and
// the files on disk compared afterwards. Content is made up.

const SCRIPT = resolve('scripts/transfer.mjs');
const PURGE = resolve('scripts/purge.mjs');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const graphOf = (vaultPath) => computeGraphMetrics(buildGraph(vaultPath));

function clipping(title, body, extra = '') {
  // A clipper hashes the bare Markdown and stores it after one blank line, with one line break after it.
  const file = `---\ntitle: "${title}"\nsource: https://example.com/${encodeURIComponent(title)}\ncreated: 2026-01-01\ntags: [clippings]\nquality: medium\nsource-hash: HASH\n${extra}---\n\n${body}\n`;
  return file.replace('HASH', sha(clipperText(file)));
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00, 0xfe, 0x80]);

const GENERAL = {
  'wiki/authored/alpha/overview.md': '---\ntype: authored\nproject: alpha\nkind: overview\nsources: []\nai-generated: true\n---\n# Overview\n\nSee [[wiki/authored/alpha/architecture|architecture]], the [[Retry Budget]] idea and [[Queue Notes]].\n\n![[raw/attachments/diagram.png]]\n\nRecorded in [[log/2026-01-01-000000-relink-start]].\n\n```\n[[Code Example]]\n```\n',
  'wiki/authored/alpha/architecture.md': '---\ntype: authored\nproject: alpha\nkind: architecture\nsources: []\nai-generated: true\n---\n# Architecture\n\nBack to [[overview]].\n\n| Part | Link |\n|---|---|\n| a | [[overview]] |\n',
  'moc/alpha.md': '# Alpha\n\n- [[overview]]\n- [[architecture]]\n',
  'wiki/concepts/Retry Budget.md': '---\ntype: concept\nsources: ["[[raw/clippings/Retry Paper.md]]"]\nai-generated: true\n---\n# Retry Budget\n\nRelated to [[Backoff|backing off]] and a [[Missing Page]].\n\n- Parent\n\t- nested [[Backoff]] too\n\t  ```\n\t  [[Indented Example]]\n\t  ```\n',
  'wiki/concepts/Backoff.md': '---\ntype: concept\nsources: ["[[raw/clippings/Backoff Notes.md]]"]\nai-generated: true\n---\n# Backoff\n\nText.\n',
  'wiki/sources/Queue Notes.md': '---\ntype: source\nsources: ["[[raw/clippings/Queue Notes.md]]"]\nai-generated: true\n---\n# Queue Notes\n\nSummary, used by [[wiki/authored/alpha/overview|alpha]].\n',
  'wiki/syntheses/Digest.md': '---\ntype: synthesis\nsources: ["[[Backoff]]"]\nai-generated: true\n---\n# Digest\n\nText.\n',
  'wiki/concepts/Elsewhere.md': '---\ntype: concept\nsources: ["[[wiki/sources/Queue Notes]]"]\nai-generated: true\n---\n# Elsewhere\n\nUnrelated, but see [[wiki/authored/alpha/overview|the alpha overview]].\n',
  'moc/tasks.md': '# Tasks\n\n- [[Retry Budget]]\n',
  'raw/clippings/Queue Notes.md': clipping('Queue Notes', 'Queues hold items. The [[length]] slot is notation.'),
  'raw/clippings/Retry Paper.md': clipping('Retry Paper', 'Retries are budgeted.', 'figures: ["raw/figures/Retry Paper-p1.md"]\n'),
  'raw/clippings/Backoff Notes.md': clipping('Backoff Notes', 'Wait longer each time.'),
  'raw/figures/Retry Paper-p1.md': '---\nsource: "https://example.com/Retry%20Paper"\npage: 1\n---\n![[raw/figures/Retry Paper-p1.png]]\n',
  'index.md': '# Index\n',
  'log/2026-01-01-000000-relink-start.md': '---\ndate: 2026-01-01\nop: relink\n---\nStarted.\n',
};

function vault(root, id, files) {
  const path = join(root, id);
  mkdirSync(join(path, 'log'), { recursive: true });
  writeFileSync(join(path, 'VAULT.md'), `---\nschema-version: 1\nvault-id: ${id}\npurpose: Fixture\nincludes: [Fixture]\nexcludes: []\n---\n`);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(path, rel)), { recursive: true });
    writeFileSync(join(path, rel), content);
  }
  return path;
}

function fixture({ registry = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'wm-transfer-'));
  const general = vault(root, 'general', { ...GENERAL, 'raw/attachments/diagram.png': PNG, 'raw/figures/Retry Paper-p1.png': PNG });
  const docs = vault(root, 'docs', { 'wiki/authored/acorn/overview.md': '---\ntype: authored\nproject: acorn\nsources: []\n---\n# Acorn\n' });
  const config = join(root, 'vaults.json');
  if (registry) writeFileSync(config, JSON.stringify({ version: 1, defaultVault: 'general', vaults: [
    { id: 'general', path: general, obsidian: 'General Fixture' },
    { id: 'docs', path: docs, obsidian: 'Docs Fixture' },
  ] }));
  const env = { ...process.env, HOME: root, USERPROFILE: root, WIKI_MASTER_CONFIG: config, WIKI_MASTER_PROJECT_ROOT: '' };
  for (const key of ['WIKI_MASTER_VAULT', 'WIKI_MASTER_VAULT_ID', 'WIKI_MASTER_VAULT_NAME', 'WIKI_MASTER_PROJECT_ROOT']) delete env[key];
  if (!registry) { delete env.WIKI_MASTER_CONFIG; env.WIKI_MASTER_VAULT = general; }
  const run = (script, args) => spawnSync(process.execPath, [script, ...args], { cwd: root, env, encoding: 'utf8', timeout: 30000 });
  const transfer = (...args) => run(SCRIPT, args);
  return { root, general, docs, transfer, run, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const SELECT = ['--from', 'general', '--to', 'docs', '--seed-folder', 'wiki/authored/alpha', '--seeds', 'moc/alpha.md'];

function snapshot(dir) {
  const out = {};
  for (const rel of readdirSync(dir, { recursive: true })) {
    const p = join(dir, rel);
    if (statSync(p).isFile()) out[rel.replaceAll('\\', '/')] = sha(readFileSync(p));
  }
  return out;
}
const logs = (dir, op) => readdirSync(join(dir, 'log')).filter((n) => n.includes(`-${op}-`));
const planOf = (f, args = SELECT) => {
  const r = f.transfer('--plan', ...args, '--json');
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};

test('a plan selects the seeds, their direct links and the evidence they cite, and writes nothing', (t) => {
  const f = fixture(); t.after(f.cleanup);
  const before = { general: snapshot(f.general), docs: snapshot(f.docs) };
  const plan = planOf(f);
  const reasons = Object.fromEntries(plan.entries.map((e) => [e.path, e.reason]));
  assert.deepEqual(reasons, {
    'moc/alpha.md': 'seed',
    'raw/attachments/diagram.png': 'evidence',
    'raw/clippings/Queue Notes.md': 'evidence',
    'raw/clippings/Retry Paper.md': 'evidence',
    'raw/figures/Retry Paper-p1.md': 'evidence',
    'raw/figures/Retry Paper-p1.png': 'evidence',
    'wiki/authored/alpha/architecture.md': 'seed',
    'wiki/authored/alpha/overview.md': 'seed',
    'wiki/concepts/Retry Budget.md': 'linked',
    'wiki/sources/Queue Notes.md': 'linked',
  });
  assert.equal(plan.totals.raw, 5);
  assert.ok(plan.totals.bytes > 0);
  assert.deepEqual(plan.blocking, []);
  assert.deepEqual(plan.conflicts, []);
  assert.match(plan.id, /^[0-9a-f]{16}$/);
  assert.deepEqual({ general: snapshot(f.general), docs: snapshot(f.docs) }, before, 'a plan writes nothing');

  const deeper = planOf(f, [...SELECT, '--depth', '2']);
  assert.ok(deeper.entries.some((e) => e.path === 'wiki/concepts/Backoff.md' && e.depth === 2));
  assert.ok(deeper.entries.some((e) => e.path === 'raw/clippings/Backoff Notes.md'), 'a selected page brings its evidence at any depth');
  assert.notEqual(deeper.id, plan.id);
  const seedsOnly = planOf(f, [...SELECT, '--depth', '0']);
  assert.ok(!seedsOnly.entries.some((e) => e.reason === 'linked'));
});

test('a copy lands raw bytes unchanged, rewrites only links, logs once in each vault and is idempotent', (t) => {
  const f = fixture(); t.after(f.cleanup);
  const sourceBefore = snapshot(f.general);
  const plan = planOf(f);
  const r = f.transfer('--apply', ...SELECT, '--expect', plan.id);
  assert.equal(r.status, 0, r.stderr);

  for (const raw of ['raw/clippings/Queue Notes.md', 'raw/clippings/Retry Paper.md', 'raw/attachments/diagram.png', 'raw/figures/Retry Paper-p1.png']) {
    assert.deepEqual(readFileSync(join(f.docs, raw)), readFileSync(join(f.general, raw)), `${raw} is byte-identical`);
  }
  assert.ok(readFileSync(join(f.docs, 'raw/clippings/Queue Notes.md'), 'utf8').includes('[[length]]'), 'raw bodies are never rewritten');

  const concept = readFileSync(join(f.docs, 'wiki/concepts/Retry Budget.md'), 'utf8');
  assert.ok(concept.includes('backing off (vault general: wiki/concepts/Backoff.md)'), concept);
  assert.ok(!concept.includes('[[Backoff'), 'a page outside the selection never stays a link, nested list items included');
  assert.ok(concept.includes('\t- nested Backoff (vault general: wiki/concepts/Backoff.md) too'), concept);
  assert.ok(concept.includes('\t  [[Indented Example]]'), 'a link in an indented fence is code and stays');
  assert.ok(concept.includes('[[Missing Page]]'), 'an unresolved link is left as written');
  assert.ok(concept.startsWith('---\ntype: concept\nsources: ["[[raw/clippings/Retry Paper.md]]"]\nai-generated: true\n---\n'), 'frontmatter is intact');

  // The destination has its own overview, which sorts first: the bare link would land there, so it gains its path.
  const architecture = readFileSync(join(f.docs, 'wiki/authored/alpha/architecture.md'), 'utf8');
  assert.ok(architecture.includes('Back to [[wiki/authored/alpha/overview.md|overview]].'), architecture);
  assert.ok(architecture.includes('| a | [[wiki/authored/alpha/overview.md\\|overview]] |'), 'a table cell escapes the alias bar');
  const overview = readFileSync(join(f.docs, 'wiki/authored/alpha/overview.md'), 'utf8');
  assert.ok(overview.includes('```\n[[Code Example]]\n```'), 'links in code are examples and stay');
  assert.ok(overview.includes('![[raw/attachments/diagram.png]]'));
  assert.ok(overview.includes('Recorded in log/2026-01-01-000000-relink-start (vault general: log/2026-01-01-000000-relink-start.md).'), 'a log entry is the source vault\'s own history and becomes text');

  assert.equal(logs(f.docs, 'transfer-in').length, 1);
  assert.equal(logs(f.general, 'transfer-out').length, 1);
  const inLog = readFileSync(join(f.docs, 'log', logs(f.docs, 'transfer-in')[0]), 'utf8');
  assert.match(inLog, new RegExp(`Transfer \`${plan.id}\` \\(copy\\) from vault \`general\``));
  assert.match(readFileSync(join(f.general, 'log', logs(f.general, 'transfer-out')[0]), 'utf8'), /to vault `docs`/);
  assert.ok(!inLog.includes(f.root) && !inLog.includes(f.general), 'a log names vault IDs, never roots');

  const after = snapshot(f.general);
  for (const [p, h] of Object.entries(sourceBefore)) assert.equal(after[p], h, `copy leaves ${p} at the source`);

  const docsAfter = snapshot(f.docs);
  assert.equal(planOf(f).id, plan.id, 'the plan is the same once its files have landed');
  const again = f.transfer('--apply', ...SELECT, '--expect', plan.id);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /copied 0 file\(s\)/);
  assert.deepEqual(snapshot(f.docs), docsAfter, 'a second apply changes nothing');
  assert.equal(logs(f.general, 'transfer-out').length, 1);
});

test('an interrupted copy is finished by the same apply, with one log entry', (t) => {
  const f = fixture(); t.after(f.cleanup);
  const plan = planOf(f);
  // A copy stopped partway: some of the planned files are already there.
  for (const p of ['raw/clippings/Queue Notes.md', 'raw/attachments/diagram.png']) {
    mkdirSync(dirname(join(f.docs, p)), { recursive: true });
    writeFileSync(join(f.docs, p), readFileSync(join(f.general, p)));
  }
  assert.equal(planOf(f).id, plan.id);
  const r = f.transfer('--apply', ...SELECT, '--expect', plan.id);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`copied ${plan.entries.length - 2} file\\(s\\)`));
  assert.equal(logs(f.docs, 'transfer-in').length, 1);
});

test('apply refuses without a reviewed plan id, and when the vaults changed since the review', (t) => {
  const f = fixture(); t.after(f.cleanup);
  const none = f.transfer('--apply', ...SELECT);
  assert.equal(none.status, 2);
  assert.match(none.stderr, /--expect/);
  const plan = planOf(f);
  writeFileSync(join(f.general, 'wiki/concepts/Retry Budget.md'), GENERAL['wiki/concepts/Retry Budget.md'] + '\nEdited.\n');
  const before = snapshot(f.docs);
  const r = f.transfer('--apply', ...SELECT, '--expect', plan.id);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not the reviewed/);
  assert.deepEqual(snapshot(f.docs), before);
});

test('a clipping whose text does not match its source-hash blocks the transfer', (t) => {
  const f = fixture(); t.after(f.cleanup);
  writeFileSync(join(f.general, 'raw/clippings/Queue Notes.md'), GENERAL['raw/clippings/Queue Notes.md'].replace('Queues hold items', 'Queues drop items'));
  const plan = planOf(f);
  assert.deepEqual(plan.blocking.map((b) => [b.path, b.reason]), [['raw/clippings/Queue Notes.md', 'hash-mismatch']]);
  const before = snapshot(f.docs);
  const r = f.transfer('--apply', ...SELECT, '--expect', plan.id);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /refusing to apply/);
  assert.deepEqual(snapshot(f.docs), before);

  // The owner can accept copying it as it is: byte for byte, named in the plan and in both logs.
  const accepted = planOf(f, [...SELECT, '--allow-hash-mismatch']);
  assert.deepEqual(accepted.blocking, []);
  assert.deepEqual(accepted.notes.mismatched, ['raw/clippings/Queue Notes.md']);
  assert.notEqual(accepted.id, plan.id);
  const ok = f.transfer('--apply', ...SELECT, '--allow-hash-mismatch', '--expect', accepted.id);
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(readFileSync(join(f.docs, 'raw/clippings/Queue Notes.md')), readFileSync(join(f.general, 'raw/clippings/Queue Notes.md')));
  assert.match(readFileSync(join(f.docs, 'log', logs(f.docs, 'transfer-in')[0]), 'utf8'), /not matching their source-hash[\s\S]*raw\/clippings\/Queue Notes\.md/);
  assert.match(readFileSync(join(f.general, 'log', logs(f.general, 'transfer-out')[0]), 'utf8'), /not matching their source-hash here:\n- `raw\/clippings\/Queue Notes\.md`/);
});

test('a clipping whose text is its source-hash\'s text in another form moves without --allow-hash-mismatch, named as a note', (t) => {
  const f = fixture(); t.after(f.cleanup);
  // Hashes recorded by the old rule, which kept carriage returns: one over the body with CRLF line endings (the file
  // since converted to LF, as `eol=lf` does on commit), one over the body with one more final line break.
  const recordedOver = (file, hashed) => file.replace(/^source-hash: [0-9a-f]{64}$/m, `source-hash: ${sha(hashed)}`);
  const queue = recordedOver(clipping('Queue Notes', 'Queues hold items.\nThey drain in order.'), 'Queues hold items.\r\nThey drain in order.');
  const retry = recordedOver(clipping('Retry Paper', 'Retries are budgeted.\nEach one waits.', 'figures: ["raw/figures/Retry Paper-p1.md"]\n'), 'Retries are budgeted.\nEach one waits.\n');
  assert.equal(verifyClippingHash(queue, queue.match(/^source-hash: (\S+)$/m)[1]), 'crlf-variant', 'fixture precondition');
  assert.equal(verifyClippingHash(retry, retry.match(/^source-hash: (\S+)$/m)[1]), 'trailing-newline', 'fixture precondition');
  writeFileSync(join(f.general, 'raw/clippings/Queue Notes.md'), queue);
  writeFileSync(join(f.general, 'raw/clippings/Retry Paper.md'), retry);
  const equivalent = [
    { path: 'raw/clippings/Queue Notes.md', status: 'crlf-variant' },
    { path: 'raw/clippings/Retry Paper.md', status: 'trailing-newline' },
  ];

  const plan = planOf(f, [...SELECT, '--mode', 'move']);
  assert.deepEqual(plan.blocking, []);
  assert.deepEqual(plan.notes.mismatched, []);
  assert.deepEqual(plan.notes.equivalent, equivalent);
  assert.ok(plan.entries.every((e) => !e.hashMismatch));
  const printed = f.transfer('--plan', ...SELECT, '--mode', 'move');
  assert.equal(printed.status, 0, printed.stderr);
  assert.match(printed.stdout, /NOTE — clippings whose text is the text their source-hash records, in another form[^\n]*\(2\)[^\n]*\n {4}raw\/clippings\/Queue Notes\.md \(crlf-variant\)\n {4}raw\/clippings\/Retry Paper\.md \(trailing-newline\)\n/);

  // --allow-hash-mismatch keeps its meaning for real mismatches only: an equivalent clipping is not accepted as one.
  const allowed = planOf(f, [...SELECT, '--mode', 'move', '--allow-hash-mismatch']);
  assert.deepEqual(allowed.notes.mismatched, []);
  assert.deepEqual(allowed.notes.equivalent, equivalent);

  // The apply's own check after the copy accepts them too, and the files land byte for byte.
  const r = f.transfer('--apply', ...SELECT, '--mode', 'move', '--expect', plan.id);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(f.docs, 'raw/clippings/Queue Notes.md'), 'utf8'), queue);
  assert.equal(readFileSync(join(f.docs, 'raw/clippings/Retry Paper.md'), 'utf8'), retry);
  assert.doesNotMatch(readFileSync(join(f.docs, 'log', logs(f.docs, 'transfer-in')[0]), 'utf8'), /not matching their source-hash/);
});

test('a sources: entry that leaves the selection blocks', (t) => {
  const f = fixture(); t.after(f.cleanup);
  const plan = planOf(f, ['--from', 'general', '--to', 'docs', '--seeds', 'wiki/syntheses/Digest.md', '--depth', '0']);
  assert.deepEqual(plan.blocking.map((b) => [b.path, b.reason]), [['wiki/syntheses/Digest.md', 'provenance-outside-selection']]);
  const linked = planOf(f, ['--from', 'general', '--to', 'docs', '--seeds', 'wiki/syntheses/Digest.md']);
  assert.deepEqual(linked.blocking, [], 'at depth 1 the cited page is selected');
});

test('a destination file that differs is a conflict: refused by default, kept with keep-destination', (t) => {
  const f = fixture(); t.after(f.cleanup);
  const theirs = '---\ntype: concept\nsources: []\n---\n# Their Retry Budget\n';
  mkdirSync(join(f.docs, 'wiki/concepts'), { recursive: true });
  writeFileSync(join(f.docs, 'wiki/concepts/Retry Budget.md'), theirs);
  const plan = planOf(f);
  assert.deepEqual(plan.conflicts.map((c) => c.path), ['wiki/concepts/Retry Budget.md']);
  const before = snapshot(f.docs);
  const refused = f.transfer('--apply', ...SELECT, '--expect', plan.id);
  assert.equal(refused.status, 1);
  assert.deepEqual(snapshot(f.docs), before, 'nothing is written while a conflict stands');

  const keep = planOf(f, [...SELECT, '--on-conflict', 'keep-destination']);
  assert.deepEqual(keep.conflicts, []);
  assert.equal(keep.entries.find((e) => e.path === 'wiki/concepts/Retry Budget.md').state, 'keep-destination');
  const r = f.transfer('--apply', ...SELECT, '--on-conflict', 'keep-destination', '--expect', keep.id);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(f.docs, 'wiki/concepts/Retry Budget.md'), 'utf8'), theirs);
  assert.ok(existsSync(join(f.docs, 'raw/clippings/Retry Paper.md')));
});

test('a destination path that differs only in letter case is a conflict', (t) => {
  const f = fixture(); t.after(f.cleanup);
  mkdirSync(join(f.docs, 'wiki/sources'), { recursive: true });
  writeFileSync(join(f.docs, 'wiki/sources/queue notes.md'), GENERAL['wiki/sources/Queue Notes.md']);
  const [conflict] = planOf(f).conflicts;
  assert.equal(conflict.path, 'wiki/sources/Queue Notes.md');
  assert.match(conflict.detail, /letter case/);
});

test('a file a destination purge recorded is a conflict, since its reconcile would bin it again', (t) => {
  const f = fixture(); t.after(f.cleanup);
  mkdirSync(join(f.docs, '.recycle/2026-01-01-old'), { recursive: true });
  writeFileSync(join(f.docs, '.recycle/2026-01-01-old/manifest.json'), JSON.stringify({ id: '2026-01-01-old', entries: [{ layer: 'raw', from: 'raw/clippings/Queue Notes.md' }], declines: [] }));
  assert.deepEqual(planOf(f).conflicts.map((c) => c.path), ['raw/clippings/Queue Notes.md']);
});

test('a move removes at the source only what nothing there still needs, through a restorable purge', (t) => {
  const f = fixture(); t.after(f.cleanup);
  const sourceBefore = snapshot(f.general);
  const plan = planOf(f, [...SELECT, '--mode', 'move']);
  // Elsewhere stays and cites Queue Notes, so the source page and its clipping stay too. Elsewhere and the kept
  // Queue Notes also link to the overview, a seed: it is still removed. Every link left pointing at a removed
  // page, theirs and the hand map's link to the removed Retry Budget, is listed and becomes plain text.
  assert.deepEqual(plan.removal.keep.map((k) => k.path), ['raw/clippings/Queue Notes.md', 'wiki/sources/Queue Notes.md']);
  assert.ok(plan.removal.remove.includes('wiki/authored/alpha/overview.md'));
  const inbound = [
    { page: 'moc/tasks.md', from: '[[Retry Budget]]', to: 'Retry Budget (vault docs: wiki/concepts/Retry Budget.md)' },
    { page: 'wiki/concepts/Elsewhere.md', from: '[[wiki/authored/alpha/overview|the alpha overview]]', to: 'the alpha overview (vault docs: wiki/authored/alpha/overview.md)' },
    { page: 'wiki/sources/Queue Notes.md', from: '[[wiki/authored/alpha/overview|alpha]]', to: 'alpha (vault docs: wiki/authored/alpha/overview.md)' },
  ];
  assert.deepEqual(plan.removal.inbound, inbound);
  assert.deepEqual(graphOf(f.general).brokenLinks.filter((b) => !plan.removal.remove.includes(b.source)), [], 'the fixture starts with no broken link on a page that stays');
  const r = f.transfer('--apply', ...SELECT, '--mode', 'move', '--expect', plan.id);
  assert.equal(r.status, 0, r.stderr);

  for (const l of inbound) {
    const text = readFileSync(join(f.general, l.page), 'utf8');
    assert.ok(text.includes(l.to) && !text.includes(l.from), `${l.page}: ${text}`);
  }
  assert.deepEqual(graphOf(f.general).brokenLinks, [], 'no page left at the source links to a removed page');

  for (const p of plan.removal.remove) {
    assert.ok(!existsSync(join(f.general, p)), `${p} is removed at the source`);
    assert.ok(existsSync(join(f.docs, p)), `${p} is at the destination`);
  }
  for (const p of ['wiki/sources/Queue Notes.md', 'raw/clippings/Queue Notes.md']) {
    assert.ok(existsSync(join(f.general, p)) && existsSync(join(f.docs, p)), `${p} is in both vaults`);
  }
  const bins = readdirSync(join(f.general, '.recycle'));
  assert.equal(bins.length, 1);
  const manifest = JSON.parse(readFileSync(join(f.general, '.recycle', bins[0], 'manifest.json'), 'utf8'));
  // Declined like a purge, so discovery at the source does not clip it again for its reconcile to bin.
  assert.deepEqual(manifest.declines, ['https://example.com/Retry%20Paper']);
  const declined = () => {
    const file = join(f.general, '.wiki-master/declined.json');
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).map((d) => [d.url, d.reason]) : [];
  };
  assert.deepEqual(declined(), [['https://example.com/Retry%20Paper', `purged:${bins[0]}`]]);
  assert.ok(!existsSync(join(f.docs, '.wiki-master/declined.json')), 'the destination declines nothing');
  assert.deepEqual(manifest.entries.map((e) => e.from).sort(), plan.removal.remove);
  for (const l of inbound) {
    assert.equal(sha(readFileSync(join(f.general, '.recycle', bins[0], 'transfer-originals', l.page))), sourceBefore[l.page], `${l.page} is kept as it was`);
  }
  assert.equal(logs(f.general, 'transfer-out').length, 1);
  assert.match(readFileSync(join(f.general, 'log', logs(f.general, 'transfer-out')[0]), 'utf8'), /3 link\(s\) here to removed pages became plain text naming vault `docs`/);

  const restore = f.run(PURGE, ['--restore', bins[0]]);
  assert.equal(restore.status, 0, restore.stderr);
  assert.deepEqual(declined(), [], 'restore clears the declines the move recorded');
  const restored = snapshot(f.general);
  for (const p of plan.removal.remove) assert.equal(restored[p], sourceBefore[p], `purge --restore brings back ${p} as it was`);
});

test('a move refuses while a page staying at the source cites a moved page in sources:', (t) => {
  const f = fixture(); t.after(f.cleanup);
  writeFileSync(join(f.general, 'wiki/syntheses/Cites Alpha.md'), '---\ntype: synthesis\nsources: ["[[wiki/authored/alpha/overview]]"]\nai-generated: true\n---\n# Cites Alpha\n\nText.\n');
  const plan = planOf(f, [...SELECT, '--mode', 'move']);
  assert.deepEqual(plan.blocking.map((b) => [b.path, b.reason]), [['wiki/syntheses/Cites Alpha.md', 'cites-moved-page']]);
  const before = { general: snapshot(f.general), docs: snapshot(f.docs) };
  const r = f.transfer('--apply', ...SELECT, '--mode', 'move', '--expect', plan.id);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /cites-moved-page/);
  assert.deepEqual({ general: snapshot(f.general), docs: snapshot(f.docs) }, before);
  assert.deepEqual(planOf(f).blocking, [], 'a copy removes nothing, so the citation still resolves');
});

test('a move interrupted after its manifest is written finishes on the same apply', (t) => {
  const f = fixture(); t.after(f.cleanup);
  const plan = planOf(f, [...SELECT, '--mode', 'move']);
  assert.equal(f.transfer('--apply', ...SELECT, '--mode', 'move', '--expect', plan.id).status, 0);
  // Put two binned files back where they were, and one page's links back as they were, as though the apply
  // stopped after writing its manifest.
  const [bin] = readdirSync(join(f.general, '.recycle'));
  for (const p of plan.removal.remove.slice(0, 2)) renameSync(join(f.general, '.recycle', bin, p), join(f.general, p));
  writeFileSync(join(f.general, 'wiki/concepts/Elsewhere.md'), GENERAL['wiki/concepts/Elsewhere.md']);
  const r = f.transfer('--apply', ...SELECT, '--mode', 'move', '--expect', plan.id);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /resuming the removal/);
  for (const p of plan.removal.remove) assert.ok(!existsSync(join(f.general, p)), `${p} is removed`);
  assert.ok(readFileSync(join(f.general, 'wiki/concepts/Elsewhere.md'), 'utf8').includes('the alpha overview (vault docs: wiki/authored/alpha/overview.md)'), 'the rewrite is finished too');
  assert.deepEqual(graphOf(f.general).brokenLinks, []);
  assert.equal(readdirSync(join(f.general, '.recycle')).length, 1, 'the same purge is finished, not a second one started');
  assert.equal(logs(f.general, 'transfer-out').length, 1);
  assert.equal(logs(f.docs, 'transfer-in').length, 1);
});

test('usage and configuration errors exit 2 and write nothing', (t) => {
  const f = fixture(); t.after(f.cleanup);
  const before = { general: snapshot(f.general), docs: snapshot(f.docs) };
  const cases = [
    [['--plan', '--from', 'general', '--to', 'general', '--seeds', 'moc/alpha.md'], /same vault/],
    [['--plan', '--from', 'general', '--to', 'nowhere', '--seeds', 'moc/alpha.md'], /nowhere/],
    [['--plan', '--from', 'general', '--to', 'docs'], /seed/],
    [['--plan', '--from', 'general', '--to', 'docs', '--seeds', 'index.md'], /system file/],
    [['--plan', '--from', 'general', '--to', 'docs', '--seeds', 'wiki/concepts/Absent.md'], /not a page/],
    [['--plan', '--from', 'general', '--to', 'docs', '--seed-folder', 'wiki/authored/none'], /holds no page/],
    [['--plan', ...SELECT, '--depth', 'two'], /--depth/],
    [['--plan', ...SELECT, '--mode', 'swap'], /--mode/],
  ];
  for (const [args, message] of cases) {
    const r = f.transfer(...args);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stderr}`);
    assert.match(r.stderr, message);
  }
  assert.deepEqual({ general: snapshot(f.general), docs: snapshot(f.docs) }, before);

  const legacy = fixture({ registry: false }); t.after(legacy.cleanup);
  const r = legacy.transfer('--plan', ...SELECT);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /registry/);
});

test('--exclude keeps pages out of the selection: listed, linked as text, and their own evidence left behind', (t) => {
  const f = fixture(); t.after(f.cleanup);
  for (const pattern of ['wiki/concepts/Retry Budget.md', 'wiki/concepts/', 'wiki/concepts/*.md', '**/Retry Budget.md']) {
    const plan = planOf(f, [...SELECT, '--exclude', pattern]);
    assert.deepEqual(plan.excluded, [{ path: 'wiki/concepts/Retry Budget.md', reason: 'linked', via: 'wiki/authored/alpha/overview.md' }], pattern);
    assert.ok(!plan.entries.some((e) => e.path === 'wiki/concepts/Retry Budget.md' || e.path === 'raw/clippings/Retry Paper.md'), `${pattern}: the excluded page and the evidence only it cites stay out`);
    assert.deepEqual(plan.blocking, []);
  }
  const plan = planOf(f, [...SELECT, '--exclude=wiki/concepts/Retry Budget.md']);
  assert.notEqual(plan.id, planOf(f).id, 'the exclusions are part of the plan id');
  const r = f.transfer('--apply', ...SELECT, '--exclude=wiki/concepts/Retry Budget.md', '--expect', plan.id);
  assert.equal(r.status, 0, r.stderr);
  const overview = readFileSync(join(f.docs, 'wiki/authored/alpha/overview.md'), 'utf8');
  assert.ok(overview.includes('the Retry Budget (vault general: wiki/concepts/Retry Budget.md) idea'), overview);
  assert.ok(!existsSync(join(f.docs, 'wiki/concepts/Retry Budget.md')));
});

test('a move never removes an excluded page, and links to it stay live at the source', (t) => {
  const f = fixture(); t.after(f.cleanup);
  const before = readFileSync(join(f.general, 'wiki/concepts/Retry Budget.md'));
  const args = [...SELECT, '--mode', 'move', '--exclude', 'wiki/concepts/Retry Budget.md'];
  const plan = planOf(f, args);
  assert.ok(!plan.removal.remove.includes('wiki/concepts/Retry Budget.md'));
  assert.ok(!plan.removal.inbound.some((l) => l.to.includes('wiki/concepts/Retry Budget.md')), 'the hand map keeps its link to the page that stays');
  const r = f.transfer('--apply', ...args, '--expect', plan.id);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readFileSync(join(f.general, 'wiki/concepts/Retry Budget.md')), before);
  assert.ok(existsSync(join(f.general, 'raw/clippings/Retry Paper.md')), 'its evidence stays with it');
  assert.ok(readFileSync(join(f.general, 'moc/tasks.md'), 'utf8').includes('[[Retry Budget]]'));
  assert.ok(!existsSync(join(f.general, 'wiki/authored/alpha/overview.md')), 'the rest moved');
});

test('an exclusion that matches nothing, or that excludes every seed, is refused; one that cuts provenance blocks', (t) => {
  const f = fixture(); t.after(f.cleanup);
  for (const [args, message] of [
    [[...SELECT, '--exclude', 'wiki/concepts/Retry Budgte.md'], /--exclude wiki\/concepts\/Retry Budgte\.md matches no page/],
    [[...SELECT, '--exclude', 'wiki/authored/alpha/', '--exclude', 'moc/alpha.md'], /every seed is excluded/],
    [[...SELECT, '--exclude='], /--exclude needs/],
  ]) {
    const r = f.transfer('--plan', ...args);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stderr}`);
    assert.match(r.stderr, message);
  }
  const plan = planOf(f, [...SELECT, '--exclude', 'raw/clippings/Queue Notes.md']);
  assert.deepEqual(plan.blocking.map((b) => [b.path, b.reason]), [['wiki/sources/Queue Notes.md', 'provenance-excluded']]);
  const seedOut = planOf(f, [...SELECT, '--exclude', 'wiki/authored/alpha/architecture.md']);
  assert.deepEqual(seedOut.excluded, [{ path: 'wiki/authored/alpha/architecture.md', reason: 'seed', via: null }]);
  assert.ok(!seedOut.entries.some((e) => e.path === 'wiki/authored/alpha/architecture.md'));
  // An excluded seed brings nothing in: neither the pages it links to nor the evidence it cites.
  const narrow = planOf(f, ['--from', 'general', '--to', 'docs', '--seeds', 'wiki/concepts/Elsewhere.md,wiki/concepts/Backoff.md', '--exclude', 'wiki/concepts/Elsewhere.md']);
  assert.deepEqual(narrow.entries.map((e) => e.path), ['raw/clippings/Backoff Notes.md', 'wiki/concepts/Backoff.md']);
});

test('--seeds-file names seeds one per line, so a comma stays part of the name', (t) => {
  const f = fixture(); t.after(f.cleanup);
  const comma = 'wiki/concepts/Lanterns, Kites and Ropes.md';
  writeFileSync(join(f.general, comma), '---\ntype: concept\nsources: []\nai-generated: true\n---\n# Lanterns, Kites and Ropes\n\nText.\n');
  const list = (name, text) => { const p = join(f.root, name); writeFileSync(p, text); return p; };
  const before = { general: snapshot(f.general), docs: snapshot(f.docs) };

  // One path per line with a comma in it, CRLF line ends, a byte-order mark, blank lines and comments.
  const file = list('seeds.txt', `\uFEFF# pages to copy\r\n${comma}\r\n\r\n  # indented comment\r\nmoc/alpha.md\r\n`);
  const fromFile = planOf(f, ['--from', 'general', '--to', 'docs', '--seeds-file', file]);
  assert.deepEqual(fromFile.seeds, ['moc/alpha.md', comma]);
  assert.ok(fromFile.entries.some((e) => e.path === comma && e.reason === 'seed'), 'the comma-named page is one seed');

  // The same seeds give the same plan id however they are named: by --seeds, by file, or by both with overlap.
  const listedId = planOf(f, ['--from', 'general', '--to', 'docs', '--seeds', 'moc/alpha.md', '--seeds-file', list('one.txt', `${comma}\n`)]).id;
  const mixed = planOf(f, ['--from', 'general', '--to', 'docs', '--seeds', 'moc/alpha.md', '--seeds-file', file, '--seeds-file', list('again.txt', 'moc/alpha.md\n')]);
  assert.equal(listedId, fromFile.id);
  assert.equal(mixed.id, fromFile.id);
  assert.deepEqual(mixed.seeds, fromFile.seeds);
  assert.equal(planOf(f, ['--from', 'general', '--to', 'docs', '--seeds-file', list('alpha.txt', 'moc/alpha.md\n')]).id,
    planOf(f, ['--from', 'general', '--to', 'docs', '--seeds', 'moc/alpha.md']).id);

  // --seeds still splits on commas, which is why the file exists.
  const split = f.transfer('--plan', '--from', 'general', '--to', 'docs', '--seeds', comma);
  assert.equal(split.status, 2);
  assert.match(split.stderr, /seed is not a page in vault general: wiki\/concepts\/Lanterns/);

  for (const [args, message] of [
    [['--seeds-file', join(f.root, 'absent.txt')], /--seeds-file .*absent\.txt could not be read \(ENOENT\)/],
    [['--seeds-file', f.root], /--seeds-file .* could not be read/],
    [['--seeds-file='], /--seeds-file needs a file/],
    [['--seeds-file', list('empty.txt', '# nothing yet\r\n\r\n')], /lists no paths/],
    [['--seeds-file', list('typo.txt', `${comma}\nwiki/concepts/Absent, Page.md\n`)], /seed is not a page in vault general: wiki\/concepts\/Absent, Page\.md/],
  ]) {
    const r = f.transfer('--plan', '--from', 'general', '--to', 'docs', ...args);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stderr}`);
    assert.match(r.stderr, message);
  }
  assert.deepEqual({ general: snapshot(f.general), docs: snapshot(f.docs) }, before, 'plans and refusals write nothing');

  const listBytes = readFileSync(file);
  const r = f.transfer('--apply', '--from', 'general', '--to', 'docs', '--seeds-file', file, '--expect', fromFile.id);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(f.docs, comma)));
  assert.deepEqual(readFileSync(file), listBytes, 'the seeds file is only read');
});
