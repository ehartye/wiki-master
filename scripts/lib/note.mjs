// The vault uses flat YAML metadata, quoted flow lists and block sequences.
// This intentionally does not implement nested YAML objects or executable tags.
export function normalizeIdentity(value) { return String(value ?? '').trim().toLowerCase(); }

function withoutComment(value) {
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

export function parseNote(markdown) {
  const match = markdown.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
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
