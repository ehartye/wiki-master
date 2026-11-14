/** @lane merge
 * @subject scripts/lib/local-date.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { localDate } from '../scripts/lib/local-date.mjs';
import { recordDecline, supersedeDecline, readDeclineLog } from '../scripts/lib/decline.mjs';
import { pdfClipContent } from '../scripts/clip-pdf.mjs';
import { docxClipContent } from '../scripts/clip-docx.mjs';
import { pptxClipContent } from '../scripts/clip-pptx.mjs';
import { xlsxClipContent } from '../scripts/clip-xlsx.mjs';
import { fileClipContent } from '../scripts/clip-gh.mjs';
import { confluenceClipContent } from '../scripts/clip-confluence.mjs';
import { captureSelection } from '../scripts/lib/github-selection.mjs';
import { renderFigures } from '../scripts/lib/pdf-figures.mjs';

// A clipping's `created` date, the recapture suffix built from it and a decline's date are the machine's local day, not
// the UTC day: an evening clip in New York used to be stamped tomorrow. The zone is set through TZ, in this process for
// the library cases and in the environment of a child for the command-line cases (never a shell prefix, which Git Bash
// on Windows may ignore); the child's clock is fixed by the test/helpers/freeze-clock.mjs preload. Only the zones and
// instants named here are shown.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PRELOAD = pathToFileURL(join(ROOT, 'test', 'helpers', 'freeze-clock.mjs')).href;
const URL_A = 'https://docs.example.test/guide/setup';
const NY = 'America/New_York', AKL = 'Pacific/Auckland';
const EVENING_NY = '2026-11-07T01:48:00Z'; // 20:48 EST on November 6; 14:48 NZDT on November 7
const words = (s) => `${s} is described here in enough plain words that the page counts as real content. `.repeat(20);
const field = (md, name) => (md.match(new RegExp(`^${name}: (.*)$`, 'm')) || [])[1];

// Sets TZ in this process for one test; when the test ends TZ is what it was before this file ran, however many zones
// the test went through.
const ORIGINAL_TZ = process.env.TZ;
const restoreTz = () => { if (ORIGINAL_TZ === undefined) delete process.env.TZ; else process.env.TZ = ORIGINAL_TZ; };
function zone(t, tz) {
  process.env.TZ = tz;
  t.after(restoreTz);
}

function vault(t) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'wm-local-date-'));
  mkdirSync(join(root, 'raw', 'clippings'), { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, 'raw', 'clippings');
  return {
    root,
    files: () => readdirSync(dir).sort(),
    read: (name) => readFileSync(join(dir, name), 'utf8'),
    page: (name, text) => { const p = join(root, name); writeFileSync(p, text); return p; },
    // clip.mjs in a child, at the instant `now`, in the zone `tz`.
    clip: (args, { tz, now }) => spawnSync(process.execPath, ['--import', PRELOAD, join(ROOT, 'scripts', 'clip.mjs'), ...args], {
      encoding: 'utf8', timeout: 60000, env: { ...process.env, TZ: tz, WM_FREEZE_NOW: now, WIKI_MASTER_VAULT: root },
    }),
  };
}
const ok = (r) => assert.equal(r.status, 0, `exit ${r.status}\n${r.stdout}\n${r.stderr}`);

// ---------------------------------------------------------------- localDate, in this process
test('localDate gives the local day in the zone TZ names, not the UTC day', (t) => {
  const cases = [
    [NY, EVENING_NY, '2026-11-06'],
    [AKL, EVENING_NY, '2026-11-07'],
    ['UTC', EVENING_NY, '2026-11-07'],
    // Daylight saving ends in New York on 2026-11-01 at 06:00Z: 23:30 EDT, then 23:30 EST.
    [NY, '2026-11-01T03:30:00Z', '2026-10-31'],
    [NY, '2026-11-02T04:30:00Z', '2026-11-01'],
    // Month and day are two digits.
    ['UTC', '2026-01-05T12:00:00Z', '2026-01-05'],
  ];
  for (const [tz, instant, day] of cases) {
    zone(t, tz);
    assert.equal(localDate(new Date(instant)), day, `${instant} in ${tz}`);
  }
});

test('localDate with no argument reads the clock when it is called', (t) => {
  zone(t, NY);
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(EVENING_NY) });
  assert.equal(localDate(), '2026-11-06');
  t.mock.timers.setTime(Date.parse('2026-11-07T12:00:00Z'));
  assert.equal(localDate(), '2026-11-07');
});

test('the document and repository clippers stamp the local day by default', (t) => {
  zone(t, NY);
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(EVENING_NY) });
  const text = words('This document');
  const built = {
    pdf: pdfClipContent({ title: 'A', source: 'https://docs.example.test/a.pdf', text }),
    docx: docxClipContent({ title: 'A', source: 'https://docs.example.test/a.docx', text }),
    pptx: pptxClipContent({ title: 'A', source: 'https://docs.example.test/a.pptx', text }),
    xlsx: xlsxClipContent({ title: 'A', source: 'https://docs.example.test/a.xlsx', text }),
    gh: fileClipContent({ owner: 'o', repo: 'r', ref: 'a'.repeat(40), relPath: 'README.md', content: text }),
    confluence: confluenceClipContent({ title: 'A', source: 'https://wiki.example.test/page/1', body: text }),
  };
  for (const [name, { body }] of Object.entries(built)) {
    assert.equal(field(body, 'created'), '2026-11-06', `${name} stamps the New York day`);
  }
});

test('recordDecline and supersedeDecline stamp the local day', (t) => {
  zone(t, NY);
  const v = vault(t);
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(EVENING_NY) });
  recordDecline(v.root, URL_A, 'not relevant');
  assert.equal(readDeclineLog(v.root)[0].date, '2026-11-06');
  t.mock.timers.setTime(Date.parse('2026-11-08T02:00:00Z')); // 21:00 EST on November 7
  assert.deepEqual(supersedeDecline(v.root, URL_A, 'relevant after all'), { done: true });
  assert.deepEqual(readDeclineLog(v.root)[0].superseded, { reason: 'relevant after all', date: '2026-11-07' });
});

// A repository with one README at a fixed commit, as the GitHub object reader returns it.
function oneReadmeRepo(text) {
  const buf = Buffer.from(text);
  const blob = createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
  const commit = 'c'.repeat(40), tree = 'e'.repeat(40);
  const objects = {
    [`commits/${commit}`]: { sha: commit, tree },
    [`git/trees/${tree}`]: { sha: tree, truncated: false, tree: [{ path: 'README.md', type: 'blob', mode: '100644', sha: blob, size: buf.length }] },
    [`git/blobs/${blob}`]: { sha: blob, size: buf.length, encoding: 'base64', content: buf.toString('base64') },
  };
  return { commit, read: (route) => structuredClone(objects[route]) };
}

test('a selected GitHub capture stamps the file clipping and its manifest with the local day', (t) => {
  zone(t, NY);
  const v = vault(t);
  const repo = oneReadmeRepo(`# Fixture\n\n${words('The readme')}\n`);
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(EVENING_NY) });
  const r = captureSelection({ owner: 'owner', repo: 'repo', vaultPath: v.root, read: repo.read, topic: 'dates',
    selection: { paths: [], readmeOnly: true, ref: repo.commit } });
  assert.equal(r.status, 'clipped', r.error);
  const names = readdirSync(r.outDir).sort();
  const manifest = names.filter((n) => n === r.manifest), clippings = names.filter((n) => n !== r.manifest);
  assert.equal(manifest.length, 1, names.join(', '));
  assert.equal(clippings.length, 1, names.join(', '));
  assert.equal(field(readFileSync(join(r.outDir, clippings[0]), 'utf8'), 'created'), '2026-11-06', 'the README clipping');
  assert.equal(field(readFileSync(join(r.outDir, manifest[0]), 'utf8'), 'created'), '2026-11-06', 'the selection manifest');
});

test('a figure sidecar is captured on the local day when no date is passed', (t) => {
  zone(t, NY);
  const v = vault(t);
  // pdfinfo reports one page; pdftoppm writes the image to the name it is given.
  const run = (cmd, args) => {
    if (cmd === 'pdfinfo') return 'Pages: 1\n';
    if (cmd === 'pdftoppm') { writeFileSync(`${args.at(-1)}.png`, 'image bytes'); return ''; }
    throw new Error(`unexpected tool ${cmd}`);
  };
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(EVENING_NY) });
  const r = renderFigures({ pdfPath: 'doc.pdf', vaultPath: v.root, clippingPath: 'raw/clippings/Doc.md', title: 'Doc',
    source: 'https://docs.example.test/doc.pdf', selection: { mode: 'list', pages: [1], max: 40 },
    tools: { pdftoppm: 'pdftoppm', pdfinfo: 'pdfinfo' }, run, log: () => {} });
  assert.deepEqual(r.written, ['raw/figures/Doc-p1.md']);
  assert.equal(field(readFileSync(join(v.root, 'raw', 'figures', 'Doc-p1.md'), 'utf8'), 'captured'), '2026-11-06');
});

// ---------------------------------------------------------------- clip.mjs, in a child at a fixed instant
test('clip.mjs stamps created with the local day of the zone it runs in', (t) => {
  const cases = [
    [NY, EVENING_NY, '2026-11-06'],
    [AKL, EVENING_NY, '2026-11-07'],
    [NY, '2026-11-01T03:30:00Z', '2026-10-31'],
    [NY, '2026-11-02T04:30:00Z', '2026-11-01'],
  ];
  for (const [tz, now, day] of cases) {
    const v = vault(t);
    const page = v.page('page.md', `# Setup guide\n\n${words('The setup')}\n`);
    ok(v.clip([URL_A, '--from-file', page], { tz, now }));
    const files = v.files();
    assert.equal(files.length, 1, files.join(', '));
    assert.equal(field(v.read(files[0]), 'created'), day, `${now} in ${tz}`);
  }
});

test('a recapture in the evening is named, titled and created with the local day', (t) => {
  const v = vault(t);
  const first = v.page('page.md', `# Setup guide\n\n${words('The first text')}\n`);
  const second = v.page('page2.md', `# Setup guide\n\n${words('The changed text')}\n`);
  ok(v.clip([URL_A, '--from-file', first], { tz: NY, now: '2026-10-01T15:00:00Z' }));
  const [original] = v.files();

  // Without --recapture a second clip of the URL is a duplicate; with identical text a recapture is unchanged.
  ok(v.clip([URL_A, '--from-file', second], { tz: NY, now: EVENING_NY }));
  ok(v.clip([URL_A, '--recapture', '--from-file', first], { tz: NY, now: EVENING_NY }));
  assert.deepEqual(v.files(), [original], 'no second capture is written');

  ok(v.clip([URL_A, '--recapture', '--from-file', second], { tz: NY, now: EVENING_NY }));
  const added = v.files().filter((f) => f !== original);
  assert.equal(added.length, 1, v.files().join(', '));
  assert.match(added[0], /\(recaptured 2026-11-06\)\.md$/, 'the file name carries the local day');
  const md = v.read(added[0]);
  assert.match(field(md, 'title'), /\(recaptured 2026-11-06\)"?$/, 'the title carries the local day');
  assert.equal(field(md, 'created'), '2026-11-06');
});

test('clip.mjs --decline records the local day', (t) => {
  const v = vault(t);
  ok(v.clip([URL_A, '--decline=not relevant'], { tz: NY, now: EVENING_NY }));
  const log = JSON.parse(readFileSync(join(v.root, '.wiki-master', 'declined.json'), 'utf8'));
  assert.equal(log.length, 1);
  assert.equal(log[0].date, '2026-11-06');
});

test('the zones set above do not outlive their tests', () => {
  assert.equal(process.env.TZ, ORIGINAL_TZ);
});
