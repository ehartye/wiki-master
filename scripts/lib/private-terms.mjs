import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// The public repository must not name the owner's other projects or machines (that language belongs in the wiki).
// The private list lives in a file outside the repository: one term per line, matched as a case-insensitive
// substring, or a `/pattern/flags` line for a regular expression (a word that is also ordinary text, such as a
// character name, needs whole-word, case-sensitive matching, which a plain term cannot give). Blank lines and
// lines starting with `#` are skipped. A hit is reported by path, line and rule number, never by the text it matched,
// so a report can be pasted into a public place.

const REGEX_LINE = /^\/(.+)\/([a-z]*)$/;

export function parseTerms(text) {
  const rules = [];
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const id = rules.length + 1;
    const rx = REGEX_LINE.exec(line);
    if (rx) {
      let re;
      try { re = new RegExp(rx[1], rx[2].replace(/[gy]/g, '')); } catch { throw new Error(`terms file line ${i + 1} is not a valid /pattern/flags regular expression`); }
      rules.push({ kind: 'regex', id: `regex #${id}`, test: (s) => re.test(s) });
    } else {
      const needle = line.toLowerCase();
      rules.push({ kind: 'term', id: `term #${id}`, test: (s) => s.toLowerCase().includes(needle) });
    }
  }
  return rules;
}

// Names that stand for "a user" in documentation and CI, so a path through them names nobody.
const PLACEHOLDER = '(?:you|your|name|user|username|me|example|someone|runner|runneradmin|ubuntu|public|default)';
const QUOTES = '\'"`';
const WINDOWS_HOME = new RegExp(String.raw`[A-Za-z]:[\\/]+Users[\\/]+(?!${PLACEHOLDER}\b)(?:[^\s${QUOTES}<>{}$%*\\/])+`, 'i');
const POSIX_HOME = new RegExp(String.raw`(?:^|[\s${QUOTES}(=])/(?:Users|home)/(?!${PLACEHOLDER}\b)(?:[^\s${QUOTES}<>{}$%*/])+/`, 'i');
const GPU = /\b(?:RTX|GTX)\s?\d{3,4}(?:\s?Ti)?\b|\bRX\s?\d{4}\b/;
// Soft hyphen, zero-width and bidirectional controls, line and paragraph separators, word joiners, the byte-order
// mark and the tag characters: none belongs in a source file, and some can hide text from a reviewer. Written as
// code point ranges so that this file contains none of them itself.
const INVISIBLE_RANGES = [[0xAD, 0xAD], [0x200B, 0x200F], [0x2028, 0x2029], [0x202A, 0x202E], [0x2060, 0x206F], [0xFEFF, 0xFEFF], [0xE0000, 0xE007F]];
const hasInvisible = (s) => {
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c >= 0xAD && INVISIBLE_RANGES.some(([lo, hi]) => c >= lo && c <= hi)) return true;
  }
  return false;
};
// Patterns that name a person's machine whatever the list says.
export const BUILTIN_RULES = [
  { id: 'home-path-windows', test: (s) => WINDOWS_HOME.test(s) },
  { id: 'home-path-posix', test: (s) => POSIX_HOME.test(s) },
  { id: 'gpu-model', test: (s) => GPU.test(s) },
  { id: 'invisible-character', test: hasInvisible },
];

export function scanText(text, rules) {
  const hits = [];
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const rule of rules) if (rule.test(lines[i])) hits.push({ line: i + 1, rule: rule.id });
  }
  return hits;
}

const MAX_BYTES = 5 * 1024 * 1024;

// Tracked and untracked files that are not ignored; a tracked file deleted in the working tree is skipped.
export function listFiles(root) {
  const out = execFileSync('git', ['-c', 'core.quotePath=false', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return [...new Set(out.split('\0').filter(Boolean))].sort();
}

export function scanRepo(root, rules) {
  const hits = [];
  let files = 0;
  for (const file of listFiles(root)) {
    let buf;
    try {
      const st = statSync(join(root, file));
      if (!st.isFile() || st.size > MAX_BYTES) continue;
      buf = readFileSync(join(root, file));
    } catch { continue; } // deleted since the index was written, or unreadable
    if (buf.subarray(0, 8000).includes(0)) continue; // binary
    files++;
    for (const h of scanText(buf.toString('utf8'), rules)) hits.push({ file, ...h });
  }
  return { hits, files };
}
