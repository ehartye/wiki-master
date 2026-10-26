import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateAuthored } from '../scripts/validate-authored.mjs';
import * as contract from '../scripts/lib/authored-contract.mjs';
import { BACKLOG_STATUS_ORDER, KIND_ORDER } from '../scripts/lib/authored-group.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'scripts', 'validate-authored.mjs');
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ---------------------------------------------------------------- fixtures --

// A complete authored page. Pass `undefined` to omit a key, '' to leave it blank.
function page(fields = {}, body = '# A page\n\nA short body.\n') {
  const merged = {
    type: 'authored', created: '2026-10-24', updated: '2026-10-24', status: 'draft', sources: '[]',
    'ai-generated': 'true', project: 'demo', kind: 'note', ...fields,
  };
  const lines = Object.entries(merged).filter(([, v]) => v !== undefined)
    .map(([k, v]) => (v === '' ? `${k}:` : `${k}: ${v}`));
  return `---\n${lines.join('\n')}\n---\n${body}`;
}

const lineOf = (text, pattern) => {
  const i = text.split('\n').findIndex(line => pattern.test(line));
  assert.ok(i >= 0, `no line matches ${pattern}`);
  return i + 1;
};

function vault(t) {
  const root = mkdtempSync(join(tmpdir(), 'validate-authored-'));
  assert.ok(resolve(root).startsWith(resolve(tmpdir())), 'fixture vault must live under the system temp directory');
  const scratch = mkdtempSync(join(tmpdir(), 'validate-authored-ledger-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true }); });
  let counter = 0;
  const put = (path, text) => { const file = join(root, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); return text; };
  const ledgerText = text => { const file = join(scratch, `ledger-${counter++}.json`); writeFileSync(file, text); return file; };
  const ledger = paths => ledgerText(JSON.stringify(paths));
  // The vault reaches the child through its environment only; the cwd is unrelated to the vault.
  const run = args => spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: scratch, encoding: 'utf8', env: { ...process.env, WIKI_MASTER_VAULT: root },
  });
  const runLedger = (paths, extra = []) => run(['--paths-file', ledger(paths), ...extra]);
  return { root, scratch, put, ledger, ledgerText, run, runLedger, validate: paths => validateAuthored(root, paths) };
}

const rules = (result, path) => result.defects.filter(d => !path || d.path === path).map(d => d.rule);
const only = (result, path) => {
  const found = result.defects.filter(d => d.path === path);
  assert.equal(found.length, 1, `${path}: expected one defect, got ${JSON.stringify(found)}`);
  return found[0];
};

const DEMO = 'wiki/authored/demo';
const LINKS_BODY = [
  '# Links page', '',
  'The plan is in [[Missing Page]].',
  'A bare link [[roadmap]] is ambiguous.',
  'A split link [[Split',
  'Target]] is malformed.',
  'An example in code `[[Example]]` is ignored.', '',
].join('\n');

function exampleFixture(t) {
  const v = vault(t);
  v.put(`${DEMO}/overview.md`, page({ kind: 'overview' }, '# Demo overview\n\nSee [[wiki/authored/demo/roadmap.md|demo roadmap]].\n'));
  v.put(`${DEMO}/roadmap.md`, page({ kind: 'roadmap' }, '# Demo roadmap\n\nPlanned work.\n'));
  v.put('wiki/authored/other/roadmap.md', page({ project: 'other', kind: 'roadmap' }, '# Other roadmap\n\nPlanned work.\n'));
  v.put(`${DEMO}/backlog/wrong-kind.md`, page({ kind: 'note' }, '# Wrong kind\n\nThis item sits in the backlog folder.\n'));
  v.put(`${DEMO}/backlog/bad-status.md`, page({ kind: 'backlog-item', 'backlog-status': 'proposed' }, '# Bad status\n\nAn item.\n'));
  v.put(`${DEMO}/notes/no-sources.md`, page({ sources: undefined }, '# No sources\n'));
  v.put(`${DEMO}/notes/links.md`, page({}, LINKS_BODY));
  // Broken, but not part of the task: it must never be reported.
  v.put(`${DEMO}/notes/outside-broken.md`, '# Outside\n\n[[Nowhere]] [[roadmap]] [[Torn\nLink]]\n');
  const ledger = [
    `${DEMO}/overview.md`, `${DEMO}/roadmap.md`, `${DEMO}/backlog/wrong-kind.md`,
    `${DEMO}/backlog/bad-status.md`, `${DEMO}/notes/no-sources.md`, `${DEMO}/notes/links.md`,
  ];
  return { ...v, ledgerPaths: ledger };
}

function snapshot(root) {
  const out = new Map();
  (function walk(dir, rel) {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name), r = rel ? `${rel}/${name}` : name, st = statSync(abs);
      if (st.isDirectory()) { out.set(r, `dir:${st.mtimeMs}`); walk(abs, r); }
      else out.set(r, `${st.size}:${st.mtimeMs}:${createHash('sha256').update(readFileSync(abs)).digest('hex')}`);
    }
  })(root, '');
  return out;
}

// ------------------------------------------------- the example, end to end --

test('the example fixture reports exactly the six defects by path and line, then the summary, and exits 1', t => {
  const v = exampleFixture(t);
  const r = v.runLedger(v.ledgerPaths);
  assert.equal(r.status, 1, r.stderr);
  assert.equal(r.stderr, '');
  const lines = r.stdout.trimEnd().split('\n');
  const links = readFileSync(join(v.root, `${DEMO}/notes/links.md`), 'utf8');
  const wrong = readFileSync(join(v.root, `${DEMO}/backlog/wrong-kind.md`), 'utf8');
  const bad = readFileSync(join(v.root, `${DEMO}/backlog/bad-status.md`), 'utf8');
  const expected = [
    [`${DEMO}/backlog/bad-status.md`, lineOf(bad, /^backlog-status:/), 'bad-value'],
    [`${DEMO}/backlog/wrong-kind.md`, lineOf(wrong, /^kind:/), 'kind-folder-mismatch'],
    [`${DEMO}/notes/links.md`, lineOf(links, /Missing Page/), 'unresolved-link'],
    [`${DEMO}/notes/links.md`, lineOf(links, /\[\[roadmap\]\]/), 'ambiguous-link'],
    [`${DEMO}/notes/links.md`, lineOf(links, /\[\[Split$/), 'malformed-link'],
    [`${DEMO}/notes/no-sources.md`, 1, 'missing-key'],
  ];
  assert.equal(lines.length, expected.length + 1, r.stdout);
  expected.forEach(([path, line, rule], i) => assert.ok(lines[i].startsWith(`${path}:${line} ${rule} `), `${lines[i]} should start with ${path}:${line} ${rule}`));
  assert.equal(lines.at(-1), 'validate-authored: 6 pages checked, 6 defects');
  assert.doesNotMatch(r.stdout, /Example|outside-broken/);
});

test('the example corrected prints only the zero-defect count and exits 0', t => {
  const v = exampleFixture(t);
  v.put(`${DEMO}/backlog/wrong-kind.md`, page({ kind: 'backlog-item', 'backlog-status': 'planned' }, '# Wrong kind\n\nNow a proper item.\n'));
  v.put(`${DEMO}/backlog/bad-status.md`, page({ kind: 'backlog-item', 'backlog-status': 'planned' }, '# Bad status\n\nAn item.\n'));
  v.put(`${DEMO}/notes/no-sources.md`, page({}, '# No sources\n'));
  v.put(`${DEMO}/notes/links.md`, page({}, '# Links page\n\nSee [[wiki/authored/demo/roadmap.md|roadmap]] and [[wiki/authored/demo/overview.md]].\nA joined link [[Overview]] is fine; `[[Example]]` is code.\n'));
  const r = v.runLedger(v.ledgerPaths);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stdout, 'validate-authored: 6 pages checked, 0 defects\n');
  assert.equal(r.stderr, '');
});

test('backlog criterion 1: a page whose kind disagrees with its folder is reported by path and line', t => {
  const v = exampleFixture(t);
  const d = only(v.validate(v.ledgerPaths), `${DEMO}/backlog/wrong-kind.md`);
  assert.equal(d.rule, 'kind-folder-mismatch');
  assert.equal(d.line, lineOf(readFileSync(join(v.root, d.path), 'utf8'), /^kind:/));
  assert.match(d.message, /note/);
  assert.match(d.message, /backlog-item/);
});

test('backlog criterion 2: a page with no sources line is reported at line 1 as a missing key', t => {
  const v = exampleFixture(t);
  const d = only(v.validate(v.ledgerPaths), `${DEMO}/notes/no-sources.md`);
  assert.deepEqual([d.rule, d.line], ['missing-key', 1]);
  assert.match(d.message, /"sources"/);
  assert.match(d.message, /\[\]/);
});

test('backlog criterion 3: an unresolved wikilink is an error on a ledger page, at its line', t => {
  const v = exampleFixture(t);
  const found = v.validate(v.ledgerPaths).defects.filter(d => d.rule === 'unresolved-link');
  assert.equal(found.length, 1);
  assert.equal(found[0].path, `${DEMO}/notes/links.md`);
  assert.equal(found[0].line, lineOf(readFileSync(join(v.root, found[0].path), 'utf8'), /Missing Page/));
  assert.match(found[0].message, /\[\[Missing Page\]\]/);
});

test('backlog criterion 4: an ambiguous bare link lists every candidate path', t => {
  const v = exampleFixture(t);
  const found = v.validate(v.ledgerPaths).defects.filter(d => d.rule === 'ambiguous-link');
  assert.equal(found.length, 1);
  assert.equal(found[0].line, lineOf(readFileSync(join(v.root, found[0].path), 'utf8'), /\[\[roadmap\]\]/));
  assert.match(found[0].message, /wiki\/authored\/demo\/roadmap\.md/);
  assert.match(found[0].message, /wiki\/authored\/other\/roadmap\.md/);
});

test('a hard-wrapped link is a malformed-link at the line it starts on; a link in a code span is not scanned', t => {
  const v = exampleFixture(t);
  const found = v.validate(v.ledgerPaths).defects.filter(d => d.rule === 'malformed-link');
  assert.equal(found.length, 1);
  assert.equal(found[0].line, lineOf(readFileSync(join(v.root, found[0].path), 'utf8'), /\[\[Split$/));
  assert.ok(!v.validate(v.ledgerPaths).defects.some(d => /Example/.test(d.message)));
});

// ------------------------------------------------------- vocabulary rules --

test('an invalid backlog-status or decision-status is reported with the allowed values', t => {
  const v = vault(t);
  v.put(`${DEMO}/decisions/old-adr.md`, page({ kind: 'decision', 'decision-status': 'accepted-implemented' }));
  v.put(`${DEMO}/backlog/done.md`, page({ kind: 'backlog-item', 'backlog-status': 'done' }));
  const r = v.validate([`${DEMO}/decisions/old-adr.md`, `${DEMO}/backlog/done.md`]);
  const adr = only(r, `${DEMO}/decisions/old-adr.md`);
  assert.equal(adr.rule, 'bad-value');
  assert.equal(adr.line, lineOf(readFileSync(join(v.root, adr.path), 'utf8'), /^decision-status:/));
  for (const value of ['proposed', 'accepted', 'superseded', 'deprecated']) assert.match(adr.message, new RegExp(value));
  const item = only(r, `${DEMO}/backlog/done.md`);
  assert.equal(item.rule, 'bad-value');
  for (const value of BACKLOG_STATUS_ORDER) assert.ok(item.message.includes(value), `${value} listed`);
});

test('kind outside the vocabulary, type, and ai-generated are bad-value; the kind also disagrees with its folder', t => {
  const v = vault(t);
  v.put(`${DEMO}/notes/runbook.md`, page({ kind: 'runbook' }));
  v.put(`${DEMO}/notes/ai.md`, page({ 'ai-generated': 'yes' }));
  v.put(`${DEMO}/notes/type.md`, page({ type: 'concept' }));
  const r = v.validate([`${DEMO}/notes/runbook.md`, `${DEMO}/notes/ai.md`, `${DEMO}/notes/type.md`]);
  assert.deepEqual(rules(r, `${DEMO}/notes/runbook.md`).sort(), ['bad-value', 'kind-folder-mismatch']);
  const kind = r.defects.find(d => d.path.endsWith('runbook.md') && d.rule === 'bad-value');
  for (const value of [...KIND_ORDER, 'backlog-item']) assert.ok(kind.message.includes(value), `${value} listed`);
  assert.equal(only(r, `${DEMO}/notes/ai.md`).rule, 'bad-value');
  assert.match(only(r, `${DEMO}/notes/ai.md`).message, /true/);
  assert.equal(only(r, `${DEMO}/notes/type.md`).rule, 'bad-value');
  assert.match(only(r, `${DEMO}/notes/type.md`).message, /authored/);
});

test('project is compared with the folder, case-insensitively, with one sub-project level', t => {
  const v = vault(t);
  const clean = [
    [`${DEMO}/notes/upper.md`, page({ project: 'DEMO' })],
    [`${DEMO}/notes/deep/inner/free.md`, page({})],
    [`${DEMO}/misc/free.md`, page({})],
    ['wiki/authored/acme/migrator/guides/user.md', page({ project: 'acme/migrator', kind: 'guide' })],
    ['wiki/authored/acme/migrator/overview.md', page({ project: 'Acme/Migrator', kind: 'overview' })],
    ['wiki/authored/standalone.md', page({ project: undefined, kind: undefined })],
    ['wiki/authored/standalone-with-project.md', page({ project: 'anything', kind: 'note' })],
  ];
  const wrong = [
    [`${DEMO}/notes/elsewhere.md`, page({ project: 'other' })],
    ['wiki/authored/acme/migrator/guides/dev.md', page({ project: 'acme', kind: 'guide' })],
    [`${DEMO}/misc/elsewhere.md`, page({ project: 'other' })],
    ['wiki/authored/a/b/c/notes/deep.md', page({ project: 'a/b/c' })],
  ];
  for (const [path, text] of [...clean, ...wrong]) v.put(path, text);
  const r = v.validate([...clean, ...wrong].map(([path]) => path));
  assert.deepEqual(r.defects.filter(d => clean.some(([p]) => p === d.path)), []);
  for (const [path, text] of wrong) {
    const d = only(r, path);
    assert.equal(d.rule, 'project-folder-mismatch', path);
    assert.equal(d.line, lineOf(text, /^project:/));
  }
});

test('required keys: an absent key is reported at line 1, a blank one at its own line; reviewed and the page status value are not constrained', t => {
  const v = vault(t);
  const absent = ['type', 'created', 'updated', 'status', 'ai-generated', 'project', 'kind'];
  const ledger = [];
  for (const key of absent) {
    const path = `${DEMO}/notes/no-${key}.md`;
    v.put(path, page({ [key]: undefined }));
    ledger.push(path);
  }
  v.put(`${DEMO}/notes/blank-created.md`, page({ created: '' }));
  v.put(`${DEMO}/notes/blank-sources.md`, page({ sources: '' }));
  v.put(`${DEMO}/decisions/no-decision-status.md`, page({ kind: 'decision' }));
  v.put(`${DEMO}/decisions/blank-decision-status.md`, page({ kind: 'decision', 'decision-status': '' }));
  v.put(`${DEMO}/backlog/no-backlog-status.md`, page({ kind: 'backlog-item' }));
  v.put(`${DEMO}/notes/odd-status.md`, page({ status: 'done', reviewed: undefined }));
  ledger.push(`${DEMO}/notes/blank-created.md`, `${DEMO}/notes/blank-sources.md`, `${DEMO}/decisions/no-decision-status.md`,
    `${DEMO}/decisions/blank-decision-status.md`, `${DEMO}/backlog/no-backlog-status.md`, `${DEMO}/notes/odd-status.md`);
  const r = v.validate(ledger);
  for (const key of absent) {
    const d = only(r, `${DEMO}/notes/no-${key}.md`);
    assert.deepEqual([d.rule, d.line], ['missing-key', 1], key);
    assert.ok(d.message.includes(`"${key}"`), d.message);
  }
  const blank = only(r, `${DEMO}/notes/blank-created.md`);
  assert.deepEqual([blank.rule, blank.line], ['missing-key', 3]);
  assert.match(blank.message, /empty/);
  assert.equal(only(r, `${DEMO}/notes/blank-sources.md`).rule, 'missing-key');
  assert.match(only(r, `${DEMO}/decisions/no-decision-status.md`).message, /"decision-status"/);
  const blankDecision = only(r, `${DEMO}/decisions/blank-decision-status.md`);
  assert.equal(blankDecision.rule, 'missing-key');
  assert.equal(blankDecision.line, 10);
  assert.match(only(r, `${DEMO}/backlog/no-backlog-status.md`).message, /"backlog-status"/);
  assert.deepEqual(rules(r, `${DEMO}/notes/odd-status.md`), []);
});

test('a page with no frontmatter block reports every required key; pages outside wiki/authored get link rules only', t => {
  const v = vault(t);
  v.put(`${DEMO}/notes/bare.md`, '# Bare\n\nNo frontmatter at all.\n');
  v.put('wiki/concepts/plain.md', '---\ntype: concept\nstatus: stub\nsources: []\n---\n# Plain\n\nA stub concept with a [[Nowhere Yet]] link.\n');
  const r = v.validate([`${DEMO}/notes/bare.md`, 'wiki/concepts/plain.md']);
  const keys = r.defects.filter(d => d.path.endsWith('bare.md')).map(d => d.message.match(/"([\w-]+)"/)[1]).sort();
  assert.deepEqual(keys, ['ai-generated', 'created', 'kind', 'project', 'sources', 'status', 'type', 'updated']);
  assert.deepEqual(rules(r, 'wiki/concepts/plain.md'), ['unresolved-link']);
});

test('line numbers survive CRLF line endings', t => {
  const v = vault(t);
  const text = page({ 'ai-generated': 'maybe' }, '# Crlf\n\nA [[Missing Crlf Link]] here.\n').replace(/\n/g, '\r\n');
  v.put(`${DEMO}/notes/crlf.md`, text);
  const r = v.validate([`${DEMO}/notes/crlf.md`]);
  assert.deepEqual(r.defects.map(d => [d.line, d.rule]), [[7, 'bad-value'], [13, 'unresolved-link']]);
});

test('a byte-order mark on a page or on the ledger file changes neither the lines nor the verdict', t => {
  const v = vault(t);
  const bom = String.fromCharCode(0xfeff);
  v.put(`${DEMO}/notes/bom.md`, bom + page({ 'ai-generated': 'maybe' }, '# Bom\n\nA [[Missing Bom Link]] here.\n'));
  assert.deepEqual(v.validate([`${DEMO}/notes/bom.md`]).defects.map(d => [d.line, d.rule]), [[7, 'bad-value'], [13, 'unresolved-link']]);
  v.put(`${DEMO}/notes/ok.md`, page());
  const r = v.run(['--paths-file', v.ledgerText(bom + JSON.stringify([`${DEMO}/notes/ok.md`]))]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'validate-authored: 1 pages checked, 0 defects\n');
});

// ------------------------------------------------------------- link rules --

test('citations and evidence: a missing citation target, a missing evidence route and a resolved citation', t => {
  const v = vault(t);
  v.put('raw/clippings/real.md', '---\ntitle: Real\n---\nCaptured text.\n');
  v.put(`${DEMO}/notes/cites-missing.md`, page({ sources: '["[[raw/clippings/missing.md]]"]' }));
  v.put(`${DEMO}/notes/cites-real.md`, page({ sources: '["[[raw/clippings/real.md]]"]' }, '# Cites\n\nThe supporting evidence is the captured clipping, cited in the sources list.\n'));
  v.put('wiki/concepts/unsupported.md', `---\ntype: concept\nstatus: maintained\nsources: []\n---\n# Unsupported\n\n${'A substantive claim with no evidence route at all. '.repeat(3)}\n`);
  const r = v.validate([`${DEMO}/notes/cites-missing.md`, `${DEMO}/notes/cites-real.md`, 'wiki/concepts/unsupported.md']);
  const missing = only(r, `${DEMO}/notes/cites-missing.md`);
  assert.deepEqual([missing.rule, missing.line], ['unresolved-citation', 6]);
  assert.match(missing.message, /raw\/clippings\/missing\.md/);
  assert.deepEqual(rules(r, `${DEMO}/notes/cites-real.md`), []);
  assert.deepEqual(rules(r, 'wiki/concepts/unsupported.md'), ['missing-evidence']);
  assert.equal(only(r, 'wiki/concepts/unsupported.md').line, 4);
});

test('a substantive page that omits sources gets the key defect and, because only [] is the disclosure, missing-evidence', t => {
  const v = vault(t);
  v.put(`${DEMO}/notes/omits.md`, page({ sources: undefined }, `# Omits\n\n${'A substantive paragraph that says a good deal about the project. '.repeat(3)}\n`));
  assert.deepEqual(rules(v.validate([`${DEMO}/notes/omits.md`])).sort(), ['missing-evidence', 'missing-key']);
});

test('links repeated on several lines are one defect at the first line that names the others', t => {
  const v = vault(t);
  v.put(`${DEMO}/notes/repeat.md`, page({}, '# Repeat\n\nOne [[Gone Page]].\n\nTwo [[Gone Page]].\n'));
  const r = v.validate([`${DEMO}/notes/repeat.md`]);
  const d = only(r, `${DEMO}/notes/repeat.md`);
  assert.deepEqual([d.rule, d.line], ['unresolved-link', 13]);
  assert.match(d.message, /15/);
});

test('code spans and fences are not scanned, and qualified or aliased links resolve', t => {
  const v = vault(t);
  v.put(`${DEMO}/overview.md`, page({ kind: 'overview' }, '# Overview\n\nAn overview.\n'));
  v.put(`${DEMO}/notes/masked.md`, page({}, '# Masked\n\n`[[Nope]]`\n\n```md\n[[Nope Either]]\n[[Torn\nLink]]\n```\n\n[[wiki/authored/demo/overview.md|the overview]] and [[Overview]].\n'));
  assert.deepEqual(v.validate([`${DEMO}/notes/masked.md`]).defects, []);
});

// ------------------------------------------------------- scope and safety --

test('defects on pages outside the ledger are not reported, but a ledger link made ambiguous by an outside page is', t => {
  const v = vault(t);
  v.put(`${DEMO}/roadmap.md`, page({ kind: 'roadmap' }));
  v.put('wiki/authored/other/roadmap.md', page({ project: 'other', kind: 'roadmap' }));
  v.put(`${DEMO}/notes/uses-roadmap.md`, page({}, '# Uses\n\nThe plan lives in [[roadmap]].\n'));
  v.put(`${DEMO}/notes/outside.md`, '# Outside\n\n[[Gone]] [[Torn\nLink]]\n');
  const r = v.validate([`${DEMO}/notes/uses-roadmap.md`]);
  assert.deepEqual(r.defects.map(d => [d.path, d.rule]), [[`${DEMO}/notes/uses-roadmap.md`, 'ambiguous-link']]);
  assert.match(r.defects[0].message, /other\/roadmap\.md/);
  assert.deepEqual(v.validate([`${DEMO}/roadmap.md`]).defects, []);
  assert.equal(v.validate([`${DEMO}/notes/outside.md`]).defects.length > 0, true, 'the same page is reported once it is in the ledger');
});

test('a clean ledger prints one count line, including filled pages made from each authored template', t => {
  const v = vault(t);
  const template = name => readFileSync(join(ROOT, 'templates', '_templates', `${name}.md`), 'utf8');
  const fill = (text, extra = '') => text
    .replace(/^created:[ \t]*(?=\r?$)/m, 'created: 2026-10-24')
    .replace(/^updated:[ \t]*(?=\r?$)/m, 'updated: 2026-10-24')
    .replace(/^ai-generated:[ \t]*(?=\r?$)/m, `ai-generated: true${extra}`)
    .replace(/^project:[ \t]*(?=\r?$)/m, 'project: demo')
    .replace(/\{\{title\}\}/g, 'Filled page');
  const note = fill(template('authored-note'), '\nproject: demo\nkind: note');
  const decision = fill(template('authored-decision'));
  const backlog = fill(template('authored-backlog-item'));
  v.put(`${DEMO}/notes/filled-note.md`, note);
  v.put(`${DEMO}/decisions/filled-adr.md`, decision);
  v.put(`${DEMO}/backlog/filled-item.md`, backlog);
  const r = v.runLedger([`${DEMO}/notes/filled-note.md`, `${DEMO}/decisions/filled-adr.md`, `${DEMO}/backlog/filled-item.md`]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stdout, 'validate-authored: 3 pages checked, 0 defects\n');
});

test('an unfilled template fails: a blank value counts as missing', t => {
  const v = vault(t);
  const template = name => readFileSync(join(ROOT, 'templates', '_templates', `${name}.md`), 'utf8');
  v.put(`${DEMO}/notes/unfilled-note.md`, template('authored-note'));
  v.put(`${DEMO}/decisions/unfilled-adr.md`, template('authored-decision'));
  v.put(`${DEMO}/backlog/unfilled-item.md`, template('authored-backlog-item'));
  const r = v.validate([`${DEMO}/notes/unfilled-note.md`, `${DEMO}/decisions/unfilled-adr.md`, `${DEMO}/backlog/unfilled-item.md`]);
  assert.ok(r.defects.every(d => d.rule === 'missing-key'), JSON.stringify(r.defects));
  const keys = path => r.defects.filter(d => d.path === path).map(d => d.message.match(/"([\w-]+)"/)[1]).sort();
  assert.deepEqual(keys(`${DEMO}/notes/unfilled-note.md`), ['ai-generated', 'created', 'kind', 'project', 'updated']);
  assert.deepEqual(keys(`${DEMO}/decisions/unfilled-adr.md`), ['ai-generated', 'created', 'project', 'updated']);
  assert.deepEqual(keys(`${DEMO}/backlog/unfilled-item.md`), ['ai-generated', 'created', 'project', 'updated']);
});

test('the vault is byte-for-byte unchanged after a run: no write, no timestamp change, no new file or directory', t => {
  const v = exampleFixture(t);
  v.put('wiki/authored/demo/.hidden/keep.md', 'hidden');
  const before = snapshot(v.root);
  const dirty = v.runLedger(v.ledgerPaths);
  const json = v.runLedger(v.ledgerPaths, ['--json']);
  const api = v.validate(v.ledgerPaths);
  const clean = v.runLedger([`${DEMO}/overview.md`]);
  assert.deepEqual([dirty.status, json.status, clean.status], [1, 1, 0]);
  assert.ok(api.defects.length > 0);
  const after = snapshot(v.root);
  assert.deepEqual([...after.keys()], [...before.keys()], 'same files and directories');
  assert.deepEqual([...after], [...before], 'same bytes and modification times');
  assert.ok(!existsSync(join(v.root, '.wiki-master')));
});

test('the validator source has no write, delete, rename or directory-creating call', () => {
  const forbidden = /\b(?:writeFile|writeFileSync|appendFile|appendFileSync|mkdir|mkdirSync|mkdtemp|mkdtempSync|rm|rmSync|rmdir|unlink|unlinkSync|rename|renameSync|copyFile|copyFileSync|createWriteStream|utimes|utimesSync|chmod|openSync|truncate)\(/;
  for (const file of ['scripts/validate-authored.mjs', 'scripts/lib/authored-contract.mjs']) {
    assert.doesNotMatch(readFileSync(join(ROOT, file), 'utf8'), forbidden, file);
  }
});

// ------------------------------------------------------------ ledger shape --

test('log, raw, templates, root index, non-Markdown and dot-prefixed entries are skipped and counted; an absent .md is missing-file', t => {
  const v = vault(t);
  const broken = '# Broken\n\n[[Torn\nLink]] [[Gone Page]]\n';
  v.put('log/2026-10-24-op.md', broken);
  v.put('raw/clippings/c.md', broken);
  v.put('_templates/t.md', broken);
  v.put('index.md', broken);
  v.put('wiki/authored/demo/image.png', 'not markdown');
  v.put('wiki/authored/.hidden/secret.md', broken);
  v.put(`${DEMO}/notes/good.md`, page());
  const ledger = ['log/2026-10-24-op.md', 'raw/clippings/c.md', '_templates/t.md', 'index.md', 'wiki/authored/demo/image.png',
    'wiki/authored/.hidden/secret.md', 'wiki/authored/demo/gone.png', `${DEMO}/notes/good.md`, `${DEMO}/notes/gone.md`];
  const r = v.validate(ledger);
  assert.equal(r.skipped, 7);
  assert.equal(r.checked, 2);
  assert.equal(r.checked + r.skipped, ledger.length);
  assert.deepEqual(r.defects.map(d => [d.path, d.line, d.rule]), [[`${DEMO}/notes/gone.md`, 1, 'missing-file']]);
  const cli = v.runLedger(ledger);
  assert.equal(cli.status, 1);
  assert.match(cli.stdout, /validate-authored: 2 pages checked, 1 defects, 7 skipped\n$/);
});

test('a ledger path whose letter case differs from the file is missing-file, never a silently unchecked page', t => {
  const v = vault(t);
  v.put(`${DEMO}/notes/Case.md`, page({ 'ai-generated': 'maybe' }));
  for (const wrong of [`${DEMO}/notes/case.md`, `Wiki/authored/demo/notes/Case.md`]) {
    const r = v.validate([wrong]);
    assert.deepEqual(r.defects.map(d => d.rule), ['missing-file'], wrong);
  }
  assert.deepEqual(v.validate([`${DEMO}/notes/Case.md`]).defects.map(d => d.rule), ['bad-value']);
});

test('duplicate ledger entries are checked once', t => {
  const v = vault(t);
  v.put(`${DEMO}/notes/a.md`, page());
  const r = v.validate([`${DEMO}/notes/a.md`, `${DEMO}/notes/a.md`]);
  assert.equal(r.checked, 1);
});

test('--json emits the same defects as data, sorted by path then line', t => {
  const v = exampleFixture(t);
  const cli = v.runLedger(v.ledgerPaths, ['--json']);
  assert.equal(cli.status, 1);
  const data = JSON.parse(cli.stdout);
  assert.deepEqual(data, v.validate(v.ledgerPaths));
  assert.equal(data.version, 1);
  assert.deepEqual([data.checked, data.skipped, data.defects.length], [6, 0, 6]);
  for (const d of data.defects) assert.deepEqual(Object.keys(d).sort(), ['line', 'message', 'path', 'rule']);
  const sorted = [...data.defects].sort((a, b) => compare(a.path, b.path) || a.line - b.line);
  assert.deepEqual(data.defects.map(d => [d.path, d.line]), sorted.map(d => [d.path, d.line]));
  const clean = v.runLedger([`${DEMO}/overview.md`], ['--json']);
  assert.equal(clean.status, 0);
  assert.deepEqual(JSON.parse(clean.stdout), { version: 1, checked: 1, skipped: 0, defects: [] });
});

test('bad input exits 2 with a message on stderr and nothing on stdout', t => {
  const v = vault(t);
  v.put(`${DEMO}/notes/a.md`, page());
  const good = v.ledger([`${DEMO}/notes/a.md`]);
  const before = snapshot(v.root);
  const cases = [
    ['no flag', [], /--paths-file/],
    ['flag without a value', ['--paths-file'], /--paths-file/],
    ['unknown flag', ['--paths-file', good, '--bogus'], /--bogus|unknown|Unknown/i],
    ['unreadable file', ['--paths-file', join(v.scratch, 'absent.json')], /cannot read/],
    ['a directory', ['--paths-file', v.scratch], /cannot read/],
    ['invalid JSON', ['--paths-file', v.ledgerText('{not json')], /JSON/],
    ['empty array', ['--paths-file', v.ledgerText('[]')], /non-empty JSON array/],
    ['an object', ['--paths-file', v.ledgerText('{"a":1}')], /non-empty JSON array/],
    ['a string', ['--paths-file', v.ledgerText('"wiki/a.md"')], /non-empty JSON array/],
    ['a non-string entry', ['--paths-file', v.ledgerText('[1]')], /invalid ledger path/],
    ['an empty entry', ['--paths-file', v.ledgerText('[""]')], /invalid ledger path/],
    ['a .. segment', ['--paths-file', v.ledger(['wiki/../x.md'])], /invalid ledger path/],
    ['a . segment', ['--paths-file', v.ledger(['wiki/./x.md'])], /invalid ledger path/],
    ['an empty segment', ['--paths-file', v.ledger(['wiki//x.md'])], /invalid ledger path/],
    ['a leading slash', ['--paths-file', v.ledger(['/wiki/x.md'])], /invalid ledger path/],
    ['a backslash', ['--paths-file', v.ledger(['wiki\\x.md'])], /invalid ledger path/],
    ['a drive prefix', ['--paths-file', v.ledger(['C:/x.md'])], /invalid ledger path/],
    ['a NUL', ['--paths-file', v.ledger(['wiki/a\u0000.md'])], /invalid ledger path/],
  ];
  for (const [label, args, hint] of cases) {
    const r = v.run(args);
    assert.equal(r.status, 2, `${label}: exit code (stdout ${JSON.stringify(r.stdout)})`);
    assert.equal(r.stdout, '', `${label}: stdout`);
    assert.match(r.stderr, /^validate-authored: /, label);
    assert.match(r.stderr, hint, label);
  }
  const missingVault = spawnSync(process.execPath, [SCRIPT, '--paths-file', good], {
    cwd: v.scratch, encoding: 'utf8', env: { ...process.env, WIKI_MASTER_VAULT: join(v.scratch, 'no-such-vault') },
  });
  assert.equal(missingVault.status, 2);
  assert.match(missingVault.stderr, /vault/i);
  assert.deepEqual([...snapshot(v.root)], [...before]);
});

test('validateAuthored rejects an unsafe ledger the same way the command does', t => {
  const v = vault(t);
  for (const bad of [[], 'x', ['..'], ['a\\b.md'], ['C:/a.md'], ['a/\u0000.md'], [7]]) {
    assert.throws(() => v.validate(bad), /ledger|JSON array/i);
  }
});

// -------------------------------------------------------------- the contract --

// The code spans in a reference that LIST a vocabulary: they start with `key:` and hold more than
// one value, separated by `|`. A span with one value is ordinary prose about that value and is not
// compared. Each span carries the line it begins on and may wrap across lines. `drift` holds the
// lists whose words differ from the vocabulary (a list cut down to one value is not detected).
function vocabularyDrift(text, key, expected) {
  const words = s => s.split(/[\s|,#]+/).filter(Boolean).sort();
  const spans = [...text.matchAll(new RegExp('`' + key + ':\\s*([^`|]*\\|[^`]*)`', 'g'))]
    .map(m => ({ line: text.slice(0, m.index).split('\n').length, span: m[0], words: words(m[1]) }));
  const want = JSON.stringify([...expected].sort());
  return { found: spans.length, drift: spans.filter(s => JSON.stringify(s.words) !== want) };
}

const VOCABULARY = ['dropped', 'blocked', 'in-progress', 'planned', 'shipped'];

test('prose that names one status in a code span is not a vocabulary list', () => {
  const text = ['The list is `backlog-status: planned | in-progress | shipped | blocked | dropped`.', '', 'A shipped item keeps `backlog-status: shipped` until it is dropped.', ''].join('\n');
  const r = vocabularyDrift(text, 'backlog-status', VOCABULARY);
  assert.equal(r.found, 1, 'only the list counts');
  assert.deepEqual(r.drift, []);
});

test('a vocabulary list that drops a value fails, and names the span and its line', () => {
  const text = ['Intro.', '', 'Set `backlog-status: planned | in-progress |', 'shipped | blocked` on an item.', ''].join('\n');
  const r = vocabularyDrift(text, 'backlog-status', VOCABULARY);
  assert.equal(r.drift.length, 1);
  assert.equal(r.drift[0].line, 3);
  assert.match(r.drift[0].span, /planned \| in-progress/);
});

test('a reference with no vocabulary list at all is reported as none found', () => {
  assert.equal(vocabularyDrift('No lists here, only `backlog-status: planned` once.', 'backlog-status', VOCABULARY).found, 0);
});

test('the vocabulary the validator uses is the vocabulary written in the schema, the templates and the authoring reference', () => {
  const read = file => readFileSync(join(ROOT, file), 'utf8');
  const words = text => text.split(/[\s|,#]+/).filter(Boolean).sort();
  const one = (text, pattern, label) => { const m = text.match(pattern); assert.ok(m, `${label}: not found`); return words(m[1]); };
  const every = (text, pattern, label) => { const all = [...text.matchAll(pattern)]; assert.ok(all.length, `${label}: not found`); return all.map(m => words(m[1])); };
  const kinds = [...contract.KINDS].sort();
  const decisions = [...contract.DECISION_STATUSES].sort();
  const backlog = [...BACKLOG_STATUS_ORDER].sort();

  assert.strictEqual(contract.BACKLOG_STATUSES, BACKLOG_STATUS_ORDER, 'backlog statuses are imported, not copied');
  assert.deepEqual(kinds, [...KIND_ORDER, 'backlog-item'].sort());

  const schema = read('templates/vault-schema.md');
  assert.deepEqual(one(schema, /`kind`\s*\(`([^`]+)`\)/, 'schema kind'), kinds);
  assert.deepEqual(one(schema, /`decision-status`\s*\(`([^`]+)`\)/, 'schema decision-status'), decisions);
  assert.deepEqual(one(schema, /`backlog-status`\s*\(`([^`]+)`\)/, 'schema backlog-status'), backlog);

  const authoring = read('skills/wiki-maintainer/references/authoring.md');
  assert.deepEqual(one(authoring, /`kind:`[^`]*?one of\s+`([^`]+)`/, 'authoring kind'), kinds);
  for (const [key, expected] of [['decision-status', decisions], ['backlog-status', backlog]]) {
    const r = vocabularyDrift(authoring, key, expected);
    assert.ok(r.found, `authoring ${key}: no vocabulary list found`);
    assert.deepEqual(r.drift.map(d => `line ${d.line}: ${d.span}`), [], `authoring ${key}: a list differs from the vocabulary`);
  }

  assert.deepEqual(one(read('templates/_templates/authored-decision.md'), /<!--\s*([a-z-]+(?:\s*\|\s*[a-z-]+)+)/, 'decision template'), decisions);
  assert.deepEqual(one(read('templates/_templates/authored-backlog-item.md'), /\(([a-z-]+(?:\s*\|\s*[a-z-]+){2,})\)/, 'backlog template'), backlog);
  assert.deepEqual(one(read('templates/_templates/authored-note.md'), /kind: <one of:([^>]+)>/, 'note template'), kinds.filter(k => k !== 'backlog-item'));
});

test('the folder-to-kind table the validator uses is the placement table in the authoring reference', () => {
  const rows = readFileSync(join(ROOT, 'skills/wiki-maintainer/references/authoring.md'), 'utf8').split(/\r?\n/).filter(line => line.trimStart().startsWith('|'));
  const table = rows.join('\n');
  const folders = [...new Set([...table.matchAll(/`<project>\/([\w-]+)\/[^`]*`/g)].map(m => m[1]))].sort();
  const files = [...new Set([...table.matchAll(/`<project>\/([\w-]+\.md)`/g)].map(m => m[1]))].sort();
  assert.deepEqual(Object.keys(contract.FOLDER_KINDS).sort(), folders);
  assert.deepEqual(Object.keys(contract.FILE_KINDS).sort(), files);
  for (const kind of [...Object.values(contract.FOLDER_KINDS), ...Object.values(contract.FILE_KINDS)]) assert.ok(contract.KINDS.includes(kind), kind);
});

test('placement reads the project folder, the kind folder and the exact-file kinds from a path', () => {
  assert.deepEqual(contract.placement('wiki/authored/demo/notes/x.md'), { project: 'demo', strict: true, expectedKind: 'note', folder: 'notes' });
  assert.deepEqual(contract.placement('wiki/authored/acme/migrator/guides/user.md'), { project: 'acme/migrator', strict: true, expectedKind: 'guide', folder: 'guides' });
  assert.deepEqual(contract.placement('wiki/authored/demo/cyber/notes/a/b/c.md'), { project: 'demo/cyber', strict: true, expectedKind: 'note', folder: 'notes' });
  assert.deepEqual(contract.placement('wiki/authored/demo/roadmap.md'), { project: 'demo', strict: false, expectedKind: 'roadmap', folder: null });
  assert.deepEqual(contract.placement('wiki/authored/demo/misc/x.md'), { project: 'demo/misc', strict: false, expectedKind: null, folder: null });
  assert.deepEqual(contract.placement('wiki/authored/standalone.md'), { project: '', strict: false, expectedKind: null, folder: null });
  assert.deepEqual(contract.placement('wiki/authored/overview.md'), { project: '', strict: false, expectedKind: null, folder: null });
  assert.equal(contract.placement('wiki/concepts/x.md'), null);
});

// ------------------------------------------------------------- depends-on --

const BL = `${DEMO}/backlog`;
const todo = (status, dependsOn, fields = {}) => page({ kind: 'backlog-item', 'backlog-status': status, ...(dependsOn === undefined ? {} : { 'depends-on': dependsOn }), ...fields }, '# An item\n\nWork.\n');

test('a backlog item whose prerequisites exist in its project has no dependency defect, in the ledger or not', t => {
  const v = vault(t);
  v.put(`${BL}/base.md`, todo('shipped'));
  v.put(`${BL}/next.md`, todo('planned', '["[[base]]", "[[wiki/authored/demo/backlog/base.md|base again]]"]'));
  assert.deepEqual(v.validate([`${BL}/next.md`]).defects, []);
});

test('depends-on may be a block sequence', t => {
  const v = vault(t);
  v.put(`${BL}/base.md`, todo('shipped'));
  v.put(`${BL}/next.md`, todo('planned', '\n  - "[[base]]"'));
  assert.deepEqual(v.validate([`${BL}/next.md`]).defects, []);
});

test('a prerequisite that matches no item is a dependency-dangling defect on the depends-on line', t => {
  const v = vault(t);
  const text = v.put(`${BL}/next.md`, todo('planned', '["[[nowhere]]"]'));
  const d = only(v.validate([`${BL}/next.md`]), `${BL}/next.md`);
  assert.equal(d.rule, 'dependency-dangling');
  assert.equal(d.line, lineOf(text, /^depends-on:/));
  assert.match(d.message, /nowhere/);
});

test('a note in the backlog folder is not an item, so depending on it is dangling', t => {
  const v = vault(t);
  v.put(`${BL}/just-a-note.md`, page({ kind: 'note' }));
  v.put(`${BL}/next.md`, todo('planned', '["[[just-a-note]]"]'));
  assert.deepEqual(rules(v.validate([`${BL}/next.md`])), ['dependency-dangling']);
});

test('a prerequisite in another project is dependency-cross-project, and the message says why', t => {
  const v = vault(t);
  v.put('wiki/authored/other/backlog/base.md', todo('shipped', undefined, { project: 'other' }));
  v.put(`${BL}/next.md`, todo('planned', '["[[wiki/authored/other/backlog/base.md|base]]"]'));
  const d = only(v.validate([`${BL}/next.md`]), `${BL}/next.md`);
  assert.equal(d.rule, 'dependency-cross-project');
  assert.match(d.message, /same project/);
});

test('an item that depends on itself is dependency-self', t => {
  const v = vault(t);
  v.put(`${BL}/loop.md`, todo('planned', '["[[loop]]"]'));
  assert.deepEqual(rules(v.validate([`${BL}/loop.md`])), ['dependency-self']);
});

test('a cycle is reported on each ledger page in it, naming the whole loop, and not on pages outside the ledger', t => {
  const v = vault(t);
  v.put(`${BL}/a.md`, todo('planned', '["[[b]]"]'));
  v.put(`${BL}/b.md`, todo('planned', '["[[c]]"]'));
  v.put(`${BL}/c.md`, todo('planned', '["[[a]]"]'));
  const result = v.validate([`${BL}/a.md`]);
  assert.deepEqual(rules(result), ['dependency-cycle']);
  assert.equal(result.defects[0].path, `${BL}/a.md`);
  assert.match(result.defects[0].message, /a -> b -> c -> a/);
});

test('an entry that is not a wikilink is dependency-malformed instead of ignored', t => {
  const v = vault(t);
  v.put(`${BL}/next.md`, todo('planned', '["plain-text"]'));
  const d = only(v.validate([`${BL}/next.md`]), `${BL}/next.md`);
  assert.equal(d.rule, 'dependency-malformed');
  assert.match(d.message, /plain-text/);
});

test('depends-on on a page that is not a backlog item is dependency-misplaced', t => {
  const v = vault(t);
  v.put(`${DEMO}/notes/n.md`, page({ 'depends-on': '["[[x]]"]' }));
  assert.deepEqual(rules(v.validate([`${DEMO}/notes/n.md`])), ['dependency-misplaced']);
});

test('an item without depends-on, and an empty depends-on, add no defect', t => {
  const v = vault(t);
  v.put(`${BL}/plain.md`, todo('planned'));
  v.put(`${BL}/empty.md`, todo('planned', '[]'));
  assert.deepEqual(v.validate([`${BL}/plain.md`, `${BL}/empty.md`]).defects, []);
});

test('the command prints a dependency defect and exits 1', t => {
  const v = vault(t);
  v.put(`${BL}/next.md`, todo('planned', '["[[nowhere]]"]'));
  const r = v.runLedger([`${BL}/next.md`]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /next\.md:\d+ dependency-dangling /);
});

test('the depends-on key and its five defect rules are written where authors read them', () => {
  const read = file => readFileSync(join(ROOT, file), 'utf8');
  const authoring = read('skills/wiki-maintainer/references/authoring.md');
  for (const [label, text] of [['schema', read('templates/vault-schema.md')], ['authoring reference', authoring], ['backlog template', read('templates/_templates/authored-backlog-item.md')]]) {
    assert.ok(text.includes('depends-on'), `${label} names depends-on`);
  }
  for (const rule of ['dependency-dangling', 'dependency-cross-project', 'dependency-self', 'dependency-cycle', 'dependency-malformed', 'dependency-misplaced']) {
    assert.ok(authoring.includes(`\`${rule}\``), `authoring reference lists ${rule}`);
  }
  assert.ok(authoring.includes('Ready to start'), 'authoring reference names the generated section');
});
