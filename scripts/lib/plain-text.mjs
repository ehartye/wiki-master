import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { looksBinaryBytes } from './binary-content.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

// A text file is not a web page. Defuddle cannot read one (measured for a checksum manifest, a dotfile and a package.json served
// as text/plain: the static read fails outright), so a pinned source file or a manifest fell to the browser rung or was queued as
// a failure, and a short one that was read was judged thin. A URL that looks like a text file is fetched for its bytes and kept
// whole, in a fence, with its source, hash and an `extraction: plaintext` mark.
//
// The test is the URL, not a probe of every address: a path ending in a text extension, or anything on the raw GitHub host.
// The answer to "is it really text" is the content type, which the child process reads; a page that answers with HTML goes to
// the ladder as before.
export const MAX_PLAIN_BYTES = 1024 * 1024;

const TEXT_EXTENSIONS = new Set([
  'txt', 'text', 'md', 'markdown', 'rst', 'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'csv', 'tsv', 'log',
  'sha256', 'sha1', 'sha512', 'sum', 'asc', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h',
  'cpp', 'hpp', 'cs', 'sh', 'bash', 'ps1', 'bat', 'sql', 'lua', 'gd', 'glsl', 'wgsl', 'frag', 'vert', 'hlsl', 'gradle', 'cmake',
]);

export function looksLikePlainTextUrl(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.hostname === 'raw.githubusercontent.com') return true;
  // The blob view of a file on a code host is a web page about the file, not the file.
  if (/\/(blob|tree)\//.test(u.pathname) && /(^|\.)(github|gitlab|bitbucket)\./.test(u.hostname)) return false;
  const ext = /\.([a-z0-9]+)$/i.exec(u.pathname)?.[1]?.toLowerCase();
  return Boolean(ext) && TEXT_EXTENSIONS.has(ext);
}

const CHILD = join(dirname(fileURLToPath(import.meta.url)), 'fetch-text-child.mjs');

// Synchronous, because the clipper is: the fetch runs in a child process that prints one line of JSON.
// { ok: true, text, type } | { ok: false, reason } | { ok: false, refused: true, reason }
// `refused` means it is a text URL that must not be clipped (a binary, a file over the size bound); anything else that is not
// ok is simply not a text file, and the ladder takes it.
export function fetchPlainText(url, { run = execFileSync } = {}) {
  try {
    const out = run(process.execPath, [CHILD, url], { encoding: 'utf8', timeout: 40000, maxBuffer: 4 * MAX_PLAIN_BYTES });
    const parsed = JSON.parse(String(out).trim().split('\n').pop());
    return parsed && typeof parsed === 'object' ? parsed : { ok: false, reason: 'unreadable answer' };
  } catch (error) {
    return { ok: false, reason: `fetch failed: ${String(error.message ?? error).slice(0, 120)}` };
  }
}

// The longest run of backticks in the text, plus one (at least three), so the text cannot close its own fence.
export function fenceFor(text) {
  const longest = Math.max(0, ...(String(text).match(/`+/g) ?? []).map((run) => run.length));
  return '`'.repeat(Math.max(3, longest + 1));
}

export function plainTextPage(url, text) {
  const u = new URL(url);
  const name = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? u.hostname);
  const body = String(text).replace(/\r\n/g, '\n').trimEnd();
  const fence = fenceFor(body);
  return { title: name, contentMarkdown: `${fence}\n${body}\n${fence}` };
}

// A page a person saved from a signed-in browser and supplies with --from-file. The extension decides what it is: a text file is the
// page text, unchanged; an HTML file is a page and goes through the extractor like a fetched one. Anything else is neither.
const SUPPLIED_TEXT = new Set(['.md', '.markdown', '.txt']);
const SUPPLIED_HTML = new Set(['.html', '.htm']);
// null when --from-file names a file that can be supplied; otherwise what is wrong, for a message and exit 2.
export function suppliedFileProblem(path) {
  if (!path) return '--from-file needs a path';
  if (suppliedKind(path) === null) return `${path}: a supplied file must be .md, .markdown or .txt (text) or .html or .htm (a page)`;
  try { if (!statSync(path).isFile()) return `${path}: not a file`; }
  catch (error) { return `${path}: ${error.code === 'ENOENT' ? 'no such file' : String(error.message ?? error).slice(0, 120)}`; }
  return null;
}

export function suppliedKind(path) {
  const ext = extname(String(path ?? '')).toLowerCase();
  return SUPPLIED_TEXT.has(ext) ? 'text' : SUPPLIED_HTML.has(ext) ? 'html' : null;
}

// The supplied file's bytes under the same guards as a fetched text file: a size bound (MAX_PLAIN_BYTES) and the binary check
// (a NUL byte, or text that does not decode). { ok: true, text, sha256 } with the hash of the bytes as supplied |
// { ok: false, missing: true, reason } for a path that is not a readable file | { ok: false, refused: true, reason }.
export function readSuppliedFile(path) {
  let size;
  try {
    const info = statSync(path);
    if (!info.isFile()) return { ok: false, missing: true, reason: 'not a file' };
    size = info.size;
  } catch (error) {
    return { ok: false, missing: true, reason: error.code === 'ENOENT' ? 'no such file' : String(error.message ?? error).slice(0, 120) };
  }
  if (size > MAX_PLAIN_BYTES) return { ok: false, refused: true, reason: `supplied file is larger than ${MAX_PLAIN_BYTES / 1024 / 1024} MiB (${size} bytes)` };
  let bytes;
  try { bytes = readFileSync(path); }
  catch (error) { return { ok: false, missing: true, reason: String(error.message ?? error).slice(0, 120) }; }
  if (looksBinaryBytes(bytes)) return { ok: false, refused: true, reason: 'supplied file is binary (a NUL byte or text that does not decode)' };
  return { ok: true, text: bytes.toString('utf8').replace(new RegExp('^' + String.fromCharCode(0xFEFF)), ''), sha256: createHash('sha256').update(bytes).digest('hex') };
}
