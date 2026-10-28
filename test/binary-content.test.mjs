import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { looksBinaryBytes, looksBinaryText } from '../scripts/lib/binary-content.mjs';
import { shouldExcludePath, partitionRepoFiles } from '../scripts/clip-gh.mjs';
import { scanClippings } from '../scripts/triage.mjs';

// A GitHub capture used to write any file as text. A model, a sprite or a font read as UTF-8 became a clipping full of NUL
// bytes and replacement characters under `quality: high`, and 35 of them reached one vault. Measured over its 6,788
// clippings: 37 held a NUL byte, 35 of them under gh/ (27 .glb, 7 .fbx, 1 .aseprite) and two PDF text layers; every other
// clipping with 0.5% replacement characters or more was a PDF already marked degraded, and none was a source file.

const GLB = Buffer.concat([Buffer.from('glTF'), Buffer.from([2, 0, 0, 0, 0x7c, 0x1a, 0, 0]), Buffer.from('{"asset":{"version":"2.0"}}'), Buffer.alloc(200, 0), Buffer.from('BIN\0')]);

test('a binary file read as bytes is binary: a NUL byte, or 2% replacement characters', () => {
  assert.equal(looksBinaryBytes(GLB), true);
  assert.equal(looksBinaryBytes(Buffer.from('plain text\0with one NUL')), true);
  const garbled = Buffer.from('ok '.repeat(20) + '\uFFFD'.repeat(10), 'utf8');
  assert.equal(looksBinaryBytes(garbled), true, 'about 14% replacement characters');
});

test('text is not binary, whatever it contains', () => {
  assert.equal(looksBinaryBytes(Buffer.from('')), false);
  assert.equal(looksBinaryBytes(Buffer.from('Ordinary prose with accents é ü and 中文 text, and emoji 🙂.\n'.repeat(50))), false);
  assert.equal(looksBinaryBytes(Buffer.from('export function add(a, b) {\n  return a + b;\n}\n'.repeat(40))), false);
  assert.equal(looksBinaryBytes(Buffer.from('{"asset":{"version":"2.0"},"scenes":[{"nodes":[0]}],"nodes":[{"mesh":0}]}')), false, 'a glTF description in JSON is text');
  const oneStray = Buffer.from('a'.repeat(5000) + '\uFFFD' + 'b'.repeat(5000), 'utf8');
  assert.equal(looksBinaryBytes(oneStray), false, 'one replacement character in ten thousand is not a binary file');
});

test('the same judgment on a string already decoded', () => {
  assert.equal(looksBinaryText('glTF\0\0\0'), true);
  assert.equal(looksBinaryText('ok '.repeat(20) + '\uFFFD'.repeat(10)), true);
  assert.equal(looksBinaryText('plain text'), false);
  assert.equal(looksBinaryText(''), false);
});

test('binary extensions the exclusion list missed are excluded', () => {
  for (const name of ['model.glb', 'rig.fbx', 'sprite.aseprite', 'sprite.ase', 'layers.psd', 'voice.ogg', 'DIR/Model.GLB']) {
    assert.equal(shouldExcludePath(name).excluded, true, name);
  }
  for (const name of ['scene.gltf', 'data.json', 'README.md', 'main.js', 'mesh.obj', 'notes.txt', 'shader.glsl']) {
    assert.equal(shouldExcludePath(name).excluded, false, name);
  }
});

test('partitionRepoFiles excludes a binary by content even when its extension looks like text', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'wm-partition-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (rel, data) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), data); };
  put('src/main.js', 'export const answer = 42;\n'.repeat(20));
  put('docs/readme.txt', 'Plain text documentation.\n'.repeat(20));
  put('assets/mystery.dat', GLB);
  put('assets/renamed.txt', GLB);
  put('assets/model.glb', GLB);
  const { included, excluded } = partitionRepoFiles(root, ['src/main.js', 'docs/readme.txt', 'assets/mystery.dat', 'assets/renamed.txt', 'assets/model.glb']);
  assert.deepEqual(included.sort(), ['docs/readme.txt', 'src/main.js']);
  const byPath = Object.fromEntries(excluded.map((e) => [e.relPath, e.reason]));
  assert.match(byPath['assets/model.glb'], /extension/);
  assert.match(byPath['assets/mystery.dat'], /binary content/);
  assert.match(byPath['assets/renamed.txt'], /binary content/);
});

function vault(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'wm-binary-triage-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, 'raw', 'clippings', rel)), { recursive: true });
    writeFileSync(join(root, 'raw', 'clippings', rel), text);
  }
  return root;
}
const clipping = (source, body, extra = '') => `---\ntitle: "T"\nsource: "${source}"\nquality: high\n${extra}source-hash: abc1234\n---\n\n${body}\n`;

test('triage lists a GitHub capture that holds a binary file as text, naming its path', (t) => {
  const root = vault(t, {
    'gh/owner/repo/models-bird.glb.md': clipping('https://github.com/owner/repo/blob/main/models/bird.glb', '```\nglTF\0\0\0\0binary\n```'),
    'gh/owner/repo/src-main.js.md': clipping('https://github.com/owner/repo/blob/main/src/main.js', '```js\nexport const answer = 42;\n```'),
  });
  const { flagged } = scanClippings(root);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].kind, 'fidelity');
  assert.match(flagged[0].reason, /binary content/);
  assert.equal(flagged[0].title, 'gh/owner/repo/models-bird.glb');
});

test('a NUL in a clipping that is not a GitHub capture is left to the grade it already has', (t) => {
  const root = vault(t, {
    'paper.md': clipping('C:/x/paper.pdf', 'text layer with a stray \0 byte in it', 'fidelity: degraded\n'),
    'gh/o/r/a.md': clipping('https://github.com/o/r/blob/main/a.glb', 'glTF\0', 'fidelity: degraded\n'),
  });
  const { flagged } = scanClippings(root);
  assert.equal(flagged.length, 2, 'one row each, not two for the capture that is both degraded and binary');
  const reason = (title) => flagged.find((f) => f.title === title)?.reason;
  assert.equal(reason('paper'), 'fidelity: degraded', 'a PDF text layer keeps the grade it carries');
  assert.match(reason('gh/o/r/a'), /binary content/, 'the capture is named for what it is');
});
