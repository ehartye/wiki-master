// Capability gates for the tests that run the real PDF tools. A test gates on the same probe the product trusts, so it
// never expects Poppler behavior from a tool the product itself would refuse:
//
//   raster  diagnosePdf's figure render (the resolved pdftoppm writes a PNG page), its -v probes of pdfimages,
//           pdftocairo and pdfinfo, and a pdftotext it can identify
//   ocr     ocrReachable (pdftoppm -v and tesseract --version exit 0), and pdftotextPresent
//   title   diagnosePdf's -v probe of the resolved pdfinfo exits 0, and pdfinfoTitle reads a fixture PDF's title
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
import { pdftotextPresent } from '../../scripts/lib/pdf-extract.mjs';
import { ocrReachable, pdfinfoTitle } from '../../scripts/clip-pdf.mjs';
import { resolveTool } from '../../scripts/lib/pdf-figures.mjs';
import { makePdf, prosePages } from '../fixtures/make-pdf.mjs';

export const STRICT_ENV = 'WIKI_MASTER_TEST_REQUIRE_POPPLER';
const FIXTURE_TITLE = 'A Plausible Report Title';
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
// pdfinfo and read text with pdftotext.
export function rasterCapability(diagnosis) {
  const c = diagnosis.capabilities;
  if (c.figureRaster.outcome !== 'passed') return { ok: false, reason: `needs Poppler pdftoppm; ${found(c.figureRaster, 'pdftoppm', 'a one-page PNG render')}` };
  for (const tool of ['pdfimages', 'pdftocairo', 'pdfinfo']) {
    const probe = c.figureDetection.prerequisites[tool];
    if (probe?.outcome !== 'passed') return { ok: false, reason: `needs Poppler ${tool}; ${found(probe, tool, '-v')}` };
  }
  if (c.text.flavor === 'unknown') return { ok: false, reason: 'needs pdftotext; found none that answers -h or -v' };
  return OK;
}

// `reachable` is ocrReachable(), the product's gate, and it decides; the doctor's probes of the same two commands only
// say which tool failed.
export function ocrCapability({ reachable, text, diagnosis }) {
  if (!text) return { ok: false, reason: 'needs pdftotext; found none' };
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

let diagnosis;
const diagnose = () => (diagnosis ??= diagnosePdf());

function readFixtureTitle() {
  const dir = mkdtempSync(join(tmpdir(), 'wm-pdf-tools-'));
  try {
    const pdf = makePdf(prosePages(1), join(dir, 'titled.pdf'), { info: { title: FIXTURE_TITLE } });
    return pdfinfoTitle(pdf, { tool: resolveTool('pdfinfo') });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const PROBES = {
  raster: async () => rasterCapability(await diagnose()),
  ocr: async () => ocrCapability({ reachable: ocrReachable(), text: pdftotextPresent(), diagnosis: await diagnose() }),
  title: async () => {
    const version = (await diagnose()).capabilities.figureDetection.prerequisites.pdfinfo;
    return titleCapability({ version, title: version?.outcome === 'passed' ? readFixtureTitle() : undefined });
  },
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
