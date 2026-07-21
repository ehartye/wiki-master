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
import { assessFidelity } from './clip-pdf.mjs';

// Remove the `fidelity:` line from a note's frontmatter. No-op if absent.
export function clearFidelityLine(fileText) {
  const fm = fileText.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!fm) return fileText;
  const kept = fm[2].split('\n').filter((l) => !/^fidelity:/.test(l));
  if (kept.length === fm[2].split('\n').length) return fileText;
  return fm[1] + kept.join('\n') + fm[3] + fileText.slice(fm[0].length);
}

export function splitBody(fileText) {
  const m = fileText.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return m ? fileText.slice(m[0].length) : fileText;
}

// Guard on the entry point, not the filename: `endsWith` is true for any import
// of this module, so the CLI body ran as a side effect of importing its helpers.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const apply = process.argv.includes('--apply');
  const { path: vault } = resolveVault();
  const dir = join(vault, 'raw', 'clippings');
  const cleared = [];
  const kept = [];

  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith('.md')) continue;
      const text = readFileSync(p, 'utf8');
      const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!fm || !/^fidelity:/m.test(fm[1])) continue;
      const a = assessFidelity(splitBody(text));
      const rel = p.slice(vault.length + 1).replace(/\\/g, '/');
      if (a.degraded) { kept.push({ clipping: rel, repl: a.replacement, cid: a.cid, mm: a.mangledMath, lr: +a.letterRatio.toFixed(2) }); continue; }
      if (apply) writeFileSync(p, clearFidelityLine(text));
      cleared.push(rel);
    }
  };
  if (existsSync(dir)) walk(dir);

  console.log(JSON.stringify({ type: 'refresh-fidelity', applied: apply, cleared: cleared.length, stillDegraded: kept.length }));
  if (kept.length) console.log(JSON.stringify({ stillDegraded: kept }, null, 2));
  if (!apply) console.error('dry run — re-run with --apply to clear stale flags');
}
