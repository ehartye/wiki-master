import { spawn, spawnSync } from 'node:child_process';
import { open as fsOpen, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isIncompleteChain, systemDownloader, systemDownloadArgs, incompleteChainReason } from './tls-chain.mjs';

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

// A source of bytes for stream(): `open(signal)` answers { failure } or { read, stop, end }. `read()` gives the next chunk, or null
// at the end; `stop()` drops the rest unread; `end()` is asked once the bytes are through and answers a failure or null. Aborting
// the signal ends the source.
const fromFetch = (url, fetchImpl) => async (signal) => {
  let response;
  try { response = await fetchImpl(url, { redirect: 'follow', signal }); }
  catch (error) {
    if (signal.aborted) throw error;
    return { failure: { ...fail('FETCH', `${String(error?.cause?.message ?? error?.message ?? error).slice(0, 120)}`), incompleteChain: isIncompleteChain(error) } };
  }
  if (response.status !== 200) return { failure: fail('HTTP', `the server answered ${response.status}`) };
  const reader = response.body.getReader();
  return {
    read: async () => { const { done, value } = await reader.read(); return done ? null : value; },
    stop: () => reader.cancel().catch(() => {}),
    end: async () => null,
  };
};

// The system downloader writing the file to its standard output, so the same first-bytes check, stall limit and writer apply to it.
// It verifies the certificate itself (see tls-chain.mjs); when it fails, its own error text is the reason.
const fromSystem = (tool, url, spawnImpl) => async (signal) => {
  const child = spawnImpl(tool.command, systemDownloadArgs(url), { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let said = '';
  child.stderr?.on('data', (d) => { if (said.length < 2000) said += d; });
  const closed = new Promise((resolve) => {
    child.once('error', (error) => resolve({ error }));
    child.once('close', (code, killedBy) => resolve({ code, killedBy }));
  });
  const kill = () => { try { child.kill(); } catch { /* already gone */ } };
  signal.addEventListener('abort', kill, { once: true });
  const chunks = child.stdout[Symbol.asyncIterator]();
  return {
    read: async () => { try { const { done, value } = await chunks.next(); return done ? null : value; } catch { return null; } },
    stop: async () => { kill(); },
    end: async () => {
      const { error, code, killedBy } = await closed;
      if (!error && code === 0) return null;
      const text = said.replace(/\s+/g, ' ').trim();
      const status = code === 22 ? /error: (\d{3})\b/.exec(text)?.[1] : null;
      if (status) return fail('HTTP', `the server answered ${status}`);
      const how = error ? `${tool.name} could not be started: ${error.code ?? error.message}` : `${tool.name} ${killedBy ? `stopped by ${killedBy}` : `exit ${code}`}`;
      return fail('CHAIN', incompleteChainReason(`${how}${!error && text ? `: ${text.slice(0, 160)}` : ''}`));
    },
  };
};

async function stream(dest, { stallMs, openWriter, open }) {
  const controller = new AbortController();
  let timer;
  let stalled = false;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { stalled = true; controller.abort(); }, stallMs);
  };
  const stall = () => fail('STALL', `the download stalled: no data for ${Number((stallMs / 1000).toFixed(1))} seconds`);
  let writer = null;
  try {
    arm();
    const source = await open(controller.signal);
    if (source.failure) return source.failure;
    let head = Buffer.alloc(0);
    let bytes = 0;
    for (;;) {
      const value = await source.read();
      if (value === null) break;
      arm();
      const chunk = Buffer.from(value);
      if (writer) { await writer.write(chunk); bytes += chunk.length; continue; }
      head = Buffer.concat([head, chunk]);
      if (head.length < MAGIC.length) continue;
      // Decided on the first bytes: anything else is not read further, and nothing is written for it.
      if (!head.subarray(0, MAGIC.length).equals(MAGIC)) {
        await source.stop();
        return fail('NOT_PDF', NOT_PDF);
      }
      writer = await openWriter(dest);
      await writer.write(head);
      bytes = head.length;
    }
    if (stalled) return stall();
    const failure = await source.end();
    if (stalled) return stall();
    if (failure) return failure;
    return writer ? { ok: true, bytes } : fail('NOT_PDF', NOT_PDF);
  } catch (error) {
    if (stalled) return stall();
    if (error?.code === 'ENOSPC') return fail('ENOSPC', 'the disk is full (ENOSPC): the PDF could not be written');
    if (writer) return fail('WRITE', `the PDF could not be written: ${String(error?.message ?? error).slice(0, 120)}`);
    return fail('FETCH', `${String(error?.cause?.message ?? error?.message ?? error).slice(0, 120)}`);
  } finally {
    clearTimeout(timer);
    try { await writer?.close(); } catch { /* the outcome is already decided */ }
    controller.abort();
  }
}

// { ok: true, bytes } | { ok: false, code, reason }, where code is HTTP, NOT_PDF, STALL, ENOSPC, WRITE, FETCH or CHAIN. A download that
// fails leaves no file.
//
// One retry, for one error: when the server sends an incomplete certificate chain, the file is fetched once more by the system
// downloader, which completes the chain and verifies it against the operating system's trust (tls-chain.mjs). Verification is never
// turned off. A success by that route carries `via: 'system-downloader'`; when there is no such downloader, or it fails too, the
// code is CHAIN and the reason names the route that works. `systemTool` is null where the system has none; a test supplies its own,
// and `spawnImpl` to start it.
export async function streamPdf(url, dest, { stallMs = STALL_MS, openWriter = openFile, fetchImpl = fetch, systemTool = systemDownloader(), spawnImpl = spawn } = {}) {
  let { incompleteChain, ...outcome } = await stream(dest, { stallMs, openWriter, open: fromFetch(url, fetchImpl) });
  if (incompleteChain) {
    await rm(dest, { force: true });
    if (!systemTool) outcome = fail('CHAIN', incompleteChainReason());
    else {
      outcome = await stream(dest, { stallMs, openWriter, open: fromSystem(systemTool, url, spawnImpl) });
      if (outcome.ok) outcome = { ...outcome, via: 'system-downloader' };
    }
  }
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
