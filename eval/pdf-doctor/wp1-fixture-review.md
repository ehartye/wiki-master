# PDF doctor synthetic-fixture correction review

Result: **PASS** for the narrow fixture correction.

The content stream is now defined once and its `/Length` is computed with
`Buffer.byteLength(stream)`. The emitted stream is exactly 24 bytes, including
its final newline. Object offsets and `startxref` remain computed from emitted
bytes. This resolves the prior 22-byte declaration without changing the raster
commands, process runner, or normal clipping behavior.

Independent verification:

```sh
node --test --test-name-pattern="synthetic PDF stream length" test/pdf-doctor.test.mjs
git diff --check
```

The regression passed **1/1** and checks both exact stream length and
cross-reference offsets. Whitespace validation passed. An independent native
`diagnosePdf()` run also passed both raster contracts: OCR produced 300×300 and
figures 200×200, both exited zero with **empty stdout and stderr**, and cleanup
passed. No parser recovery warnings remained.

The privately retained inherited and mixed `native-*-stream-fixed.json` receipts
were inspected. Both have empty renderer stderr, successful output checks and
cleanup. The mixed receipt still distinguishes Xpdf text help/version exit 99
from successful Poppler rasterization; that expected version behavior is not a
synthetic-fixture warning. Earlier warning-bearing receipts and the initial
changes-required review remain retained.

The reported doctor **23/23** and mixed seven-file PDF **95/95** runs cover this
correction. Earlier full local suite counts remain pre-correction historical
evidence; final full Linux/macOS CI must validate the final source before merge.
This narrow review does not erase the prior process-supervision limits or claim
OCR recognition, table fidelity, or automatic figure detection were exercised.

No source or wiki changes were made by this reviewer.
