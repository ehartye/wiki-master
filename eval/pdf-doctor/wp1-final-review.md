# PDF doctor WP1 final independent review

Result: **PASS within the explicitly recorded native-converter scope**.

This fresh review is independent of the implementing author and both earlier
reviewers. It retains their findings rather than replacing their evidence.

## Scope disposition

The root orchestrator explicitly interpreted the task as diagnostics for the
installed native converters, with bounded launched processes and termination of
traceable descendants on timeout/output overflow. It is not OS sandbox
containment for a program that deliberately daemonizes, detaches/reparents its
child and exits. The normal-exit adversarial reproduction in `wp1-rereview.md`
remains a real, disclosed limitation. This PASS does not establish the broader
arbitrary-descendant guarantee. WP2 guidance and the delivery record must carry
the same limit. Ordinary converter pipeline leaks and exceeded bounds remain
defects within scope.

## Independent verification

```sh
node --test test/clip-pdf-deps-and-mode.test.mjs test/pdf-extract.test.mjs test/clip-pdf-figures.test.mjs test/pdf-doctor.test.mjs
node scripts/clip-pdf.mjs --doctor
git diff --check
```

The focused suite passed **71 tests, 0 failures, 0 skips**. Whitespace validation
passed. The native doctor invocation passed both raster contracts, retained the
false legacy dependency summary for a Poppler text extractor without `-table`,
allowed the unchanged OCR version gate, and reported successful cleanup.

An additional real ordinary child-pipeline check launched a Node parent which
spawned a non-detached hanging child with inherited stdio and remained alive
through its ordinary child reference. With an 1,800 ms probe budget, the runner
returned `timeout`, reported successful `taskkill /T /F`, and the descendant PID
was no longer live. Measured elapsed time was 1,313 ms. The reviewer removed the
owned temporary fixture. The committed detached-timeout regression also passed.

## Source checks

- Doctor enters bounded collection before the unchanged normal startup probes.
  Only the doctor branch now returns a Promise; the CLI awaits it, while normal
  clipping retains its synchronous behavior.
- OCR and figure probes use the exact specified runtime flags and distinct new
  output directories. PNG validation checks signature, IHDR length/type/legal
  fields, CRC and positive bounded dimensions; it does not claim full decoding.
- Existing text capability parsing and figure executable-selection policy are
  reused through bounded cached probes. Literal invocations disclose unresolved
  identity. Version results and the unchanged runtime OCR gate remain separate
  from actual raster success.
- Per-process deadlines include reserved termination time; the shared budget
  includes resolver/help/version probes and termination-helper wall time. Output
  capture is bounded. Unconfirmed termination stops further probes, retains the
  fixture, and produces a nonzero CLI result instead of unsafe cleanup.
- Legacy dependency-only fields, unavailable-capability exit semantics,
  unexercised OCR recognition/table fidelity/automatic detection limits, and
  human-versus-structured outcomes are consistent.

## Remaining validation

Actual POSIX process-tree execution was not available in this Windows review;
Linux/macOS CI must exercise those paths before integration. WP2 still owns the
full PDF/skill/repository suites and detailed mixed-toolchain native evidence.
This review makes no installed-release or publication claim.
