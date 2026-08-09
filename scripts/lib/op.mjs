// Pure delta logic for bracketing a vault operation. No fs, no child_process —
// op-begin.mjs and op-commit.mjs do the I/O and hand this module text/Sets.

// Porcelain is `XY <path>`, fixed width, and the leading space in " M path"
// means "modified but not staged". Slice by column; never trim the line.
// git wraps non-ASCII paths in quotes even under core.quotePath=false — measured
// against git-for-windows 2.55 — so the pair is stripped with an anchored match
// that cannot eat a lone quote from a POSIX filename.
export function dirtySet(porcelain) {
  return new Set(
    porcelain
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => l.slice(3).replace(/^"(.*)"$/, '$1'))
  );
}

// What this operation touched: dirty now, minus dirty before it started. Sorted
// so two machines produce identical commits from identical work — not
// localeCompare, which depends on the machine's ICU locale.
export function deltaPaths(before, after) {
  return [...after].filter((p) => !before.has(p)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
