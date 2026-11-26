// What each clipper accepts on its command line, and the check that rejects the rest.
//
// A mistyped or unsupported option used to be ignored: `clip.mjs <url> --dry-run` performed a real
// clipping write, and `--help` was read as the URL. Each clipper now validates its arguments before any
// network or vault activity: an unknown option is rejected with exit 2 and the usage text, and `--help`
// or `-h` prints the usage and exits 0 having touched nothing. Only the command-line entry applies the
// check, so a caller that runs `main()` programmatically is unaffected.
//
//   values   options written `--name=value`
//   flags    options written bare (a name in both `values` and `flags` may be either)
//   spaced   options that may also take their value as the next token (`--clipping path`)
//   lead     options allowed as the very first token, where a positional is otherwise expected
//   enums    options whose value must be one of a fixed list (`--quality`: high, medium or low, lowercase)
import { QUALITY_TIERS } from './quality-tiers.mjs';

export const CLIP_SPECS = {
  "clip": {
    name: "clip.mjs",
    usage: [
      "usage: clip.mjs <url> [--quality=high|medium|low] [--topic=\"...\"] [--decline=\"reason\"] [--slug <name>] [--recapture]",
      "                [--from-file <path>] [--expand] [--find-twin] [--ledger <file>] [--probe]",
      "       clip.mjs --list <file> [--quality=...] [--topic=\"...\"] [--recapture] [--expand] [--find-twin] [--ledger <file>] [--probe]",
      "",
      "  --probe  what a clip of this address would do, with nothing written: the same fetch, browser render, extraction and thin,",
      "           wrong-node and login-page checks, stopped before a file name is chosen. No clipping, decline, triage row or ledger line.",
      "           Prints one JSON line on stdout (url, outcome, extraction, words, title, captured, existing, declined, declineReason, reason,",
      "           wouldDecline, wouldQueue, ocr, estimate) and one line for a person on stderr. Exit 0 whatever the outcome, thin and blocked",
      "           included. With --list, one JSON line per address. Not with --decline, --slug, --recapture, --ledger, --find-twin,",
      "           --override-decline or --supersede-decline (exit 2).",
      "  A page that reads thin (or fails) is looked up as Markdown before the browser is tried: <page>.md.txt, <page>.md, a \"View page in",
      "           Markdown\" link, then the page's entry in the site's /llms.txt. A twin of at least 100 words is stored as it is, with",
      "           twin-url and extraction: plaintext-twin. No file, --expand, plain-text URL or PDF URL probes, and a healthy page is not probed.",
      "  A page under 300 words whose only PDF link is one document is written as a landing page (landing-page: true, document-link): it is",
      "           not evidence for the document. It prints the clip-pdf.mjs command for the document, which clip.mjs never fetches itself.",
      "  --find-twin  for a page that clipped with a partial fidelity warning: print its plain-text twin, if any. Nothing is written.",
      "  --expand opens the page's tabs and collapsed panels in a browser and stores them all. It skips the static read, and a page",
      "           the browser cannot read is queued, not declined. It sends no non-GET request and leaves no page. At most 200 clicks",
      "           and 60 seconds; hitting either marks the clip fidelity: partial. Not for --from-file, or a PDF or plain-text URL.",
      "  --list   clip every address in <file>, one per line (blank lines and lines starting # are ignored), in order and one at a time,",
      "           at least 1 second apart on one host. It must be the first argument; the other options apply to each address. A line that is",
      "           not an http or https address, or carries a username, password or secret query parameter, is an error outcome and the run goes on. A missing extraction",
      "           runtime stops the run with exit 1. Otherwise it ends with a count per outcome and exits 0, even after thin or failed ones.",
      "           Not with a URL, --from-file, --slug, --decline, --override-decline or --supersede-decline (exit 2).",
      "  --ledger append one JSON line per address to <file> (with or without --list), inside the selected vault but outside raw/ and wiki/ (else exit 2).",
      "           Fields, null where one does not apply: url, status, path, sourceHash, quality, topic, extraction, fidelity, reason, twinUrl,",
      "           documentLink, expandCoverage, unexpandedTabs, extractionRetry, visibleWords, extractedWords. An address with a username, password or",
      "           secret query parameter is refused, and its row records it without the username, password or secret values.",
      "  --slug   the file name, without .md (--slug <name> or --slug=<name>). A name that is taken is a clash: nothing is written and nothing is suffixed.",
      "  --recapture  a URL that is already clipped is clipped again as a dated second capture, beside the first and linked to it by",
      "           recapture-of; the older clipping is never edited. Text identical to any capture of the URL writes nothing.",
      "           A URL not clipped yet is clipped as usual. Without this flag a second clip of a URL is a duplicate.",
      "  --from-file  a page a person saved from a signed-in browser (.md, .markdown, .txt or .html, .htm, at most 1 MiB). The URL is the",
      "           page's real address and nothing is fetched. Text is the page unchanged; HTML goes through the extractor. The thin,",
      "           login-form and decline checks apply. The clipping records extraction: manual and supplied-sha256 (the supplied bytes).",
    ],
    values: ["quality", "topic", "decline", "slug", "from-file", "ledger"],
    flags: ["recapture", "expand", "find-twin", "probe"],
    spaced: ["from-file", "slug", "ledger"],
    lead: ["--list"],
    probeRefuses: ["decline", "slug", "recapture", "ledger", "find-twin", "override-decline", "supersede-decline"],
  },
  "clip-pdf": {
    name: "clip-pdf.mjs",
    usage: [
      "usage: clip-pdf.mjs <file.pdf | https-url> [--source=\"<url-or-path>\"] [--quality=high|medium|low]",
      "                          [--mode=auto|reading-order|table] [--ocr] [--ocr-lang=eng]",
      "                          [--topic=\"<research topic>\"] [--decline=\"reason\"] [--doctor]",
      "                          [--title=\"<text>\"] [--slug=<name>]",
      "                          [--figures[=auto|all|3,5-7]] [--figures-max=N] [--probe]",
      "       clip-pdf.mjs <file.pdf> --figures-only --clipping <raw/clippings/x.md> [--figures=...]",
      "",
      "  <https-url>  the PDF is downloaded to a temp folder, clipped with the URL as its source, and removed. The dedup and decline checks",
      "           run on the URL before any download. Redirects are followed and there is no size cap; the download stops when the first",
      "           bytes are not %PDF-, when no data arrives for 60 seconds, or when the disk is full. A failed download is queued, not declined.",
      "           The title is --title, then the PDF's own title (pdfinfo, if installed), then the last part of the URL.",
      "  --mode   reading mode. auto (default) lets the tabular detector choose;",
      "           reading-order and table override it when it gets a document wrong.",
      "  --topic  the research run this clip belongs to. Recorded going forward only:",
      "           without it, wiki-maintainer triage can never group this clipping by run.",
      "  --title  the clipping title. Default: the PDF's pdfinfo title when plausible, else the file name or the address's last segment, with a warning.",
      "  --slug   the file name, without .md. A name that is taken is a clash: nothing is written and nothing is suffixed.",
      "  --figures render figure pages to raw/figures (poppler pdftoppm). auto = pages with embedded",
      "           rasters or vector drawings; all = every page; or a page list. Cap 40 (--figures-max).",
      "  --figures-only  add figures to an EXISTING clipping from the PDF you supply (frontmatter only). Not for a URL: download the file first.",
      "  --doctor report dependencies and bounded synthetic PDF rendering probes, then exit.",
      "  --probe  what a clip of this file or address would do, with nothing written: the same download, text layer and thin check. A PDF",
      "           that would go to OCR has its first 2 pages recognised, not the whole document. No clipping, decline or triage row.",
      "           Prints one JSON line on stdout (url, outcome, extraction, words, title, captured, existing, declined, declineReason, reason,",
      "           wouldDecline, wouldQueue, ocr, estimate) and one line for a person on stderr. ocr is { pagesSampled, pages, words }; estimate",
      "           is true when the outcome is projected from a sample that is not the whole document. Exit 0 whatever the outcome.",
      "           Not with --decline, --slug, --figures, --figures-max, --figures-only, --clipping, --allow-pdf-mismatch, --doctor,",
      "           --override-decline or --supersede-decline (exit 2).",
    ],
    values: ["source", "quality", "mode", "ocr-lang", "topic", "decline", "figures", "figures-max", "clipping", "title", "slug"],
    flags: ["ocr", "doctor", "figures", "figures-only", "allow-pdf-mismatch", "probe"],
    spaced: ["clipping"],
    lead: ["--doctor"],
    probeRefuses: ["decline", "slug", "figures", "figures-max", "figures-only", "clipping", "allow-pdf-mismatch", "doctor", "override-decline", "supersede-decline"],
  },
  "clip-docx": {
    name: "clip-docx.mjs",
    usage: [
      "usage: clip-docx.mjs <file.docx> [--source=\"<url-or-path>\"] [--quality=high|medium|low]",
      "                           [--topic=\"<research topic>\"] [--decline=\"reason\"]",
      "                           [--allow-short]",
      "                           [--title=\"<text>\"] [--slug=<name>]",
      "",
      "  --topic  the research run this clip belongs to. Recorded going forward only:",
      "           without it, wiki-maintainer triage can never group this clipping by run.",
      "  --title  the clipping title. Default: derived from the file name.",
      "  --slug   the file name, without .md. A name that is taken is a clash: nothing is written and nothing is suffixed.",
    ],
    values: ["source", "quality", "topic", "decline", "title", "slug"],
    flags: ["allow-short"],
    spaced: [],
    lead: [],
  },
  "clip-pptx": {
    name: "clip-pptx.mjs",
    usage: [
      "usage: clip-pptx.mjs <file.pptx> [--source=\"<url-or-path>\"] [--quality=high|medium|low]",
      "                           [--topic=\"<research topic>\"] [--decline=\"reason\"]",
      "                           [--title=\"<text>\"] [--slug=<name>]",
      "",
      "  --topic  the research run this clip belongs to. Recorded going forward only:",
      "           without it, wiki-maintainer triage can never group this clipping by run.",
      "  --title  the clipping title. Default: derived from the file name.",
      "  --slug   the file name, without .md. A name that is taken is a clash: nothing is written and nothing is suffixed.",
    ],
    values: ["source", "quality", "topic", "decline", "title", "slug"],
    flags: [],
    spaced: [],
    lead: [],
  },
  "clip-xlsx": {
    name: "clip-xlsx.mjs",
    usage: [
      "usage: clip-xlsx.mjs <file.xlsx> [--source=\"<url-or-path>\"] [--quality=high|medium|low]",
      "                           [--topic=\"<research topic>\"] [--decline=\"reason\"]",
      "                           [--title=\"<text>\"] [--slug=<name>]",
      "",
      "  --topic  the research run this clip belongs to. Recorded going forward only:",
      "           without it, wiki-maintainer triage can never group this clipping by run.",
      "  --title  the clipping title. Default: derived from the file name.",
      "  --slug   the file name, without .md. A name that is taken is a clash: nothing is written and nothing is suffixed.",
    ],
    values: ["source", "quality", "topic", "decline", "title", "slug"],
    flags: [],
    spaced: [],
    lead: [],
  },
  "clip-confluence": {
    name: "clip-confluence.mjs",
    usage: [
      "usage: clip-confluence.mjs <confluence-url-or-page-id> [--quality=high|medium|low]",
      "                                 [--topic=\"<research topic>\"] [--decline=\"reason\"]",
      "       clip-confluence.mjs --doctor   (check whether confluencer is installed)",
      "",
      "  --topic  the research run this clip belongs to. Recorded going forward only:",
      "           without it, wiki-maintainer triage can never group this clipping by run.",
    ],
    values: ["quality", "topic", "decline"],
    flags: [],
    spaced: [],
    lead: ["--doctor"],
  },
  "clip-gh": {
    name: "clip-gh.mjs",
    usage: [
      "usage: clip-gh.mjs <owner/repo | github-url> [--ref=<branch>] [--quality=high|medium|low]",
      "                        [--topic=\"<research topic>\"] [--max-files=N] [--force-full]",
      "                        [--max-groups=N] [--max-file-size=<size, e.g. 512K>]",
      "                        [--path=<exact-repo-path> ... | --readme-only]",
      "                        [--decline=\"reason\"]",
      "       clip-gh.mjs --doctor   (check whether gh is installed and authenticated)",
      "",
      "  Clones the repo to a temp directory (never into the vault), then writes ONE",
      "  clipping per included source file to raw/clippings/gh/<owner>/<repo>/ — never",
      "  one giant dump of the whole repo. Excludes dependency/build directories,",
      "  binaries, lockfiles, and oversized files by default.",
      "",
      "  A repo over the per-file cap (default 300) switches to DIGEST mode instead of",
      "  refusing: a manifest + bounded per-module file listings + a small set of full",
      "  anchor clips (README, LICENSE, top-level manifests), never one file per source",
      "  file. Pass --force-full (with a raised --max-files) to force the old exhaustive",
      "  per-file behavior on a large repo instead.",
      "",
      "  --path (repeat, max 32) or --readme-only opts into clone-free authenticated",
      "  GitHub capture at one resolved commit (--ref accepts a branch, tag or full SHA).",
      "  Root LICENSE/NOTICE/COPYING files (max 8) accompany the selected files.",
      "  Immutable clips + a selection manifest go to raw/clippings/gh-selected/.",
      "  No pruning; all-file preflight refuses missing, unsafe or binary selections.",
      "  Cannot combine selection with full/digest controls or --decline.",
      "",
      "  --max-file-size=<n>K|<n>M raises the per-file cap (default 256K, ceiling 1M) in",
      "  both modes. A selected file over the cap is skipped and named with the flag",
      "  that takes it; the rest are captured, the manifest lists the skipped paths,",
      "  and the call exits 1. Over 8 MiB in total still refuses the whole selection.",
    ],
    values: ["ref", "quality", "topic", "max-files", "max-groups", "max-file-size", "decline", "path"],
    flags: ["force-full", "readme-only"],
    spaced: [],
    lead: ["--doctor"],
  },
};

// Every clipper takes the two flags that lift an active decline once its clip is written (decline-gate.mjs).
const DECLINE_USAGE = [
  '  --override-decline  lift a decline the clippers recorded themselves (thin content, wrong node) once this clip is written',
  '  --supersede-decline="reason"  lift any decline once this clip is written, and record why',
];
for (const spec of Object.values(CLIP_SPECS)) {
  spec.values.push('supersede-decline');
  spec.flags.push('override-decline');
  const at = spec.usage.indexOf('');
  spec.usage.splice(at < 0 ? spec.usage.length : at + 1, 0, ...DECLINE_USAGE);
}

// Every clipper takes the same quality tiers. A value outside them used to be written into frontmatter as it was.
for (const spec of Object.values(CLIP_SPECS)) spec.enums = { quality: QUALITY_TIERS };

// "high, medium or low"
const choices = (list) => (list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} or ${list.at(-1)}`);

// `--probe` writes nothing, so an option that asks for a write, or names the file a write would make, is a contradiction and
// not something to ignore. The first such option on the line as a one-line problem, or null. Shared by the command-line check
// below and by each clipper's main(), so a programmatic call is refused the same way.
export function probeConflict(argv, spec) {
  if (!argv.includes('--probe')) return null;
  for (const token of argv) {
    if (typeof token !== 'string' || !token.startsWith('--')) continue;
    const name = token.slice(2).split('=')[0];
    if ((spec.probeRefuses ?? []).includes(name)) return `--probe cannot be used with --${name}: a probe writes nothing`;
  }
  return null;
}

// null-safe, side-effect free. Returns { ok: true }, { help: true } or { error }.
export function checkClipArgs(argv, spec) {
  if (argv.some((a) => a === '--help' || a === '-h')) return { help: true };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (typeof token !== 'string' || !token.startsWith('-')) continue;
    // The first token is the target; only a lead option such as --doctor may stand there.
    if (i === 0 && spec.lead.includes(token)) continue;
    if (i === 0 || !token.startsWith('--')) return { error: `unknown option ${token}` };
    const eq = token.indexOf('=');
    const name = eq < 0 ? token.slice(2) : token.slice(2, eq);
    if (eq >= 0) {
      const allowed = spec.enums?.[name], value = token.slice(eq + 1);
      if (allowed && !allowed.includes(value)) return { error: `--${name} must be ${choices(allowed)} (got "${value}")` };
      if (spec.values.includes(name)) continue;
      return { error: `unknown option --${name}` };
    }
    if (spec.flags.includes(name)) continue;
    if (spec.spaced.includes(name)) {
      const next = argv[i + 1];
      if (next === undefined || String(next).startsWith('-')) return { error: `--${name} needs a value` };
      i++;
      continue;
    }
    if (spec.values.includes(name)) return { error: `--${name} needs a value: --${name}=<value>` };
    return { error: `unknown option --${name}` };
  }
  const conflict = probeConflict(argv, spec);
  if (conflict) return { error: conflict };
  return { ok: true };
}

// The command-line entry of a clipper calls this before doing anything else. Help prints the usage to
// stdout and exits 0; an unknown option prints the problem and the usage to stderr and exits 2.
export function guardClipArgs(argv, spec, { exit = process.exit, out = console.log, err = console.error } = {}) {
  const r = checkClipArgs(argv, spec);
  if (r.help) { for (const line of spec.usage) out(line); exit(0); return 'help'; }
  if (r.error) { err(`${spec.name}: ${r.error}`); for (const line of spec.usage) err(line); exit(2); return 'error'; }
  return null;
}
