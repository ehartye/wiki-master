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
// A path under the home folder written through its token: `~`, `$HOME`, `${HOME}`, `%USERPROFILE%` or
// `$env:USERPROFILE`, then `/` or `\`. Two segments after the token name a layout (a folder and a repository in it),
// so they are a hit unless the first segment is a dot-folder (where tools keep their config), a segment holds a
// `<placeholder>`, or the path starts with an entry of the allow file. A word, a dot or a slash running into the token
// means it is not one. Windows matches its variable names without regard to case; a shell does not.
const ci = (word) => word.replace(/[A-Za-z]/g, (c) => `[${c.toUpperCase()}${c.toLowerCase()}]`);
const TOKENS = String.raw`(?:~|\$HOME|\$\{HOME\}|%${ci('USERPROFILE')}%|\$${ci('env')}:${ci('USERPROFILE')})`;
// An escaped line end or tab (`\n`, `\r`, `\t` in JSON or source text) before the token still starts a path.
const HOME_TOKEN = new RegExp(String.raw`(?:(?<![\w~.\\/-])|(?<=\\[nrt]))${TOKENS}(?=[\\/])`, 'g');
const STARTS_WITH_TOKEN = new RegExp(String.raw`^${TOKENS}[\\/]`);
// The path runs to the first space, quote, bracket or list punctuation. A backslash before n, r or t that no letter
// follows is an escaped line end or tab in JSON or source text (a tilde underline in a recorded log), not a folder.
const PATH_TAIL = /^(?:(?!\\[nrt](?![A-Za-z0-9]))[^\s'"`()[\]{},;|*?])*/;
const PLACEHOLDER_SEGMENT = /<[^<>]+>/;
const NAMED = /[\p{L}\p{N}]/u; // a segment with no letter or digit (an ellipsis) names no folder

// Each home-relative path on the line, as written: token and path, without the sentence punctuation after it.
function homePaths(s) {
  const found = [];
  for (const m of s.matchAll(HOME_TOKEN)) {
    const tail = PATH_TAIL.exec(s.slice(m.index + m[0].length))[0].replace(/[.,:;!?]+$/, '');
    found.push({ text: m[0] + tail, segments: tail.split(/[\\/]/).filter((seg) => NAMED.test(seg)) });
  }
  return found;
}

const allows = (entry, text) => text === entry || (text.startsWith(entry) && (/[\\/]$/.test(entry) || /^[\\/]/.test(text.slice(entry.length))));

// The home-path-relative rule over an allow list ({ entry, line } items, from parseAllow). `used` collects the entries
// that let a path through; `silent` is the same rule without that record, for the allow file's own lines, whose
// entries would otherwise count as used by themselves.
export function homeRelativeRule(allow = []) {
  const used = new Set();
  const check = (record) => (s) => {
    let hit = false;
    for (const p of homePaths(s)) {
      if (p.segments.length < 2 || p.segments[0].startsWith('.') || p.segments.some((seg) => PLACEHOLDER_SEGMENT.test(seg))) continue;
      const by = allow.filter((a) => allows(a.entry, p.text));
      if (!by.length) hit = true;
      else if (record) for (const a of by) used.add(a.entry);
    }
    return hit;
  };
  return { id: 'home-path-relative', test: check(true), used, silent: { id: 'home-path-relative', test: check(false) } };
}

// The allow file: one home-relative path prefix per line, as the text writes it, each on the line straight after a
// `#` comment that says why it is allowed (GitHub's advice for secret-scanning exclusions: keep each one precise and
// documented). It applies to home-path-relative only. Read at the root of a scan and at the root of a vault.
export const ALLOW_FILE = '.private-terms-allow';
// An allow file that cannot be used: its message names the line, fit to print as it is.
export class AllowFileError extends Error {}

export function parseAllow(text) {
  const entries = [];
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
  let documented = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) { documented = false; continue; }
    if (line.startsWith('#')) { documented = true; continue; }
    if (!documented) throw new AllowFileError(`${ALLOW_FILE} line ${i + 1}: an entry needs a # comment on the line above it saying why it is allowed`);
    if (!STARTS_WITH_TOKEN.test(line)) throw new AllowFileError(`${ALLOW_FILE} line ${i + 1}: an entry must be a home-relative path (~, $HOME, \${HOME}, %USERPROFILE% or $env:USERPROFILE, then / or \\)`);
    // `~/` or `~/plugins` would let through every path below it, and the unused check could never catch that.
    const segments = line.replace(STARTS_WITH_TOKEN, '').split(/[\\/]/).filter(Boolean);
    if (segments.filter((seg) => NAMED.test(seg)).length < 2 || segments.some((seg) => seg === '.' || seg === '..')) {
      throw new AllowFileError(`${ALLOW_FILE} line ${i + 1}: an entry must give at least two folder names after the home token, and no . or .. segment, so that it allows one documented path and not a whole folder`);
    }
    entries.push({ entry: line, line: i + 1 });
    documented = false;
  }
  return entries;
}

// The allow file in a folder, parsed; none (or no such folder) gives no entries. A folder that cannot be read is the
// listing's error, with the listing's message, not the allow file's: the file is read before the listing starts.
export function readAllow(dir) {
  let text;
  try { text = readFileSync(join(dir, ALLOW_FILE), 'utf8'); } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return [];
    try { readdirSync(dir); } catch { throw new ListingError('the root folder cannot be read'); }
    throw new AllowFileError(`${ALLOW_FILE} cannot be read`);
  }
  return parseAllow(text);
}

// Patterns that name a person's machine whatever the list says, with home-path-relative over an allow list.
export function builtinRules(allow = []) {
  return [
    { id: 'home-path-windows', test: (s) => WINDOWS_HOME.test(s) },
    { id: 'home-path-posix', test: (s) => POSIX_HOME.test(s) },
    homeRelativeRule(allow),
    { id: 'gpu-model', test: (s) => GPU.test(s) },
    { id: 'invisible-character', test: hasInvisible },
  ];
}
export const BUILTIN_RULES = builtinRules();

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
  const real = realpathSync.native; // resolves short names and substituted drives, so the root and a link's target compare alike
  const top = real(root);
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
        try { if (inside(real(full)) && statSync(full).isFile()) files.push(name); } catch { /* a broken link */ }
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
    const own = file === ALLOW_FILE ? rules.map((r) => r.silent ?? r) : rules; // its entries do not use themselves up
    for (const h of scanText(buf.toString('utf8'), own)) hits.push({ file, ...h });
  }
  return { hits, files, walked: listing.walked };
}
