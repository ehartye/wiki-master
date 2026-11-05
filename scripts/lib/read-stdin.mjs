// Reads all of stdin asynchronously rather than via `readFileSync(0)`. A synchronous read throws
// `EAGAIN: resource temporarily unavailable` when stdin is a non-blocking pipe with no data waiting yet. That is the
// shape PowerShell gives a spawned process on Linux and macOS, and also `node a.mjs | node b.mjs` on macOS while the
// writer is still flushing. Async iteration goes through libuv's real async I/O path and does not hit this.
export async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c)))).toString('utf8');
}
