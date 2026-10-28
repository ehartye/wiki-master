// A file that is not text, read as text. A model, a sprite or a font decoded as UTF-8 becomes a body of NUL bytes and
// replacement characters, and a clipping of it reads as a source that says nothing. Two signals, either of which settles it:
// a NUL byte (no text file has one), or replacement characters making up 2% or more of the decoded text.
//
// Measured over the 6,788 clippings of one vault: 37 held a NUL byte, 35 of them under gh/ (27 .glb, 7 .fbx, 1 .aseprite) and
// two PDF text layers. No clipping that was not a PDF text layer had 0.5% replacement characters or more; the PDF ones are
// already marked degraded. So the replacement floor is a backstop for a binary format that happens to avoid zero bytes,
// not a rule anything measured here depends on.
const REPLACEMENT_FLOOR = 0.02;

export function looksBinaryText(text) {
  const s = String(text ?? '');
  if (!s.length) return false;
  if (s.includes('\0')) return true;
  const replaced = s.match(/�/g)?.length ?? 0;
  return replaced / s.length >= REPLACEMENT_FLOOR;
}

export function looksBinaryBytes(bytes) {
  if (!bytes?.length) return false;
  if (bytes.includes(0)) return true;
  return looksBinaryText(bytes.toString('utf8'));
}
