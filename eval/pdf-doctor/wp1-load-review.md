# PDF doctor WP1 load-correction independent review

Result: **PASS within the recorded native-converter scope**.

This fresh review inspected the saved spec, the earlier review findings and root
scope disposition, the current runner and regression, and the private red/green
full-suite receipts. No source or wiki content was changed by the reviewer.

## Verified correction

The original 1.8-second fixture and the subsequent production-default five-second
fixture both failed under full-suite load because the Windows tree-termination
helper exhausted its reserved time. The retained receipts show `ETIMEDOUT`, a
null helper status, and observed probe durations of 1812 ms and 5017 ms,
respectively. Each full run reported 2344 passes, one failure and four skips.
This is evidence of a runner allocation defect, not merely a short test fixture.

The corrected runner reserves half of the existing per-probe deadline for tree
termination, giving the production default 2.5 seconds for cleanup. It begins
termination earlier; it does not increase the five-second individual or
thirty-second aggregate budget. Helper execution remains bounded by the time
remaining in that same deadline. Unconfirmed termination still stops later
probes and prevents unsafe fixture deletion.

The regression now uses the production default and requires a successful
termination result and a no-longer-addressable descendant. It allows one second
of scheduler tolerance around the five-second internal deadline and has a
separate fifteen-second test-harness limit. It introduces no retries or sleeps.
Failure teardown targets only the fixture's recorded descendant PID.

The corrected full-suite receipt reports **2345 passed, 0 failed, 4 skipped**,
with the process-tree regression completing in 3721 ms. The receipt agrees with
the WP1 evidence summary.

## Independent verification

```sh
node --test test/pdf-doctor.test.mjs
git diff --check
```

The doctor suite passed **22 tests, 0 failures, 0 skips**. The real process-tree
case completed in 2983 ms and asserted successful termination and no live
descendant. Whitespace validation passed. The reviewer did not repeat the full
suite because the retained full-load result and focused execution support this
narrow correction; WP2 still owns its required corrected mixed-toolchain run.

## Limits retained

This review does not broaden the root's stated supervision boundary into OS
containment of intentionally daemonizing programs. The normal-exit detached-daemon
finding remains documented in the earlier rereview. Actual POSIX execution is
still pending Linux/macOS CI. A larger termination reserve makes the effective
converter execution allowance shorter than the maximum five-second probe
budget; documentation must not imply that every converter gets five full
seconds before termination begins. Timer scheduling tolerance is not a claim
of a hard real-time wall-clock guarantee.
