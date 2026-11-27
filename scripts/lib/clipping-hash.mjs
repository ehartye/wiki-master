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

// ------------------------------------------------------------------ checking a recorded hash
// Hashes recorded before line endings were normalized were made by the old rule: the framing stripped and nothing else, so
// carriage returns stayed in the hashed text. Those hashes are kept as recorded (no clipping is restamped), so a check of a
// clipping against its hash recognises what the old rule hashed as well as the current rule.
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const OLD_FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;
function oldRuleText(fileText) {
  const text = String(fileText);
  const m = text.match(OLD_FRONTMATTER);
  const body = m ? text.slice(m[0].length) : text;
  return body.replace(/^\r?\n/, '').replace(/\n$/, '');
}

// Every status verifyClippingHash returns, in the order it tries them. `match` and `match-raw` are matches; the
// EQUIVALENT_HASH_STATUSES are the same text in another form; only `mismatch` is a defect.
export const CLIPPING_HASH_STATUSES = Object.freeze(['match', 'match-raw', 'crlf-variant', 'trailing-newline', 'mismatch']);
export const EQUIVALENT_HASH_STATUSES = Object.freeze(['crlf-variant', 'trailing-newline']);

/**
 * Classify a clipping's text against the source-hash it records. Returns exactly one status string, the first that holds:
 *  - 'match': clippingHash(fileText), the hash of the LF-normalized body, equals it;
 *  - 'match-raw': the old rule's hash of the body as it is, carriage returns kept, equals it (a clipping whose CRs survived,
 *    in a vault that marks its evidence `-text`);
 *  - 'crlf-variant': the old rule's hash of the same text with CRLF line endings equals it. Two shapes are tried, the body
 *    alone as CRLF (an LF frame around a CRLF body, as a writer wrote it) and the whole file as CRLF (which leaves the CR of
 *    the closing line break in the text). The file has since been converted to LF, typically by `eol=lf` on commit;
 *  - 'trailing-newline': the body with one more final line feed equals it, under the current rule or the old one;
 *  - 'mismatch': none of these; the text is not the text the hash was recorded over.
 * The recorded hash is compared in full, ignoring letter case and surrounding space; a shortened hash is a mismatch.
 * `recorded` must be a non-empty string: a clipping with no source-hash has nothing to verify (health lists it as missing
 * one), so a missing value throws a TypeError rather than reading as a status.
 * @param {string} fileText the whole clipping file, frontmatter included, as read from disk
 * @param {string} recorded the clipping's recorded source-hash value
 * @returns {'match'|'match-raw'|'crlf-variant'|'trailing-newline'|'mismatch'}
 */
export function verifyClippingHash(fileText, recorded) {
  if (typeof recorded !== 'string' || !recorded.trim()) throw new TypeError('verifyClippingHash needs the recorded source-hash');
  const want = recorded.trim().toLowerCase();
  const text = clipperText(fileText);
  if (sha256(text) === want) return 'match';
  const raw = oldRuleText(fileText);
  if (raw !== text && sha256(raw) === want) return 'match-raw';
  const asCrlf = text.replace(/\n/g, '\r\n');
  if (sha256(asCrlf) === want || sha256(`${asCrlf}\r`) === want) return 'crlf-variant';
  if (sha256(`${text}\n`) === want || (raw !== text && sha256(`${raw}\n`) === want)) return 'trailing-newline';
  return 'mismatch';
}
