When converters answer version queries but reject the required PNG arguments,
PDF doctor now reports the failed raster capability separately from its legacy
dependency summary. It exercises the actual OCR and figure raster commands on
a synthetic page, bounds probe execution/output, validates the expected PNG
header, and reports the unchanged OCR version gate and untested capabilities.
Normal clipping behavior is unchanged. Setup, researcher preflight and CLI help
explain the distinction and the older installed-release limitation.

Final focused validation: doctor 23/23 and PDF suite 95/95 in a process-scoped
mixed Xpdf text/Poppler renderer environment. Skills passed 46/46 and CLI
argument/help checks 9/9. The full local repository suite passed 2,346 tests,
0 failed, 3 skipped before the final synthetic-stream correction; full
Linux/macOS CI must validate the final source before merge. Local skips were
two file-symlink permission fixtures and the unset private-term dictionary.
Final native inherited/mixed rendering passed both contracts with empty
renderer stdout/stderr. Earlier complete-Xpdf selection reproduced exit-99
raster failures despite a true legacy dependency summary.

The full run first exposed insufficient process-tree termination time under
load. The corrected runner reserves half of the same five-second probe deadline
for termination, and the reviewed correction passed the repeated full suite.
Review also found that native converters recovered from an incorrect synthetic
PDF stream length. The fixture now computes its length from emitted bytes,
with a regression for length and cross-reference offsets and fresh warning-free
native verification. Red/green evidence and the original findings are retained
in `eval/pdf-doctor/`.

Probe supervision is not OS containment for deliberately daemonizing programs.
Raster success does not establish recognition accuracy, table fidelity or
automatic figure-selection coverage. No release or installed-cache update is
included.
