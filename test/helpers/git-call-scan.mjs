import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Finds every way a script can start git or gh, and judges each call. It reads source as text, so it works on a copy
// of the scripts and on single lines fed to it by a self-test. Comments, regular expressions and strings that are not
// arguments of a process call are ignored: a message that says "run git push" starts nothing.
//
// A call is judged by its subcommand, which is the first argument after git's own options. An unknown subcommand is
// refused as well as a known write, so a new git call has to be added to a list here on purpose. When the subcommand
// cannot be read from the source the call is refused too, so the scan fails closed.

const GIT_READS = new Set(['status', 'rev-parse', 'remote', 'ls-files', '--version']);
const GIT_WRITES = new Set(['add', 'commit', 'push', 'pull', 'fetch', 'rebase', 'stash', 'reset', 'merge', 'checkout', 'switch', 'rm', 'mv', 'clean', 'restore', 'worktree', 'init', 'clone', 'tag', 'branch']);
const GIT_OPTIONS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']);
const GH_CLONER = 'scripts/clip-gh.mjs';

const PROCESS_APIS = ['execFileSync', 'execFile', 'execSync', 'exec', 'spawnSync', 'spawn', 'serializedExecFileSync'];
const SHELL_LIKE = ['run', 'sh', 'shell'];
const PROGRAM = /^(?:.*[\\/])?(git|gh)(?:\.exe)?$/i;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

// Two copies of the source, offsets intact. `code` has comments and regular expressions blanked. `bare` also has the
// inside of every string blanked, so a call can only be found in real code.
function mask(source) {
  const code = source.split('');
  const bare = source.split('');
  const blank = (from, to, both = true) => {
    for (let k = from; k < to; k++) {
      if (source[k] === '\n') continue;
      bare[k] = ' ';
      if (both) code[k] = ' ';
    }
  };
  const templateBody = (start) => {
    let j = start;
    while (j < source.length) {
      if (source[j] === '\\') { j += 2; continue; }
      if (source[j] === '`') { blank(start, j, false); return { end: j + 1, open: false }; }
      if (source[j] === '$' && source[j + 1] === '{') { blank(start, j, false); return { end: j + 2, open: true }; }
      j++;
    }
    return { end: j, open: false };
  };
  const regexStart = (i) => {
    let j = i - 1;
    while (j >= 0 && /\s/.test(bare[j])) j--;
    if (j < 0) return true;
    if ('(,=:[!&|?{};+-*%<>~^'.includes(bare[j])) return true;
    const word = /([A-Za-z_$][\w$]*)$/.exec(bare.slice(Math.max(0, j - 10), j + 1).join(''));
    return !!word && ['return', 'typeof', 'case', 'of', 'in', 'void'].includes(word[1]);
  };
  const open = [];
  let depth = 0;
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const d = source[i + 1];
    if (c === '/' && d === '/') {
      const end = source.indexOf('\n', i);
      const stop = end < 0 ? source.length : end;
      blank(i, stop);
      i = stop;
    } else if (c === '/' && d === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end < 0 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (c === '\'' || c === '"') {
      let j = i + 1;
      while (j < source.length && source[j] !== c && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1;
      blank(i + 1, j, false);
      i = j + 1;
    } else if (c === '`' || (c === '}' && open.length && open.at(-1) === depth)) {
      if (c === '}') open.pop();
      const r = templateBody(i + 1);
      if (r.open) open.push(depth);
      i = r.end;
    } else if (c === '/' && regexStart(i)) {
      let j = i + 1;
      let inClass = false;
      while (j < source.length && source[j] !== '\n' && (inClass || source[j] !== '/')) {
        if (source[j] === '\\') j++;
        else if (source[j] === '[') inClass = true;
        else if (source[j] === ']') inClass = false;
        j++;
      }
      blank(i + 1, j);
      i = j + 1;
    } else {
      if (c === '{') depth++;
      else if (c === '}') depth--;
      i++;
    }
  }
  return { code: code.join(''), bare: bare.join('') };
}

// The text between a bracket at `open` and its partner, split at its top-level commas. Uses `bare`, where a string's
// inside cannot hold a bracket or a comma.
function splitArgs(code, bare, open) {
  const closer = { '(': ')', '[': ']', '{': '}' };
  const stack = [closer[bare[open]]];
  const parts = [];
  let start = open + 1;
  let j = open + 1;
  for (; j < bare.length && stack.length; j++) {
    const c = bare[j];
    if (closer[c]) stack.push(closer[c]);
    else if (c === stack.at(-1)) stack.pop();
    else if (c === ',' && stack.length === 1) { parts.push({ from: start, to: j }); start = j + 1; }
  }
  const end = j - 1;
  if (code.slice(start, end).trim()) parts.push({ from: start, to: end });
  return { end, args: parts.map(({ from, to }) => ({ text: code.slice(from, to).trim(), at: from + code.slice(from, to).search(/\S/) })) };
}

const stringValue = (text) => {
  const quote = text[0];
  if (quote !== '\'' && quote !== '"' && quote !== '`') return null;
  if (text.at(-1) !== quote || text.length < 2) return null;
  const inner = text.slice(1, -1);
  if (quote === '`' && inner.includes('${')) return null;
  return inner;
};

const literal = (value) => ({ literal: true, value });
const opaque = (text) => ({ literal: false, text });

class FileScan {
  constructor(source, file) {
    this.file = file;
    Object.assign(this, mask(source));
    this.calls = [];
    this.findings = [];
    this.dynamic = [];
    this.wrappers = new Map([['git', 'git'], ['gh', 'gh']]);
    this.discovered = new Set();
    this.apis = new Set(PROCESS_APIS);
    for (const m of this.bare.matchAll(new RegExp(`\\b([A-Za-z_$][\\w$]*)\\s*=\\s*(?:${PROCESS_APIS.join('|')})\\b(?!\\s*\\()`, 'g'))) this.apis.add(m[1]);
    for (const m of this.bare.matchAll(new RegExp(`\\b(?:${PROCESS_APIS.join('|')})\\s+as\\s+([A-Za-z_$][\\w$]*)`, 'g'))) this.apis.add(m[1]);
  }

  lineOf(at) {
    return this.code.slice(0, at).split('\n').length;
  }

  // The nearest declaration of a name before a position, as the argument text after its `=`.
  declared(name, before) {
    const pattern = new RegExp(`\\b(?:const|let|var)\\s+${name.replace(/\$/g, '\\$')}\\s*=\\s*`, 'g');
    let found = null;
    for (const m of this.bare.matchAll(pattern)) if (m.index < before) found = m.index + m[0].length;
    return found;
  }

  tokensOfArray(open, before) {
    const tokens = [];
    for (const { text, at } of splitArgs(this.code, this.bare, open).args) {
      if (text.startsWith('...')) {
        const name = text.slice(3).trim();
        const inlined = IDENTIFIER.test(name) ? this.resolveArray(name, before) : null;
        if (inlined) tokens.push(...inlined);
        else tokens.push({ ...opaque(text), spread: name });
        continue;
      }
      if (this.code[at] === '[') { tokens.push(opaque(text)); continue; }
      const value = stringValue(text);
      if (value !== null) { tokens.push(literal(value)); continue; }
      const resolved = IDENTIFIER.test(text) ? this.resolveString(text, before) : null;
      tokens.push(resolved === null ? opaque(text) : literal(resolved));
    }
    return tokens;
  }

  resolveArray(name, before) {
    const at = this.declared(name, before);
    return at !== null && this.bare[at] === '[' ? this.tokensOfArray(at, at) : null;
  }

  resolveString(name, before) {
    const at = this.declared(name, before);
    if (at === null) return null;
    const line = this.code.slice(at).split(/[;\n]/)[0].trim();
    return stringValue(line);
  }

  // What an argument expression says the command line is, as far as the source shows it.
  argvOf(arg, before) {
    if (!arg) return [];
    if (this.code[arg.at] === '[') return this.tokensOfArray(arg.at, before);
    if (IDENTIFIER.test(arg.text)) return this.resolveArray(arg.text, before) ?? [{ ...opaque(arg.text), spread: arg.text }];
    // A helper that builds the list, such as gitArgs(['status']): read the list it was given.
    const inner = this.bare.indexOf('[', arg.at);
    if (inner >= 0 && inner < arg.at + arg.text.length) return this.tokensOfArray(inner, before);
    return [opaque(arg.text)];
  }

  // A process call whose arguments come from the enclosing function's parameters is a wrapper: its callers hold the
  // subcommand, so they are the calls to judge. Returns the name of that function, if there is one.
  enclosingWrapper(name, at) {
    const window = this.bare.slice(Math.max(0, at - 500), at);
    const forms = [
      /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g,
      /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/g,
    ];
    let best = null;
    for (const form of forms) {
      for (const m of window.matchAll(form)) {
        if (!best || m.index > best.index) best = { index: m.index, wrapper: m[1], params: m[2] };
      }
    }
    if (!best) return null;
    const params = best.params.split(',').map((p) => p.replace(/^\s*\.\.\./, '').split('=')[0].trim());
    return params.includes(name) ? best.wrapper : null;
  }

  record(tool, tokens, at) {
    const verdict = (tool === 'git' ? judgeGit : judgeGh)(tokens, this.file);
    const entry = { file: this.file, line: this.lineOf(at), tool, command: describe(tokens), problem: verdict };
    this.calls.push(entry);
    if (verdict) this.findings.push(entry);
  }

  judgeShell(text, at) {
    const value = text.slice(1, -1);
    for (const piece of value.split(/&&|\|\||;|\||\n/)) {
      const words = piece.trim().split(/\s+/);
      const match = PROGRAM.exec((words[0] ?? '').replace(/^["']|["']$/g, ''));
      if (!match) continue;
      this.record(match[1].toLowerCase(), words.slice(1).map((w) => (w.includes('${') ? opaque(w) : literal(w.replace(/^["']|["']$/g, '')))), at);
    }
  }

  // First pass: find the wrappers, so the second pass can judge their callers wherever they sit in the file.
  findWrappers() {
    for (const { args, at } of this.callSites()) {
      const position = args.findIndex((a, k) => k < 3 && PROGRAM.test(stringValue(a.text) ?? ''));
      if (position < 0) continue;
      const tool = PROGRAM.exec(stringValue(args[position].text))[1].toLowerCase();
      const argv = this.argvOf(args[position + 1], at);
      const first = firstMeaningful(tool, argv);
      if (first?.literal !== false) continue;
      const wrapper = this.enclosingWrapper(first.spread ?? first.text, at);
      if (!wrapper) continue;
      this.wrappers.set(wrapper, tool);
      this.discovered.add(wrapper);
    }
  }

  * callSites() {
    for (const m of this.bare.matchAll(/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/g)) {
      const before = this.bare.slice(Math.max(0, m.index - 12), m.index);
      if (/\bfunction\s*$/.test(before) || /\.\s*$/.test(before)) continue;
      const open = m.index + m[0].length - 1;
      const { args } = splitArgs(this.code, this.bare, open);
      yield { callee: m[1], args, at: m.index };
    }
  }

  isProcessApi(callee) {
    if (this.apis.has(callee)) return true;
    const [object, method] = callee.split('.');
    if (!method) return false;
    if (['execFileSync', 'execFile', 'execSync', 'spawnSync', 'spawn'].includes(method)) return true;
    return method === 'exec' && /^(cp|childProcess|child_process)$/.test(object);
  }

  scan() {
    this.findWrappers();
    for (const { callee, args, at } of this.callSites()) {
      const isApi = this.isProcessApi(callee);
      // The program is usually first, but a helper can take the runner first: sh(run, 'git', ['status']).
      const position = args.findIndex((a, k) => k < 3 && PROGRAM.test(stringValue(a.text) ?? ''));
      const direct = position >= 0 ? PROGRAM.exec(stringValue(args[position].text)) : null;
      if (direct && (isApi || args.length > position + 1)) {
        const tool = direct[1].toLowerCase();
        const argv = this.argvOf(args[position + 1], at);
        const first = firstMeaningful(tool, argv);
        const held = first?.literal === false && this.enclosingWrapper(first.spread ?? first.text, at);
        if (!held) this.record(tool, argv, at);
        continue;
      }
      if (this.wrappers.has(callee)) {
        this.judgeWrapperCall(callee, this.wrappers.get(callee), args, at);
        continue;
      }
      if (!isApi && !SHELL_LIKE.includes(callee)) continue;
      const head = args[0]?.text ?? '';
      if (/^['"`]/.test(head) && head.at(-1) === head[0]) {
        this.judgeShell(head, at);
        for (const arg of args.slice(1)) {
          for (const m of arg.text.matchAll(/(['"`])((?:(?!\1).)*)\1/g)) this.judgeShell(`'${m[2]}'`, at);
        }
        continue;
      }
      if (!isApi || !head) continue;
      const known = IDENTIFIER.test(head) ? this.resolveString(head, at) : null;
      const named = known !== null ? PROGRAM.exec(known) : null;
      if (named) this.record(named[1].toLowerCase(), this.argvOf(args[1], at), at);
      else if (known === null && head !== 'process.execPath') this.dynamic.push({ file: this.file, line: this.lineOf(at), program: head });
    }
    return { calls: this.calls, findings: this.findings, dynamic: this.dynamic };
  }

  // git(dir, 'remote', 'get-url', 'origin'), git(cwd, ['add', x]), git(['reset']) or git(cwd, listOfArgs).
  judgeWrapperCall(callee, tool, args, at) {
    for (let k = 0; k < args.length; k++) {
      const { text } = args[k];
      if (stringValue(text) !== null) {
        this.record(tool, args.slice(k).map((a) => {
          const value = stringValue(a.text);
          return value === null ? opaque(a.text) : literal(value);
        }), at);
        return;
      }
      if (text.startsWith('[')) { this.record(tool, this.argvOf(args[k], at), at); return; }
      if (IDENTIFIER.test(text)) {
        const list = this.resolveArray(text, at);
        if (list) { this.record(tool, list, at); return; }
      }
    }
    if (!args.length) return;
    const text = args.map((a) => a.text).join(', ');
    // A local name that merely spells git, with no process call behind it in this file (an injected probe, say), is
    // for a person to read. A real wrapper called with something unreadable is refused.
    if (this.discovered.has(callee)) this.record(tool, [opaque(text)], at);
    else this.dynamic.push({ file: this.file, line: this.lineOf(at), program: `${callee}(${text})` });
  }
}

// The first token after git's own options, which is the subcommand.
function firstMeaningful(tool, argv) {
  return afterGlobals(tool, argv)[0];
}

function afterGlobals(tool, argv) {
  if (tool !== 'git') return argv;
  let k = 0;
  while (k < argv.length && argv[k].literal && argv[k].value.startsWith('-') && argv[k].value !== '--version') {
    k += GIT_OPTIONS_WITH_VALUE.has(argv[k].value) ? 2 : 1;
  }
  return argv.slice(k);
}

const describe = (tokens) => tokens.slice(0, 6).map((t) => (t.literal ? t.value : `<${t.text}>`)).join(' ');

function judgeGit(argv) {
  const rest = afterGlobals('git', argv);
  const sub = rest[0];
  if (!sub) return 'git with no subcommand the scan can read';
  if (!sub.literal) return `git subcommand cannot be read from the source (${sub.text})`;
  if (sub.value === 'config') return rest.some((t) => t.literal && t.value === '--get') ? null : 'git config without --get writes';
  if (GIT_READS.has(sub.value)) return null;
  if (GIT_WRITES.has(sub.value)) return `git ${sub.value} is a write`;
  return `git ${sub.value} is not on the read-only list`;
}

function judgeGh(argv, file) {
  const [first, second] = argv;
  if (!first) return 'gh with no subcommand the scan can read';
  if (!first.literal) return `gh subcommand cannot be read from the source (${first.text})`;
  if (first.value === '--version') return null;
  if (first.value === 'api') {
    const flag = argv.findIndex((t) => t.literal && (t.value === '--method' || t.value === '-X'));
    if (flag < 0) return null;
    const method = argv[flag + 1];
    return method?.literal && method.value.toUpperCase() === 'GET' ? null : 'gh api with a method other than GET writes';
  }
  const pair = `${first.value} ${second?.literal ? second.value : `<${second?.text ?? ''}>`}`;
  if (pair === 'auth status' || pair === 'repo view') return null;
  if (pair === 'repo clone' && file === GH_CLONER) return null;
  if (pair === 'repo clone') return `gh repo clone is allowed only in ${GH_CLONER}`;
  return `gh ${pair} is not on the read-only list`;
}

// One file's source. `file` is its repository path, with `/` separators.
export function scanSource(source, file = 'scripts/snippet.mjs') {
  return new FileScan(source, file).scan();
}

const SCANNED = /\.(?:mjs|cjs|js)$/;
const OTHER_CODE = /\.(?:py|sh|ps1|cmd|bat)$/;

// Every script under `scriptsDir`, reported under `scripts/`. A file in another language is not parsed: naming git or
// gh in one at all is reported, so it gets looked at.
export function scanTree(scriptsDir) {
  const out = { calls: [], findings: [], dynamic: [] };
  (function walk(dir, rel) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const abs = join(dir, entry.name);
      const path = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(abs, path);
      else if (SCANNED.test(entry.name)) {
        const r = scanSource(readFileSync(abs, 'utf8'), path);
        out.calls.push(...r.calls);
        out.findings.push(...r.findings);
        out.dynamic.push(...r.dynamic);
      } else if (OTHER_CODE.test(entry.name) && /(^|[\s"'[(])(git|gh)([\s"',\])]|$)/m.test(readFileSync(abs, 'utf8'))) {
        out.findings.push({ file: path, line: 0, tool: 'git', command: '', problem: 'names git or gh in a language the scan does not parse' });
      }
    }
  })(scriptsDir, 'scripts');
  return out;
}

export const formatFinding = ({ file, line, command, problem }) => `${file}:${line}: ${problem}${command ? ` [${command}]` : ''}`;
