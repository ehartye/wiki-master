# PDF doctor WP1 fresh rereview

Result: **changes required**.

Independent focused command:

```sh
node --test test/clip-pdf-deps-and-mode.test.mjs test/pdf-extract.test.mjs test/clip-pdf-figures.test.mjs test/pdf-doctor.test.mjs
git diff --check
```

Result: **71 passed, 0 failed, 0 skipped**; whitespace check clean. The corrected
Windows timeout regression now terminates its detached descendant. POSIX tree
termination has been inspected but not executed in this Windows review; CI must
exercise it before delivery.

## High: normal completion can still leave an owned descendant

`runOwnedProcess` calls `finish` on the parent's `close` event and performs tree
termination only in `stop`, which is reached for timeout/output overflow. A
parent that starts a detached child with ignored stdio, calls `unref()` on it,
and exits normally therefore returns `passed` without terminating that child.

Independent real-process reproduction:

```js
// Probed parent:
const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
  detached: true,
  stdio: 'ignore',
});
writeFileSync(ownedPidFile, String(child.pid));
child.unref(); // parent exits zero
// Reviewer, after await createProbeRunner({ perProcessMs: 1500 })(...):
process.kill(Number(readFileSync(ownedPidFile, 'utf8')), 0); // succeeds
```

Observed result: `{ outcome: 'passed', status: 0, descendantAlive: true }`, with
no `termination` field. The reviewer explicitly killed this owned descendant
and removed its owned temporary directory.

The saved acceptance requires no owned child after normal completion/failure,
as well as timeout. The timeout fix does not yet satisfy that boundary. Add a
real failing normal-exit descendant regression and make process ownership last
through descendant completion/termination, without exceeding the subprocess and
combined budget or silently weakening the no-orphan guarantee. Fresh review is
required after correction.

## Other checks

Doctor is now the asynchronous branch only; normal clipping keeps its existing
synchronous startup and runtime functions. CLI awaits doctor completion. The
shared runner accounts for bounded termination helper time in the probe's wall
time and stops later probes after unconfirmed termination. Such failures retain
the owned fixture and are reported with a nonzero CLI exit. Raster commands,
separate directories, PNG signature/IHDR/CRC/dimension checks, dependency-only
legacy fields, OCR version gate, and unexercised recognition/detection reporting
remain consistent with the reviewed WP1 scope.
