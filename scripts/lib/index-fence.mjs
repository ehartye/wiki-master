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

const BEGIN_MARKS = new Set([BEGIN_MARK, ...LEGACY_BEGIN_MARKS]);
const CODE_FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

// The lines of `text` that hold a marker and nothing else, outside any fenced code block: a page that quotes a marker,
// inline or in an example, is talking about a fence, not holding one. Indented code and block quotes need no rule of
// their own, because their lines start with something other than the marker. An opener nothing closes is not code
// here, so a fence appended after it is found on the next run instead of being appended again each time.
function markerLines(text) {
  const lines = [...text.matchAll(/[^\n]*\n?/g)].filter((m) => m[0]).map((m) => ({ start: m.index, text: m[0].trimEnd() }));
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const open = CODE_FENCE.exec(lines[i].text);
    if (open && !(open[1][0] === '`' && open[2].includes('`'))) {
      const closes = (line) => {
        const close = CODE_FENCE.exec(line.text);
        return close && close[1][0] === open[1][0] && close[1].length >= open[1].length && !close[2].trim();
      };
      const offset = lines.slice(i + 1).findIndex(closes);
      if (offset >= 0) { i += offset + 1; continue; }
    }
    if (lines[i].text === END_MARK || BEGIN_MARKS.has(lines[i].text)) found.push(lines[i]);
  }
  return found;
}

// Each fence in `text`, in order: `start` and `end` are offsets, the end marker included. A fence runs from the first
// begin line after the previous fence to the next end line, so begin lines between them are inside it. A begin line
// no end line follows is a span of just that line (`closed: false`): nothing after it is generated, so nothing after
// it may be replaced. An end line with no begin before it is ordinary text.
export function fenceSpans(text) {
  const spans = [];
  let open = [];
  for (const line of markerLines(text)) {
    const end = line.start + line.text.length;
    if (line.text !== END_MARK) { open.push({ start: line.start, end, closed: false }); continue; }
    if (!open.length) continue;
    spans.push({ start: open[0].start, end, closed: true });
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
