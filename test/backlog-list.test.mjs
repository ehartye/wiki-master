import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, statSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { listBacklog } from '../scripts/backlog-list.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'scripts', 'backlog-list.mjs');

// ---------------------------------------------------------------- fixtures --

function vault(t) {
  const root = mkdtempSync(join(tmpdir(), 'backlog-list-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, text) => { const file = join(root, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };
  // One backlog item. `status` is the PAGE status (draft or maintained), a different field from the
  // lifecycle `backlog` value, which is what the command lists by.
  const item = (project, slug, backlog, { status = 'draft', dependsOn, speccedIn, title = slug, kind = 'backlog-item' } = {}) => put(
    `wiki/authored/${project}/backlog/${slug}.md`,
    `---\ntype: authored\ncreated: 2026-10-26\nupdated: 2026-10-26\nstatus: ${status}\nsources: []\nai-generated: true\nproject: ${project}\nkind: ${kind}\n${backlog === undefined ? '' : `backlog-status: ${backlog}\n`}${dependsOn ? `depends-on: ${dependsOn}\n` : ''}${speccedIn ? `specced-in: ${speccedIn}\n` : ''}---\n# ${title}\n\nBody.\n`);
  const run = args => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, WIKI_MASTER_VAULT: root } });
  return { root, put, item, run, list: opts => listBacklog(root, opts) };
}
const paths = rows => rows.map(r => r.path.replace(/^wiki\/authored\//, ''));

function snapshot(root) {
  const out = new Map();
  (function walk(dir, rel) {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name), r = rel ? `${rel}/${name}` : name, st = statSync(abs);
      if (st.isDirectory()) walk(abs, r);
      else out.set(r, `${st.mtimeMs}:${createHash('sha256').update(readFileSync(abs)).digest('hex')}`);
    }
  })(root, '');
  return out;
}

// ------------------------------------------------------------------ listing --

test('listing by lifecycle status finds the planned item whatever its page status says, and none of the shipped', t => {
  const v = vault(t);
  v.item('demo', 'open-work', 'planned', { status: 'draft' });
  v.item('demo', 'kept-work', 'planned', { status: 'maintained' });
  v.item('demo', 'done-work', 'shipped', { status: 'maintained' });
  assert.deepEqual(paths(v.list({ backlogStatus: ['planned'] })), ['demo/backlog/kept-work.md', 'demo/backlog/open-work.md']);
});

test('a row carries project, lifecycle status, path and the first heading as its title', t => {
  const v = vault(t);
  v.item('demo', 'a-slug', 'blocked', { title: 'A readable title' });
  assert.deepEqual(v.list({}), [{
    project: 'demo', backlogStatus: 'blocked', path: 'wiki/authored/demo/backlog/a-slug.md', title: 'A readable title',
    dependsOn: [], unmet: [], startable: false, speccedIn: [],
  }]);
});

test('the title falls back to the file name when the page has no heading', t => {
  const v = vault(t);
  v.put('wiki/authored/demo/backlog/no-heading.md', '---\ntype: authored\nproject: demo\nkind: backlog-item\nbacklog-status: planned\n---\nJust text.\n');
  assert.equal(v.list({})[0].title, 'no-heading');
});

test('several statuses and one project can be asked for together, and the project name ignores case', t => {
  const v = vault(t);
  v.item('demo', 'a', 'planned'); v.item('demo', 'b', 'in-progress'); v.item('demo', 'c', 'shipped');
  v.item('other', 'd', 'planned');
  assert.deepEqual(paths(v.list({ project: 'DEMO', backlogStatus: ['planned', 'in-progress'] })), ['demo/backlog/b.md', 'demo/backlog/a.md']);
});

test('rows are ordered by project, then lifecycle order, then path', t => {
  const v = vault(t);
  v.item('zeta', 'x', 'planned'); v.item('alpha', 'z', 'shipped'); v.item('alpha', 'y', 'in-progress'); v.item('alpha', 'a', 'in-progress');
  assert.deepEqual(paths(v.list({})), ['alpha/backlog/a.md', 'alpha/backlog/y.md', 'alpha/backlog/z.md', 'zeta/backlog/x.md']);
});

test('a page that is not a backlog item is never listed, whatever it says about backlog-status', t => {
  const v = vault(t);
  v.item('demo', 'real', 'planned');
  v.item('demo', 'fake', 'planned', { kind: 'note' });
  assert.deepEqual(paths(v.list({})), ['demo/backlog/real.md']);
});

test('the pseudo-status unrecognized lists items outside the vocabulary and items with none', t => {
  const v = vault(t);
  v.item('demo', 'ok', 'planned'); v.item('demo', 'idea', 'proposed'); v.item('demo', 'bare', undefined);
  assert.deepEqual(paths(v.list({ backlogStatus: ['unrecognized'] })), ['demo/backlog/bare.md', 'demo/backlog/idea.md']);
});

// ------------------------------------------------------------- dependencies --

test('startable lists planned items with no unmet prerequisite, declared or not, and no others', t => {
  const v = vault(t);
  v.item('demo', 'base', 'shipped');
  v.item('demo', 'plain', 'planned');
  v.item('demo', 'unlocked', 'planned', { dependsOn: '["[[base]]"]' });
  v.item('demo', 'waiting', 'planned', { dependsOn: '["[[plain]]"]' });
  v.item('demo', 'busy', 'in-progress');
  v.item('demo', 'held', 'blocked');
  assert.deepEqual(paths(v.list({ startable: true })), ['demo/backlog/plain.md', 'demo/backlog/unlocked.md']);
});

test('a row names what an item waits on, and flags itself startable when nothing is unmet', t => {
  const v = vault(t);
  v.item('demo', 'plain', 'planned');
  v.item('demo', 'waiting', 'planned', { dependsOn: '["[[plain]]", "[[nowhere]]"]' });
  const byName = Object.fromEntries(v.list({}).map(r => [r.path.split('/').pop(), r]));
  assert.deepEqual(byName['waiting.md'].dependsOn, ['plain', 'nowhere']);
  assert.deepEqual(byName['waiting.md'].unmet, ['wiki/authored/demo/backlog/plain.md', 'nowhere']);
  assert.equal(byName['waiting.md'].startable, false);
  assert.equal(byName['plain.md'].startable, true);
});

// --------------------------------------------------------------- specced-in --

function speccedFixture(v) {
  v.item('demo', 'alpha-spec', 'in-progress');
  v.item('demo', 'item-a', 'shipped', { speccedIn: '["[[alpha-spec|WP1]]"]' });
  v.item('demo', 'item-b', 'planned', { speccedIn: '["[[alpha-spec|WP2]]"]' });
}
const SPEC = 'wiki/authored/demo/backlog/alpha-spec.md';

test('a row names the specs that cover it by resolved path, or by the declared target when it does not resolve', t => {
  const v = vault(t);
  speccedFixture(v);
  v.item('demo', 'odd', 'planned', { speccedIn: '["[[nowhere|WP1]]", "[[alpha-spec]]", "plain"]' });
  const byName = Object.fromEntries(v.list({}).map(r => [r.path.split('/').pop(), r]));
  assert.deepEqual(byName['item-a.md'].speccedIn, [SPEC]);
  assert.deepEqual(byName['odd.md'].speccedIn, ['nowhere', SPEC]);
  assert.deepEqual(byName['alpha-spec.md'].speccedIn, []);
});

test('--specced-in keeps the items of one spec, by bare name or full path, ignoring case and .md', t => {
  const v = vault(t);
  speccedFixture(v);
  v.item('demo', 'beta-spec', 'planned');
  v.item('demo', 'item-c', 'planned', { speccedIn: '["[[beta-spec]]"]' });
  v.item('other', 'item-d', 'planned', { speccedIn: '["[[alpha-spec]]"]' });
  const r = v.run(['--specced-in', 'alpha-spec', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const rows = JSON.parse(r.stdout);
  assert.deepEqual(rows.map(row => [row.path, row.speccedIn]), [
    ['wiki/authored/demo/backlog/item-b.md', [SPEC]],
    ['wiki/authored/demo/backlog/item-a.md', [SPEC]],
  ]);
  for (const name of ['ALPHA-SPEC.md', 'wiki/authored/demo/backlog/Alpha-Spec', SPEC]) {
    assert.deepEqual(paths(v.list({ speccedIn: name })), ['demo/backlog/item-b.md', 'demo/backlog/item-a.md'], name);
  }
  assert.deepEqual(paths(v.list({ speccedIn: 'nowhere' })), []);
  assert.deepEqual(paths(v.list({ speccedIn: 'alpha-spec', backlogStatus: ['planned'] })), ['demo/backlog/item-b.md']);
});

test('an empty --specced-in exits 2 and says what it needs', t => {
  const v = vault(t);
  speccedFixture(v);
  const r = v.run(['--specced-in', '']);
  assert.equal(r.status, 2);
  assert.equal(r.stderr.trim(), 'backlog-list: --specced-in needs a backlog item name');
});

// ------------------------------------------------------------------ command --

// Recorded from the command before the specced-in key existed; the text output must not change.
test('the text output for items without specced-in is byte for byte what it was before the key existed', t => {
  const v = vault(t);
  v.item('demo', 'base', 'shipped', { title: 'Base work' });
  v.item('demo', 'next', 'planned', { title: 'Next\twork', dependsOn: '["[[base]]"]' });
  v.item('demo', 'later', 'planned', { title: 'Later work', dependsOn: '["[[next]]", "[[nowhere]]", "plain"]' });
  v.item('demo', 'held', 'blocked', { dependsOn: '["[[later]]"]' });
  v.item('demo', 'idea', 'proposed');
  v.item('demo', 'bare', undefined);
  v.item('demo', 'gone', 'dropped');
  v.item('other', 'busy', 'in-progress', { title: 'Busy work' });
  const r = v.run([]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.replace(/\r\n/g, '\n'), [
    'demo\tplanned\twiki/authored/demo/backlog/later.md\tLater work\twaiting on next, nowhere, plain',
    'demo\tplanned\twiki/authored/demo/backlog/next.md\tNext work\t',
    'demo\tblocked\twiki/authored/demo/backlog/held.md\theld\twaiting on later',
    'demo\tshipped\twiki/authored/demo/backlog/base.md\tBase work\t',
    'demo\tdropped\twiki/authored/demo/backlog/gone.md\tgone\t',
    'demo\tnone\twiki/authored/demo/backlog/bare.md\tbare\t',
    'demo\tproposed\twiki/authored/demo/backlog/idea.md\tidea\t',
    'other\tin-progress\twiki/authored/other/backlog/busy.md\tBusy work\t',
    '',
  ].join('\n'));
});

test('the command prints one tab-separated line per item: project, status, path, title, then what it waits on', t => {
  const v = vault(t);
  v.item('demo', 'plain', 'planned', { title: 'Plain work' });
  v.item('demo', 'waiting', 'planned', { title: 'Later work', dependsOn: '["[[plain]]"]' });
  const r = v.run(['--backlog-status', 'planned']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.trimEnd().split('\n'), [
    'demo\tplanned\twiki/authored/demo/backlog/plain.md\tPlain work\t',
    'demo\tplanned\twiki/authored/demo/backlog/waiting.md\tLater work\twaiting on plain',
  ]);
});

test('--json prints the rows as an array', t => {
  const v = vault(t);
  v.item('demo', 'a', 'planned');
  const rows = JSON.parse(v.run(['--json']).stdout);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].backlogStatus, 'planned');
});

test('no match prints nothing and exits 0', t => {
  const v = vault(t);
  v.item('demo', 'a', 'shipped');
  const r = v.run(['--backlog-status', 'planned']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('an unknown status or flag exits 2 and says what is allowed', t => {
  const v = vault(t);
  v.item('demo', 'a', 'planned');
  const status = v.run(['--backlog-status', 'proposed']);
  assert.equal(status.status, 2);
  assert.match(status.stderr, /in-progress, planned, blocked, shipped, dropped/);
  assert.match(status.stderr, /unrecognized/);
  assert.equal(v.run(['--nope']).status, 2);
  assert.equal(spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', env: { ...process.env, WIKI_MASTER_VAULT: join(v.root, 'missing') } }).status, 2);
});

test('the command writes nothing', t => {
  const v = vault(t);
  v.item('demo', 'a', 'planned'); v.item('demo', 'b', 'planned', { dependsOn: '["[[a]]"]' });
  const before = snapshot(v.root);
  v.run(['--startable']); v.run(['--json']); v.run(['--specced-in', 'a']); v.run(['--project', 'demo', '--backlog-status', 'planned,shipped']);
  assert.deepEqual([...snapshot(v.root)], [...before]);
});
