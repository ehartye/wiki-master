// `npm test`: runs `node --test <arguments>` with its own temp root, so the suite's temp folders stop piling up in
// the system temp folder. The root is wm-run-XXXXXX under the real temp folder; TMPDIR, TEMP and TMP point at it,
// so every os.tmpdir() in the tests and in the processes they start lands inside it. Tests are not rewritten.
//
//   npm test                         # the whole suite
//   npm test -- test/x.test.mjs      # arguments are passed to node --test
//
// When the run ends it prints how many entries the tests left in the root and how many new wm-* entries appeared
// in the real temp folder outside it (another suite running at the same time adds its own). A passing run removes
// the root; a failing run keeps it and prints its path, because a failed test's leftovers are its evidence. Nothing
// the runner did not create is ever deleted. Exits with the code of node --test, or 128 plus the signal number when
// a signal stopped it.
import { mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { constants, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const wmEntries = (dir) => new Set(readdirSync(dir).filter((n) => n.startsWith('wm-')));

// Started as the entry point, not imported. The loader names a module by its real path, so argv[1] is resolved
// the same way; a start through a link or junction still runs the suite.
function startedDirectly() {
  if (!process.argv[1]) return false;
  let entry = process.argv[1];
  try { entry = realpathSync(entry); } catch { /* compare the spelling given */ }
  return import.meta.url === pathToFileURL(entry).href || import.meta.url === pathToFileURL(process.argv[1]).href;
}

// `node --test` loads every .mjs below test/ as a test file, this one included; only a direct start runs the suite.
if (startedDirectly() && !process.env.NODE_TEST_CONTEXT) {
  const systemTemp = realpathSync(tmpdir());
  const before = wmEntries(systemTemp);
  const root = mkdtempSync(join(systemTemp, 'wm-run-'));
  console.log(`run-suite: temp root ${root}`);
  const child = spawn(process.execPath, ['--test', ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, TMPDIR: root, TEMP: root, TMP: root },
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('close', (code, signal) => {
    const status = code ?? (signal ? 128 + (constants.signals[signal] ?? 0) : 0);
    const left = readdirSync(root).length;
    const outside = [...wmEntries(systemTemp)].filter((n) => !before.has(n) && join(systemTemp, n) !== root).length;
    console.log(`run-suite: left behind: ${left} in the temp root`);
    console.log(`run-suite: new wm-* entries in ${systemTemp} outside the root: ${outside}`);
    if (status === 0) {
      try {
        rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        console.log(`run-suite: removed ${root}`);
      } catch (error) {
        console.log(`run-suite: could not remove ${root}: ${error.message}`);
      }
    } else {
      console.log(`run-suite: kept ${root} (the run failed; its temp folders are evidence)`);
    }
    process.exitCode = status; // not process.exit, which can cut off the lines above when stdout is a pipe
  });
}
