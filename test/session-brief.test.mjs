import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, statSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { normalizeRepoRef, findProject, parseStatePage, buildBrief, formatBrief } from '../scripts/lib/session-brief.mjs';

// `session-brief` finds the wiki project a repository belongs to (a `repo:` key on the project's overview page)
// and prints the state page's three-line report plus the stale, blocked and overdue lists. It never writes.

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'session-brief.mjs');
const FM = (extra = '') => `---\ntype: authored\ncreated: 2026-01-01\nupdated: 2026-01-01\nstatus: draft\nsources: []\nai-generated: true\n${extra}---\n`;

function vault(t, projects = {}) {
  const root = mkdtempSync(join(tmpdir(), 'wm-brief-vault-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [project, { repo, state, items = {} }] of Object.entries(projects)) {
    const dir = join(root, 'wiki', 'authored', ...project.split('/'));
    mkdirSync(join(dir, 'reference'), { recursive: true }); mkdirSync(join(dir, 'backlog'), { recursive: true });
    const repoLine = repo === undefined ? '' : Array.isArray(repo) ? `repo: ${JSON.stringify(repo)}\n` : `repo: ${repo}\n`;
    writeFileSync(join(dir, 'overview.md'), `${FM(`project: ${project}\nkind: overview\n${repoLine}`)}# ${project}\n`);
    if (state !== undefined) writeFileSync(join(dir, 'reference', 'studio-state.md'), state);
    for (const [name, status] of Object.entries(items)) writeFileSync(join(dir, 'backlog', `${name}.md`), `${FM(`project: ${project}\nkind: backlog-item\nbacklog-status: ${status}\n`)}# ${name}\n`);
  }
  return root;
}
function repo(t, { remote, name = 'game-repo' } = {}) {
  const parent = mkdtempSync(join(tmpdir(), 'wm-brief-repo-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const dir = join(parent, name);
  mkdirSync(dir);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  if (remote) execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: dir });
  return dir;
}
const STATE = (o = {}) => `${FM('project: demo\nkind: reference\n')}# Studio state: demo

## Phase
${o.phase ?? 'pre-production'}

## Rigor tier
${o.tier ?? 'standard'}

## Next step
${o.next ?? 'Build the vertical slice'}

## Blocked by
${o.blocked ?? 'nothing'}

## Current sprint
none

## Artifact registry
| Artifact | Path | Owner | Status | Last verified |
|---|---|---|---|---|
${o.registry ?? '| State page | reference/studio-state.md | game-pm | draft | 2026-10-20 |'}

## Open questions
${o.questions ?? 'No open questions.'}

## Last gate result
none
`;

test('normalizeRepoRef makes a remote, an ssh address and an owner/name compare equal', () => {
  const want = 'github.com/acme/game';
  for (const v of ['https://github.com/acme/game.git', 'https://GitHub.com/Acme/Game', 'git@github.com:acme/game.git', 'ssh://git@github.com/acme/game.git/', 'https://user:tok@github.com/acme/game'])
    assert.equal(normalizeRepoRef(v), want, v);
  assert.equal(normalizeRepoRef('Acme/Game'), 'acme/game');
  assert.equal(normalizeRepoRef('my-game'), 'my-game');
  assert.equal(normalizeRepoRef(''), null);
  assert.equal(normalizeRepoRef(42), null);
});

test('a project is found by the repository remote, in any spelling', (t) => {
  const v = vault(t, { alpha: { repo: 'https://github.com/acme/game.git' }, beta: { repo: 'https://github.com/acme/other' } });
  for (const remote of ['git@github.com:acme/game.git', 'https://github.com/Acme/game']) {
    const r = findProject(v, { remote, folder: 'whatever' });
    assert.deepEqual(r.matches.map((m) => [m.project, m.by]), [['alpha', 'remote']], remote);
  }
});

test('a project is found by the repository folder name when there is no remote', (t) => {
  const v = vault(t, { alpha: { repo: 'my-game' }, beta: { repo: 'other' } });
  assert.deepEqual(findProject(v, { remote: null, folder: 'My-Game' }).matches.map((m) => [m.project, m.by]), [['alpha', 'folder']]);
});

test('an owner/name value matches the end of the remote; a list of values matches any', (t) => {
  const v = vault(t, { alpha: { repo: ['acme/game', 'old-name'] } });
  assert.equal(findProject(v, { remote: 'https://github.com/acme/game.git', folder: 'x' }).matches.length, 1);
  assert.equal(findProject(v, { remote: null, folder: 'old-name' }).matches.length, 1);
  assert.equal(findProject(v, { remote: 'https://github.com/other/game', folder: 'x' }).matches.length, 0);
});

test('a nested project is found by its path', (t) => {
  const v = vault(t, { 'acme-suite/tool': { repo: 'tool-repo' } });
  assert.deepEqual(findProject(v, { remote: null, folder: 'tool-repo' }).matches.map((m) => m.project), ['acme-suite/tool']);
});

test('two projects claiming one repository are both reported, not guessed', (t) => {
  const v = vault(t, { alpha: { repo: 'shared' }, beta: { repo: 'shared' } });
  assert.deepEqual(findProject(v, { remote: null, folder: 'shared' }).matches.map((m) => m.project).sort(), ['alpha', 'beta']);
});

test('parseStatePage reads the fields, the registry and the open-question table', () => {
  const s = parseStatePage(STATE({ registry: '| Game brief | overview.md | game-master | ready | 2026-09-01 |\n| Architecture | architecture.md | game-architect | absent | - |', questions: '| Question | Owner | Must be answered by | Status |\n|---|---|---|---|\n| Which engine? | owner | G2 | open |\n| Old one | owner | G1 | answered |' }));
  assert.equal(s.fields.phase, 'pre-production');
  assert.equal(s.fields.tier, 'standard');
  assert.equal(s.fields.next, 'Build the vertical slice');
  assert.equal(s.fields.blocked, 'nothing');
  assert.deepEqual(s.registry.map((r) => [r.artifact, r.status, r.lastVerified]), [['Game brief', 'ready', '2026-09-01'], ['Architecture', 'absent', '-']]);
  assert.deepEqual(s.questions.map((q) => [q.question, q.gate, q.status]), [['Which engine?', 'G2', 'open'], ['Old one', 'G1', 'answered']]);
});

test('"No open questions." is no questions, and an empty required field is named', () => {
  const s = parseStatePage(STATE({ next: '' }));
  assert.deepEqual(s.questions, []);
  assert.deepEqual(s.empty, ['Next step']);
});

const TODAY = new Date('2026-10-26T12:00:00Z');
// Verbatim public template at agent-game-studio 0.4.1, source 463d4e99410f431980b48837b58aa54ee13b8802.
const ORIENTATION_TEMPLATE = readFileSync(new URL('./fixtures/studio-orientation-0.4.1.md', import.meta.url), 'utf8');
const ORIENTATION_PAGE = ORIENTATION_TEMPLATE
  .replace('<goal, current work and useful next action>', 'Finish [[wiki/authored/demo/decisions/stack.md|stack decision]] and [[backlog/slice.md]].')
  .replace('| <record> | <link> | <person or role, if useful> | <uncertainty or date checked> |', '| Stack | [[decisions/stack.md|Stack decision]] | owner | Last discussed 2020-01-01; build unverified |')
  .replace('<real obstacles or uncertainty; no compulsory readiness fields>', 'Audio format is unresolved.')
  .replace('<links to actual decisions, not copied progress or invented approvals>', '[Renderer choice](decisions/renderer.md)');
const fromPage = (page) => buildBrief({ state: parseStatePage(page), today: TODAY });
const formatted = (b) => formatBrief({ project: 'demo', path: 'wiki/authored/demo', by: 'flag', brief: b });

test('current optional orientation renders focus, records and uncertainty without legacy requirements', () => {
  const b = fromPage(ORIENTATION_PAGE + '\n## Phase\nproduction\n## Open questions\n| Question | Owner | Must be answered by | Status |\n|---|---|---|---|\n| Historical | owner | G1 | open |');
  assert.equal(b.schema, 'orientation');
  assert.deepEqual(b.empty, []);
  assert.deepEqual(b.report, ['Current focus: Finish stack decision and slice.', 'Dependencies and open questions: Audio format is unresolved.', 'Recent decisions: [Renderer choice](decisions/renderer.md)']);
  assert.equal(b.records[0].path, '[[decisions/stack.md|Stack decision]]');
  assert.deepEqual(b.stale, []);
  assert.deepEqual(b.unverified, [], 'free-form notes never become verification dates');
  assert.deepEqual(b.overdue, []);
  assert.deepEqual(b.dueNext, []);
  assert.match(formatted(b), /Stack decision/);
  assert.doesNotMatch(formatted(b), /gate|incomplete|required|run studio-start/);
});

test('blank and partial orientation are optional, not incomplete', () => {
  const blank = fromPage(ORIENTATION_TEMPLATE);
  assert.deepEqual(blank.report, []);
  assert.deepEqual(blank.records, []);
  assert.match(formatted(blank), /No orientation details recorded/);
  const partial = fromPage('## Current focus\nRead the existing source.');
  assert.deepEqual(partial.report, ['Current focus: Read the existing source.']);
  assert.doesNotMatch(formatted(partial), /incomplete|required|Unfilled|studio-start/);
});

test('legacy checkpoint alias and scalar value lines avoid template explanations', () => {
  const state = parseStatePage(STATE({ phase: 'concept\n\nExplanation of phases.', tier: 'minimal\n\nExplanation of tiers.', next: 'Read [[decisions/stack.md|stack decision]] and [[backlog/slice.md]]' }).replace('Last gate result', 'Last checkpoint review'));
  assert.equal(state.fields.gate, 'none');
  assert.deepEqual(state.empty, []);
  const b = buildBrief({ state });
  assert.equal(b.report[0], 'Phase: concept, tier: minimal');
  assert.equal(b.report[1], 'Next step: Read stack decision and slice');
});

test('invalid and future verification dates are unverified, not stale', () => {
  const b = fromPage(STATE({ registry: '| Invalid | a.md | owner | ready | 2026-02-30 |\n| Future | b.md | owner | draft | 2026-12-01 |' }));
  assert.deepEqual(b.stale, []);
  assert.deepEqual(b.unverified.map((r) => r.artifact), ['Invalid', 'Future']);
});

test('legacy narrative fields retain multiline actions and blockers', () => {
  const b = fromPage(STATE({ next: 'Inspect the renderer.\nThen compare the traces.', blocked: 'Missing asset license.\nAudio decision unresolved.' }));
  assert.equal(b.report[1], 'Next step: Inspect the renderer. Then compare the traces.');
  assert.equal(b.report[2], 'Blocked by: Missing asset license. Audio decision unresolved.');
});

test('malformed pages and tables report limits without inventing records', () => {
  const bad = fromPage('---\nstatus: draft\n## Current focus\nShould not be interpreted');
  assert.equal(bad.schema, 'unknown');
  assert.deepEqual(bad.report, []);
  assert.match(formatted(bad), /frontmatter fence that is not closed/);
  const row = fromPage(ORIENTATION_PAGE.replace('build unverified |', 'build | unverified |'));
  assert.deepEqual(row.records, []);
  assert.match(formatted(row), /Malformed row/);
  const header = fromPage(ORIENTATION_PAGE.replace('Actual wiki path or existing source link', 'Unrecognized column'));
  assert.deepEqual(header.records, []);
  assert.match(formatted(header), /Unrecognized Relevant records table header/);
  assert.equal(fromPage('```md\n## Current focus\nExample\n```').schema, 'unknown');
  assert.match(formatted(fromPage('## Current focus\nFirst\n## Current focus\nSecond')), /Duplicate section/);
  assert.match(formatted(fromPage('## Current focus\nFirst\n```\n## Phase\nproduction')), /Unclosed code fence/);
});

test('legacy table aliases and escaped pipes preserve columns and owner punctuation', () => {
  const b = fromPage(STATE({ questions: '| Question | Owner | Must be answered by | Status |\n|---|---|---|---|\n| [[questions/a.md|Which engine?]] | owner | G1 | open |', registry: '| A \\| B | [[a.md|A]] | owner | ready | 2026-01-01 |' }));
  assert.equal(b.stale[0].artifact, 'A | B');
  assert.equal(b.stale[0].path, '[[a.md|A]]');
  assert.match(formatted(b), /Which engine\? \(gate G1, owner: owner\)/);
  assert.match(formatted(b), /Legacy gate annotations only; no approval or work prerequisite/);
});

test('current, malformed and absent pages remain read-only in CLI text and JSON', (t) => {
  for (const state of [ORIENTATION_PAGE, '---\nnot closed', undefined]) {
    const v = vault(t, { demo: { state } });
    const dir = repo(t);
    const before = [snapshot(v), snapshot(dir)];
    for (const json of [false, true]) {
      const result = run(['--project', 'demo', ...(json ? ['--json'] : [])], { cwd: dir, vaultPath: v });
      assert.equal(result.status, 0, result.stderr);
      if (json) {
        const data = JSON.parse(result.stdout);
        assert.equal(data.statePage === null, state === undefined);
        if (state !== undefined) assert.equal(data.schema, state === ORIENTATION_PAGE ? 'orientation' : 'unknown');
      } else assert.doesNotMatch(result.stdout, /run studio-start|Empty required/);
    }
    assert.deepEqual([snapshot(v), snapshot(dir)], before);
  }
});
const brief = (o, items = [], extra = {}) => buildBrief({ state: parseStatePage(STATE(o)), items, today: TODAY, staleDays: 30, ...extra });

test('the report is exactly three lines, in the studio format', () => {
  const b = brief({ phase: 'concept', tier: 'minimal', next: 'Write the brief', blocked: 'nothing' });
  assert.deepEqual(b.report, ['Phase: concept, tier: minimal', 'Next step: Write the brief', 'Blocked by: nothing']);
});

test('an artifact verified more than the threshold ago is stale; absent, never-set and recent ones are handled', () => {
  const b = brief({ registry: [
    '| Old | a.md | game-pm | ready | 2026-09-01 |',
    '| Edge | b.md | game-pm | ready | 2026-09-26 |',
    '| Recent | c.md | game-pm | ready | 2026-10-20 |',
    '| Missing | d.md | game-pm | absent | - |',
    '| Never | e.md | game-pm | draft | - |',
  ].join('\n') });
  assert.deepEqual(b.stale.map((s) => [s.artifact, s.reason]), [['Old', '55 days']]);
  assert.deepEqual(b.unverified.map((s) => s.artifact), ['Never']);
  assert.equal(brief({ registry: '| Edge | b.md | game-pm | ready | 2026-09-26 |' }, [], { staleDays: 30 }).stale.length, 0, 'exactly the threshold is not stale');
  assert.equal(brief({ registry: '| Edge | b.md | game-pm | ready | 2026-09-26 |' }, [], { staleDays: 29 }).stale.length, 1);
});

test('blocked backlog items are listed', () => {
  const items = [{ path: 'wiki/authored/demo/backlog/a.md', backlogStatus: 'blocked', title: 'A' }, { path: 'wiki/authored/demo/backlog/b.md', backlogStatus: 'planned', title: 'B' }];
  assert.deepEqual(brief({}, items).blockedItems.map((i) => i.path), ['wiki/authored/demo/backlog/a.md']);
});

test('an open question is overdue once the gate it names is behind the current phase', () => {
  const q = '| Question | Owner | Must be answered by | Status |\n|---|---|---|---|\n| Q1 | o | G1 | open |\n| Q2 | o | G2 | open |\n| Q3 | o | G3 | open |\n| Q4 | o | G1 | answered |\n| Q5 | o | none | open |';
  const b = brief({ phase: 'pre-production', questions: q });
  assert.deepEqual(b.overdue.map((x) => x.question), ['Q1']);
  assert.deepEqual(b.dueNext.map((x) => x.question), ['Q2']);
  assert.deepEqual(brief({ phase: 'production', questions: q }).overdue.map((x) => x.question), ['Q1', 'Q2']);
  assert.deepEqual(brief({ phase: 'adopt', questions: q }).overdue, []);
  assert.deepEqual(brief({ phase: 'live', questions: q }).overdue.map((x) => x.question), ['Q1', 'Q2', 'Q3']);
});

test('formatBrief names the project and path, the three lines, then the lists', () => {
  const b = brief({ registry: '| Old | a.md | game-pm | ready | 2026-01-01 |' }, [{ path: 'wiki/authored/demo/backlog/a.md', backlogStatus: 'blocked', title: 'A' }]);
  const text = formatBrief({ project: 'demo', path: 'wiki/authored/demo', by: 'remote', brief: b, staleDays: 30 });
  const lines = text.split('\n');
  assert.equal(lines[0], 'Project: demo (wiki/authored/demo), matched by the repository remote');
  assert.deepEqual(lines.slice(1, 4), b.report);
  assert.match(text, /Stale artifacts \(not verified for more than 30 days\):/);
  assert.match(text, /Old/);
  assert.match(text, /Blocked backlog items:/);
});

test('a missing state page and an empty required field are said plainly', () => {
  const none = formatBrief({ project: 'demo', path: 'wiki/authored/demo', by: 'flag', brief: null, staleDays: 30 });
  assert.match(none, /no state page at wiki\/authored\/demo\/reference\/studio-state\.md/);
  assert.match(none, /orientation is optional and work can continue/);
  const b = brief({ next: '' });
  assert.match(formatBrief({ project: 'demo', path: 'wiki/authored/demo', by: 'flag', brief: b, staleDays: 30 }), /Unfilled legacy fields: Next step; these are not prerequisites/);
});

function run(args, { cwd, vaultPath }) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', env: { ...process.env, WIKI_MASTER_VAULT: vaultPath } });
}
function snapshot(root) {
  const out = {};
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      if (name === '.git') continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { out[full] = 'dir'; walk(full); } else out[full] = `${statSync(full).mtimeMs}:${readFileSync(full, 'utf8')}`;
    }
  })(root);
  return out;
}

test('the command: found by remote, three lines first, nothing written to the vault or the repository', (t) => {
  const v = vault(t, { demo: { repo: 'https://github.com/acme/game.git', state: STATE({ phase: 'concept', tier: 'minimal', next: 'Write the brief' }) } });
  const dir = repo(t, { remote: 'git@github.com:acme/game.git' });
  const before = [snapshot(v), snapshot(dir)];
  const r = run([], { cwd: dir, vaultPath: v });
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n');
  assert.match(lines[0], /^Project: demo \(wiki\/authored\/demo\), matched by the repository remote$/);
  assert.deepEqual(lines.slice(1, 4), ['Phase: concept, tier: minimal', 'Next step: Write the brief', 'Blocked by: nothing']);
  assert.deepEqual([snapshot(v), snapshot(dir)], before);
});

test('the command: --project overrides the match and --json is one object', (t) => {
  const v = vault(t, { demo: { state: STATE({}) } });
  const dir = repo(t, {});
  const r = run(['--project', 'demo', '--json'], { cwd: dir, vaultPath: v });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.project, 'demo');
  assert.equal(j.by, 'flag');
  assert.deepEqual(j.report, ['Phase: pre-production, tier: standard', 'Next step: Build the vertical slice', 'Blocked by: nothing']);
});

test('the command: no match says so and shows how to bind; two matches are listed; both exit 1', (t) => {
  const v = vault(t, { alpha: { repo: 'shared' }, beta: { repo: 'shared' } });
  const none = run([], { cwd: repo(t, { name: 'unbound' }), vaultPath: v });
  assert.equal(none.status, 1);
  assert.match(none.stdout, /no wiki project is bound to this repository/);
  assert.match(none.stdout, /repo: unbound/);
  const two = run([], { cwd: repo(t, { name: 'shared' }), vaultPath: v });
  assert.equal(two.status, 1);
  assert.match(two.stdout, /more than one/);
  assert.match(two.stdout, /alpha/); assert.match(two.stdout, /beta/);
});

test('the command: a project that does not exist, a bad option and --help', (t) => {
  const v = vault(t, { demo: { state: STATE({}) } });
  const dir = repo(t, {});
  const missing = run(['--project', 'nope'], { cwd: dir, vaultPath: v });
  assert.equal(missing.status, 2);
  assert.equal(missing.stderr.trim().split('\n').length, 1);
  const bad = run(['--bogus'], { cwd: dir, vaultPath: v });
  assert.equal(bad.status, 2);
  assert.equal(bad.stderr.trim().split('\n').length, 1, bad.stderr);
  const days = run(['--project', 'demo', '--stale-days', 'x'], { cwd: dir, vaultPath: v });
  assert.equal(days.status, 2);
  const help = run(['--help'], { cwd: dir, vaultPath: join(v, 'does-not-exist') });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /usage: node scripts\/session-brief\.mjs/);
});

test('a state page with nothing to flag says so in one line', () => {
  const text = formatBrief({ project: 'demo', path: 'wiki/authored/demo', by: 'folder', brief: brief({}), staleDays: 30 });
  assert.equal(text.split('\n').slice(5).join('\n'), 'No stale artifacts, blocked items or overdue questions.');
  assert.match(text.split('\n')[0], /matched by the repository folder name$/);
});

test('the unfilled studio template reads as all fields empty, not as a state', () => {
  const template = `${FM('project: demo\nkind: reference\n')}# Studio state: demo

## Phase
<adopt | concept | pre-production | production | beta | release | live>

## Rigor tier
<minimal | standard | full>

## Next step
<one line>

## Blocked by
<the item and the reason, or: nothing>

## Current sprint
<backlog item slugs, or: none>

## Artifact registry
| Artifact | Path | Owner | Status | Last verified |
|---|---|---|---|---|
| State page | reference/studio-state.md | game-pm | draft | <YYYY-MM-DD> |
| Game brief | overview.md | game-master | absent | - |

## Open questions
<If there are none, write: No open questions. Otherwise use this table.>

| Question | Owner | Must be answered by | Status |
|---|---|---|---|
| <question> | <role or owner> | <G1 to G5, or none> | open |

## Last gate result
<none | <gate> <met | unmet | waived> - owner accepted <YYYY-MM-DD, or: not yet> - <evidence link>>
`;
  const state = parseStatePage(template);
  assert.deepEqual(state.empty, ['Phase', 'Rigor tier', 'Next step', 'Blocked by', 'Current sprint', 'Last gate result']);
  const b = buildBrief({ state, today: TODAY, staleDays: 30 });
  assert.deepEqual(b.report, ['Phase: (empty), tier: (empty)', 'Next step: (empty)', 'Blocked by: (empty)']);
  assert.deepEqual(b.stale, []);
  assert.deepEqual(b.unverified.map((s) => s.artifact), ['State page'], 'a placeholder date is unverified');
  assert.deepEqual(b.overdue, [], 'a placeholder gate names no gate');
});
