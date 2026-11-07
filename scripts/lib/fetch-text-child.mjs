// Fetches one URL and prints one line of JSON (see fetchPlainText in plain-text.mjs). Run as a child process so the synchronous
// clipper can wait for it. Usage: node fetch-text-child.mjs <url> [--same-origin]
//
// --same-origin is for an address the clipper guessed (a plain-text twin): redirects are followed one at a time, and one that leaves the
// address's origin is refused before any request is made to it. Without it, the address the user typed follows redirects anywhere.
import { looksBinaryBytes } from './binary-content.mjs';

const MAX = 1024 * 1024;
const TEXT_TYPE = /^(text\/(?!html)|application\/(json|yaml|x-yaml|toml|javascript|x-sh))/i;
const out = (value) => { process.stdout.write(`${JSON.stringify(value)}\n`); };

const sameOrigin = process.argv.includes('--same-origin');
const MAX_HOPS = 5;

// Fetch one hop at a time, so the Location can be judged before it is requested. The response keeps its `url` as the last address asked.
async function fetchWithinOrigin(start, signal) {
  const origin = new URL(start).origin;
  let current = start;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const response = await fetch(current, { signal, redirect: 'manual' });
    const location = response.headers.get('location');
    if (![301, 302, 303, 307, 308].includes(response.status) || !location) return { response, url: current };
    await response.body?.cancel().catch(() => {});
    let next;
    try { next = new URL(location, current); } catch { return { refusal: 'redirect to an address that is not a URL' }; }
    if (next.origin !== origin) return { refusal: 'redirect to another origin' };
    current = next.href;
  }
  return { refusal: 'too many redirects' };
}

try {
  const signal = AbortSignal.timeout(25000);
  const { response, url: finalUrl, refusal } = sameOrigin
    ? await fetchWithinOrigin(process.argv[2], signal)
    : { response: await fetch(process.argv[2], { signal, redirect: 'follow' }) };
  const type = response?.headers.get('content-type') ?? '';
  if (refusal) out({ ok: false, reason: refusal });
  else if (response.status !== 200) out({ ok: false, reason: `status ${response.status}` });
  else if (!TEXT_TYPE.test(type)) out({ ok: false, reason: `content type ${type || 'unknown'}` });
  else {
    const chunks = [];
    let size = 0;
    let over = false;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > MAX) { over = true; break; }
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    if (over) out({ ok: false, refused: true, reason: `larger than ${MAX} bytes` });
    else if (looksBinaryBytes(bytes)) out({ ok: false, refused: true, reason: 'binary content served as text' });
    // finalUrl: where the redirects ended. A caller that guessed this address (a plain-text twin) must know it was not sent elsewhere.
    else out({ ok: true, type, text: bytes.toString('utf8'), finalUrl: finalUrl ?? response.url });
  }
} catch (error) {
  out({ ok: false, reason: `fetch failed: ${String(error.message ?? error).slice(0, 120)}` });
}
