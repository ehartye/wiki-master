// What a clipper hashes, recovered from a stored clipping. Every clipper hashes its bare Markdown and writes
// `${frontmatter}\n\n${md}\n`, so the stored body is that text inside one blank line before and one line break after.
// Removing exactly that framing, and nothing else, gives back the writer's hash for a file it wrote; trimming more would
// lose the trailing space or line break that some Markdown legitimately ends with.
import { createHash } from 'node:crypto';

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

export function clipperText(fileText) {
  const m = fileText.match(FRONTMATTER);
  let body = m ? fileText.slice(m[0].length) : fileText;
  body = body.replace(/^\r?\n/, '').replace(/\r?\n$/, '');
  return body;
}

export const clippingHash = (fileText) => createHash('sha256').update(clipperText(fileText)).digest('hex');
