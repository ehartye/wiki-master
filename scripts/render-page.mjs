import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { renderPage, RenderUnavailable } from './lib/render.mjs';

// A one-page browser render, as a subprocess.
//
// clip.mjs drives this with execSync rather than importing renderPage directly,
// for three reasons that all point the same way:
//
//  - clip.mjs's main() is SYNCHRONOUS and imported that way by callers
//    (test/decline.test.mjs calls it and reads .status off the return value).
//    Making it async to await a browser would change that contract for every
//    caller, to buy nothing the subprocess does not already give.
//  - It matches how this codebase already reaches Defuddle: shell out, parse
//    JSON off stdout.
//  - A browser is a large, crash-prone dependency. In its own process, a hung
//    or dead Chrome costs one URL; in-process it would take the whole batch.
//
// The rendered HTML goes to a file rather than stdout because that is what
// Defuddle wants next (`defuddle parse <file>`), and because a multi-megabyte
// document on a pipe is a buffer limit waiting to be hit.

export async function main(argv) {
  const [url, outFile] = argv;
  if (!url || !outFile) {
    console.error('usage: render-page.mjs <url> <out.html>');
    process.exit(2);
  }
  try {
    const { html, finalUrl, status, title, words } = await renderPage(url);
    writeFileSync(outFile, html);
    console.log(JSON.stringify({ htmlFile: outFile, finalUrl, status, title, words }));
  } catch (err) {
    // The two are not the same failure and must not read the same. "No browser
    // installed" is a setup problem the user fixes once for every future URL;
    // "this page timed out" is about one page. Collapsing them would train the
    // user to ignore a message that is telling them the rung never ran at all.
    const unavailable = err instanceof RenderUnavailable;
    console.error(JSON.stringify({ unavailable, error: String(err.message || err).split('\n')[0] }));
    process.exit(unavailable ? 3 : 1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
