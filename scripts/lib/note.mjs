// The vault uses flat YAML metadata, quoted flow lists and block sequences.
// This intentionally does not implement nested YAML objects or executable tags.
export function normalizeIdentity(value) { return String(value ?? '').trim().toLowerCase(); }

export function withoutComment(value) {
  let quote = null;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (quote) {
      if (quote === '"' && c === '\\') { i++; continue; }
      if (c === quote) {
        if (quote === "'" && value[i + 1] === "'") { i++; continue; }
        quote = null;
      }
    } else if ((c === '"' || c === "'") && (!value.slice(0, i).trim() || /[,[{]\s*$/.test(value.slice(0, i)))) quote = c;
    else if (c === '#' && (i === 0 || /\s/.test(value[i - 1]))) return value.slice(0, i);
  }
  return value;
}

function scalar(value) {
  const s = withoutComment(value).trim();
  if (s.startsWith('"') && s.endsWith('"')) {
    try { return JSON.parse(s); } catch { return s.slice(1, -1); }
  }
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  return s;
}

function flowList(value) {
  const out = [];
  let start = 0, quote = null, depth = 0;
  const inner = value.slice(1, -1);
  for (let i = 0; i <= inner.length; i++) {
    const c = inner[i];
    if (quote) {
      if (quote === '"' && c === '\\') { i++; continue; }
      if (c === quote) {
        if (quote === "'" && inner[i + 1] === "'") { i++; continue; }
        quote = null;
      }
    } else if ((c === '"' || c === "'") && !inner.slice(start, i).trim()) quote = c;
    else if (c === '[') depth++;
    else if (c === ']') depth--;
    else if ((c === ',' && depth === 0) || i === inner.length) {
      const item = scalar(inner.slice(start, i));
      if (item) out.push(item);
      start = i + 1;
    }
  }
  return out;
}

const FRONTMATTER = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const STRAY_CR = /\r(?!\n)/;

// A page that opens with a frontmatter fence either has its metadata read or it is damaged: the parser
// cannot match the fence (a doubled carriage return, `---\r\r\n`, or a block that is never closed), or a
// carriage return inside the block is not half of a CRLF. Returns { line, text } for the reader, or null.
// Only the opening region is searched: a stray carriage return in the body does not stop the page parsing.
export function frontmatterDamage(markdown) {
  const text = markdown.replace(/^\uFEFF/, '');
  if (!/^---[ \t\r]*(?:\n|$)/.test(text)) return null;
  const match = text.match(FRONTMATTER);
  const region = match ? match[0] : text.split('\n', 60).join('\n');
  const stray = region.search(STRAY_CR);
  if (match && stray < 0) return null;
  if (stray < 0) return { line: 1, text: 'The file opens with a frontmatter fence that is not closed, so no metadata was read.' };
  const line = region.slice(0, stray).split('\n').length;
  return { line, text: `Frontmatter has a carriage return that is not part of a CRLF line ending (line ${line}); ${match ? 'the block may be read wrongly' : 'no metadata was read'}.` };
}

// The line (counting from 1) of the first carriage return anywhere in the text that is not half of a CRLF, or 0.
// Unlike frontmatterDamage this looks at the whole page: a stray return in the body leaves the page readable, so it
// is only reported (health, unscored), never counted as a defect.
export function strayCarriageReturn(markdown) {
  const at = markdown.search(STRAY_CR);
  return at < 0 ? 0 : markdown.slice(0, at).split('\n').length;
}

export function parseNote(markdown) {
  const match = markdown.match(FRONTMATTER);
  const metadata = {};
  const body = match ? markdown.slice(match[0].length) : markdown;
  const lines = (match?.[1] ?? '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const field = lines[i].match(/^([\w-]+):[ \t]*(.*)$/);
    if (!field) continue;
    const [, key, value] = field;
    const trimmed = withoutComment(value).trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      metadata[key] = flowList(trimmed);
    } else if (!trimmed) {
      const list = [];
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
        list.push(scalar(lines[++i].replace(/^\s*-\s+/, '')));
      }
      metadata[key] = list.length ? list : '';
    } else metadata[key] = scalar(value);
  }
  const strings = value => (Array.isArray(value) ? value : value ? [value] : []).filter(v => typeof v === 'string' && v.length);
  return { body, metadata, sources: strings(metadata.sources), aliases: strings(metadata.aliases) };
}
