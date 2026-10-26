import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Every place a release version is written, and the changelog heading that must agree with them. One list: the
// drift test reads it to fail when a manifest grows a `version` field that is not listed, and bump-version.mjs
// reads it to change them all in one step, so a new manifest is added in one place.
//
// package-lock.json lists every dependency's version too: only its root `version` and the `packages[""]` entry
// describe this plugin.
export const VERSION_FIELDS = [
  { file: 'package.json', path: ['version'] },
  { file: 'package-lock.json', path: ['version'] },
  { file: 'package-lock.json', path: ['packages', '', 'version'] },
  { file: 'plugin.json', path: ['version'] },
  { file: '.claude-plugin/plugin.json', path: ['version'] },
  { file: '.claude-plugin/marketplace.json', path: ['plugins', 0, 'version'] },
  { file: '.codex-plugin/plugin.json', path: ['version'] },
  { file: '.github/plugin/marketplace.json', path: ['metadata', 'version'] },
  { file: '.github/plugin/marketplace.json', path: ['plugins', 0, 'version'] },
];
export const LOCK_FILE = 'package-lock.json';
export const MANIFEST_FILES = [...new Set(VERSION_FIELDS.map((r) => r.file))];

export const pathLabel = (path) => path.reduce(
  (acc, k) => (typeof k === 'number' ? `${acc}[${k}]`
    : k === '' ? `${acc}[""]`
      : acc ? `${acc}.${k}` : k), '');

export const valueAt = (json, path) => path.reduce((o, k) => (o == null ? undefined : o[k]), json);

const EM_DASH = String.fromCharCode(0x2014);
const VERSION = /^\d+\.\d+\.\d+$/;
export const isVersion = (v) => typeof v === 'string' && VERSION.test(v);

export function compareVersions(a, b) {
  const x = a.split('.').map(Number); const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

// `## 0.69.0 — 2026-10-26`
export const changelogHeading = (version, date) => `## ${version} ${EM_DASH} ${date}`;
const HEADING = new RegExp(`^## (\\d+\\.\\d+\\.\\d+) ${EM_DASH} (\\d{4}-\\d{2}-\\d{2})\\s*$`, 'm');

// Why the newest changelog entry does not describe `version`, or null. It reads the newest release heading (the
// first `## x.y.z — date` line), so an older heading further down is never taken for it, and requires at least one
// bullet under it: a heading with no entry is a release nobody described.
export function changelogProblem(text, version) {
  const m = HEADING.exec(text);
  if (!m) return 'CHANGELOG.md has no release heading of the form "## x.y.z — YYYY-MM-DD"';
  if (m[1] !== version) return `the newest CHANGELOG.md heading is ${m[1]} but the version is ${version}`;
  const after = text.slice(m.index + m[0].length);
  const next = after.search(/^## /m);
  const body = next < 0 ? after : after.slice(0, next);
  if (!/^\s*- \S/m.test(body)) return `the CHANGELOG.md entry for ${version} has no bullet under its heading`;
  return null;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function setAt(json, path, value) {
  let node = json;
  for (const k of path.slice(0, -1)) node = node[k];
  node[path[path.length - 1]] = value;
}

// Plans a version bump without touching the disk. Throws an Error that says what is wrong and writes nothing.
// The manifests are edited as text, not re-serialised, so each file keeps its own formatting and line endings;
// the result is then parsed and compared with the original to prove that only the listed fields changed.
export function planBump(root, to, { date, entry } = {}) {
  if (!isVersion(to)) throw new Error(`the new version must look like x.y.z, not "${to}"`);
  const read = (file) => readFileSync(join(root, file), 'utf8');
  const parsed = Object.fromEntries(MANIFEST_FILES.map((file) => [file, JSON.parse(read(file))]));
  const from = valueAt(parsed['package.json'], ['version']);
  const apart = VERSION_FIELDS.filter((r) => valueAt(parsed[r.file], r.path) !== from);
  if (apart.length) {
    throw new Error(`the version fields disagree with package.json (${from}); fix them before bumping: ${apart.map((r) => `${r.file} ${pathLabel(r.path)}=${valueAt(parsed[r.file], r.path)}`).join(', ')}`);
  }
  if (compareVersions(to, from) <= 0) throw new Error(`the new version ${to} is not greater than the current ${from}`);

  const re = new RegExp(`("version"\\s*:\\s*")${escapeRe(from)}(")`, 'g');
  const writes = [];
  for (const file of MANIFEST_FILES) {
    const before = read(file);
    const expected = VERSION_FIELDS.filter((r) => r.file === file).length;
    let count = 0;
    const after = before.replace(re, (_, a, b) => { count++; return `${a}${to}${b}`; });
    if (count !== expected) {
      throw new Error(`${file}: expected to change ${expected} version field(s) but the text holds ${count} of "${from}" (another entry shares the version); nothing was written`);
    }
    // Prove it: parse the new text, and compare with the old tree after setting only the listed fields.
    const want = JSON.parse(before);
    for (const r of VERSION_FIELDS.filter((x) => x.file === file)) setAt(want, r.path, to);
    if (JSON.stringify(JSON.parse(after)) !== JSON.stringify(want)) throw new Error(`${file}: the edit changed something other than the listed version fields; nothing was written`);
    writes.push({ file, text: after, fields: expected });
  }

  const log = read('CHANGELOG.md');
  const eol = log.includes('\r\n') ? '\r\n' : '\n';
  let changelog = 'present';
  let logAfter = log;
  if (!log.includes(`## ${to} ${EM_DASH} `)) {
    const head = log.startsWith(`# Changelog${eol}${eol}`) ? `# Changelog${eol}${eol}` : null;
    if (!head) throw new Error('CHANGELOG.md does not start with "# Changelog" and a blank line');
    const body = entry ? entry.replace(/\r?\n/g, eol).replace(/(\r?\n)*$/, '') + eol + eol : '';
    logAfter = head + changelogHeading(to, date) + eol + eol + body + log.slice(head.length);
    changelog = entry ? 'inserted with its entry' : 'heading inserted; the entry still has to be written';
  }
  return { from, to, writes, changelog: { text: logAfter, changed: logAfter !== log, state: changelog } };
}

export function applyBump(root, plan) {
  const files = plan.writes.map((w) => ({ file: w.file, text: w.text }));
  if (plan.changelog.changed) files.push({ file: 'CHANGELOG.md', text: plan.changelog.text });
  const originals = files.map((f) => ({ file: f.file, text: readFileSync(join(root, f.file), 'utf8') }));
  const done = [];
  try {
    for (const f of files) { writeFileSync(join(root, f.file), f.text); done.push(f.file); }
  } catch (error) {
    for (const o of originals) if (done.includes(o.file)) writeFileSync(join(root, o.file), o.text);
    throw new Error(`a write failed and the files were put back: ${error.message}`);
  }
}
