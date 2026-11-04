"""Keep orphan reaping local to this test supervisor instead of depending on PID 1.

Only test-owned children are adopted. A correct leaf-first cleanup leaves none.
An adopted zombie is reaped for safety, but remains a failing test result.
"""
import ctypes
import os
from pathlib import Path
import subprocess
import sys

if sys.platform != 'linux':
    raise SystemExit('This process-reaping regression requires Linux prctl.')
libc = ctypes.CDLL(None, use_errno=True)
if libc.prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER
    raise OSError(ctypes.get_errno(), 'PR_SET_CHILD_SUBREAPER')
result = subprocess.run([
    sys.argv[1] if len(sys.argv) > 1 else 'node', '--test',
    '--test-name-pattern=timeout terminates|multilevel detached',
    'test/pdf-doctor.test.mjs',
], cwd=Path(__file__).resolve().parent.parent)
adopted = []
live = False
while True:
    try:
        pid, status = os.waitpid(-1, os.WNOHANG)
        if not pid:
            live = True
            break
        adopted.append({'pid': pid, 'wait_status': status})
    except ChildProcessError:
        break
print(f'Owned adopted children reaped: {adopted}; live adopted children: {live}', flush=True)
raise SystemExit(result.returncode or (1 if adopted or live else 0))
