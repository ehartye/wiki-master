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

import { optionValue } from './cli-guard.mjs';
import { openOperationProblem } from './op-ledger.mjs';
import { resolveVault } from './vault.mjs';

export const CLIP_SPECS = {
  "clip": {
    name: "clip.mjs",
    usage: [
      "usage: clip.mjs <url> [--quality=high|medium|low] [--topic=\"...\"] [--decline=\"reason\"] [--slug=<name>] [--recapture]",
      "                [--from-file <path>]",
      "",
      "  --slug   the file name, without .md. A name that is taken is a clash: nothing is written and nothing is suffixed.",
      "  --recapture  a URL that is already clipped is clipped again as a dated second capture, beside the first and linked to it by",
      "           recapture-of; the older clipping is never edited. Text identical to any capture of the URL writes nothing.",
      "           A URL not clipped yet is clipped as usual. Without this flag a second clip of a URL is a duplicate.",
      "  --from-file  a page a person saved from a signed-in browser (.md, .markdown, .txt or .html, .htm, at most 1 MiB). The URL is the",
      "           page's real address and nothing is fetched. Text is the page unchanged; HTML goes through the extractor. The thin,",
      "           login-form and decline checks apply. The clipping records extraction: manual and supplied-sha256 (the supplied bytes).",
    ],
    values: ["quality", "topic", "decline", "slug", "from-file"],
    flags: ["recapture"],
    spaced: ["from-file"],
    lead: [],
  },
  "clip-pdf": {
    name: "clip-pdf.mjs",
    usage: [
      "usage: clip-pdf.mjs <file.pdf> [--source=\"<url-or-path>\"] [--quality=high|medium|low]",
      "                          [--mode=auto|reading-order|table] [--ocr] [--ocr-lang=eng]",
      "                          [--topic=\"<research topic>\"] [--decline=\"reason\"] [--doctor]",
      "                          [--title=\"<text>\"] [--slug=<name>]",
      "                          [--figures[=auto|all|3,5-7]] [--figures-max=N]",
      "       clip-pdf.mjs <file.pdf> --figures-only --clipping <raw/clippings/x.md> [--figures=...]",
      "",
      "  --mode   reading mode. auto (default) lets the tabular detector choose;",
      "           reading-order and table override it when it gets a document wrong.",
      "  --topic  the research run this clip belongs to. Recorded going forward only:",
      "           without it, /wiki-triage can never group this clipping by run.",
      "  --title  the clipping title. Default: derived from the file name.",
      "  --slug   the file name, without .md. A name that is taken is a clash: nothing is written and nothing is suffixed.",
      "  --figures render figure pages to raw/figures (poppler pdftoppm). auto = pages with embedded",
      "           rasters or vector drawings; all = every page; or a page list. Cap 40 (--figures-max).",
      "  --figures-only  add figures to an EXISTING clipping from the PDF you supply (frontmatter only).",
      "  --doctor report which external tools are installed, then exit.",
    ],
    values: ["source", "quality", "mode", "ocr-lang", "topic", "decline", "figures", "figures-max", "clipping", "title", "slug"],
    flags: ["ocr", "doctor", "figures", "figures-only", "allow-pdf-mismatch"],
    spaced: ["clipping"],
    lead: ["--doctor"],
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
      "           without it, /wiki-triage can never group this clipping by run.",
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
      "           without it, /wiki-triage can never group this clipping by run.",
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
      "           without it, /wiki-triage can never group this clipping by run.",
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
      "           without it, /wiki-triage can never group this clipping by run.",
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
      "                        [--max-groups=N]",
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
    ],
    values: ["ref", "quality", "topic", "max-files", "max-groups", "decline"],
    flags: ["force-full"],
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

// Every clipper also takes the operation it is writing for. The exact path of each file it writes goes into that
// operation's ledger (lib/op-ledger.mjs), which `op-ledger.mjs show` turns into the op-commit scope. Without it a clip is
// recorded nowhere, as before. The command-line entry refuses a token that names no open operation before any work is done.
const SINCE_USAGE = ['  --since  the operation token op-begin printed: records the path of every file this clip writes in the operation\'s ledger'];
for (const spec of Object.values(CLIP_SPECS)) {
  spec.values.push('since');
  spec.spaced.push('since');
  const at = spec.usage.indexOf('');
  spec.usage.splice(at < 0 ? spec.usage.length : at + 1, 0, ...SINCE_USAGE);
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
  return { ok: true };
}

// The command-line entry of a clipper calls this before doing anything else. Help prints the usage to
// stdout and exits 0; an unknown option prints the problem and the usage to stderr and exits 2.
export function guardClipArgs(argv, spec, { exit = process.exit, out = console.log, err = console.error, vaultPath } = {}) {
  const r = checkClipArgs(argv, spec);
  if (r.help) { for (const line of spec.usage) out(line); exit(0); return 'help'; }
  if (r.error) { err(`${spec.name}: ${r.error}`); for (const line of spec.usage) err(line); exit(2); return 'error'; }
  // A token that names no open operation would record nothing, quietly, for every file of a long run. Said once, here.
  const since = optionValue(argv, 'since');
  if (since !== undefined) {
    const problem = openOperationProblem(vaultPath ?? resolveVault().path, since);
    if (problem) { err(`${spec.name}: --since: ${problem}`); exit(2); return 'error'; }
  }
  return null;
}
