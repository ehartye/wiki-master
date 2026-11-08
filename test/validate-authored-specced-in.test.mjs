import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateAuthored } from '../scripts/validate-authored.mjs';

// The optional specced-in key: an item names the spec (another backlog item of its project)
// that covers it. The validator checks it as it checks depends-on, with six specced-in-* rules
// reported on the key's line. A page that only carries the older prose line is not read at all.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'scripts', 'validate-authored.mjs');
const BL = 'wiki/authored/demo/backlog';

function page(fields = {}, body = '# An item\n\nWork.\n') {
  const merged = {
    type: 'authored', created: '2026-11-07', updated: '2026-11-07', status: 'draft', sources: '[]',
    'ai-generated': 'true', project: 'demo', kind: 'backlog-item', 'backlog-status': 'planned', ...fields,
  };
  const lines = Object.entries(merged).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join('\n')}\n---\n${body}`;
}
const item = (speccedIn, fields = {}, body) => page({ ...(speccedIn === undefined ? {} : { 'specced-in': speccedIn }), ...fields }, body);

const lineOf = (text, pattern) => {
  const i = text.split('\n').findIndex(line => pattern.test(line));
  assert.ok(i >= 0, `no line matches ${pattern}`);
  return i + 1;
};

function vault(t) {
  const base = realpathSync(tmpdir());
  const root = mkdtempSync(join(base, 'validate-specced-in-'));
  const scratch = mkdtempSync(join(base, 'validate-specced-in-ledger-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true }); });
  let counter = 0;
  const put = (path, text) => { const file = join(root, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); return text; };
  const runLedger = paths => {
    const ledger = join(scratch, `ledger-${counter++}.json`);
    writeFileSync(ledger, JSON.stringify(paths));
    return spawnSync(process.execPath, [SCRIPT, '--paths-file', ledger], { cwd: scratch, encoding: 'utf8', env: { ...process.env, WIKI_MASTER_VAULT: root } });
  };
  return { root, put, runLedger, validate: paths => validateAuthored(root, paths) };
}

const rules = result => result.defects.map(d => d.rule);
const only = (result, path) => {
  const found = result.defects.filter(d => d.path === path);
  assert.equal(found.length, 1, `${path}: expected one defect, got ${JSON.stringify(found)}`);
  return found[0];
};

test('an item whose spec is a backlog item of its project has no defect, whether the spec is in the ledger or not', t => {
  const v = vault(t);
  v.put(`${BL}/alpha-spec.md`, item(undefined, { 'backlog-status': 'in-progress' }));
  v.put(`${BL}/item-a.md`, item('["[[alpha-spec|WP1]]", "[[wiki/authored/demo/backlog/alpha-spec.md|WP2]]"]'));
  v.put(`${BL}/item-b.md`, item('\n  - "[[alpha-spec|WP3]]"'));
  assert.deepEqual(v.validate([`${BL}/item-a.md`, `${BL}/item-b.md`]).defects, []);
  assert.deepEqual(v.validate([`${BL}/item-a.md`, `${BL}/item-b.md`, `${BL}/alpha-spec.md`]).defects, []);
});

test('each rule is reported on the specced-in line and names the offending entry', t => {
  const v = vault(t);
  v.put('wiki/authored/other/backlog/far-spec.md', item(undefined, { project: 'other' }));
  const cases = [
    ['dangling', '["[[missing-spec|WP1]]"]', 'specced-in-dangling', /^\[\[missing-spec\]\] matches no backlog item in this project$/],
    ['cross', '["[[wiki/authored/other/backlog/far-spec.md|WP1]]"]', 'specced-in-cross-project', /^\[\[wiki\/authored\/other\/backlog\/far-spec\.md\]\] is in another project; a spec must be an item of the same project$/],
    ['selfish', '["[[selfish|WP1]]"]', 'specced-in-self', /^an item cannot be specced in itself$/],
    ['mistyped', '["alpha-spec"]', 'specced-in-malformed', /^specced-in entry "alpha-spec" is not a \[\[wikilink\]\]; write quoted wikilinks, e\.g\. specced-in: \["\[\[spec\|WP1\]\]"\]$/],
  ];
  for (const [slug, value, rule, message] of cases) {
    const text = v.put(`${BL}/${slug}.md`, item(value));
    const d = only(v.validate([`${BL}/${slug}.md`]), `${BL}/${slug}.md`);
    assert.equal(d.rule, rule);
    assert.equal(d.line, lineOf(text, /^specced-in:/));
    assert.match(d.message, message);
  }
  const note = v.put('wiki/authored/demo/notes/n.md', page({ kind: 'note', 'backlog-status': undefined, 'specced-in': '["[[alpha-spec]]"]' }));
  const d = only(v.validate(['wiki/authored/demo/notes/n.md']), 'wiki/authored/demo/notes/n.md');
  assert.equal(d.rule, 'specced-in-misplaced');
  assert.equal(d.line, lineOf(note, /^specced-in:/));
  assert.equal(d.message, 'specced-in is read only on backlog items (kind: backlog-item), so these entries are ignored');
});

test('a loop is reported on every ledger page in it, naming the whole loop, and not on pages outside the ledger', t => {
  const v = vault(t);
  v.put(`${BL}/a.md`, item('["[[b]]"]'));
  v.put(`${BL}/b.md`, item('["[[c|WP1]]"]'));
  v.put(`${BL}/c.md`, item('["[[a]]"]'));
  v.put(`${BL}/chained.md`, item('["[[a]]"]'));
  const result = v.validate([`${BL}/a.md`, `${BL}/b.md`, `${BL}/chained.md`]);
  assert.deepEqual(result.defects.map(d => [d.path, d.rule, d.message]), [
    [`${BL}/a.md`, 'specced-in-cycle', 'specced-in cycle: a -> b -> c -> a'],
    [`${BL}/b.md`, 'specced-in-cycle', 'specced-in cycle: a -> b -> c -> a'],
  ]);
});

test('a page with only the prose "Specced in" line, an item without the key and an empty key add no defect', t => {
  const v = vault(t);
  v.put(`${BL}/prose.md`, item(undefined, {}, '# An item\n\nSpecced in [[x]] (WP1).\n'));
  v.put(`${BL}/x.md`, item());
  v.put(`${BL}/empty.md`, item('[]'));
  assert.deepEqual(rules(v.validate([`${BL}/prose.md`, `${BL}/x.md`, `${BL}/empty.md`])), []);
});

test('the command exits 1 on a dangling spec and 0 once the spec exists', t => {
  const v = vault(t);
  v.put(`${BL}/item-a.md`, item('["[[missing-spec|WP1]]"]'));
  const red = v.runLedger([`${BL}/item-a.md`]);
  assert.equal(red.status, 1, red.stderr);
  assert.match(red.stdout, /item-a\.md:\d+ specced-in-dangling \[\[missing-spec\]\] matches no backlog item in this project/);
  v.put(`${BL}/missing-spec.md`, item());
  const green = v.runLedger([`${BL}/item-a.md`]);
  assert.equal(green.status, 0, green.stdout + green.stderr);
});

test('the specced-in key and its six rules are written where authors read them', () => {
  const read = file => readFileSync(join(ROOT, file), 'utf8');
  const authoring = read('skills/wiki-project/references/backlog.md');
  const validation = read('skills/wiki-setup/references/validation.md');
  for (const [label, text] of [['schema', read('templates/vault-schema.md')], ['authoring reference', authoring], ['backlog template', read('templates/_templates/authored-backlog-item.md')]]) {
    assert.ok(text.includes('specced-in'), `${label} names specced-in`);
  }
  for (const rule of ['specced-in-dangling', 'specced-in-cross-project', 'specced-in-self', 'specced-in-cycle', 'specced-in-malformed', 'specced-in-misplaced']) {
    assert.ok(validation.includes(`\`${rule}\``), `setup validation reference lists ${rule}`);
  }
  assert.ok(authoring.includes('Specced work'), 'authoring reference names the generated section');
  assert.ok(authoring.includes('--specced-in'), 'authoring reference names the list filter');
  assert.match(authoring.replace(/\s+/g, ' '), /same spec twice[^.]*labels[^.]*joined with [`"]?, /, 'authoring reference says how two labels for one spec are shown');
});
