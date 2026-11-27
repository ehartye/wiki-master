import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

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

// A root that cannot be listed: its message is fit to print as it is, and names no matched text.
export class ListingError extends Error {}

// Folders a walk never enters, at any depth: git's data, the vault app's and this plugin's state, the recycle
// folder and installed packages. A `.git` file (a linked worktree's pointer) is skipped too.
export const WALK_SKIP = ['.git', '.obsidian', '.wiki-master', '.recycle', 'node_modules'];
const SKIP = new Set(WALK_SKIP);

// Git's answer for a folder with no repository around it. Matched in the C locale, so a translation cannot hide it.
// A `.git` file that points nowhere gives "not a git repository: <path>" instead, and stays an error.
const NOT_A_REPOSITORY = /^fatal: not a git repository \(or any (?:of the parent directories|parent up to mount point)/m;
const gitMessage = (r) => String(r.stderr ?? '').trim().split(/\r?\n/)[0] || r.error?.message || `exit ${r.status}`;

// How the root is listed: 'git' inside a git work tree, 'not-a-repo' when git finds none around it, 'no-git' when
// git cannot be run at all. Any other git failure is an error: the root is in a repository that git cannot read.
function gitState(root) {
  const r = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, encoding: 'utf8', windowsHide: true, env: { ...process.env, LC_ALL: 'C' } });
  if (r.error?.code === 'ENOENT') return 'no-git';
  if (r.status === 0) return r.stdout.trim() === 'true' ? 'git' : 'not-a-repo'; // 'false': inside a .git folder or a bare repository
  if (NOT_A_REPOSITORY.test(r.stderr ?? '')) return 'not-a-repo';
  throw new ListingError(`the repository cannot be listed: git rev-parse failed: ${gitMessage(r)}`);
}

// Tracked and untracked files that are not ignored; a tracked file deleted in the working tree is skipped.
function gitFiles(root) {
  const r = spawnSync('git', ['-c', 'core.quotePath=false', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  if (r.error || r.status !== 0) throw new ListingError(`the repository cannot be listed: git ls-files failed: ${gitMessage(r)}`);
  if (r.stderr) process.stderr.write(r.stderr); // git's warnings reach the terminal, as they did when git wrote there itself
  return [...new Set(r.stdout.split('\0').filter(Boolean))].sort();
}

// Every file under the root, as root-relative paths with forward slashes, sorted. Skips the WALK_SKIP folders, links
// that leave the root, broken links and links to folders (a folder inside the root is walked where it is, so a link
// back up cannot loop). A link to a file inside the root is read, as a git listing reads a tracked link.
function walkFiles(root) {
  const top = realpathSync(root);
  const inside = (p) => { const rel = relative(top, p); return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)); };
  const files = [];
  const visit = (dir, prefix) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch {
      if (!prefix) throw new ListingError('the root folder cannot be read');
      return; // a folder below the root that cannot be read is skipped, as an unreadable file is
    }
    for (const e of entries) {
      if (SKIP.has(e.name)) continue;
      const full = join(dir, e.name);
      const name = prefix + e.name;
      if (e.isDirectory()) visit(full, `${name}/`);
      else if (e.isFile()) files.push(name);
      else if (e.isSymbolicLink()) {
        try { if (inside(realpathSync(full)) && statSync(full).isFile()) files.push(name); } catch { /* a broken link */ }
      }
    }
  };
  visit(root, '');
  return files.sort();
}

// The files to scan, and whether they came from a walk: null for a git listing, else why no git listing was available.
export function listFiles(root) {
  let st;
  try { st = statSync(root); } catch (err) {
    throw new ListingError(err.code === 'ENOENT' || err.code === 'ENOTDIR' ? 'the root folder does not exist' : 'the root folder cannot be read');
  }
  if (!st.isDirectory()) throw new ListingError('the root is not a folder');
  const state = gitState(root);
  if (state === 'git') return { files: gitFiles(root), walked: null };
  return { files: walkFiles(root), walked: state === 'no-git' ? 'git could not be run' : 'the root is not in a git work tree' };
}

export function scanRepo(root, rules) {
  const hits = [];
  let files = 0;
  const listing = listFiles(root);
  for (const file of listing.files) {
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
  return { hits, files, walked: listing.walked };
}
