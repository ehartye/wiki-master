# PDF doctor native integration and guidance

WP2 follows the reviewed WP1 implementation. It changes documentation only;
factual native/CLI verification supplies the check rather than artificial
documentation-mirroring tests. No converter was installed and no persistent
PATH setting was changed.

## Native contracts

The same deterministic one-page synthetic PDF exercised these exact arguments
in separate owned temporary output directories:

```text
pdftoppm -png -r 300 <fixture.pdf> <ocr-prefix>
pdftoppm -r 200 -png -f 1 -l 1 -singlefile <fixture.pdf> <figure-prefix>
```

The inherited and mixed rows below were reverified with the corrected final
synthetic fixture. The shadowed-suite row retains the earlier incompatible-flag
reproduction, before the fixture correction.

| Process-scoped selection | Legacy dependency summary | OCR raster | Figure raster | Unchanged OCR version gate |
|---|---|---|---|---|
| Inherited Poppler text and rendering | `ok: false`, no `-table` | passed, exit 0, 300×300 | passed, exit 0, 200×200 | allowed |
| Existing Xpdf text-only selection, inherited Poppler rendering | `ok: true`, `-table` advertised | passed, exit 0, 300×300 | passed, exit 0, 200×200 | allowed |
| Existing complete Xpdf suite placed first for this child process | `ok: true`, `-table` advertised | unusable, exit 99 | unusable, exit 99 | refused |

All three diagnostics reported successful cleanup. The earlier inherited and
mixed native receipts had exit zero and valid output headers, but also contained
Poppler recovery warnings: `Missing 'endstream' or incorrect stream length` and
`Unknown operator 'endstream'`. They did not establish a warning-free valid PDF
fixture. Review found a 22-byte declared content stream length for 24 emitted
bytes. The WP1 author corrected the length calculation, added a regression for
stream length and cross-reference offsets, and obtained fresh review
(`wp1-fixture-review.md`). Final inherited and mixed native receipts now show
both raster contracts passed with **empty renderer stdout/stderr**, exit zero,
the dimensions listed above and successful cleanup. Earlier warning-bearing
receipts remain retained as historical evidence. The mixed case used the
existing scoped launcher after checking its existing text-only selection. The
collision case changed only the test process environment and restored it.
Separately collected executable-resolution receipts confirm which native paths
were selected; the doctor's bare runtime invocation correctly discloses that it
does not itself establish an absolute identity. Exact machine-local paths,
arguments, output text and timestamps remain in private delivery receipts and
belong in the scoped wiki delivery record, not this public repository.

This establishes representative native rendering, including the historical
presence-success/render-failure mismatch. It does not establish OCR recognition,
table-row fidelity, automatic figure detection, full PNG pixel decoding or
compatibility with arbitrary PDFs. The table integration fixture below separately
exercises the existing table extraction route; doctor still reports table rows
as unverified.

## Suites

```sh
npm ci
node --test test/clip-pdf.test.mjs test/clip-pdf-url-routing.test.mjs test/clip-pdf-tabular.test.mjs test/clip-pdf-figures.test.mjs test/clip-pdf-deps-and-mode.test.mjs test/pdf-extract.test.mjs test/pdf-doctor.test.mjs
npm run test:skills
npm test
git diff --check
```

Dependency installation completed with zero reported vulnerabilities. The
seven-file PDF suite passed **93 tests, 1 skip** in the inherited environment
(the native table test requires Xpdf `-table`). With process-scoped Xpdf text
and Poppler rendering it passed **94 tests, 0 failures, 0 skips**. The skill suite
passed **46 tests, 0 failures, 0 skips** in that mixed environment.

The first mixed-environment full repository run failed: **2,345 passed,
1 failed, 3 skipped** (2,349 total). The failing
`timeout terminates the owned process tree before returning` fixture took
1,827.736 ms with its 1,800 ms test budget; its descendant remained addressable
at the assertion. The fixture's cleanup kills that descendant. The WP1 author
reproduced the failure at the production deadline, corrected the termination
reserve, and obtained fresh review (`wp1-load-review.md`). Focused success alone
did not supersede that failure. Skips were the two file-symlink permission
fixtures and the unset private-term dictionary.

After that reviewed correction, the mixed-toolchain PDF suite passed **94/94**,
the skill suite passed **46/46**, and `npm test` passed **2,346 tests, 0 failed,
3 skipped** (2,349 total, exit 0). The three skips are the two file-symlink
permission fixtures and the unset private-term dictionary. Native Xpdf table
integration ran successfully in this process-scoped mixed environment. The
corrected full run took 94,341.2774 ms; the timeout-tree regression passed. This
full-suite result predates the subsequent synthetic-stream correction and is
historical evidence, not a full-suite claim for the final source.

After the narrow synthetic-stream correction, the doctor suite passed **23/23**
and the mixed seven-file PDF suite passed **95/95**. Fresh review independently
checked the stream regression and warning-free native output. Per the root's
proportional-validation instruction, another full local run was not performed;
the final source still requires full Linux/macOS CI before merge. The earlier
skill and CLI results remain applicable to the unchanged guidance/help paths.

After the help-string correction, the actual `--help` output agreed, CLI
argument/help tests passed **9/9**, and the skill suite passed **46/46** again.
Whitespace validation passed. No runtime or timeout-test change was made by
the WP2 author; the correction and its independent review remain recorded with
WP1, and WP2 supplies the subsequent mixed-environment verification.

## Guidance and limits

The setup reference explains the synthetic raster contracts and their outcomes,
legacy dependency summary, unchanged OCR gate, untested recognition/table/figure
selection, bounded probes, cleanup failures, and older installed-release limits.
It states that half of each probe deadline is reserved for termination: the
default five-second cap gives about 2.5 seconds before converter termination
begins, rather than promising five full seconds of conversion or hard real-time
scheduling.
The researcher preflight points to those distinctions. The CLI help registration
now describes bounded synthetic render probes, verified through actual `--help`.
The current package
version remains 0.89.0; corrected source does not imply release publication or
an installed-cache update.

As recorded in the WP1 reviews, supervision bounds launched native converters
and traceable timeout descendants. It is not OS containment for a deliberately
daemonizing program that detaches/reparents a child and exits. The adversarial
normal-exit finding remains retained; it is not represented as fixed or as proof
of arbitrary-descendant containment. Ordinary converter pipelines remain in
scope. Windows native checks ran here; Linux/macOS process supervision still
requires CI before integration.
