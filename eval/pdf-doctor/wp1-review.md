# PDF doctor WP1 independent review

Result: **CHANGES REQUIRED**.

Reviewed the saved spec, source diff, diagnostic helper, regression fixtures and
WP1 evidence. Independent focused command:

```sh
node --test test/clip-pdf-deps-and-mode.test.mjs test/pdf-extract.test.mjs test/clip-pdf-figures.test.mjs test/pdf-doctor.test.mjs
git diff --check
```

Result: **69 passed, 0 failed, 0 skipped**; whitespace check passed.

## Required finding: timed-out descendants can survive (high)

`createProbeRunner` in `scripts/lib/pdf-doctor.mjs` delegates termination to
`spawnSync` with `killSignal: 'SIGKILL'`. Its test verifies only the direct PID.
That does not establish the spec's promise to leave no orphan child processes.

Independent Windows reproduction used the real runner with a 1500 ms limit. The
owned Node probe launched another Node process with `detached: true` and
`stdio: 'ignore'`, recorded that child's PID in an owned temporary file, and then
waited indefinitely. The child also waited indefinitely. The runner returned
`outcome: 'timeout'`, but `process.kill(descendantPid, 0)` succeeded afterward.
The review explicitly terminated its surviving descendant and removed its
owned temporary files. A comparison with an ordinary non-detached child did
not leave a surviving descendant on this Windows host.

Sanitized reproduction shape:

```js
// Inside the probed parent, before it waits indefinitely:
const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
  detached: true,
  stdio: 'ignore',
});
writeFileSync(ownedPidFile, String(child.pid));
setInterval(()=>{},1000);
// Outside, after createProbeRunner({ perProcessMs: 1500 }) returns timeout:
process.kill(Number(readFileSync(ownedPidFile, 'utf8')), 0); // succeeds
```

Resolve owned process-tree termination before declaring the diagnostic complete
and before deleting temporary outputs. Add a real process-tree regression (not
only injected timeout results/direct-PID checks), with coverage appropriate to
Windows and POSIX. Any cleanup subprocess must respect the diagnostic bounds;
retain failure visibility if cleanup cannot establish termination. Do not fix
this by weakening the saved no-orphan contract without owner approval.

## Other reviewed behavior

Exact OCR and figure arguments match runtime routes. The doctor branch enters
before the ordinary dependency probes. The bounded adapter feeds the existing
text capability parser and figure resolver. Raster directories are separate and
owned, the expected PNG header checks signature/IHDR fields/CRC/dimensions,
legacy summary remains dependency-only, and version failures remain separate
from successful rendering and the unchanged OCR gate. Human output distinguishes
unexercised recognition and detection. No additional confirmed findings were
identified in this review.

This review does not establish full-suite or native mixed-toolchain integration;
those belong to WP2. Fresh review is required after the process-tree correction.
