import { stemOf } from './clip-names.mjs';
import { prose } from './integrity.mjs';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Repoint wikilinks whose target is exactly a renamed path. The target may be
// written with or without `.md`; the alias, a `#heading` and the table-cell
// escape `\|` are kept as written, and so is the form of the target. Links inside
// code fences, inline code and comments are examples, not citations, and stay.
// Matching is by full vault path (never by bare name), case-insensitively.
export function rewriteLinkTargets(text, renames) {
  if (!renames.length) return { text, count: 0 };
  const forms = new Map();
  for (const { from, to } of renames) {
    forms.set(from.toLowerCase(), to);
    forms.set(stemOf(from).toLowerCase(), stemOf(to));
  }
  // prose() treats a backtick pair as a code span, which would also blank the
  // target of a link to a backtick-named file. Neutralise the backticks inside the
  // known old paths first (same length, so offsets stay valid), then mask.
  const oldPaths = [...forms.keys()].filter((k) => k.includes('`'));
  let neutral = text;
  for (const old of oldPaths) {
    neutral = neutral.replace(new RegExp(escapeRe(old), 'gi'), (m) => m.replace(/`/g, '\u0001'));
  }
  const mask = prose(neutral);
  let out = '';
  let cursor = 0;
  let count = 0;
  for (const m of mask.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
    const inner = text.slice(m.index + 2, m.index + 2 + m[1].length);
    const cut = inner.search(/\\?\||#/);
    const target = cut < 0 ? inner : inner.slice(0, cut);
    const replacement = forms.get(target.trim().toLowerCase());
    if (replacement === undefined) continue;
    const lead = target.length - target.trimStart().length;
    out += text.slice(cursor, m.index + 2) + target.slice(0, lead) + replacement
      + target.slice(target.trimEnd().length) + (cut < 0 ? '' : inner.slice(cut)) + ']]';
    cursor = m.index + m[0].length;
    count++;
  }
  return count ? { text: out + text.slice(cursor), count } : { text, count: 0 };
}
