import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { repairAmbiguousLinks } from '../scripts/repair-ambiguous-links.mjs';
import { scanIntegrity } from '../scripts/lib/integrity.mjs';
import { BEGIN_MARK, END_MARK, LEGACY_BEGIN_MARKS } from '../scripts/lib/index-fence.mjs';
import { repointBareLinks, hasGeneratedFence } from '../scripts/lib/ambiguous-repair.mjs';

// Two lints in a row repaired ambiguous `[[architecture]]`-style links with a throwaway script. This is the
// reusable, tested version. On its own it applies one deterministic rule (the page lives in a project's folder
// and exactly one candidate does too) and reports every other class with its reason instead of guessing.

const SUBSTANTIVE = 'This original page explains how the importer decides which of two settings wins when they disagree, and why.';
const page = (project, body, fm = '') => `---\ntype: authored\ncreated: 2026-01-01\nupdated: 2026-01-01\nreviewed: 2026-01-01\nstatus: draft\nsources: []\nai-generated: true\nproject: ${project}\nkind: note\n${fm}---\n${body}\n`;

function vault(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'wm-rambig-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  return root;
}
const ambiguous = (root) => scanIntegrity(root).issues.filter((i) => i.rule === 'ambiguous-link').map((i) => `${i.source}->${i.target}`).sort();
const read = (root, path) => readFileSync(join(root, path), 'utf8');

const TWO_ARCH = {
  'wiki/authored/proj/architecture.md': page('proj', `# Architecture\n${SUBSTANTIVE}`),
  'wiki/authored/other/architecture.md': page('other', `# Architecture\n${SUBSTANTIVE}`),
};

test('a bare link on a project page with exactly one candidate in that project is repointed, keeping the displayed text', t => {
  const root = vault(t, { ...TWO_ARCH, 'wiki/authored/proj/guide.md': page('proj', `# Guide\nSee [[architecture]] for the design. ${SUBSTANTIVE}`) });
  assert.deepEqual(ambiguous(root), ['wiki/authored/proj/guide.md->architecture']);
  const r = repairAmbiguousLinks(root, { apply: true });
  assert.equal(r.fixed, 1);
  assert.match(read(root, 'wiki/authored/proj/guide.md'), /See \[\[wiki\/authored\/proj\/architecture\.md\|architecture\]\] for the design\./);
  assert.deepEqual(ambiguous(root), []);
});

test('alias, heading and the table-cell separator are kept', t => {
  const body = [
    '# Guide', SUBSTANTIVE,
    'Aliased: [[architecture|the design]].',
    'Heading: [[architecture#Layers]].',
    '| Doc | Link |', '|---|---|', '| design | [[architecture]] |', '| aliased | [[architecture\\|the design]] |',
  ].join('\n');
  const root = vault(t, { ...TWO_ARCH, 'wiki/authored/proj/guide.md': page('proj', body) });
  repairAmbiguousLinks(root, { apply: true });
  const out = read(root, 'wiki/authored/proj/guide.md');
  assert.match(out, /Aliased: \[\[wiki\/authored\/proj\/architecture\.md\|the design\]\]\./);
  assert.match(out, /Heading: \[\[wiki\/authored\/proj\/architecture\.md#Layers\|architecture\]\]\./);
  assert.match(out, /\| design \| \[\[wiki\/authored\/proj\/architecture\.md\\\|architecture\]\] \|/);
  assert.match(out, /\| aliased \| \[\[wiki\/authored\/proj\/architecture\.md\\\|the design\]\] \|/);
  assert.deepEqual(ambiguous(root), []);
});

test('links in code spans, fences and comments are examples and stay as written', t => {
  const body = ['# Guide', SUBSTANTIVE, 'Inline `[[architecture]]` is an example.', '```', '[[architecture]]', '```', '%% [[architecture]] %%', 'Real [[architecture]] here.'].join('\n');
  const root = vault(t, { ...TWO_ARCH, 'wiki/authored/proj/guide.md': page('proj', body) });
  const r = repairAmbiguousLinks(root, { apply: true });
  assert.equal(r.fixed, 1);
  const out = read(root, 'wiki/authored/proj/guide.md');
  assert.match(out, /Inline `\[\[architecture\]\]` is an example\./);
  assert.match(out, /```\n\[\[architecture\]\]\n```/);
  assert.match(out, /%% \[\[architecture\]\] %%/);
  assert.match(out, /Real \[\[wiki\/authored\/proj\/architecture\.md\|architecture\]\] here\./);
});

test('a sources: entry takes the full path with no alias', t => {
  const root = vault(t, { ...TWO_ARCH, 'wiki/authored/proj/guide.md': page('proj', `# Guide\n${SUBSTANTIVE}`).replace('sources: []', 'sources: ["[[architecture]]"]') });
  repairAmbiguousLinks(root, { apply: true });
  assert.match(read(root, 'wiki/authored/proj/guide.md'), /^sources: \["\[\[wiki\/authored\/proj\/architecture\.md\]\]"\]$/m);
});

test('updated is set to the run date once, reviewed is left alone, and only wikilinks change', t => {
  const body = `# Guide\n${SUBSTANTIVE}\nOne [[architecture]] and again [[architecture]].\nAn unrelated line with  odd   spacing.`;
  const root = vault(t, { ...TWO_ARCH, 'wiki/authored/proj/guide.md': page('proj', body) });
  const before = read(root, 'wiki/authored/proj/guide.md');
  repairAmbiguousLinks(root, { apply: true, today: '2026-10-26' });
  const after = read(root, 'wiki/authored/proj/guide.md');
  assert.match(after, /^updated: 2026-10-26$/m);
  assert.match(after, /^reviewed: 2026-01-01$/m);
  const strip = (s) => s.replace(/\[\[[^\]]*\]\]/g, '[[]]').replace(/^updated: .*$/m, 'updated: X');
  assert.equal(strip(after), strip(before), 'nothing but the links and the updated date changed');
  assert.equal((after.match(/architecture\.md\|architecture/g) ?? []).length, 2);
});

test('a dry run reports the change line by line and writes nothing; a second apply finds nothing', t => {
  const root = vault(t, { ...TWO_ARCH, 'wiki/authored/proj/guide.md': page('proj', `# Guide\nSee [[architecture]] now. ${SUBSTANTIVE}`) });
  const before = read(root, 'wiki/authored/proj/guide.md');
  const dry = repairAmbiguousLinks(root, { apply: false });
  assert.equal(dry.applied, false);
  assert.equal(dry.planned.length, 1);
  assert.match(dry.planned[0].before, /See \[\[architecture\]\] now/);
  assert.match(dry.planned[0].after, /See \[\[wiki\/authored\/proj\/architecture\.md\|architecture\]\] now/);
  assert.equal(read(root, 'wiki/authored/proj/guide.md'), before);
  repairAmbiguousLinks(root, { apply: true });
  const again = repairAmbiguousLinks(root, { apply: true });
  assert.equal(again.fixed, 0);
  assert.deepEqual(again.planned, []);
});

test('a hub MOC and a page sharing a name are not ambiguous since 0.57.0, so there is nothing to repair or report', t => {
  const root = vault(t, {
    'moc/proj.md': '---\ntype: moc\n---\n# proj\n',
    'wiki/entities/proj.md': `---\ntype: entity\nstatus: maintained\nsources: []\n---\n# proj\n${SUBSTANTIVE}\n`,
    'wiki/authored/proj/guide.md': page('proj', `# Guide\nThe [[proj]] tool. ${SUBSTANTIVE}`),
  });
  const before = read(root, 'wiki/authored/proj/guide.md');
  assert.deepEqual(ambiguous(root), []);
  const r = repairAmbiguousLinks(root, { apply: true });
  assert.deepEqual([r.fixed, r.reported.length], [0, 0]);
  assert.equal(read(root, 'wiki/authored/proj/guide.md'), before);
});

test('a page outside every project folder, or with several candidates in its project, is reported as needing a reading', t => {
  const root = vault(t, {
    ...TWO_ARCH,
    'wiki/sources/shared.md': `---\ntype: source\nstatus: maintained\nsources: []\n---\n# Shared\nSee [[architecture]]. ${SUBSTANTIVE}\n`,
    'wiki/authored/proj/notes/architecture.md': page('proj', `# Architecture notes\n${SUBSTANTIVE}`),
    'wiki/authored/proj/guide.md': page('proj', `# Guide\nSee [[architecture]]. ${SUBSTANTIVE}`),
  });
  const r = repairAmbiguousLinks(root, { apply: true });
  assert.equal(r.fixed, 0);
  const by = Object.fromEntries(r.reported.map((x) => [x.page, x]));
  assert.equal(by['wiki/sources/shared.md'].class, 'shared-page');
  assert.equal(by['wiki/authored/proj/guide.md'].class, 'needs-reading');
  assert.match(by['wiki/authored/proj/guide.md'].reason, /more than one candidate in the project/);
});

test('a title-shaped citation shared by two clippings is reported and never edited', t => {
  const clip = (n) => `---\ntitle: "Shared Title"\nsource: "https://example.com/${n}"\ncreated: 2026-01-01\ntags: [clippings]\nquality: high\n---\nBody ${n}.\n`;
  const root = vault(t, {
    'raw/clippings/a.md': clip('a'), 'raw/clippings/b.md': clip('b'),
    'wiki/authored/proj/guide.md': page('proj', `# Guide\n${SUBSTANTIVE}`).replace('sources: []', 'sources: ["[[Shared Title]]"]'),
  });
  const before = read(root, 'wiki/authored/proj/guide.md');
  const r = repairAmbiguousLinks(root, { apply: true });
  assert.equal(r.fixed, 0);
  assert.equal(r.reported[0].class, 'title-citation');
  assert.equal(read(root, 'wiki/authored/proj/guide.md'), before);
});

test('an occurrence inside a generated catalog fence is left for regeneration and reported', t => {
  const fence = [LEGACY_BEGIN_MARKS[1], '- [[architecture]]', '%% END GENERATED CATALOG %%'].join('\n');
  const root = vault(t, { ...TWO_ARCH, 'wiki/authored/proj/roadmap.md': page('proj', `# Roadmap\n${SUBSTANTIVE}\n${fence}`) });
  const before = read(root, 'wiki/authored/proj/roadmap.md');
  const r = repairAmbiguousLinks(root, { apply: true });
  assert.equal(r.fixed, 0);
  assert.equal(r.reported[0].class, 'catalog-line');
  assert.match(r.reported[0].reason, /regenerat/i);
  assert.equal(read(root, 'wiki/authored/proj/roadmap.md'), before);
});

// Every generated fence is masked, whichever script's name its begin line carries, in every kind of catalog.
for (const begin of [BEGIN_MARK, ...LEGACY_BEGIN_MARKS]) {
  // A project map is outside every project folder, so only a reviewed mapping can aim a repair at it.
  for (const [path, options] of [
    ['wiki/authored/proj/roadmap.md', {}],
    ['moc/proj.md', { mapping: [{ target: 'architecture', path: 'wiki/authored/proj/architecture.md' }] }],
  ]) {
    test(`${path} with the fence "${begin.slice(-30)}" is left for regeneration and reported`, t => {
      const fence = [begin, '- [[architecture]]', END_MARK].join('\n');
      const root = vault(t, { ...TWO_ARCH, [path]: page('proj', `# Catalog\n${SUBSTANTIVE}\n${fence}`) });
      const before = read(root, path);
      const r = repairAmbiguousLinks(root, { apply: true, ...options });
      assert.equal(r.fixed, 0);
      assert.equal(r.reported[0].class, 'catalog-line');
      assert.equal(read(root, path), before);
    });
  }
}

test('index.md and other catalog text: every fence is masked, and a link in the prose around them is still repointed', () => {
  const wanted = new Map([['architecture', 'wiki/authored/proj/architecture.md']]);
  for (const begin of [BEGIN_MARK, ...LEGACY_BEGIN_MARKS]) {
    const fence = [begin, '- [[architecture]]', END_MARK].join('\n');
    const text = `---\ntype: synthesis\n---\n# Index\n${fence}\nSee [[architecture]].\n${fence}\n`;
    assert.equal(hasGeneratedFence(text), true);
    const r = repointBareLinks(text, wanted);
    assert.equal(r.count, 1, 'only the link between the fences');
    assert.equal(r.text, text.replace('See [[architecture]]', 'See [[wiki/authored/proj/architecture.md|architecture]]'));
  }
  assert.equal(hasGeneratedFence('# no fence\n- [[architecture]]\n'), false);
  assert.equal(hasGeneratedFence(`${END_MARK}\n${BEGIN_MARK}\n`), false, 'an end before the begin is not a fence');
});

test('a quoted marker masks nothing: links beside it are still repointed, and it is not a generated fence', () => {
  const wanted = new Map([['architecture', 'wiki/authored/proj/architecture.md']]);
  const text = `---\ntype: note\n---\nThe line \`${BEGIN_MARK}\` opens a fence and See [[architecture]] explains \`${END_MARK}\`.\n`;
  assert.equal(hasGeneratedFence(text), false);
  const r = repointBareLinks(text, wanted);
  assert.equal(r.count, 1);
  assert.match(r.text, /See \[\[wiki\/authored\/proj\/architecture\.md\|architecture\]\]/);
  const example = `---\ntype: note\n---\n\`\`\`\n${BEGIN_MARK}\n${END_MARK}\n\`\`\`\nSee [[architecture]].\n`;
  assert.equal(hasGeneratedFence(example), false);
  assert.equal(repointBareLinks(example, wanted).count, 1);
});

test('--exclude leaves pages an application reads alone and says so', t => {
  const root = vault(t, {
    ...TWO_ARCH,
    'wiki/authored/proj/guide.md': page('proj', `# Guide\nSee [[architecture]]. ${SUBSTANTIVE}`),
    'wiki/authored/proj/app/read-by-app.md': page('proj', `# App\nSee [[architecture]]. ${SUBSTANTIVE}`),
  });
  const r = repairAmbiguousLinks(root, { apply: true, exclude: ['wiki/authored/proj/app/'] });
  assert.equal(r.fixed, 1);
  assert.deepEqual(r.excluded.map((x) => x.page), ['wiki/authored/proj/app/read-by-app.md']);
  assert.match(read(root, 'wiki/authored/proj/app/read-by-app.md'), /See \[\[architecture\]\]\./);
});

test('--project bounds the run to that project\'s pages', t => {
  const root = vault(t, {
    ...TWO_ARCH,
    'wiki/authored/proj/guide.md': page('proj', `# Guide\nSee [[architecture]]. ${SUBSTANTIVE}`),
    'wiki/authored/other/guide.md': page('other', `# Guide\nSee [[architecture]]. ${SUBSTANTIVE}`),
  });
  const r = repairAmbiguousLinks(root, { apply: true, project: 'proj' });
  assert.equal(r.fixed, 1);
  assert.match(read(root, 'wiki/authored/other/guide.md'), /See \[\[architecture\]\]\./);
  assert.match(read(root, 'wiki/authored/proj/guide.md'), /architecture\.md\|architecture/);
});

test('a reviewed mapping repoints a link the rule cannot decide, and refuses a path that is not a candidate', t => {
  const root = vault(t, {
    ...TWO_ARCH,
    'wiki/sources/shared.md': `---\ntype: source\nstatus: maintained\nsources: []\n---\n# Shared\nSee [[architecture]]. ${SUBSTANTIVE}\n`,
  });
  const bad = repairAmbiguousLinks(root, { apply: true, mapping: [{ target: 'architecture', path: 'wiki/authored/nowhere/architecture.md' }] });
  assert.equal(bad.fixed, 0);
  assert.match(bad.reported[0].reason, /not a candidate/);
  const good = repairAmbiguousLinks(root, { apply: true, mapping: [{ target: 'architecture', path: 'wiki/authored/other/architecture.md', page: 'wiki/sources/shared.md' }] });
  assert.equal(good.fixed, 1);
  assert.match(read(root, 'wiki/sources/shared.md'), /\[\[wiki\/authored\/other\/architecture\.md\|architecture\]\]/);
  assert.deepEqual(ambiguous(root), []);
});
