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
