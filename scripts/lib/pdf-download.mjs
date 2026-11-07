import { spawnSync } from 'node:child_process';
import { open as fsOpen, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Downloading a PDF for clip-pdf.mjs. There is no size cap, as there is none on a local file, so the guard against a download
// that never ends is a stall limit: no data for this long, and it stops. A slow download that keeps moving finishes however
// long it takes. It also stops at the first bytes that are not a PDF, without reading the rest.
export const STALL_MS = 60000;

const MAGIC = Buffer.from('%PDF-');
const NOT_PDF = 'not a PDF: the response does not start with %PDF-';

// The default writer: a file opened for writing. A test supplies its own to make a write fail, or `open` to make the disk take a chunk
// in pieces. handle.write may accept fewer bytes than it was given, so a chunk is written until it is whole; one that accepts
// nothing is an error rather than a loop.
export async function openFile(path, open = fsOpen) {
  const handle = await open(path, 'w');
  return {
    async write(chunk) {
      let done = 0;
      while (done < chunk.length) {
        const { bytesWritten } = await handle.write(chunk, done, chunk.length - done);
        if (!bytesWritten) throw new Error('the disk accepted a write of 0 bytes');
        done += bytesWritten;
      }
    },
    close: () => handle.close(),
  };
}

const fail = (code, reason) => ({ ok: false, code, reason });

async function stream(url, dest, { stallMs, openWriter, fetchImpl }) {
  const controller = new AbortController();
  let timer;
  let stalled = false;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { stalled = true; controller.abort(); }, stallMs);
  };
  let writer = null;
  try {
    arm();
    const response = await fetchImpl(url, { redirect: 'follow', signal: controller.signal });
    if (response.status !== 200) return fail('HTTP', `the server answered ${response.status}`);
    const reader = response.body.getReader();
    let head = Buffer.alloc(0);
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      arm();
      const chunk = Buffer.from(value);
      if (writer) { await writer.write(chunk); bytes += chunk.length; continue; }
      head = Buffer.concat([head, chunk]);
      if (head.length < MAGIC.length) continue;
      // Decided on the first bytes: anything else is not read further, and nothing is written for it.
      if (!head.subarray(0, MAGIC.length).equals(MAGIC)) {
        await reader.cancel().catch(() => {});
        return fail('NOT_PDF', NOT_PDF);
      }
      writer = await openWriter(dest);
      await writer.write(head);
      bytes = head.length;
    }
    return writer ? { ok: true, bytes } : fail('NOT_PDF', NOT_PDF);
  } catch (error) {
    if (stalled) return fail('STALL', `the download stalled: no data for ${Number((stallMs / 1000).toFixed(1))} seconds`);
    if (error?.code === 'ENOSPC') return fail('ENOSPC', 'the disk is full (ENOSPC): the PDF could not be written');
    if (writer) return fail('WRITE', `the PDF could not be written: ${String(error?.message ?? error).slice(0, 120)}`);
    return fail('FETCH', `${String(error?.cause?.message ?? error?.message ?? error).slice(0, 120)}`);
  } finally {
    clearTimeout(timer);
    try { await writer?.close(); } catch { /* the outcome is already decided */ }
    controller.abort();
  }
}

// { ok: true, bytes } | { ok: false, code, reason }, where code is HTTP, NOT_PDF, STALL, ENOSPC, WRITE or FETCH. A download that
// fails leaves no file.
export async function streamPdf(url, dest, { stallMs = STALL_MS, openWriter = openFile, fetchImpl = fetch } = {}) {
  const outcome = await stream(url, dest, { stallMs, openWriter, fetchImpl });
  if (!outcome.ok) await rm(dest, { force: true });
  return outcome;
}

// The same, for a caller that cannot wait on a promise (clip-pdf.mjs is synchronous): the stream runs in a child process, which owns
// the timer, the abort and the write errors and prints one line of JSON. spawnSync gets no `timeout`: that would cap the total time, and
// the point of the stall limit is that a slow download is not capped.
const CHILD = join(dirname(fileURLToPath(import.meta.url)), 'pdf-download-child.mjs');
export function downloadPdf(url, dest, { stallMs = STALL_MS, run = spawnSync } = {}) {
  const r = run(process.execPath, [CHILD, url, dest, String(stallMs)], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  const last = String(r.stdout ?? '').trim().split('\n').pop();
  try {
    const parsed = JSON.parse(last);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch { /* no answer: the child died */ }
  return fail('CHILD', `the download process failed: ${String(r.error?.message ?? r.stderr ?? 'no answer').trim().slice(0, 120)}`);
}
