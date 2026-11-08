import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderBacklogCatalog, regenerateBacklogRoadmaps, refreshCatalogs, BEGIN_MARK, END_MARK } from '../scripts/lib/catalogs.mjs';

// The "Specced work" roadmap section, read from the optional specced-in key. Items stay under their
// own status; the section lists each spec with its members and how many are closed. A project
// without the key renders byte for byte as before.

const HERE = dirname(fileURLToPath(import.meta.url));
const BEFORE = join(HERE, 'fixtures', 'specced-in', 'roadmap-before.md');

const at = (slug, status, speccedIn) => ({
  path: `wiki/authored/demo/backlog/${slug}.md`, project: 'demo', kind: 'backlog-item', backlogStatus: status,
  metadata: speccedIn ? { 'specced-in': speccedIn } : {},
});

function tempVault(t) {
  const v = mkdtempSync(join(realpathSync(tmpdir()), 'wm-specced-in-'));
  t.after(() => rmSync(v, { recursive: true, force: true }));
  mkdirSync(join(v, 'wiki', 'authored', 'demo', 'backlog'), { recursive: true });
  const file = (name, status, { heading = name, extra = '', body = 'body' } = {}) => writeFileSync(join(v, 'wiki', 'authored', 'demo', 'backlog', `${name}.md`),
    `---\ntype: authored\ncreated: 2026-11-07\nupdated: 2026-11-07\nstatus: draft\nsources: []\nai-generated: true\nproject: demo\nkind: backlog-item\nbacklog-status: ${status}\n${extra}---\n# ${heading}\n\n${body}\n`);
  return { v, file };
}
const fenced = (text) => text.slice(text.indexOf(BEGIN_MARK) + BEGIN_MARK.length + 1, text.indexOf(END_MARK) - 1);

// ------------------------------------------------------------ compatibility --

test('a project with depends-on, titles and a collapsed Shipped but no specced-in renders exactly as before the key existed', (t) => {
  const { v, file } = tempVault(t);
  file('base', 'shipped', { heading: 'Base work' });
  file('old', 'shipped', { heading: 'Old work' });
  file('gone', 'dropped', { heading: 'Gone | work' });
  file('next', 'planned', { heading: 'Next [[work]]', extra: 'depends-on: ["[[base]]", "[[gone]]"]\n' });
  file('later', 'planned', { heading: 'Later work', extra: 'depends-on: ["[[next]]", "[[nowhere]]", "plain"]\n' });
  file('held', 'blocked', { heading: 'Held work', extra: 'depends-on: ["[[later]]"]\n' });
  file('busy', 'in-progress', { heading: 'Busy work' });
  file('idea', 'proposed', { heading: 'An idea' });
  file('bare', 'planned', { heading: 'Bare', body: 'Specced in [[next]] (WP1).' });
  writeFileSync(join(v, 'wiki', 'authored', 'demo', 'roadmap.md'),
    '---\ntype: authored\ncreated: 2026-11-07\nupdated: 2026-11-07\nstatus: draft\nsources: []\nai-generated: true\nproject: demo\nkind: roadmap\nbacklog-titles: true\nbacklog-shipped: collapse\n---\n# demo — roadmap\n\nFraming.\n');
  regenerateBacklogRoadmaps(v, { apply: true, now: new Date('2026-11-07T00:00:00Z') });
  const out = fenced(readFileSync(join(v, 'wiki', 'authored', 'demo', 'roadmap.md'), 'utf8'));
  assert.equal(out + '\n', readFileSync(BEFORE, 'utf8'));
  assert.ok(!out.includes('Specced work'));
});

// ------------------------------------------------------------------ section --

const three = (specStatus = 'in-progress', a = 'shipped', b = 'planned') => [
  at('alpha-spec', specStatus), at('item-a', a, ['[[alpha-spec|WP1]]']), at('item-b', b, ['[[alpha-spec|WP2]]']),
];

test('a spec is listed after the status groups with its members, their labels and the closed count', () => {
  assert.equal(renderBacklogCatalog({ pages: three() }),
    '## In progress\n- [[alpha-spec]]\n\n## Planned\n- [[item-b]]\n\n## Shipped\n- [[item-a]]\n\n## Specced work\n- [[alpha-spec]] — covers 2 items, 1 closed\n  - [[item-a]] (WP1)\n  - [[item-b]] (WP2)');
});

test('the section sits before Unrecognized status, a single member reads "1 item", and an unrecognized member is not closed', () => {
  const catalog = renderBacklogCatalog({ pages: [at('spec', 'planned'), at('odd', 'proposed', ['[[spec]]']), at('gone', 'dropped', ['[[spec|WP9]]'])] });
  assert.ok(catalog.includes('## Specced work\n- [[spec]] — covers 2 items, 1 closed\n  - [[gone]] (WP9)\n  - [[odd]]\n\n## Unrecognized status'));
  const one = renderBacklogCatalog({ pages: [at('spec', 'planned'), at('x', 'planned', ['[[spec]]'])] });
  assert.ok(one.endsWith('## Specced work\n- [[spec]] — covers 1 item, 0 closed\n  - [[x]]'));
});

test('a group whose spec and members are all closed is omitted, and with it the heading', () => {
  assert.ok(!renderBacklogCatalog({ pages: three('shipped', 'shipped', 'shipped') }).includes('Specced work'));
  assert.ok(!renderBacklogCatalog({ pages: three('dropped', 'shipped', 'dropped') }).includes('Specced work'));
  assert.ok(renderBacklogCatalog({ pages: three('shipped', 'shipped', 'planned') }).includes('covers 2 items, 1 closed'));
  assert.ok(renderBacklogCatalog({ pages: three('in-progress', 'shipped', 'shipped') }).includes('covers 2 items, 2 closed'));
});

test('a dangling, cross-project, self or malformed entry adds no line', () => {
  const pages = [at('spec', 'planned'), at('x', 'planned', ['[[spec|WP1]]', '[[nowhere|WP2]]', '[[wiki/authored/other/backlog/spec.md]]', 'spec', '[[spec|WP]]1]]']), at('y', 'planned', ['[[y]]', '[[gone]]'])];
  assert.ok(renderBacklogCatalog({ pages }).endsWith('## Specced work\n- [[spec]] — covers 1 item, 0 closed\n  - [[x]] (WP1)'));
  assert.ok(!renderBacklogCatalog({ pages: [at('y', 'planned', ['[[nowhere]]'])] }).includes('Specced work'));
});

test('a label with a pipe is cleaned like a title, a blank label is omitted, and links follow titles and ambiguity', () => {
  const pages = [at('spec', 'planned'), at('x', 'planned', ['[[spec|WP1 | part  two]]']), at('y', 'planned', ['[[spec|   ]]'])];
  assert.ok(renderBacklogCatalog({ pages }).endsWith('  - [[x]] (WP1 part two)\n  - [[y]]'));
  const titles = new Map([['wiki/authored/demo/backlog/spec.md', 'The [[spec]]'], ['wiki/authored/demo/backlog/x.md', 'Item x']]);
  const titled = renderBacklogCatalog({ pages, titles, ambiguousNames: new Set(['y']) });
  assert.ok(titled.endsWith('## Specced work\n- [[spec|The spec]] — covers 2 items, 0 closed\n  - [[x|Item x]] (WP1 part two)\n  - [[wiki/authored/demo/backlog/y|y]]'));
});

test('a refresh on a disposable vault writes the section inside the roadmap fence', (t) => {
  const { v, file } = tempVault(t);
  file('alpha-spec', 'in-progress');
  file('item-a', 'shipped', { extra: 'specced-in: ["[[alpha-spec|WP1]]"]\n' });
  file('item-b', 'planned', { extra: 'specced-in: ["[[alpha-spec|WP2]]"]\n' });
  const { changed } = refreshCatalogs(v);
  assert.ok(changed.includes('wiki/authored/demo/roadmap.md'));
  const out = fenced(readFileSync(join(v, 'wiki', 'authored', 'demo', 'roadmap.md'), 'utf8'));
  assert.ok(out.endsWith('## Specced work\n- [[alpha-spec]] — covers 2 items, 1 closed\n  - [[item-a]] (WP1)\n  - [[item-b]] (WP2)'));
});
