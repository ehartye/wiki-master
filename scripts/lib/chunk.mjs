// Splits markdown into embeddable chunks along structural boundaries rather
// than blind character offsets -- a chunk that begins mid-sentence embeds
// poorly. Pure: no node:fs, no child_process. See
// docs/superpowers/specs/2026-08-09-chunk-semantic-index-design.md section 5.1.
//
// Strategy, in preference order:
//   1. Heading boundaries (`^#{1,6} `) -- split so each chunk holds whole
//      sections, coalescing consecutive small sections up to ~targetChars.
//   2. Paragraph boundaries (blank-line-separated blocks) when there are no
//      headings to anchor on.
//   3. A hard character split for a single unbroken run with neither (e.g.
//      one 20,000-char line) -- the only case with nowhere else to cut.
//
// Every chunk's `text` is prefixed with "<title> › <heading path>" so a
// chunk deep in a long document still carries the topical fingerprint that
// made page-level truncated embedding retrieve well (design spec section
// 5.1). Frontmatter (a leading `---`...`---` block) rides along with the
// FIRST chunk only -- repeating it into every chunk would waste embedding
// budget on the same boilerplate over and over.

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

// Builds "H2 › H3 › ..." from the stack of open headings, dropping the hash
// marks. Level-1 headings are excluded: a document's single H1 is
// conventionally the same as its page title (already the first segment of
// the prefix -- see prefixFor), so including it would duplicate that
// segment rather than add information. An empty stack (no sub-headings yet,
// or none in the whole doc) yields '' -- see prefixFor.
function headingPathString(stack) {
  return stack.filter((h) => h.level > 1).map((h) => h.text).join(' › ');
}

function prefixFor(title, headingPath) {
  const line = headingPath ? `${title} › ${headingPath}` : title;
  return `${line}\n\n`;
}

// Splits the raw source into lines, preserving the ability to reconstruct
// 1-indexed line numbers. A trailing newline does not create a phantom extra
// line (mirrors how editors count lines).
function splitLines(text) {
  const lines = text.split('\n');
  if (lines.length > 0 && lines.at(-1) === '') lines.pop();
  return lines;
}

// Walks the line array and groups it into "blocks": either a single heading
// line, or a run of contiguous non-heading lines (which may itself contain
// blank-line-separated paragraphs, handled by the paragraph fallback below).
function blockify(lines) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(HEADING_RE);
    if (m) {
      blocks.push({ type: 'heading', level: m[1].length, text: m[2].trim(), startLine: i + 1, endLine: i + 1 });
      i++;
      continue;
    }
    const start = i;
    while (i < lines.length && !lines[i].match(HEADING_RE)) i++;
    blocks.push({ type: 'body', startLine: start + 1, endLine: i, lines: lines.slice(start, i) });
  }
  return blocks;
}

// Splits a body block into paragraph sub-blocks on blank lines, each keeping
// its own line span. A body block that is entirely blank contributes nothing.
function paragraphize(block) {
  const paras = [];
  let start = null;
  let buf = [];
  for (let j = 0; j < block.lines.length; j++) {
    const line = block.lines[j];
    if (line.trim() === '') {
      if (buf.length) {
        paras.push({ startLine: block.startLine + start, endLine: block.startLine + start + buf.length - 1, text: buf.join('\n') });
        buf = [];
        start = null;
      }
      continue;
    }
    if (start === null) start = j;
    buf.push(line);
  }
  if (buf.length) {
    paras.push({ startLine: block.startLine + start, endLine: block.startLine + start + buf.length - 1, text: buf.join('\n') });
  }
  return paras;
}

// Hard character split of a single unbroken paragraph that is itself over
// targetChars (e.g. one 20,000-char line, no blank lines, no headings). There
// is no structural boundary to prefer here, so this is the last resort.
// Since the source is a single line, every produced piece reports the SAME
// 1-indexed line span (that one line) -- there is nowhere finer to point.
function hardSplit(paraText, startLine, endLine, targetChars, overlapChars) {
  const pieces = [];
  let pos = 0;
  const step = Math.max(1, targetChars - overlapChars);
  while (pos < paraText.length) {
    const end = Math.min(paraText.length, pos + targetChars);
    pieces.push({ text: paraText.slice(pos, end), startLine, endLine });
    if (end >= paraText.length) break;
    pos += step;
  }
  return pieces;
}

export function chunkMarkdown(text, { title, targetChars = 1200, overlapChars = 150 } = {}) {
  if (!text) return [];

  const fmMatch = text.match(FRONTMATTER_RE);
  const frontmatter = fmMatch ? fmMatch[0] : '';
  const rest = fmMatch ? text.slice(fmMatch[0].length) : text;
  // Frontmatter occupies the leading N lines of the ORIGINAL document (N =
  // count of newlines it contains, since it always starts at line 1). Every
  // line number computed below is local to `rest` and must be shifted by
  // this offset before being reported, or a chunk past the frontmatter would
  // point at the wrong source line.
  const lineOffset = frontmatter ? (frontmatter.match(/\n/g) || []).length : 0;

  const lines = splitLines(rest);
  if (lines.length === 0) return [];

  const blocks = blockify(lines);

  // Flatten blocks into a linear list of "units": heading markers (which
  // update the heading-path stack but carry no body text of their own) and
  // paragraph units (which carry text and a line span). This is the common
  // sequence the packer below walks, regardless of whether headings exist.
  const units = [];
  for (const block of blocks) {
    if (block.type === 'heading') {
      units.push({ kind: 'heading', level: block.level, text: block.text, startLine: block.startLine, endLine: block.endLine });
    } else {
      for (const para of paragraphize(block)) {
        units.push({ kind: 'para', text: para.text, startLine: para.startLine, endLine: para.endLine });
      }
    }
  }

  const chunks = [];
  let headingStack = []; // stack of {level, text}, active heading path
  let current = null; // { startLine, endLine, headingPath, bodyLines: [{text, startLine, endLine}] }

  function currentLength() {
    if (!current) return 0;
    return current.bodyLines.reduce((n, l) => n + l.text.length + 1, 0);
  }

  function flush() {
    if (!current || current.bodyLines.length === 0) { current = null; return; }
    const bodyText = current.bodyLines.map((l) => l.text).join('\n\n');
    chunks.push({
      text: bodyText,
      startLine: current.startLine,
      endLine: current.endLine,
      headingPath: current.headingPath,
    });
    current = null;
  }

  function startNew(headingPath) {
    current = { startLine: null, endLine: null, headingPath, bodyLines: [] };
  }

  function addBody(u) {
    if (!current) startNew(headingStack.length ? headingPathString(headingStack) : '');
    if (current.startLine === null) current.startLine = u.startLine;
    current.endLine = u.endLine;
    current.bodyLines.push({ text: u.text, startLine: u.startLine, endLine: u.endLine });
  }

  for (const u of units) {
    if (u.kind === 'heading') {
      // A new heading always starts a fresh chunk (heading-aware splitting),
      // UNLESS the current chunk is still well under budget -- small
      // consecutive sections coalesce rather than each becoming its own
      // tiny, context-starved chunk.
      if (current && currentLength() >= targetChars * 0.5) {
        flush();
      }
      while (headingStack.length && headingStack.at(-1).level >= u.level) headingStack.pop();
      headingStack.push({ level: u.level, text: u.text });
      continue;
    }
    // Body/paragraph unit. A single unbroken run (no blank line inside it)
    // that is itself over budget needs a hard split regardless of whether
    // headings exist elsewhere in the document -- one oversized paragraph
    // under a heading is still "a single unbroken run with neither [a
    // heading nor a paragraph boundary]" (requirement 1's last resort), and
    // leaving it whole would defeat chunking's purpose of staying under the
    // embedding model's context window.
    if (u.text.length > targetChars * 1.5) {
      flush();
      const path = headingStack.length ? headingPathString(headingStack) : '';
      for (const piece of hardSplit(u.text, u.startLine, u.endLine, targetChars, overlapChars)) {
        chunks.push({ text: piece.text, startLine: piece.startLine, endLine: piece.endLine, headingPath: path });
      }
      continue;
    }
    addBody(u);
    if (currentLength() >= targetChars) flush();
  }
  flush();

  // Nothing produced any chunk (e.g. only headings, no body at all) --
  // degenerate but should still not silently drop the document.
  if (chunks.length === 0 && units.length > 0) {
    // All headings, no body text anywhere: emit one chunk per contiguous
    // heading run is overkill; instead emit a single empty-bodied chunk
    // spanning everything so coverage still holds.
    const first = units[0];
    const last = units.at(-1);
    chunks.push({ text: '', startLine: first.startLine, endLine: last.endLine, headingPath: '' });
  }

  // Close coverage gaps. Heading lines and blank-line paragraph separators
  // are structural -- they end up between two units' recorded spans, in
  // neither. Rather than track them as their own content, absorb any such
  // gap into the END of the preceding chunk (its section trails off into
  // the whitespace/heading that follows) so consecutive spans are truly
  // contiguous, no gap. This is a no-op for hard-split pieces of a single
  // unbroken line/paragraph: those intentionally share one identical span,
  // so `startLine > prevEndLine + 1` is never true for them.
  if (chunks.length > 0) {
    chunks[0].startLine = 1;
    for (let i = 1; i < chunks.length; i++) {
      if (chunks[i].startLine > chunks[i - 1].endLine + 1) {
        chunks[i - 1].endLine = chunks[i].startLine - 1;
      }
    }
    chunks.at(-1).endLine = Math.max(chunks.at(-1).endLine, lines.length);
  }

  // Apply overlap: prepend the tail of the previous chunk's text (roughly
  // overlapChars worth) to each subsequent chunk, and widen startLine
  // backward to the line that tail text began on, so line spans stay
  // truthful about what a chunk's TEXT actually covers, and the overlap
  // region is genuinely reachable via either chunk's line span.
  for (let i = 1; i < chunks.length; i++) {
    const prev = chunks[i - 1];
    if (!prev.text) continue;
    const overlapText = prev.text.slice(-overlapChars);
    if (!overlapText) continue;
    chunks[i].text = overlapText + '\n\n' + chunks[i].text;
    // Widen the start of this chunk's line span backward: the overlap text
    // came from somewhere within prev's line span, so pull startLine back
    // proportionally to the previous chunk's span rather than claiming a
    // precise (and false) line number. A simple, defensible choice: the
    // overlap makes this chunk start no later than prev.endLine, so a
    // search hit landing in the overlap still resolves to a real line
    // within the previous chunk's own span, not before it.
    chunks[i].startLine = Math.min(chunks[i].startLine, prev.endLine);
  }

  // Shift every line number from "local to `rest`" to "in the original
  // document" now that all splitting/overlap math (which only cares about
  // relative positions) is done.
  if (lineOffset) {
    for (const c of chunks) {
      c.startLine += lineOffset;
      c.endLine += lineOffset;
    }
  }

  // Prefix every chunk with title + heading path, and the first chunk with
  // frontmatter (never repeated into later chunks). The first chunk's TEXT
  // includes the frontmatter block, which starts at line 1 of the document,
  // so its reported startLine widens back to 1 to match what it covers.
  for (let i = 0; i < chunks.length; i++) {
    const prefix = prefixFor(title, chunks[i].headingPath);
    const fm = i === 0 && frontmatter ? frontmatter + '\n' : '';
    chunks[i].text = fm + prefix + chunks[i].text;
    if (i === 0 && frontmatter) {
      chunks[i].startLine = 1;
    }
  }

  return chunks;
}
