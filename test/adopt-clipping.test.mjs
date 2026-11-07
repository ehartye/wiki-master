import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { main } from '../scripts/clip.mjs';
import { clippingHash } from '../scripts/lib/clipping-hash.mjs';

// Hand-clipped files joining the pipeline. A stamp is only worth having when it is the hash a clipper computes for the same
// text: recapture, re-clip and dedupe all join on it. So most tests close the loop through a real recapture.

const SCRIPTS = fileURLToPath(new URL('../scripts/', import.meta.url));
const URL_A = 'https://docs.example.test/guide/hand';
const sentence = (s) => `${s} is described here in enough plain words that the page counts as real content. `;
const text = (s) => sentence(s).repeat(30);
const sha = (s) => createHash('sha256').update(s).digest('hex');
const page = (body) => () => ({ title: 'Hand guide', contentMarkdown: body });

function vault(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-adopt-'));
  const dir = join(root, 'raw', 'clippings');
  mkdirSync(dir, { recursive: true });
  const prior = process.env.WIKI_MASTER_VAULT;
  process.env.WIKI_MASTER_VAULT = root;
  t.after(() => { if (prior === undefined) delete process.env.WIKI_MASTER_VAULT; else process.env.WIKI_MASTER_VAULT = prior; rmSync(root, { recursive: true, force: true }); });
  return { root, dir, path: (name) => join(dir, name), read: (name) => readFileSync(join(dir, name), 'utf8') };
}

// What a web clipper's Markdown export looks like: no source-hash, quality or topic.
const handClip = (body, source = URL_A) => `---\ntitle: "Hand guide"\nsource: ${JSON.stringify(source)}\ncreated: 2026-10-01\ntags:\n  - clippings\n---\n\n${body}\n`;

function script(name, args, root) {
  const r = spawnSync(process.execPath, [join(SCRIPTS, name), ...args], { env: { ...process.env, WIKI_MASTER_VAULT: root }, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function recapture(extract) {
  const lines = [];
  const log = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try { return { result: main([URL_A, '--recapture'], { extract, today: () => '2026-10-29' }), lines }; }
  finally { console.log = log; }
}

// ---------------------------------------------------------------- the mismatch this work package starts from
test('a clipping stamped by repair-missing-hash is unchanged on recapture with identical text', (t) => {
  const v = vault(t);
  writeFileSync(v.path('Hand guide.md'), handClip(text('Hand')));
  const r = script('repair-missing-hash.mjs', ['--apply'], v.root);
  assert.equal(r.code, 0, r.err);
  assert.match(v.read('Hand guide.md'), new RegExp(`^source-hash: ${sha(text('Hand'))}$`, 'm'));
  assert.equal(recapture(page(text('Hand'))).result.status, 'unchanged');
});

test('the helper returns the hash a clipper stored for the file it wrote', (t) => {
  const v = vault(t);
  const written = main([URL_A], { extract: page(text('Clipped')), today: () => '2026-10-01' });
  assert.equal(written.status, 'clipped');
  const stored = v.read(`${written.slug}.md`);
  assert.equal(clippingHash(stored), stored.match(/^source-hash: (.*)$/m)[1]);
});

// ---------------------------------------------------------------- adopt-clipping.mjs
test('a dry run changes nothing; --apply stamps the three fields, keeps the body byte-identical and a second run changes nothing', (t) => {
  const v = vault(t);
  const original = handClip(text('Hand'));
  const bystander = handClip(text('Other'), 'https://docs.example.test/guide/other');
  writeFileSync(v.path('Hand guide.md'), original);
  writeFileSync(v.path('Other.md'), bystander);
  const args = [v.path('Hand guide.md'), '--topic=Field notes', '--quality=high'];

  const dry = script('adopt-clipping.mjs', args, v.root);
  assert.equal(dry.code, 0, dry.err);
  assert.equal(v.read('Hand guide.md'), original, 'a dry run writes nothing');
  assert.match(dry.out, /"applied":false/);

  const applied = script('adopt-clipping.mjs', [...args, '--apply'], v.root);
  assert.equal(applied.code, 0, applied.err);
  const stamped = v.read('Hand guide.md');
  assert.match(stamped, /^quality: high$/m);
  assert.match(stamped, /^topic: "Field notes"$/m);
  assert.match(stamped, new RegExp(`^source-hash: ${sha(text('Hand'))}$`, 'm'));
  assert.equal(stamped.slice(stamped.indexOf('\n---\n') + 5), original.slice(original.indexOf('\n---\n') + 5), 'the body is untouched');
  assert.equal(v.read('Other.md'), bystander, 'a file that was not named is untouched');

  const again = script('adopt-clipping.mjs', [...args, '--apply'], v.root);
  assert.equal(again.code, 0, again.err);
  assert.equal(v.read('Hand guide.md'), stamped);
  assert.equal(recapture(page(text('Hand'))).result.status, 'unchanged');
});

test('a path outside raw/clippings, a file with no frontmatter or no source, and a missing quality are refused, and nothing is written', (t) => {
  const v = vault(t);
  mkdirSync(join(v.root, 'wiki'), { recursive: true });
  const good = handClip(text('Hand'));
  writeFileSync(v.path('Good.md'), good);
  writeFileSync(join(v.root, 'raw', 'Elsewhere.md'), handClip(text('Elsewhere')));
  writeFileSync(join(v.root, 'wiki', 'Page.md'), handClip(text('Page')));
  writeFileSync(v.path('Bare.md'), `${text('No frontmatter')}\n`);
  writeFileSync(v.path('Nosource.md'), `---\ntitle: "No source"\ncreated: 2026-10-01\n---\n\n${text('No source')}\n`);
  const refused = [
    [join(v.root, 'raw', 'Elsewhere.md'), /raw\/clippings/],
    [join(v.root, 'wiki', 'Page.md'), /raw\/clippings/],
    [join(v.dir, '..', 'Elsewhere.md'), /raw\/clippings/],
    [v.path('Bare.md'), /frontmatter/],
    [v.path('Nosource.md'), /source/],
    [v.path('Missing.md'), /no such file/],
  ];
  for (const [path, why] of refused) {
    const r = script('adopt-clipping.mjs', [v.path('Good.md'), path, '--quality=high', '--apply'], v.root);
    assert.equal(r.code, 2, `${path}: ${r.out}${r.err}`);
    assert.match(r.err, why, path);
    assert.equal(v.read('Good.md'), good, `${path}: the valid file is left alone when another is refused`);
  }
  const noQuality = script('adopt-clipping.mjs', [v.path('Good.md'), '--apply'], v.root);
  assert.equal(noQuality.code, 2);
  assert.match(noQuality.err, /--quality/);
  assert.equal(v.read('Good.md'), good);
});

test('an existing value that differs is reported as a conflict and left alone; the fields that are absent are still filled', (t) => {
  const v = vault(t);
  const body = text('Hand');
  writeFileSync(v.path('Held.md'), handClip(body).replace('tags:', 'quality: low\ntopic: "Old topic"\nsource-hash: 0123abcd\ntags:'));
  const r = script('adopt-clipping.mjs', [v.path('Held.md'), '--quality=high', '--topic=New topic', '--apply'], v.root);
  assert.equal(r.code, 0, r.err);
  const after = v.read('Held.md');
  assert.match(after, /^quality: low$/m);
  assert.match(after, /^topic: "Old topic"$/m);
  assert.match(after, /^source-hash: 0123abcd$/m);
  assert.deepEqual(JSON.parse(r.out.split('\n')[0]).files[0].conflicts.map((c) => c.field).sort(), ['quality', 'source-hash', 'topic']);

  writeFileSync(v.path('Partial.md'), handClip(body, 'https://docs.example.test/guide/partial').replace('tags:', 'quality: medium\ntags:'));
  const partial = script('adopt-clipping.mjs', [v.path('Partial.md'), '--topic=Field notes', '--apply'], v.root);
  assert.equal(partial.code, 0, partial.err);
  assert.match(v.read('Partial.md'), /^quality: medium$/m);
  assert.match(v.read('Partial.md'), /^topic: "Field notes"$/m);
  assert.match(v.read('Partial.md'), new RegExp(`^source-hash: ${sha(body)}$`, 'm'));
});

// ---------------------------------------------------------------- frontmatter shapes a web clipper and a hand edit produce
const crlf = (s) => s.replace(/\r?\n/g, '\r\n');
const keyLines = (file, key) => file.split(/\r?\n/).filter((l) => l.startsWith(`${key}:`));
const adopt = (v, name, extra = []) => script('adopt-clipping.mjs', [v.path(name), '--topic=Field notes', '--quality=high', ...extra, '--apply'], v.root);
const firstReport = (r) => JSON.parse(r.out.split('\n')[0]).files[0];

for (const [shape, eol] of [['LF', (s) => s], ['CRLF', crlf]]) {
  for (const empty of ['topic:', 'quality:', 'quality: ""', "topic: ''", 'topic: ""', "quality: ''"]) {
    test(`${shape}: an empty "${empty}" line is filled in place, once, and a second run changes nothing byte for byte`, (t) => {
      const v = vault(t);
      writeFileSync(v.path('Hand guide.md'), eol(handClip(text('Hand')).replace('tags:', `${empty}\ntags:`)));
      const first = adopt(v, 'Hand guide.md');
      assert.equal(first.code, 0, first.err);
      const stamped = v.read('Hand guide.md');
      assert.deepEqual(keyLines(stamped, 'topic').map((l) => l.trimEnd()), ['topic: "Field notes"']);
      assert.deepEqual(keyLines(stamped, 'quality').map((l) => l.trimEnd()), ['quality: high']);
      assert.equal(keyLines(stamped, 'source-hash').length, 1);
      assert.deepEqual(firstReport(first).conflicts, [], 'an empty value is no conflict');
      if (shape === 'CRLF') assert.ok(!/[^\r]\n/.test(stamped.slice(0, stamped.indexOf('\n---', 4) + 5)), 'the frontmatter keeps its CRLF line breaks');
      const second = adopt(v, 'Hand guide.md');
      assert.equal(second.code, 0, second.err);
      assert.equal(firstReport(second).status, 'unchanged');
      assert.equal(v.read('Hand guide.md'), stamped, 'a second run writes nothing');
    });
  }
}

test('an empty quality with no --quality is refused rather than stamped empty', (t) => {
  const v = vault(t);
  for (const empty of ['quality:', 'quality: ""', "quality: ''"]) {
    const original = handClip(text('Hand')).replace('tags:', `${empty}\ntags:`);
    writeFileSync(v.path('Empty.md'), original);
    const r = script('adopt-clipping.mjs', [v.path('Empty.md'), '--apply'], v.root);
    assert.equal(r.code, 2, `${empty}: ${r.out}${r.err}`);
    assert.match(r.err, /--quality/);
    assert.equal(v.read('Empty.md'), original, empty);
  }
});

test('a file an older run left with an empty and a filled copy of a key reads the filled one and adds nothing', (t) => {
  const v = vault(t);
  writeFileSync(v.path('Twice.md'), handClip(text('Hand')).replace('tags:', 'topic:\nquality:\ntopic: "Field notes"\nquality: high\ntags:'));
  const r = adopt(v, 'Twice.md');
  assert.equal(r.code, 0, r.err);
  const after = v.read('Twice.md');
  assert.equal(keyLines(after, 'topic').length, 2);
  assert.equal(keyLines(after, 'quality').length, 2);
  assert.deepEqual(firstReport(r).conflicts, []);
  assert.equal(adopt(v, 'Twice.md').err, '');
  assert.equal(v.read('Twice.md'), after);
});

test('CRLF: the stamp is the hash of the CRLF body, and the body bytes are untouched', (t) => {
  const v = vault(t);
  const lf = `${text('Hand')}

A second paragraph.`;
  const original = crlf(handClip(lf));
  writeFileSync(v.path('Crlf.md'), original);
  assert.equal(adopt(v, 'Crlf.md').code, 0);
  const after = v.read('Crlf.md');
  const body = (s) => s.slice(s.indexOf('\r\n---\r\n') + 7);
  assert.equal(body(after), body(original));
  assert.equal(after.match(/^source-hash: (.*?)\r?$/m)[1], clippingHash(original));
  assert.notEqual(clippingHash(original), sha(lf), 'the CRLF body hashes differently from an LF recapture, as decision 10 has it');
});

test('a file that starts with a byte-order mark is refused for that reason, and nothing is written', (t) => {
  const v = vault(t);
  const original = String.fromCharCode(0xFEFF) + handClip(text('Hand'));
  writeFileSync(v.path('Bom.md'), original);
  const r = script('adopt-clipping.mjs', [v.path('Bom.md'), '--quality=high', '--apply'], v.root);
  assert.equal(r.code, 2, r.out);
  assert.match(r.err, /byte-order mark/);
  assert.doesNotMatch(r.err, /no frontmatter/);
  assert.equal(v.read('Bom.md'), original);
});

test('an empty source is refused as having no source', (t) => {
  const v = vault(t);
  for (const empty of ['source:', 'source: ""', "source: ''"]) {
    const original = handClip(text('Hand')).replace(/^source: .*$/m, empty);
    writeFileSync(v.path('Nosource.md'), original);
    const r = script('adopt-clipping.mjs', [v.path('Nosource.md'), '--quality=high', '--apply'], v.root);
    assert.equal(r.code, 2, `${empty}: ${r.out}${r.err}`);
    assert.match(r.err, /no source/);
    assert.equal(v.read('Nosource.md'), original);
  }
});

test('a path named twice, spelled two ways, is planned and reported once', (t) => {
  const v = vault(t);
  mkdirSync(join(v.dir, 'sub'), { recursive: true });
  writeFileSync(v.path('Hand guide.md'), handClip(text('Hand')));
  const r = script('adopt-clipping.mjs', [v.path('Hand guide.md'), join(v.dir, 'sub', '..', 'Hand guide.md'), '--quality=high', '--apply'], v.root);
  assert.equal(r.code, 0, r.err);
  const report = JSON.parse(r.out.split('\n')[0]);
  assert.equal(report.files.length, 1);
  assert.equal(report.files[0].status, 'adopted');
  assert.equal(keyLines(v.read('Hand guide.md'), 'source-hash').length, 1);
});

test('a "---" in the body, quoted values, a tags list and a file in a nested directory are all handled', (t) => {
  const v = vault(t);
  mkdirSync(join(v.dir, 'nested', 'deeper'), { recursive: true });
  const body = `${text('Hand')}\n---\n\nA section after a rule.\n\n---\nkey: value\n---\n`;
  const original = `---\ntitle: "Hand: \\"quoted\\" guide"\nsource: 'https://docs.example.test/guide/hand'\ncreated: 2026-10-01\ntags:\n  - clippings\n  - "second tag"\nquality: 'low'\n---\n\n${body}\n`;
  const file = join('nested', 'deeper', 'Hand guide.md');
  writeFileSync(v.path(file), original);
  const r = script('adopt-clipping.mjs', [v.path(file), '--quality=low', '--topic=Field notes', '--apply'], v.root);
  assert.equal(r.code, 0, r.err);
  const after = v.read(file);
  assert.equal(after.slice(after.indexOf('\n---\n\n') + 5), original.slice(original.indexOf('\n---\n\n') + 5), 'the body, rules included, is untouched');
  assert.match(after, /^title: "Hand: \\"quoted\\" guide"$/m);
  assert.match(after, /^tags:\n {2}- clippings\n {2}- "second tag"\nquality: 'low'\n/m, 'the tags list and the quoted quality stay as they were');
  assert.deepEqual(keyLines(after, 'quality'), ["quality: 'low'"]);
  assert.match(after, /^topic: "Field notes"$/m);
  assert.match(after, new RegExp(`^source-hash: ${sha(`${body}\n`.slice(0, -1))}$`, 'm'));
  assert.deepEqual(firstReport(r).conflicts, [], "'low' equals low");
});

test('--help says a file saved with CRLF line breaks is stamped with the hash of its CRLF body', (t) => {
  const v = vault(t);
  const r = script('adopt-clipping.mjs', ['--help'], v.root);
  assert.match(`${r.out}${r.err}`, /CRLF/);
});
