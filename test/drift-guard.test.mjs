import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFrontmatter } from '../scripts/clip.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Spec/executor drift is the endemic failure of prose-driven systems: the
// SKILL.md is the executor, and nothing else checks that what it references
// exists or that what the schema declares matches what the code writes.
// Every confirmed drift in sibling projects lived where a fact was COPIED
// rather than DERIVED — these tests derive.

function allProseFiles() {
  const out = [];
  for (const dir of ['skills', 'commands']) {
    const base = join(ROOT, dir);
    if (!existsSync(base)) continue;
    (function walk(d) {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(d, e.name));
        else if (e.name.endsWith('.md')) out.push(join(d, e.name));
      }
    })(base);
  }
  return out;
}

test('every script path referenced in skills/commands exists on disk', () => {
  const missing = [];
  for (const f of allProseFiles()) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/scripts\/[\w./-]+\.mjs/g)) {
      if (!existsSync(join(ROOT, m[0]))) missing.push(`${f} -> ${m[0]}`);
    }
  }
  assert.deepEqual(missing, [], `prose references scripts that do not exist:\n${missing.join('\n')}`);
});

test('clipping frontmatter contract: schema template and clip.mjs agree', () => {
  const schema = readFileSync(join(ROOT, 'templates', 'vault-schema.md'), 'utf8');
  const contractLine = schema.match(/Raw\/clippings:\s*`([^`]+)`/)?.[1];
  assert.ok(contractLine, 'vault-schema.md declares a Raw/clippings contract');
  const declared = contractLine.match(/[\w-]+/g).filter((w) => w !== 'clippings');

  const fm = buildFrontmatter({
    title: 'T', source: 'https://x.com/a', author: 'A',
    published: '2026-01-01', created: '2026-01-02', quality: 'high', hash: 'h',
    topic: 'Some Research Topic',
  });
  const written = [...fm.matchAll(/^([\w-]+):/gm)].map((m) => m[1]);

  for (const field of declared) {
    assert.ok(written.includes(field) || field === 'tags',
      `schema declares '${field}' but clip.mjs does not write it`);
  }
  for (const field of written) {
    assert.ok(declared.includes(field) || field === 'tags',
      `clip.mjs writes '${field}' but the schema contract does not declare it`);
  }
});

// Every place a release version is written. The table is the single list a
// version bump must touch; the discovery test below fails when a manifest grows
// a `version` field that is not listed here, so the table cannot go stale
// silently. package-lock.json lists every dependency's version too: only its
// root `version` and the `packages[""]` entry describe this plugin.
const VERSION_FIELDS = [
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
const LOCK_FILE = 'package-lock.json';
const MANIFEST_FILES = [...new Set(VERSION_FIELDS.map((r) => r.file))];

const readManifest = (file) => JSON.parse(readFileSync(join(ROOT, file), 'utf8'));

const pathLabel = (path) => path.reduce(
  (acc, k) => (typeof k === 'number' ? `${acc}[${k}]`
    : k === '' ? `${acc}[""]`
      : acc ? `${acc}.${k}` : k), '');

const valueAt = (json, path) => path.reduce((o, k) => (o == null ? undefined : o[k]), json);

// Paths of every `version` key in a manifest. In the lockfile only the root and
// the `packages[""]` entry count; the other entries are dependencies.
function versionKeyPaths(file, json) {
  const scope = file === LOCK_FILE
    ? { ...json, packages: json.packages && '' in json.packages ? { '': json.packages[''] } : {} }
    : json;
  const found = [];
  (function walk(node, path) {
    if (Array.isArray(node)) node.forEach((v, i) => walk(v, [...path, i]));
    else if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (k === 'version') found.push([...path, k]);
        walk(v, [...path, k]);
      }
    }
  })(scope, []);
  return found;
}

// Throws unless the table and the manifests name exactly the same version keys.
function assertCoverage(read) {
  for (const file of MANIFEST_FILES) {
    const json = read(file);
    const listed = VERSION_FIELDS.filter((r) => r.file === file).map((r) => pathLabel(r.path));
    const present = versionKeyPaths(file, json).map(pathLabel);
    for (const label of present) {
      assert.ok(listed.includes(label),
        `${file} has an unlisted version field '${label}': add it to VERSION_FIELDS so a bump cannot miss it`);
    }
    for (const label of listed) {
      assert.ok(present.includes(label),
        `VERSION_FIELDS lists '${label}' in ${file} but the file has no such version field`);
    }
  }
}

test('version is identical in every field of the manifests (Claude + Copilot + Codex + lockfile)', () => {
  // The version is one fact copied into nine JSON fields across seven files —
  // the exact drift seam this suite exists to guard. wiki-master ships to three
  // hosts (Claude Code reads .claude-plugin/; Copilot CLI reads a root
  // plugin.json + .github/plugin/; Codex reads .codex-plugin/), and a manifest
  // set that disagrees about what version this is must fail loud. Two files
  // carry the version twice: package-lock.json (root and packages[""]) and
  // .github/plugin/marketplace.json (metadata.version and the plugin entry).
  // npm rewrites the lockfile only when someone runs `npm install`, so a bump
  // that edits the other files by hand leaves it silently pinned to the
  // previous version. package.json is the reference every row is held to.
  const expected = valueAt(readManifest('package.json'), ['version']);
  assert.match(expected, /^\d+\.\d+\.\d+$/, `package.json version is not x.y.z: ${expected}`);
  const stale = VERSION_FIELDS
    .map((r) => ({ ...r, v: valueAt(readManifest(r.file), r.path) }))
    .filter((r) => r.v !== expected);
  assert.deepEqual(stale, [],
    `version fields differ from package.json (${expected}): ${stale.map((r) => `${r.file} ${pathLabel(r.path)}=${r.v}`).join(', ')}`);
});

test('every version field in the manifests is listed in VERSION_FIELDS', () => {
  assertCoverage(readManifest);
});

test('the coverage guard names an unlisted or a missing version field', () => {
  // Positive control for the test above: prove assertCoverage fails, with its
  // own message, on a drifted tree, so a guard that never throws cannot pass the
  // real-tree check forever. It runs on manifests synthesized from the table,
  // so the real tree being clean or drifted cannot change its result. The
  // synthetic lockfile also carries a dependency entry, which must be ignored.
  const synth = (file) => {
    const json = file === LOCK_FILE ? { packages: { 'node_modules/dep': { version: '1.0.0' } } } : {};
    for (const row of VERSION_FIELDS.filter((r) => r.file === file)) {
      let node = json;
      row.path.slice(0, -1).forEach((k, i) => {
        node = node[k] ??= typeof row.path[i + 1] === 'number' ? [] : {};
      });
      node.version = '1.2.3';
    }
    return json;
  };
  assert.doesNotThrow(() => assertCoverage(synth));

  const extra = (file) => {
    const j = synth(file);
    if (file === '.claude-plugin/plugin.json') j.extra = { version: '0.0.0' };
    return j;
  };
  assert.throws(() => assertCoverage(extra),
    { message: ".claude-plugin/plugin.json has an unlisted version field 'extra.version': add it to VERSION_FIELDS so a bump cannot miss it" });

  const missing = (file) => {
    const j = synth(file);
    if (file === '.codex-plugin/plugin.json') delete j.version;
    return j;
  };
  assert.throws(() => assertCoverage(missing),
    { message: "VERSION_FIELDS lists 'version' in .codex-plugin/plugin.json but the file has no such version field" });
});

test('shared plugin hooks use supported fields and remain opt-in on every host', () => {
  // Codex rejects unknown root fields; Claude Code supports description + hooks.
  // Keep disabled examples in documentation, never in the auto-loaded config.
  const config = JSON.parse(readFileSync(join(ROOT, 'hooks/hooks.json'), 'utf8'));
  for (const key of Object.keys(config)) {
    assert.ok(['description', 'hooks'].includes(key), `unsupported hooks field: ${key}`);
  }
  if ('description' in config) assert.equal(typeof config.description, 'string');
  assert.deepEqual(config.hooks, {}, 'no hooks should execute by default');
});

test('Copilot manifests are structurally valid and point at skills/', () => {
  // Copilot CLI reads a root plugin.json and .github/plugin/marketplace.json.
  // The plugin ships its user-facing operations as skills (commands/ retired
  // in 0.3.0), so the manifest must point Copilot at skills/.
  const plugin = JSON.parse(readFileSync(join(ROOT, 'plugin.json'), 'utf8'));
  assert.equal(plugin.name, 'wiki-master', 'root plugin.json name');
  const skills = [].concat(plugin.skills ?? []);
  assert.ok(skills.includes('skills/'), 'root plugin.json declares skills: ["skills/"]');

  const mkt = JSON.parse(readFileSync(join(ROOT, '.github/plugin/marketplace.json'), 'utf8'));
  const entry = mkt.plugins?.[0];
  assert.ok(entry && entry.name === 'wiki-master' && entry.source,
    '.github/plugin/marketplace.json lists the wiki-master plugin with a source');
});

test('skill argument-hint frontmatter is a string, not a YAML collection', () => {
  // `argument-hint: [foo]` parses as a YAML array and the skill validator
  // rejects it ("argument hint must be a string"). A leading unquoted [ or {
  // is a flow indicator — it must be quoted to stay a string.
  const bad = [];
  for (const f of allProseFiles()) {
    const fm = readFileSync(f, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
    if (!fm) continue;
    const m = fm.match(/^argument-hint:[ \t]*(.+)$/m);
    if (m && /^[[{]/.test(m[1].trim())) bad.push(`${f} -> ${m[1].trim()}`);
  }
  assert.deepEqual(bad, [], `argument-hint must be quoted when it starts with [ or {:\n${bad.join('\n')}`);
});

// A SKILL.md with no frontmatter block at all is not a "no argument-hint" edge
// case, it is invisible: the skill loader has no name/description to register it
// under, so it never appears in /skills and can break loading for every OTHER
// skill in the same scan. This exact bug shipped once (wiki-author/SKILL.md was
// added with pure body text, no `---` header at all) and went undetected because
// the check above silently `continue`s past any file with no frontmatter instead
// of failing on it -- this test closes that gap by asserting every skill has one,
// with a name matching its own directory (the loader's registration key) and a
// non-empty description (every existing skill's actual convention, confirmed
// against skills/wiki-query, skills/wiki-discover, etc. above).
test('every skills/<name>/SKILL.md has a frontmatter block with name: <name> and a description', () => {
  const missing = [];
  const skillsDir = join(ROOT, 'skills');
  for (const dirName of readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) {
    const f = join(skillsDir, dirName, 'SKILL.md');
    if (!existsSync(f)) continue; // covered separately by the former-commands test
    const text = readFileSync(f, 'utf8');
    const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
    if (!fm) { missing.push(`${dirName}/SKILL.md -> no frontmatter block at all`); continue; }
    const name = fm.match(/^name:[ \t]*(.+)$/m)?.[1]?.trim();
    const description = fm.match(/^description:[ \t]*(.+)$/m)?.[1]?.trim();
    if (name !== dirName) missing.push(`${dirName}/SKILL.md -> name: ${JSON.stringify(name)} (expected ${JSON.stringify(dirName)})`);
    if (!description) missing.push(`${dirName}/SKILL.md -> missing or empty description`);
  }
  assert.deepEqual(missing, [], `skill frontmatter drift:\n${missing.join('\n')}`);
});

test('commands/ is retired — every former op exists as a skill', () => {
  // 0.3.0 migrated commands→skills (Copilot has no commands tier; skills are
  // the portable entry-point both hosts load as /wiki-*). No commands/ dir may
  // linger, and each former command must exist as skills/<name>/SKILL.md.
  assert.ok(!existsSync(join(ROOT, 'commands')), 'commands/ must be removed');
  const ops = ['wiki-discover', 'wiki-health', 'wiki-ingest', 'wiki-init',
    'wiki-lint', 'wiki-query', 'wiki-relink', 'wiki-stale'];
  const missing = ops.filter((op) => !existsSync(join(ROOT, 'skills', op, 'SKILL.md')));
  assert.deepEqual(missing, [], `missing skills for former commands: ${missing.join(', ')}`);
});

test('wiki-page contract declares every field the health graph reads', () => {
  const schema = readFileSync(join(ROOT, 'templates', 'vault-schema.md'), 'utf8');
  const contractLine = schema.match(/Wiki pages:\s*`([^`]+)`/)?.[1];
  assert.ok(contractLine, 'vault-schema.md declares a Wiki pages contract');
  // graph.mjs reads `status` from frontmatter; if the schema ever drops it,
  // stub detection silently dies again (issue #3's failure mode).
  assert.ok(contractLine.includes('status'),
    'wiki-page contract must declare status (graph.mjs stub detection reads it)');
});

// A literal NUL byte in a source file makes git treat the whole file as
// BINARY: no line diffs, no blame, no three-way merge, and a pull request that
// reports "0 insertions, 0 deletions" for a file that was substantially
// rewritten. That is a silent review failure, not a cosmetic one -- it hides
// changes from the person reviewing them.
//
// Not hypothetical. scripts/lib/triage.mjs carried one from 0.5.0 (361f267)
// until 0.13.0: an agent-written `key()` used a raw NUL as the url/kind
// separator, which works perfectly at runtime and cost the file eight months
// of reviewable history. The fix was to write the same character as its escape
// sequence -- identical string, text file.
//
// Derived, not copied: this walks the tree rather than listing known files, so
// a new file reintroducing the byte fails here rather than in a future review.
test('no source file contains a literal NUL byte, which would make git treat it as binary', () => {
  const SKIP = new Set(['.git', 'node_modules', '.playwright-mcp']);
  const offenders = [];
  (function walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(e.name)) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.(mjs|cjs|js|json|md|html|css)$/.test(e.name)) continue;
      if (readFileSync(p).includes(0)) offenders.push(p.slice(ROOT.length + 1));
    }
  })(ROOT);
  assert.deepEqual(offenders, [],
    `write it as a unicode escape instead -- same string at runtime, and the file stays diffable:\n${offenders.join('\n')}`);
});
