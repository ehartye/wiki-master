/** @lane merge
 * @subject scripts/lib/clip-args.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CLIP_SPECS } from '../scripts/lib/clip-args.mjs';
import { makePdf } from './fixtures/make-pdf.mjs';

// `--quality=official` used to be written into the clipping's frontmatter: the value was split off the option and never
// checked. The command-line guard of every clipper now refuses a value other than high, medium or low, with exit 2 and
// nothing written. These run the real scripts in a child process against a temp vault; the refusals happen before any
// network or vault activity, and the accepted values clip a supplied page, so nothing is fetched.

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const URL_A = 'https://docs.example.test/a';
const refusal = (name, value) => `${name}: --quality must be high, medium or low (got "${value}")`;

function vault(t) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'wm-quality-'));
  mkdirSync(join(root, 'raw', 'clippings'), { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return {
    root,
    clippings: () => readdirSync(join(root, 'raw', 'clippings')),
    hasState: () => existsSync(join(root, '.wiki-master')),
    run: (script, args) => spawnSync(process.execPath, [join(SCRIPTS, script), ...args], {
      encoding: 'utf8', timeout: 30000, env: { ...process.env, WIKI_MASTER_VAULT: root },
    }),
  };
}

// The guard prints the problem, then the usage, to stderr.
function assertRefused(r, v, spec, value) {
  assert.equal(r.status, 2, r.stderr);
  const lines = r.stderr.replace(/\r\n/g, '\n').trimEnd().split('\n');
  assert.equal(lines[0], refusal(spec.name, value));
  assert.deepEqual(lines.slice(1), spec.usage, 'the usage follows the problem, unchanged');
  assert.equal(r.stdout, '');
  assert.deepEqual(v.clippings(), [], 'nothing is written to raw/clippings');
  assert.equal(v.hasState(), false, 'no .wiki-master folder is created');
}

test('clip.mjs refuses --quality=official, an empty value and High with exit 2, the message and the usage', (t) => {
  for (const value of ['official', '', 'High']) {
    const v = vault(t);
    const r = v.run('clip.mjs', [URL_A, `--quality=${value}`]);
    assertRefused(r, v, CLIP_SPECS.clip, value);
  }
});

test('clip.mjs still clips with high, medium and low', (t) => {
  const page = `# A supplied page\n\n${'This page is described here in enough plain words that it counts as real content. '.repeat(20)}\n`;
  for (const value of ['high', 'medium', 'low']) {
    const v = vault(t);
    const file = join(v.root, 'page.md');
    writeFileSync(file, page);
    const r = v.run('clip.mjs', [URL_A, `--quality=${value}`, '--from-file', file]);
    assert.equal(r.status, 0, r.stderr);
    const written = v.clippings();
    assert.equal(written.length, 1, `${value}: ${written.join(', ')}`);
    assert.match(readFileSync(join(v.root, 'raw', 'clippings', written[0]), 'utf8'), new RegExp(`^quality: ${value}$`, 'm'));
  }
});

// A missing input file also exits 2, so these supply a real file and assert the message, not the exit code alone.
test('clip-pdf.mjs refuses --quality=official on a real PDF before reading it', (t) => {
  const v = vault(t);
  const pdf = join(v.root, 'small.pdf');
  makePdf([[{ x: 72, y: 700, text: 'A small document with a few plain words on its only page.' }]], pdf);
  const r = v.run('clip-pdf.mjs', [pdf, '--quality=official']);
  assertRefused(r, v, CLIP_SPECS['clip-pdf'], 'official');
});

test('clip-docx.mjs refuses --quality=official on a minimal DOCX before reading it', (t) => {
  const v = vault(t);
  const docx = join(v.root, 'small.docx');
  writeFileSync(docx, minimalDocx('A small document with a few plain words in its only paragraph.'));
  const r = v.run('clip-docx.mjs', [docx, '--quality=official']);
  assertRefused(r, v, CLIP_SPECS['clip-docx'], 'official');
});

// ---------------------------------------------------------------- a minimal DOCX, built at test time

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

// A stored (uncompressed) ZIP with the three parts a word processor needs to open a one-paragraph document.
function minimalDocx(paragraph) {
  const parts = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${paragraph}</w:t></w:r></w:p></w:body></w:document>`,
  };
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(parts)) {
    const nameBuf = Buffer.from(name, 'utf8'), data = Buffer.from(text, 'utf8'), crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(parts).length, 8); end.writeUInt16LE(Object.keys(parts).length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
