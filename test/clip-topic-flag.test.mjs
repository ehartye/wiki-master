// --topic parity across the clip scripts.
//
// clip.mjs has carried --topic since topic attribution landed; the binary-path
// clippers (pdf/docx/xlsx) never did. The consequence is not cosmetic: a
// research run that clips PDFs produces clippings with no `topic:` frontmatter,
// so /wiki-triage files every one of them under Unattributed forever. Topic is
// only ever recorded going forward, so an unattributed clipping cannot be
// retro-fitted by any tool -- the attribution is lost at clip time or never.
//
// One real run measured the cost: 16 of 41 clippings (39%) landed unattributable
// because they came in through clip-pdf.
//
// These tests pin the contract that the frontmatter carrier and the flag parsing
// behave identically to clip.mjs across every clipper.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pdfClipContent } from '../scripts/clip-pdf.mjs';
import { docxClipContent } from '../scripts/clip-docx.mjs';
import { xlsxClipContent } from '../scripts/clip-xlsx.mjs';
import { parseTopicArg } from '../scripts/lib/topic.mjs';

const BUILDERS = [
  ['pdfClipContent', pdfClipContent],
  ['docxClipContent', docxClipContent],
  ['xlsxClipContent', xlsxClipContent],
];

for (const [name, build] of BUILDERS) {
  test(`${name} writes topic: frontmatter when a topic is given`, () => {
    const { body } = build({
      title: 'A Paper', source: 'https://example.edu/p.pdf', text: 'Body text here, long enough.',
      quality: 'high', created: '2026-08-20', topic: 'excellence and efficacy in educational video games',
    });
    assert.match(body, /^topic: "excellence and efficacy in educational video games"$/m);
  });

  test(`${name} omits topic: entirely when no topic is given`, () => {
    const { body } = build({
      title: 'A Paper', source: 'https://example.edu/p.pdf', text: 'Body text here, long enough.',
      quality: 'high', created: '2026-08-20',
    });
    assert.doesNotMatch(body, /^topic:/m);
  });

  // An absent topic and an empty one must not be two different states -- the
  // same rule clip.mjs's buildFrontmatter already enforces.
  test(`${name} treats a blank or whitespace-only topic as absent`, () => {
    for (const topic of ['', '   ', '\t\n']) {
      const { body } = build({
        title: 'A Paper', source: 'https://example.edu/p.pdf', text: 'Body text here, long enough.',
        created: '2026-08-20', topic,
      });
      assert.doesNotMatch(body, /^topic:/m, `blank topic ${JSON.stringify(topic)} must not emit a key`);
    }
  });

  test(`${name} normalizes interior whitespace so one run is one triage group`, () => {
    const { body } = build({
      title: 'A Paper', source: 'https://example.edu/p.pdf', text: 'Body text here, long enough.',
      created: '2026-08-20', topic: '  BPD   research  ',
    });
    assert.match(body, /^topic: "BPD research"$/m);
  });
}

// Flag parsing is shared so a topic can never be parsed one way for HTML and
// another way for PDFs. The `=`-rejoin matters: research topics contain them
// ("cost=benefit framing"), and split('=')[1] would silently truncate.
test('parseTopicArg reads --topic= and rejoins embedded equals signs', () => {
  assert.equal(parseTopicArg(['--topic=math progressions']), 'math progressions');
  assert.equal(parseTopicArg(['x.pdf', '--quality=high', '--topic=cost=benefit framing']),
    'cost=benefit framing');
});

test('parseTopicArg returns null when the flag is absent, empty, or blank', () => {
  assert.equal(parseTopicArg([]), null);
  assert.equal(parseTopicArg(['x.pdf', '--quality=high']), null);
  assert.equal(parseTopicArg(['--topic=']), null);
  assert.equal(parseTopicArg(['--topic=   ']), null);
});

test('parseTopicArg normalizes exactly as normalizeTopic does', () => {
  assert.equal(parseTopicArg(['--topic=  spaced   out  ']), 'spaced out');
});

// Guards the regression that motivated this change: the usage text is the only
// place a human learns the flag exists.
test('every clipper advertises --topic in its usage text', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const root = fileURLToPath(new URL('../scripts/', import.meta.url));
  for (const f of ['clip-pdf.mjs', 'clip-docx.mjs', 'clip-xlsx.mjs', 'clip.mjs']) {
    const src = readFileSync(root + f, 'utf8');
    // The help block is the console.error run around the `usage:` line -- the
    // flag list wraps onto continuation lines, so a single-line grep would miss
    // a flag that is genuinely documented.
    const help = src.split('\n').filter((l) => l.includes('console.error(')).join('\n');
    assert.match(help, /usage: clip/, `${f} has no usage line`);
    assert.match(help, /--topic/, `${f} help text must advertise --topic`);
  }
});
