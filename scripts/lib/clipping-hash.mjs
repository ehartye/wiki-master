// What a clipper hashes, recovered from a stored clipping. Every clipper hashes its bare Markdown with LF line endings and writes
// `${frontmatter}\n\n${md}\n`, so the stored body is that text inside one blank line before and one line break after.
// The hash ignores line endings: the file's CRLF pairs and lone CRs are made LF first, the way Canonical XML, OpenPGP text
// signatures and Sphinx normalize text before digesting it. A vault's Git attributes (`text=auto eol=lf`) rewrite line endings
// on commit and checkout, so only a hash that ignores them still matches after a commit, a checkout or a transfer.
// Removing exactly the framing, and nothing else, gives back the writer's hash for a file it wrote; trimming more would lose
// the trailing space or line break that some Markdown legitimately ends with. The writer appends exactly one line feed, so
// exactly one is removed.
import { createHash } from 'node:crypto';

// CRLF and any lone CR become LF. Every writer applies this to its Markdown before it hashes and writes it.
export const normalizeLineEndings = (text) => String(text).replace(/\r\n?/g, '\n');

const FRONTMATTER = /^---\n[\s\S]*?\n---\n?/;

export function clipperText(fileText) {
  const text = normalizeLineEndings(fileText);
  const m = text.match(FRONTMATTER);
  const body = m ? text.slice(m[0].length) : text;
  return body.replace(/^\n/, '').replace(/\n$/, '');
}

export const clippingHash = (fileText) => createHash('sha256').update(clipperText(fileText)).digest('hex');
