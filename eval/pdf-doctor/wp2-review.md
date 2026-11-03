# PDF doctor WP2 independent review

Result: **changes required**.

## Medium: the synthetic PDF has an incorrect stream length

`syntheticPdf()` declares `/Length 22`, but its stream bytes are
`0 0 0 rg 5 5 20 20 re f\n`, which occupy 24 bytes. Independent extraction from
the generated buffer returned `{ declared: 22, actual: 24 }`.

The corrected inherited and mixed native receipts both report successful raster
exit codes and PNG dimensions, but both OCR and figure subprocesses emit:

```text
Syntax Error (283): Missing 'endstream' or incorrect stream length
Syntax Error: Unknown operator 'endstream'
```

The successful native result therefore relies on the converter recovering from
an invalid probe fixture. A converter that rejects that malformed stream could
be misdiagnosed as unusable. Correct the synthetic stream length (prefer deriving
it from the exact stream bytes), add a meaningful regression, and repeat the
native contracts before treating the integration evidence as ready. Preserve
these earlier warning-bearing receipts and report the corrected outcomes.

## Other verification

The retained corrected full-suite receipt reports **2,346 passed, 0 failed,
3 skipped**, and the mixed PDF and skills receipts report **94/94** and **46/46**.
These totals agree with the public WP2 summary. The initial load failure and
reviewed cleanup-reserve correction remain documented.

Guidance accurately distinguishes the legacy dependency summary, actual raster
contracts, unchanged OCR version gate, and untested recognition, table-row
fidelity and automatic figure detection. It explains the half-deadline
termination reserve, scheduling limits, deliberate-daemon containment exclusion,
and corrected-source versus installed-release distinction. Exact identities
remain in private receipts; the reviewed public changes contain no owner/home
paths or unrelated private project names.

Independent checks:

```sh
node scripts/clip-pdf.mjs --help
node --test test/clip-args.test.mjs
git diff --check
```

Help agrees with the new behavior; CLI tests passed **9/9** and whitespace
validation passed. No full-suite rerun was needed for this review. Linux/macOS
process supervision remains pending CI. No source or wiki edits were made.
