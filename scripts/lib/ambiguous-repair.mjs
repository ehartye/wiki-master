import { prose } from './prose.mjs';
import { BEGIN_MARK, END_MARK } from '../backlog-gen.mjs';

// Pure pieces of repair-ambiguous-links.mjs: classify an `ambiguous-link` issue, and repoint bare wikilinks to
// one chosen path. No file access here.

export const projectOf = (path) => path.match(/^wiki\/authored\/([^/]+)\//)?.[1] ?? null;

// The one rule applied without a reading: the page lives in a project's folder and exactly one candidate does
// too. Every other class is named with the reason it needs a person or a different tool. (A generated hub MOC
// that shares a name with a page is no longer a class: since the resolver lets the MOC yield in navigation, it
// is neither ambiguous nor in a candidate list.)
export function classifyAmbiguous(issue) {
  const candidates = issue.candidates ?? [];
  if (candidates.length && candidates.every((c) => c.startsWith('raw/'))) {
    return { class: 'title-citation', reason: 'every candidate is a clipping that shares the cited title; this cannot be repaired from the citing page, rename or retitle the clippings instead' };
  }
  const project = projectOf(issue.source);
  if (project) {
    const inProject = candidates.filter((c) => c.startsWith(`wiki/authored/${project}/`));
    if (inProject.length === 1) return { class: 'same-project', path: inProject[0] };
    if (inProject.length > 1) return { class: 'needs-reading', reason: 'more than one candidate in the project; read the sentence to choose' };
    return { class: 'needs-reading', reason: 'no candidate is in the page\'s own project; read the sentence to choose' };
  }
  return { class: 'shared-page', reason: 'the page is outside every project folder, so the same-project rule gives no answer; the evidence is the project of its inbound citations and neighbours' };
}

const lower = (s) => String(s).trim().toLowerCase();
const LINK = /\[\[([^\]\n]+)\]\]/g;
// Mask what is not a citation: code, comments (prose()) and the generated catalog fence, which regeneration overwrites.
function maskedBody(body) {
  const mask = prose(body).split('');
  const from = body.indexOf(BEGIN_MARK);
  const to = body.indexOf(END_MARK);
  if (from >= 0 && to > from) for (let i = from; i < to + END_MARK.length; i++) if (mask[i] !== '\n' && mask[i] !== '\r') mask[i] = ' ';
  return mask.join('');
}
const hasFence = (text) => text.includes(BEGIN_MARK) && text.indexOf(END_MARK) > text.indexOf(BEGIN_MARK);

// Rewrite the links whose bare target is a key of `wanted` (lower-cased target to vault path). In the body the
// displayed text is kept ([[path|target]]), an existing alias and #heading are kept, and a link in a table row
// uses the escaped separator. A sources: entry takes the full path with no alias. Returns the new text and the
// changed lines.
export function repointBareLinks(text, wanted) {
  const fm = text.match(/^﻿?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
  const split = fm ? fm[0].length : 0;
  let front = text.slice(0, split);
  const body = text.slice(split);
  let count = 0;

  // frontmatter: only the sources: block
  const frontLines = front.split('\n');
  const start = frontLines.findIndex((l) => /^sources:/.test(l));
  if (start >= 0) {
    let stop = start + 1;
    while (stop < frontLines.length && /^(?:\s*$|[ \t]+\S|[ \t]*-\s)/.test(frontLines[stop])) stop++;
    for (let i = start; i < stop; i++) {
      frontLines[i] = frontLines[i].replace(LINK, (whole, inner) => {
        const cut = inner.search(/\\?\||#/);
        const path = wanted.get(lower(cut < 0 ? inner : inner.slice(0, cut)));
        if (!path) return whole;
        count++;
        return `[[${path}]]`;
      });
    }
    front = frontLines.join('\n');
  }

  // body: links outside code, comments and the generated fence
  const mask = maskedBody(body);
  let out = '', cursor = 0;
  for (const m of mask.matchAll(LINK)) {
    const inner = body.slice(m.index + 2, m.index + 2 + m[1].length);
    const cut = inner.search(/\\?\||#/);
    const target = cut < 0 ? inner : inner.slice(0, cut);
    const path = wanted.get(lower(target));
    if (!path) continue;
    const rest = cut < 0 ? '' : inner.slice(cut);
    const lineStart = body.lastIndexOf('\n', m.index - 1) + 1;
    const sep = body.slice(lineStart).trimStart().startsWith('|') ? '\\|' : '|';
    const hasAlias = /^\\?\|/.test(rest) || (rest.startsWith('#') && /\\?\|/.test(rest));
    const next = hasAlias ? `${path}${rest}` : `${path}${rest}${sep}${target.trim()}`;
    out += `${body.slice(cursor, m.index)}[[${next}]]`;
    cursor = m.index + m[0].length;
    count++;
  }
  const after = front + (cursor ? out + body.slice(cursor) : body);
  const a = text.split('\n'), b = after.split('\n');
  const changes = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) changes.push({ line: i + 1, before: a[i].replace(/\r$/, ''), after: b[i].replace(/\r$/, '') });
  return { text: after, count, changes };
}

// A line-by-line check that only wikilinks changed.
export const onlyWikilinksChanged = (changes) => changes.every((c) => c.before.replace(/\[\[[^\]]*\]\]/g, '[[]]') === c.after.replace(/\[\[[^\]]*\]\]/g, '[[]]'));

export const hasGeneratedFence = hasFence;

export function bumpUpdated(text, day) {
  const fm = text.match(/^﻿?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
  if (!fm) return text;
  const head = fm[0].replace(/^updated: [^\r\n]*$/m, `updated: ${day}`);
  return head + text.slice(fm[0].length);
}
