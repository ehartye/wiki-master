// The fence around a generated catalog in index.md, a roadmap or a project map. Everything inside it is a pure
// function of the pages and is rewritten in full; everything outside it belongs to a person and is never touched.
//
// Three earlier commands each wrote a begin line naming themselves, and vaults still hold those lines, so they are
// accepted as fences and replaced on the next write. A machine still on an old plugin version can append an old
// fence beside a new one, and a line-union merge can leave two begin lines inside one fence. So a write always ends
// with exactly one new fence, wherever and however many it found.

const DASH = '—';
const beginFor = (script) => `%% BEGIN GENERATED CATALOG ${DASH} edits inside this fence are overwritten; run scripts/${script}.mjs %%`;

export const BEGIN_MARK = beginFor('refresh-index');
export const END_MARK = '%% END GENERATED CATALOG %%';
export const LEGACY_BEGIN_MARKS = Object.freeze(['index-gen', 'backlog-gen', 'moc-authored-gen'].map(beginFor));

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MARKER = new RegExp([BEGIN_MARK, ...LEGACY_BEGIN_MARKS, END_MARK].map(escape).join('|'), 'g');

// Each fence in `text`, in order: `start` and `end` are offsets, the end marker included. A fence runs from the first
// begin line after the previous fence to the next end line, so begin lines between them are inside it. A begin line
// no end line follows is a span of just that line (`closed: false`): nothing after it is generated, so nothing after
// it may be replaced. An end line with no begin before it is ordinary text.
export function fenceSpans(text) {
  const spans = [];
  let open = [];
  for (const m of text.matchAll(MARKER)) {
    if (m[0] !== END_MARK) { open.push({ start: m.index, end: m.index + m[0].length, closed: false }); continue; }
    if (!open.length) continue;
    spans.push({ start: open[0].start, end: m.index + m[0].length, closed: true });
    open = [];
  }
  return [...spans, ...open];
}

// `existing` with `fenced` in place of its first fence and every other fence removed, along with the blank lines
// before each one removed. With no fence, `fenced` is appended and the text is left as it was.
export function writeFence(existing, fenced) {
  const [first, ...extras] = fenceSpans(existing);
  if (!first) return `${existing.trimEnd()}\n\n${fenced}\n`;
  let out = existing.slice(0, first.start) + fenced;
  let cursor = first.end;
  for (const extra of extras) {
    out += existing.slice(cursor, extra.start).trimEnd();
    cursor = extra.end;
  }
  return out + existing.slice(cursor);
}
