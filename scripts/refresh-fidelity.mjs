// A clipping's `fidelity:` is a cached verdict written once at clip time, and
// nothing ever re-validates it. Heuristics improve (and older ones were buggier),
// so clippings carry stale "degraded" flags whose content assesses clean today —
// asking a human to disposition a non-problem. Re-assess from the stored markdown
// and drop the flag where it no longer holds. Absent means healthy, which is the
// convention the clippers already write.
//
//   node scripts/refresh-fidelity.mjs           # dry run
//   node scripts/refresh-fidelity.mjs --apply
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { assessFidelity, letterInventory } from './clip-pdf.mjs';
import { clippingKind } from './lib/reclip-html.mjs';
import { cliGuard } from './lib/cli-guard.mjs';
cliGuard(import.meta.url);

// A fidelity flag is only clearable if it can be RE-DERIVED from the stored
// text. Table-derived flags cannot: `extraction: table-aware` means the rows
// were reconstructed from horizontal position, and `table-flattened` means they
// were lost outright -- and in both cases the stored characters read as perfectly
// clean prose, so assessFidelity returns healthy and this script would helpfully
// delete the only record that the rows are not to be trusted (#66).
//
// Derived from the note's own `extraction:`, not a list of filenames, so a future
// extraction mode that carries the same property inherits the protection by
// naming itself here rather than by being remembered.
//
// `ocr` is the same case: recognised text is well-formed whatever the engine got wrong, so re-assessing the
// characters says "healthy" and would delete the only record that nobody verified them.
const EXTRACTION_DERIVED = new Set(['table-aware', 'table-flattened', 'ocr']);

export function fidelityIsExtractionDerived(frontmatter) {
  const line = String(frontmatter).split('\n').map((l) => l.trim())
    .find((l) => l.startsWith('extraction:'));
  if (!line) return false;
  return EXTRACTION_DERIVED.has(line.slice('extraction:'.length).trim().split('"').join(''));
}

// Remove the `fidelity:` line from a note's frontmatter. No-op if absent.
export function clearFidelityLine(fileText) {
  const fm = fileText.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!fm) return fileText;
  const kept = fm[2].split('\n').filter((l) => !/^fidelity:/.test(l));
  if (kept.length === fm[2].split('\n').length) return fileText;
  return fm[1] + kept.join('\n') + fm[3] + fileText.slice(fm[0].length);
}

// A clipping made before the OCR floor existed says `extraction: ocr` and nothing about fidelity. The floor follows
// from the extraction alone, so it can be set without guessing: returns the text with `fidelity: ocr` inserted after
// the extraction line, or null when the clipping is not an OCR one, already carries any grade, or has no frontmatter.
// An existing grade, degraded or not, is never replaced. Line endings are kept.
export function ocrFloorBackfill(fileText) {
  const fm = fileText.match(/^---(\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!fm) return null;
  const eol = fm[1];
  const lines = fm[2].split(/\r?\n/);
  const at = lines.findIndex((l) => /^extraction:\s*"?ocr"?\s*$/.test(l));
  if (at < 0 || lines.some((l) => /^fidelity:/.test(l))) return null;
  lines.splice(at + 1, 0, 'fidelity: ocr');
  return `---${eol}${lines.join(eol)}${fm[3]}${fileText.slice(fm[0].length)}`;
}

export function splitBody(fileText) {
  const m = fileText.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return m ? fileText.slice(m[0].length) : fileText;
}

// Guard on the entry point, not the filename: `endsWith` is true for any import
// of this module, so the CLI body ran as a side effect of importing its helpers.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const apply = process.argv.includes('--apply');
  const ocrFloor = process.argv.includes('--ocr-floor');
  const inventory = process.argv.includes('--inventory');
  if (inventory && (apply || ocrFloor)) {
    // A grade on evidence is the owner's call: the inventory only lists.
    console.error('refresh-fidelity: --inventory only lists the suspect clippings; it has no apply mode and is not combined with --ocr-floor');
    process.exit(2);
  }
  const { path: vault } = resolveVault();
  const dir = join(vault, 'raw', 'clippings');
  const suspects = [];
  let tested = 0;
  const floored = [];
  const cleared = [];
  const kept = [];
  const preserved = [];

  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith('.md')) continue;
      const text = readFileSync(p, 'utf8');
      if (inventory) {
        // Only text read from a PDF or a document: the inventory is a check on a text layer, not on a web page.
        if (clippingKind(text) !== 'pdf') continue;
        const r = letterInventory(splitBody(text));
        if (!r.tested) continue;
        tested++;
        const marked = /^fidelity:\s*"?degraded"?\s*$/m.test(text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '');
        if (r.suspect && !marked) {
          suspects.push({ path: p.slice(vault.length + 1).replace(/\\/g, '/'), letters: r.letters, low: r.low.map((x) => ({ letter: x.letter, share: +x.share.toFixed(4), floor: x.floor })) });
        }
        continue;
      }
      if (ocrFloor) {
        const next = ocrFloorBackfill(text);
        if (next === null) continue;
        if (apply) writeFileSync(p, next);
        floored.push(p.slice(vault.length + 1).replace(/\\/g, '/'));
        continue;
      }
      const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!fm || !/^fidelity:/m.test(fm[1])) continue;
      // Not ours to re-judge: the basis is the extraction, not the characters.
      if (fidelityIsExtractionDerived(fm[1])) {
        preserved.push(p.slice(vault.length + 1).replace(/\\/g, '/'));
        continue;
      }
      const a = assessFidelity(splitBody(text));
      const rel = p.slice(vault.length + 1).replace(/\\/g, '/');
      if (a.degraded) { kept.push({ clipping: rel, repl: a.replacement, cid: a.cid, mm: a.mangledMath, lr: +a.letterRatio.toFixed(2) }); continue; }
      if (apply) writeFileSync(p, clearFidelityLine(text));
      cleared.push(rel);
    }
  };
  if (existsSync(dir)) walk(dir);

  if (inventory) {
    console.log(JSON.stringify({ type: 'refresh-fidelity', mode: 'inventory', applied: false, tested, count: suspects.length, suspects }));
    process.exit(0);
  }

  if (ocrFloor) {
    console.log(JSON.stringify({ type: 'refresh-fidelity', mode: 'ocr-floor', applied: apply, count: floored.length, paths: floored }));
    if (!apply) console.error('dry run — re-run with --apply to set fidelity: ocr on these clippings');
    process.exit(0);
  }

  console.log(JSON.stringify({ type: 'refresh-fidelity', applied: apply, cleared: cleared.length, stillDegraded: kept.length, preserved: preserved.length }));
  if (kept.length) console.log(JSON.stringify({ stillDegraded: kept }, null, 2));
  if (!apply) console.error('dry run — re-run with --apply to clear stale flags');
}
