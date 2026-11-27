// Capability gates for the tests that run the real PDF tools. A test gates on the same probe the product trusts, so it
// never expects Poppler behavior from a tool the product itself would refuse:
//
//   raster  diagnosePdf's figure render (the resolved pdftoppm writes a PNG page), its -v probes of pdfimages,
//           pdftocairo and pdfinfo, and the pdftotext capability below
//   ocr     ocrReachable (pdftoppm -v and tesseract --version exit 0), and the pdftotext capability below
//   title   diagnosePdf's -v probe of the resolved pdfinfo exits 0, and pdfinfoTitle reads a fixture PDF's title
//   pdftotext  the product's pdfToText reads a one-page fixture's text correctly READS times in a row. The flavor
//              and banner are diagnosePdf's: its pdftotext -h and -v probes, judged by pdftotextCapabilities.
//              Xpdf 4.06 is refused by name without a read: it answers -h and -v, but when USERPROFILE is not
//              the real profile (as under npm test) it crashed on most reads and not others, so even a run of
//              good reads cannot be trusted. Other builds, such as Git for Windows' Xpdf 4.00, read reliably.
//
//   test('...', gated('raster', (t) => { ... }));
//
// A gated test skips with a reason that names the tool and what was found. With WIKI_MASTER_TEST_REQUIRE_POPPLER=1 it
// fails with that reason instead, so a machine that is meant to have Poppler cannot pass by skipping.
//
// Nothing is probed at import: `node --test` loads this file as a test file too. Each capability is probed once per
// process, on first use.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diagnosePdf } from '../../scripts/lib/pdf-doctor.mjs';
import { ocrReachable, pdfinfoTitle, pdfToText } from '../../scripts/clip-pdf.mjs';
import { resolveTool } from '../../scripts/lib/pdf-figures.mjs';
import { makePdf, prosePages } from '../fixtures/make-pdf.mjs';

export const STRICT_ENV = 'WIKI_MASTER_TEST_REQUIRE_POPPLER';
const FIXTURE_TITLE = 'A Plausible Report Title';
const FIXTURE_TEXT = 'pdftotext capability probe';
export const READS = 5;
const OK = Object.freeze({ ok: true, reason: null });

// What a failed diagnosePdf probe found, as words: "found a pdftoppm that exits 99 on -v (Xpdf)".
function found(probe, tool, what) {
  if (!probe || probe.outcome === 'missing') return `found no ${tool}`;
  if (probe.outcome === 'timeout') return `found a ${tool} that timed out on ${what}`;
  if (probe.outcome === 'invalid-output') return `found a ${tool} that wrote no valid PNG on ${what}`;
  if (probe.outcome === 'not-exercised') return `could not probe ${tool} (${probe.reason})`;
  if (typeof probe.status === 'number') {
    const banner = `${probe.stdout ?? ''}${probe.stderr ?? ''}`;
    const flavor = /xpdfreader/i.test(banner) ? ' (Xpdf)' : probe.status === 99 ? ' (Xpdf?)' : '';
    return `found a ${tool} that exits ${probe.status} on ${what}${flavor}`;
  }
  return `found a ${tool} that failed on ${what} (${probe.reason ?? probe.outcome})`;
}

// The figures tests render with the resolved pdftoppm, detect pages with pdfimages and pdftocairo, count pages with
// pdfinfo and read text with pdftotext. `text` is the pdftotext capability: Poppler's raster tools behind an Xpdf
// pdftotext that crashes is a mix the product's own degraded-text advice can produce.
export function rasterCapability(diagnosis, text) {
  const c = diagnosis.capabilities;
  if (c.figureRaster.outcome !== 'passed') return { ok: false, reason: `needs Poppler pdftoppm; ${found(c.figureRaster, 'pdftoppm', 'a one-page PNG render')}` };
  for (const tool of ['pdfimages', 'pdftocairo', 'pdfinfo']) {
    const probe = c.figureDetection.prerequisites[tool];
    if (probe?.outcome !== 'passed') return { ok: false, reason: `needs Poppler ${tool}; ${found(probe, tool, '-v')}` };
  }
  return text.ok ? OK : text;
}

// `reachable` is ocrReachable(), the product's gate, and it decides; the doctor's probes of the same two commands only
// say which tool failed. `text` is the pdftotext capability: the command reads the text layer before it decides on OCR.
export function ocrCapability({ reachable, text, diagnosis }) {
  if (!text.ok) return text;
  if (reachable) return OK;
  const failing = diagnosis.capabilities.ocrRuntimeGate.probes.find((p) => p.outcome !== 'passed');
  const what = failing ? found(failing, failing.command, failing.args?.join(' ')) : 'ocrReachable is false, though the doctor\'s probes passed';
  return { ok: false, reason: `needs Poppler pdftoppm and tesseract for OCR; ${what}` };
}

// `version` is diagnosePdf's -v probe of the resolved pdfinfo; `title` is what pdfinfoTitle read from a fixture titled
// FIXTURE_TITLE.
export function titleCapability({ version, title }) {
  if (version?.outcome !== 'passed') return { ok: false, reason: `needs Poppler pdfinfo; ${found(version, 'pdfinfo', '-v')}` };
  if (title !== FIXTURE_TITLE) return { ok: false, reason: `needs a pdfinfo that prints a PDF's title; found a pdfinfo that printed ${JSON.stringify(title)} for a fixture titled ${JSON.stringify(FIXTURE_TITLE)}` };
  return OK;
}

// How a failed tool run ended, from what execFileSync threw. A Windows exit code at or above 0xC0000000 is an NTSTATUS
// exception such as an access violation, not an exit the tool chose.
function ended(tool, error) {
  if (error?.code === 'ENOENT') return `found no ${tool}`;
  if (error?.signal) return `${tool} crashed (${error.signal})`;
  if (typeof error?.status === 'number') return error.status >= 0xC0000000 ? `${tool} crashed (exit ${error.status})` : `${tool} exited ${error.status}`;
  return `${tool} failed (${error?.code ?? error?.message ?? 'unknown error'})`;
}

const goodRead = (read) => !read.error && String(read.text).includes(FIXTURE_TEXT);

// `present` and `flavor` are pdftotextPresent's and pdftotextCapabilities' judgments of diagnosePdf's -h and -v probes;
// `banner` is those probes' output; `reads` is each fixture read in order, { text } or { error }, up to the first bad one.
export function textCapability({ present, flavor, banner = '', reads = [] }) {
  if (!present) return { ok: false, reason: 'needs pdftotext; found none that answers -h or -v' };
  const version = /pdftotext version (\S+)/i.exec(banner)?.[1];
  const needs = 'needs a pdftotext that reads a PDF reliably';
  if (flavor === 'xpdf' && version === '4.06') return { ok: false, reason: `${needs}; found Xpdf pdftotext 4.06, which crashed on most reads when USERPROFILE is not the real profile (as under npm test)` };
  for (const [i, read] of reads.entries()) {
    if (goodRead(read)) continue;
    const n = `${i + 1} of ${READS}`;
    if (read.error) return { ok: false, reason: `${needs}; ${ended('pdftotext', read.error)} on read ${n}` };
    return { ok: false, reason: `${needs}; read ${n} returned the wrong text (${JSON.stringify(String(read.text).trim().slice(0, 80))}) from a fixture that says ${JSON.stringify(FIXTURE_TEXT)}` };
  }
  if (reads.length < READS) return { ok: false, reason: `${needs}; only ${reads.length} of ${READS} reads ran` };
  return OK;
}

let diagnosis;
const diagnose = () => (diagnosis ??= diagnosePdf());

function withFixture(name, pages, options, use) {
  const dir = mkdtempSync(join(tmpdir(), 'wm-pdf-tools-'));
  try { return use(makePdf(pages, join(dir, name), options)); } finally { rmSync(dir, { recursive: true, force: true }); }
}

const readFixtureTitle = () => withFixture('titled.pdf', prosePages(1), { info: { title: FIXTURE_TITLE } }, (pdf) => pdfinfoTitle(pdf, { tool: resolveTool('pdfinfo') }));

async function readFixtureText() {
  const { flavor, probes } = (await diagnose()).capabilities.text;
  const seen = { present: flavor !== 'unknown', flavor, banner: probes.map((p) => `${p.stdout ?? ''}${p.stderr ?? ''}`).join('\n') };
  if (!textCapability({ ...seen, reads: Array(READS).fill({ text: FIXTURE_TEXT }) }).ok) return seen; // refused before any read
  return withFixture('text.pdf', [[{ x: 60, y: 700, text: FIXTURE_TEXT }]], {}, (pdf) => {
    const reads = [];
    while (reads.length < READS) {
      let read;
      try { read = { text: pdfToText(pdf) }; } catch (error) { read = { error }; }
      reads.push(read);
      if (!goodRead(read)) break;
    }
    return { ...seen, reads };
  });
}

const PROBES = {
  raster: async () => rasterCapability(await diagnose(), await pdfCapability('pdftotext')),
  ocr: async () => ocrCapability({ reachable: ocrReachable(), text: await pdfCapability('pdftotext'), diagnosis: await diagnose() }),
  title: async () => {
    const version = (await diagnose()).capabilities.figureDetection.prerequisites.pdfinfo;
    return titleCapability({ version, title: version?.outcome === 'passed' ? readFixtureTitle() : undefined });
  },
  pdftotext: async () => textCapability(await readFixtureText()),
};

const cache = new Map();
// { ok, reason } for one capability, probed once per process.
export function pdfCapability(name) {
  if (!PROBES[name]) throw new Error(`unknown PDF capability: ${name}`);
  if (!cache.has(name)) cache.set(name, PROBES[name]());
  return cache.get(name);
}

// Wraps a test body: runs it when the capability holds, else skips with the reason, or fails with it in strict mode.
export function gated(name, body, { capability = pdfCapability, env = process.env } = {}) {
  return async (t) => {
    const { ok, reason } = await capability(name);
    if (ok) return body(t);
    if (env[STRICT_ENV] === '1') throw new Error(`${reason} (${STRICT_ENV}=1 makes a missing capability a failure)`);
    t.skip(reason);
  };
}
