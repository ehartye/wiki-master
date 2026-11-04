# PDF doctor process cleanup

Version 0.90.1 corrects the POSIX timeout cleanup used by PDF doctor probes. Normal
PDF clipping and executable selection are unchanged.

The previous implementation signalled descendants and their root immediately,
then treated successful signal delivery as successful termination. Linux CI
retained a descendant in `State: Z` with `PPid: 1`: a dead but unreaped process.
The exact PID-absence assertion was valid. A parent must reap its exited children;
another SIGKILL cannot remove a zombie. See the [Linux wait documentation](https://man7.org/linux/man-pages/man2/wait.2.html).

Cleanup now snapshots the owned ancestry, signals current leaves, and yields while
their parents reap them. Only verified disappearance permits moving up the tree.
Rescans discover children created during cleanup. Pending lifetime identity uses
PID/start time, independent of PPid, so reparenting is not mistaken for disappearance.
The root's `exit` event ends ownership even when inherited pipes delay `close`.
The runner waits for both closure and cleanup verification, including output overflow.

The original five-second per-process and combined diagnostic budgets remain.
Snapshots have bounded output and time, and a 128-round cap prevents endless polling.
Snapshot errors, permission failures, an uncooperative parent, changed ownership or
deadline exhaustion report unusable termination. Subsequent probes stop and the
owned fixture is retained. No delayed signals are sent after completion or root exit.
Windows retains its owned-root `taskkill /T /F` path and shares the close/deadline guards.

This is cleanup for ordinary converter trees, not containment of hostile daemons.
POSIX snapshots and signals cannot eliminate all OS-level PID races, or identify a
process that detached and reparented before observation. A parent that never reaps
can leave a zombie; this remains an explicit cleanup failure, not invented success.

Tests retain strict PID absence checks and protect an unrelated sentinel process.
Portable cases cover multilevel ordering, reparenting, PID replacement, snapshot and
signal errors, root exit with held pipes, close-before-verification, output overflow
and hard deadlines. Failure paths retain fixture evidence without a delayed bare-PID kill.

On Linux, `python3 scripts/test-pdf-cleanup-linux.py [node-executable]` creates a
disposable subreaper supervisor. It deliberately prevents PID 1 from hiding orphan
reaping races. It can reap only children adopted from its own test subtree; any
adopted child still fails the check. The original implementation failed under this
supervisor with an owned zombie; the corrected implementation passed with no adopted
children. CI runs this check in addition to the complete Linux and macOS suites.
