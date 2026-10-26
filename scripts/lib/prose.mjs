export const blank = text => text.replace(/[^\r\n]/g, ' ');

// Preserve offsets so diagnostics always refer to the original file. This is a
// wikilink scanner, not a renderer: headings and external URLs are not checked.
// Code (fenced, indented, inline) and comments are blanked: a `[[` named inside them is not a link.
export function prose(text) {
  let fence = null;
  const fenced = text.split(/(?<=\n)/).map(line => {
    const container = line.replace(/^(?: {0,3}>[ \t]?)+/, '');
    const marker = container.match(/^ {0,3}(`{3,}|~{3,})(.*)/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      return blank(line);
    }
    if (marker) { fence = marker[1]; return blank(line); }
    // Indented code is not a navigational edge either.
    return /^(?: {4}|\t)/.test(line) ? blank(line) : line;
  }).join('');
  const comments = fenced.replace(/<!--[\s\S]*?(?:-->|$)|%%[\s\S]*?(?:%%|$)/g, blank);
  const runs = [...comments.matchAll(/`+/g)];
  let result = '', cursor = 0;
  for (let i = 0; i < runs.length; i++) {
    const close = runs.findIndex((run, j) => j > i && run[0].length === runs[i][0].length);
    if (close < 0) continue;
    const end = runs[close].index + runs[close][0].length;
    result += comments.slice(cursor, runs[i].index) + blank(comments.slice(runs[i].index, end));
    cursor = end;
    i = close;
  }
  return result + comments.slice(cursor);
}
