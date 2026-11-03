# PDF doctor bounded-probe evidence

Baseline: `cdd9ca371dcfdbcd0f0c47a451bd4687c82dc645` (source after initializer fix; package version 0.89.0).

## TDD then implementation

Before implementation, `node --test test/pdf-doctor.test.mjs` first ran the
false-positive case: **0 passed, 1 failed**. Injected version/help commands
advertised Xpdf table support and exited successfully; PNG commands would exit
99. The existing doctor returned its legacy dependency result without an
`ocrRaster` outcome, failing the required `unusable` assertion. The expanded
14-case suite then failed because the diagnostic helper did not yet exist.

The first implementation passed all 14 cases. Review preparation added three
regressions for invalid IHDR CRC, oversized dimensions and visible nonzero
version results; these ran **0 passed, 3 failed** before the corresponding
implementation correction. The final doctor suite has 20 cases.

## Focused verification

```sh
node --test test/clip-pdf-deps-and-mode.test.mjs test/pdf-extract.test.mjs test/clip-pdf-figures.test.mjs test/pdf-doctor.test.mjs
git diff --check
```

Initial reviewed result: **69 passed, 0 failed, 0 skipped**. Whitespace validation passed.
The existing figure integration fixtures exercised native rendering; their
disposable Git repositories print expected no-upstream diagnostics without test
failure. This is not the full repository or skill-suite result.

Verified cases include distinct OCR and figure arguments and fresh output
directories; malformed, empty, absent, invalid-CRC and invalid-dimension PNG
headers; renderer failure and timeout; missing versus unstartable commands;
stderr-only help; nonzero versions with successful rendering; different OCR
PATH and figure fallback selections; legacy result compatibility; missing
figure prerequisites; shared budget exhaustion and shortened final timeout;
cleanup failure reporting; and CLI exit zero for completed unavailable-tool
diagnostics with no vault or temporary-parent leftovers.

A real Node child was timed out, killed and verified no longer addressable by
PID. A real output-flood child verified bounded capture and unusable reporting.
The initial direct-child check was insufficient: independent review reproduced
a surviving detached descendant. That finding is corrected below. The fixture
checks the expected PNG header, not a full pixel decode or arbitrary-document
compatibility.

## Independent-review correction: process-tree lifetime

The same author added the real detached-child regression before changing the
runner. `node --test --test-name-pattern="owned process tree"
test/pdf-doctor.test.mjs` failed **0 passed, 1 failed** because the detached
descendant remained addressable after timeout. The fixture terminated its
survivor in `finally`.

The corrected doctor is asynchronous; ordinary `main()` clipping remains
synchronous, and only its doctor branch returns a promise. The CLI awaits it.
The bounded runner reserves half of each five-second deadline
for tree termination. Windows invokes the system `taskkill /T /F` while the
parent is still alive, including detached descendants. POSIX combines a bounded
PID/PPID snapshot with descendant and owned-process-group SIGKILL. Termination
helper time is inside the same per-probe and aggregate budget. Captures stay
bounded, and the runner awaits process closure before deleting output files.

Unconfirmed tree termination stops subsequent subprocesses and preserves the
owned fixture with an explicit cleanup failure instead of claiming success.
The CLI exits nonzero for cleanup/termination failure. Ordinary unavailable
capability results still complete with exit zero.

After the correction the focused four-file command passed **71 tests, 0 failed,
0 skipped**. The final doctor-only suite passed **22/22**, including the real
detached-descendant test on Windows and an injected termination-failure path.
The test uses a detached descendant on POSIX as well; execution of that platform
branch awaits CI. No POSIX execution is claimed from a Windows fixture run.

## Rereview finding and scope disposition

The second independent review reproduced a deliberately daemonizing process:
the launched parent spawned a detached child with ignored stdio, called
`unref()` and exited zero. The diagnostic returned `passed`, and the detached
child remained alive. The reviewer killed that fixture child. The exact
reproduction and original changes-required judgment remain in
`wp1-rereview.md`; this finding has not been presented as a code correction.

The orchestrator explicitly interpreted this work's boundary as bounded probes
of installed native converters, rather than OS containment of arbitrary
daemonizing programs. Under that interpretation, the implementation bounds the
launched converter and terminates traceable descendants on timeout or output
overflow. It does **not** guarantee containment of deliberately detached,
reparented daemons after their parent exits normally. An ordinary converter
pipeline leaving live children or exceeding the diagnostic bounds would still
be a defect. This is an explicit scope interpretation, not proof that arbitrary
child processes cannot escape. WP2 guidance must retain this limitation.

## Full-suite load correction

WP2's first full mixed-toolchain suite exposed a tree-termination failure:
**2345 passed, 1 failed, 3 skipped**. The shortened 1.8-second process-tree
fixture returned while its descendant was still addressable. The same author
added termination-result diagnostics and reran the full suite: **2344 passed,
1 failed, 4 skipped** with the plain toolchain. The captured helper result was
`taskkill /T /F`, `status: null`, `code: ETIMEDOUT`, elapsed 1812 ms.

Changing only the fixture to the actual five-second production limit did not
fix it. The full suite again returned **2344 passed, 1 failed, 4 skipped**;
`taskkill` exhausted its one-second reserve, elapsed 5017 ms. This established a
runner allocation defect under concurrent load rather than merely an overly
short test deadline.

The implementation now reserves half the existing deadline for tree cleanup:
2.5 seconds with the production five-second cap. It starts termination earlier
instead of extending either the individual or thirty-second aggregate budget.
The regression uses the production default, asserts termination succeeded,
verifies the descendant is gone, and checks observed elapsed time against the
five-second deadline plus one second of scheduler tolerance. Its independent
test-harness timeout is fifteen seconds; no sleeps or retries were introduced.
Failure teardown still targets only the fixture's recorded descendant.

The corrected plain-toolchain full suite passed **2345 tests, 0 failed,
4 skipped** (2349 total). The skips are the unavailable table integration, two
file-symlink permissions and the unset private-term dictionary. The subsequent
mixed-toolchain rerun and fresh review belong to WP2. Raw machine-local failure
logs remain outside the public repository; this record preserves the exact
failure classification and counts without publishing machine paths.

## Synthetic stream correction

WP2 review found that the fixture declared a 22-byte content stream while the
actual bytes, including the newline, occupied 24 bytes. Earlier successful native
rasters emitted recovery warnings; those warning-bearing receipts are retained.
The same author first added an exact stream-length and cross-reference-offset
regression. It failed **0 passed, 1 failed**, with `22 !== 24`, before the fix.
`syntheticPdf()` now derives `/Length` from `Buffer.byteLength(stream)`.

After this narrow correction, doctor tests passed **23/23** and the seven-file
PDF suite with existing process-scoped Xpdf text plus Poppler rendering passed
**95/95**, zero failures or skips. Both inherited and mixed native doctor probes
passed the OCR and figure contracts with exit zero and **empty renderer stderr**;
cleanup passed. Corrected native receipts are retained privately alongside the
earlier warnings, rather than replacing them. Whitespace validation passed.

The earlier complete local repository runs remain historical pre-fixture-fix
evidence. They were not relabeled as covering this final correction; affected
doctor/native/PDF checks cover it locally and final full CI must cover the latest
source before delivery.

## Native smoke and scope

`node scripts/clip-pdf.mjs --doctor` passed both actual raster contracts with the
inherited Poppler tools, allowed the unchanged runtime OCR version gate and
cleaned its temporary directory. The legacy dependency summary remained false
because that text extractor did not advertise `-table`. Detailed native/mixed
integration belongs to WP2; this smoke does not establish table fidelity, OCR
recognition or automatic figure detection.

No normal extraction/runtime resolver policy was changed. Doctor reuses the
existing capability parser and figure resolver through bounded injected probes,
before ordinary startup's unbounded dependency collection. Bare executable
invocations explicitly report unresolved identity; absolute selected commands
report their path. No release, installed-cache update or delivery is claimed.
