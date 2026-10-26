import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, writeClippingExclusive, titleFromArgs, chooseDocumentSlug } from '../scripts/clip.mjs';
import { clipSlugCandidates } from '../scripts/lib/clip-slug.mjs';
import { openIssues, loadIssueLog } from '../scripts/lib/triage.mjs';

// A bulk clip of title-less raw documents used to keep the first and report the rest as
// `exists (slug clash): untitled`, a `duplicate` that named neither the URL nor the file and left no
// trace in triage. These tests state what must hold instead.

const SKILL = (name) => `https://raw.githubusercontent.com/acme/agent/v4.2.1/skills/${name}/SKILL.md`;
const BODY = 'A substantive paragraph of document text that is long enough to count as content. '.repeat(30);
const extractor = (title = '') => () => ({ title, contentMarkdown: BODY });

function vault(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-slug-'));
  mkdirSync(join(root, 'raw', 'clippings'), { recursive: true });
  const prior = process.env.WIKI_MASTER_VAULT;
  process.env.WIKI_MASTER_VAULT = root;
  t.after(() => { if (prior === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = prior; rmSync(root, { recursive: true, force: true }); });
  const dir = join(root, 'raw', 'clippings');
  return {
    root, dir,
    files: () => readdirSync(dir).sort(),
    read: (name) => readFileSync(join(dir, name), 'utf8'),
    put: (name, source, title = '') => writeFileSync(join(dir, name), `---\ntitle: ${JSON.stringify(title)}\nsource: ${JSON.stringify(source)}\n---\nbody of ${name}\n`),
    issues: () => openIssues(loadIssueLog(root)),
  };
}
const quiet = (fn) => { const log = console.log, err = console.error; console.log = () => {}; console.error = () => {}; try { return fn(); } finally { console.log = log; console.error = err; } };
const clip = (url, extract, extra = [], deps = {}) => quiet(() => main([url, ...extra], { extract, ...deps }));

test('four title-less documents with one basename each are all clipped under distinct names, then all recognised as already clipped', t => {
  const v = vault(t);
  const urls = ['one', 'two', 'three', 'four'].map(SKILL);
  const first = urls.map((u) => clip(u, extractor()));
  assert.deepEqual(first.map((r) => r.status), ['clipped', 'clipped', 'clipped', 'clipped']);
  assert.deepEqual(v.files(), ['four-SKILL.md', 'one-SKILL.md', 'three-SKILL.md', 'two-SKILL.md']);
  const before = v.files().map((f) => v.read(f));
  const second = urls.map((u) => clip(u, extractor()));
  assert.deepEqual(second.map((r) => r.status), ['duplicate', 'duplicate', 'duplicate', 'duplicate']);
  assert.deepEqual(v.files().map((f) => v.read(f)), before, 'nothing rewritten');
  assert.deepEqual(v.issues(), [], 'a true duplicate leaves no triage row');
});

test('no new clipping name carries a doubled extension, and the frontmatter title stays exactly what the extractor returned', t => {
  const v = vault(t);
  clip(SKILL('one'), extractor(''));
  clip('https://example.org/docs/guide.md', extractor('Guide'));
  assert.ok(v.files().every((f) => !/\.md\.md$/i.test(f)), v.files().join(', '));
  assert.match(v.read('one-SKILL.md'), /^title: ""$/m, 'empty stays empty');
  assert.match(v.read('Guide.md'), /^title: "Guide"$/m);
});

test('existing clippings, a case variant of the title included, are never renamed or overwritten', t => {
  const v = vault(t);
  v.put('untitled.md', 'https://old.test/1');
  v.put('SKILL.md.md', 'https://old.test/2');
  v.put('Some Title.md', 'https://old.test/3', 'Some Title');
  const before = Object.fromEntries(v.files().map((f) => [f, v.read(f)]));
  const r = clip('https://new.test/docs/some-title', extractor('some title'));
  assert.equal(r.status, 'clipped');
  for (const [name, text] of Object.entries(before)) assert.equal(v.read(name), text, name);
  assert.ok(!v.files().some((f) => f.toLowerCase() === 'some title.md' && f !== 'Some Title.md'));
});

test('a name nobody can take is a clash: one open attention row naming the URL and the file, and nothing written', t => {
  const v = vault(t);
  const url = SKILL('one');
  clipSlugCandidates({ title: '', url }).forEach((name, i) => v.put(`${name}.md`, `https://other.test/${i}`));
  const before = v.files();
  const r = clip(url, extractor());
  assert.equal(r.status, 'clash');
  assert.deepEqual(v.files(), before, 'nothing written');
  const rows = v.issues();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'attention');
  assert.equal(rows[0].url, url);
  assert.match(rows[0].reason, /raw\/clippings\/one-SKILL\.md already exists and no alternative name could be written; nothing was written/);
});

test('a write that keeps losing to other sessions is a clash after five tries', t => {
  const v = vault(t);
  let calls = 0;
  const r = clip(SKILL('one'), extractor(), [], { writeClipping: () => { calls++; return false; } });
  assert.equal(r.status, 'clash');
  assert.equal(calls, 5);
  assert.equal(v.issues().length, 1);
  assert.deepEqual(v.files(), []);
});

test('a write that loses the race to a clip of the same URL is a duplicate and leaves one copy', t => {
  const v = vault(t);
  const url = SKILL('one');
  const r = clip(url, extractor(), [], { writeClipping: (dir, slug) => { writeFileSync(join(dir, `${slug}.md`), `---\ntitle: ""\nsource: ${JSON.stringify(url)}\n---\nwinner\n`); return false; } });
  assert.equal(r.status, 'duplicate');
  assert.deepEqual(v.files(), ['one-SKILL.md']);
  assert.match(v.read('one-SKILL.md'), /winner/);
  assert.deepEqual(v.issues(), []);
});

test('a write that loses the race to a different document moves on to the next name and leaves the winner alone', t => {
  const v = vault(t);
  let first = true;
  const r = clip(SKILL('one'), extractor(), [], { writeClipping: (dir, slug, text) => {
    if (first) { first = false; writeFileSync(join(dir, `${slug}.md`), '---\nsource: "https://other.test/x"\n---\nwinner\n'); return false; }
    writeFileSync(join(dir, `${slug}.md`), text, { flag: 'wx' }); return true;
  } });
  assert.equal(r.status, 'clipped');
  assert.match(v.read('one-SKILL.md'), /winner/);
  assert.equal(r.slug, 'skills-one-SKILL');
});

test('a title another clipping already holds is made unique by the URL part, in the title and in the file name; the old clipping is untouched', t => {
  const v = vault(t);
  v.put('Smith v. Jones.md', 'https://law.test/syllabus.html', 'Smith v. Jones');
  const before = v.read('Smith v. Jones.md');
  const r = clip('https://law.test/cases/93-1260.ZO.html', extractor('Smith v. Jones'));
  assert.equal(r.status, 'clipped');
  assert.equal(r.slug, 'Smith v. Jones (93-1260.ZO)');
  assert.match(v.read('Smith v. Jones (93-1260.ZO).md'), /^title: "Smith v\. Jones \(93-1260\.ZO\)"$/m);
  assert.equal(v.read('Smith v. Jones.md'), before);
});

test('--slug names a clipping, and a taken --slug is a clash that writes nothing and suffixes nothing', t => {
  const v = vault(t);
  const ok = clip(SKILL('one'), extractor(''), ['--slug=my-chosen-name']);
  assert.equal(ok.status, 'clipped');
  assert.deepEqual(v.files(), ['my-chosen-name.md']);
  const taken = clip(SKILL('two'), extractor(''), ['--slug=My-Chosen-Name']);
  assert.equal(taken.status, 'clash');
  assert.deepEqual(v.files(), ['my-chosen-name.md']);
  assert.equal(v.issues().length, 1);
  assert.match(v.issues()[0].reason, /raw\/clippings\/my-chosen-name\.md already exists/, 'names the file that is really there');
  assert.equal(taken.existing, 'my-chosen-name');
});

test('the default writer creates a file exactly once and never overwrites an existing one', t => {
  const v = vault(t);
  assert.equal(writeClippingExclusive(v.dir, 'Name', 'first'), true);
  assert.equal(writeClippingExclusive(v.dir, 'Name', 'second'), false);
  assert.equal(v.read('Name.md'), 'first');
});

// ------------------------------------------- --title and --slug on the document clippers --
test('titleFromArgs takes --title, and an empty or missing one keeps the fallback', () => {
  assert.equal(titleFromArgs(['a.pdf', '--title=A Paper Title'], 'valve'), 'A Paper Title');
  assert.equal(titleFromArgs(['a.pdf', '--title=  '], 'valve'), 'valve');
  assert.equal(titleFromArgs(['a.pdf'], 'valve'), 'valve');
});

test('chooseDocumentSlug without --slug disambiguates by content hash exactly as before', t => {
  const v = vault(t);
  const free = chooseDocumentSlug({ vaultPath: v.root, argv: ['a.pdf'], title: 'Valve', hash: 'abcdef1234', taken: new Set(), source: 'a.pdf' });
  assert.deepEqual(free, { slug: 'Valve' });
  const clash = chooseDocumentSlug({ vaultPath: v.root, argv: ['a.pdf'], title: 'Valve', hash: 'abcdef1234', taken: new Set(['valve']), source: 'a.pdf' });
  assert.deepEqual(clash, { slug: 'Valve-abcdef1' });
  assert.deepEqual(v.issues(), []);
});

test('chooseDocumentSlug with --slug uses that exact name, and a taken one is a recorded clash that suffixes nothing', t => {
  const v = vault(t);
  assert.deepEqual(chooseDocumentSlug({ vaultPath: v.root, argv: ['a.pdf', '--slug=valve-paper'], title: 'Valve', hash: 'abc', taken: new Set(), source: 'a.pdf' }), { slug: 'valve-paper' });
  const r = quiet(() => chooseDocumentSlug({ vaultPath: v.root, argv: ['a.pdf', '--slug=Valve-Paper'], title: 'Valve', hash: 'abc', taken: new Set(['valve-paper']), source: 'a.pdf', topic: 'T' }));
  assert.deepEqual(r, { clash: true, existing: 'Valve-Paper' });
  const rows = v.issues();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'attention');
  assert.match(rows[0].reason, /raw\/clippings\/Valve-Paper\.md already exists/);
});

test('an empty --slug= is ignored on the document clippers and on clip.mjs', t => {
  const v = vault(t);
  assert.deepEqual(chooseDocumentSlug({ vaultPath: v.root, argv: ['a.pdf', '--slug='], title: 'Valve', hash: 'abc', taken: new Set(), source: 'a.pdf' }), { slug: 'Valve' });
  const r = clip(SKILL('one'), extractor(''), ['--slug=']);
  assert.equal(r.status, 'clipped');
  assert.deepEqual(v.files(), ['one-SKILL.md']);
});
