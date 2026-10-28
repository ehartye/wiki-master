// Fetches one URL and prints one line of JSON (see fetchPlainText in plain-text.mjs). Run as a child process so the synchronous
// clipper can wait for it. Usage: node fetch-text-child.mjs <url>
import { looksBinaryBytes } from './binary-content.mjs';

const MAX = 1024 * 1024;
const TEXT_TYPE = /^(text\/(?!html)|application\/(json|yaml|x-yaml|toml|javascript|x-sh))/i;
const out = (value) => { process.stdout.write(`${JSON.stringify(value)}\n`); };

try {
  const response = await fetch(process.argv[2], { signal: AbortSignal.timeout(25000), redirect: 'follow' });
  const type = response.headers.get('content-type') ?? '';
  if (response.status !== 200) out({ ok: false, reason: `status ${response.status}` });
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
    else out({ ok: true, type, text: bytes.toString('utf8') });
  }
} catch (error) {
  out({ ok: false, reason: `fetch failed: ${String(error.message ?? error).slice(0, 120)}` });
}
