// The structural part of a skill-library audit, as a module the tests import and a command a person runs:
//
//   node test/helpers/skill-audit.mjs [skillsDir]
//
// It prints one row per skill (name, description length, body lines), the reference-depth report, then one line
// per finding, and exits 1 when there is a finding. skillsDir defaults to this plugin's skills/; the plugin root is
// its parent, where scripts/, README.md and docs/ are looked for.
//
// Findings: no frontmatter, a name that differs from the folder, no description, a description over 1,024
// characters (the Agent Skills limit), a when_to_use key (not portable), and a script that takes --apply but that no
// SKILL.md, skill reference, README.md or docs/*.md names. docs/scripts.md is not counted as naming: it lists
// every script by construction, so it says nothing about whether a procedure leads to one.
//
// Reported, not a finding: how deep each file sits below the nearest SKILL.md through inline links. The accepted shape is
// SKILL.md -> reference -> doc (depth 2); docs/skill-reliability.md records why.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DESCRIPTION_LIMIT = 1024;
export const ACCEPTED_DEPTH = 2;
const INDEX = 'docs/scripts.md';

// Frontmatter keys and values. Carriage returns are stripped first, so a CRLF file parses as its LF copy. A block
// scalar (`>`, `|`, with `-` or `+`) and plain or quoted continuation lines are folded into one line with single
// spaces, which is how a skill listing reads them. Returns null when line 1 is not `---` or nothing closes it.
export function parseFrontmatter(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end < 0) return null;
  const out = {};
  let key = null;
  for (const line of lines.slice(1, end)) {
    const m = /^([A-Za-z_][\w-]*):(?:[ \t]+(.*))?$/.exec(line);
    if (m && !/^[ \t]/.test(line)) {
      key = m[1];
      const value = (m[2] ?? '').trim();
      out[key] = /^[>|][+-]?$/.test(value) ? '' : value;
      continue;
    }
    if (key === null || !line.trim()) continue;
    out[key] = out[key] ? `${out[key]} ${line.trim()}` : line.trim();
  }
  for (const k of Object.keys(out)) {
    const v = out[k];
    if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) out[k] = v.slice(1, -1);
  }
  return out;
}

const body = (text) => text.replace(/\r/g, '').replace(/^---\n[\s\S]*?\n---\n?/, '');

// Inline Markdown link targets that are local files, outside fenced blocks and code spans.
export function localLinks(text) {
  const prose = text.replace(/\r/g, '')
    .replace(/^(?:`{3,}|~{3,})[^\n]*\n[\s\S]*?^(?:`{3,}|~{3,})[ \t]*$/gm, '')
    .replace(/(`+)[^\n]*?\1/g, '');
  return [...prose.matchAll(/!?\[[^\]\n]*\]\((<[^>]+>|[^)\s]+)(?:\s+"[^"]*")?\)/g)]
    .map((m) => m[1].replace(/^<|>$/g, '').split('#')[0])
    .filter((t) => t && !/^[a-z][a-z0-9+.-]*:|^\/\//i.test(t));
}

// Shortest link depth of every Markdown file inside root reachable from any SKILL.md, with the skill it is
// nearest to: a file another skill links at depth 3 but its own SKILL.md links at depth 1 is at depth 1.
// `entries` is [[skill, path to its SKILL.md]].
export function referenceDepths(entries, root) {
  const depth = new Map(entries.map(([skill, entry]) => [entry, { skill, depth: 0 }]));
  const queue = entries.map(([, entry]) => entry);
  while (queue.length) {
    const file = queue.shift();
    const here = depth.get(file);
    for (const target of localLinks(readFileSync(file, 'utf8'))) {
      let decoded;
      try { decoded = decodeURI(target); } catch { continue; } // malformed percent-encoding names no file
      const next = resolve(dirname(file), decoded);
      if (!next.endsWith('.md') || depth.has(next) || !existsSync(next) || !statSync(next).isFile()) continue;
      const rel = relative(root, next);
      if (rel.startsWith('..') || rel.startsWith(sep)) continue;
      depth.set(next, { skill: here.skill, depth: here.depth + 1 });
      queue.push(next);
    }
  }
  return depth;
}

function markdownBelow(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? markdownBelow(p) : e.name.endsWith('.md') ? [p] : [];
  });
}

// Scripts that take --apply: a CLI_SPECS entry with the option, or a source that mentions it.
export function applyScripts(root, cliSpecs = {}) {
  const dir = join(root, 'scripts');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort().filter((f) =>
    (cliSpecs[f.slice(0, -4)]?.options ?? []).includes('apply') || readFileSync(join(dir, f), 'utf8').includes('--apply'));
}

// The --apply scripts that no SKILL.md, skill reference, README.md or docs/*.md (other than the index) names.
export function unnamedApplyScripts(root, skillsDir, cliSpecs = {}) {
  const docs = existsSync(join(root, 'docs')) ? readdirSync(join(root, 'docs')).filter((f) => f.endsWith('.md')).map((f) => join(root, 'docs', f)) : [];
  const sources = [...markdownBelow(skillsDir), join(root, 'README.md'), ...docs]
    .filter((p) => existsSync(p) && relative(root, p).split(sep).join('/') !== INDEX);
  const text = sources.map((p) => readFileSync(p, 'utf8')).join('\n');
  return applyScripts(root, cliSpecs).filter((f) => !new RegExp(`(?<![\\w-])${f.replace(/[.]/g, '\\.')}`).test(text));
}

async function loadCliSpecs(root) {
  const file = join(root, 'scripts', 'lib', 'cli-specs.mjs');
  return existsSync(file) ? (await import(pathToFileURL(file).href)).CLI_SPECS ?? {} : {};
}

export async function auditSkills(skillsDir, { root = dirname(resolve(skillsDir)), cliSpecs } = {}) {
  skillsDir = resolve(skillsDir);
  const specs = cliSpecs ?? await loadCliSpecs(root);
  const rows = [], findings = [], entries = [];
  const names = readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(join(skillsDir, e.name, 'SKILL.md'))).map((e) => e.name).sort();
  for (const name of names) {
    const entry = join(skillsDir, name, 'SKILL.md');
    const text = readFileSync(entry, 'utf8');
    entries.push([name, entry]);
    const fm = parseFrontmatter(text);
    if (!fm) { findings.push(`${name}: SKILL.md has no frontmatter starting on line 1`); continue; }
    const description = fm.description ?? '';
    rows.push({ name, descriptionLength: [...description].length, bodyLines: body(text).split('\n').length });
    if (fm.name !== name) findings.push(`${name}: frontmatter name is ${fm.name ?? 'missing'}, not the folder name`);
    if (!description) findings.push(`${name}: no description`);
    else if ([...description].length > DESCRIPTION_LIMIT) findings.push(`${name}: description is ${[...description].length} characters, over ${DESCRIPTION_LIMIT}`);
    if ('when_to_use' in fm) findings.push(`${name}: when_to_use is not portable; put the triggers in the description`);
  }
  const deep = [...referenceDepths(entries, root)].filter(([, d]) => d.depth > ACCEPTED_DEPTH)
    .map(([file, d]) => ({ skill: d.skill, file: relative(root, file).split(sep).join('/'), depth: d.depth }));
  for (const script of unnamedApplyScripts(root, skillsDir, specs))
    findings.push(`scripts/${script}: takes --apply but no skill, reference, README.md or doc names it`);
  return { rows, findings, deep };
}

export function format({ rows, findings, deep }) {
  const width = Math.max(...rows.map((r) => r.name.length), 4);
  const lines = rows.map((r) => `${r.name.padEnd(width)}  description ${String(r.descriptionLength).padStart(4)}  body lines ${String(r.bodyLines).padStart(4)}`);
  const deepest = deep.reduce((m, d) => Math.max(m, d.depth), 0);
  lines.push(`reference depth: ${deep.length} file${deep.length === 1 ? '' : 's'} beyond SKILL.md -> reference -> doc${deep.length ? ` (deepest ${deepest}; reported, not enforced)` : ''}`);
  for (const d of deep) lines.push(`  depth ${d.depth}: ${d.file} (nearest skill: ${d.skill})`);
  for (const f of findings) lines.push(`finding: ${f}`);
  return lines.join('\n');
}

// Under `node --test` every .mjs below test/ is loaded as a test file; the command runs only when started directly.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && !process.env.NODE_TEST_CONTEXT) {
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = process.argv[2] ?? join(here, '..', '..', 'skills');
  if (!existsSync(dir) || !statSync(dir).isDirectory()) { console.error(`usage: node test/helpers/skill-audit.mjs [skillsDir]\n${dir} is not a directory`); process.exit(2); }
  const result = await auditSkills(dir);
  console.log(format(result));
  process.exit(result.findings.length ? 1 : 0);
}

