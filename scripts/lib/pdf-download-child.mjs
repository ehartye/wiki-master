// Downloads one PDF and prints one line of JSON (see downloadPdf in pdf-download.mjs). Usage: node pdf-download-child.mjs <url> <dest> <stall-ms>
import { streamPdf } from './pdf-download.mjs';

const [url, dest, stallMs] = process.argv.slice(2);
const outcome = await streamPdf(url, dest, { stallMs: Number(stallMs) || undefined });
process.stdout.write(`${JSON.stringify(outcome)}\n`, () => process.exit(0));
