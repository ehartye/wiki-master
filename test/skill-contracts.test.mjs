import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const expected = ['wiki-init', 'wiki-maintainer', 'wiki-purge', 'wiki-researcher', 'wiki-user'];
const skills = readdirSync(join(root, 'skills')).filter(name => existsSync(join(root, 'skills', name, 'SKILL.md'))).sort();
const read = file => readFileSync(resolve(root, file), 'utf8').replaceAll('\r\n', '\n');
const entry = name => 'skills/' + name + '/SKILL.md';
const description = name => read(entry(name)).match(/^description: (.+)$/m)?.[1];

// Follow maintained inline Markdown links through references and specialist docs.
// Ignore examples in fences/code spans, external destinations and vault wikilinks.
function prose(text) {
  return text.replace(/^(?:`{3,}|~{3,})[^\n]*\n[\s\S]*?^(?:`{3,}|~{3,})[ \t]*$/gm, '')
    .replace(/(`+)[^\n]*?\1/g, '');
}
function localLinks(text) {
  return [...prose(text).matchAll(/!?\[[^\]\n]*\]\((<[^>]+>|[^)\s]+)(?:\s+"[^"]*")?\)/g)]
    .map(m => m[1].replace(/^<|>$/g, ''))
    .filter(target => !/^[a-z][a-z0-9+.-]*:|^\/\//i.test(target));
}
function anchors(text) {
  const found = new Set(), counts = new Map();
  const unfenced = text.replace(/^(?:`{3,}|~{3,})[^\n]*\n[\s\S]*?^(?:`{3,}|~{3,})[ \t]*$/gm, '');
  for (const match of unfenced.matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)) {
    const base = match[1].toLowerCase().replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}_\-\s]/gu, '').trim().replace(/\s/g, '-');
    const n = counts.get(base) ?? 0; counts.set(base, n + 1);
    found.add(base + (n ? '-' + n : ''));
  }
  for (const m of unfenced.matchAll(/<(?:a|[a-z][a-z0-9]*)\b[^>]*\b(?:id|name)=["']([^"']+)["']/gi)) found.add(m[1]);
  return found;
}
function referenceProblems(starts, load = file => readFileSync(file, 'utf8'), exists = existsSync) {
  const pending = starts.map(file => resolve(root, file));
  const visited = new Set(), problems = [];
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    for (const target of localLinks(load(file))) {
      const split = target.indexOf('#');
      const name = decodeURIComponent(split < 0 ? target : target.slice(0, split));
      const fragment = split < 0 ? '' : decodeURIComponent(target.slice(split + 1));
      const dest = name ? resolve(dirname(file), name) : file;
      const rel = relative(root, dest);
      if (rel.startsWith('..') || isAbsolute(rel) || !exists(dest)) {
        problems.push(relative(root, file) + ' -> missing/outside ' + target); continue;
      }
      if (dest.endsWith('.md')) {
        if (fragment && !anchors(load(dest)).has(fragment)) problems.push(relative(root, file) + ' -> missing heading ' + target);
        pending.push(dest);
      }
    }
  }
  return { problems, visited };
}

const capabilities = {
  'wiki-user': { 'search.md': 'search.mjs', 'query.md': 'resolve-evidence.mjs', 'authoring.md': 'validate-authored.mjs' },
  'wiki-researcher': { 'discover.md': 'known-urls.mjs', 'capture.md': 'clip.mjs', 'ingest.md': 'health.mjs',
    'clip-pdf.md': 'clip-pdf.mjs', 'clip-docx.md': 'clip-docx.mjs', 'clip-pptx.md': 'clip-pptx.mjs',
    'clip-xlsx.md': 'clip-xlsx.mjs', 'clip-gh.md': 'clip-gh.mjs', 'clip-confluence.md': 'clip-confluence.mjs' },
  'wiki-maintainer': { 'health.md': 'health.mjs', 'stale.md': 'stale.mjs', 'lint.md': 'lint.mjs',
    'repair.md': 'health.mjs', 'relink.md': 'relationships.mjs', 'triage.md': 'triage.mjs', 'obsidian-cli.md': 'obsidian.mjs' },
  'wiki-init': { 'setup.md': 'init.mjs' },
  'wiki-purge': { 'purge.md': 'purge.mjs' },
};

test('exactly five portable role entry points have bounded metadata and no procedural inventories', () => {
  assert.deepEqual(skills, expected);
  assert.deepEqual(readdirSync(join(root, 'skills')).sort(), expected, 'no retired forwarding folders');
  for (const name of skills) {
    const text = read(entry(name));
    assert.equal(text.match(/^name: (.+)$/m)?.[1], name);
    assert.ok(description(name) && description(name).length <= 1024, name + ': description budget');
    assert.match(description(name), /when|asked|request/i, name + ': concrete trigger');
    assert.doesNotMatch(text, /^\s*(?:`{3}|~{3})|^\s*\|/m, name + ': procedures belong in references');
    assert.doesNotMatch(text, /^when_to_use:/m, name + ': portable metadata');
  }
});

test('the skill catalog exactly equals current candidate names and descriptions', () => {
  const catalog = '# Skill catalog (names and descriptions only)\n\n' +
    skills.map(name => '- **' + name + '** — ' + description(name)).join('\n') + '\n';
  assert.equal(read('eval/skill-catalog.md'), catalog, 'regenerate catalog when metadata changes');
});

test('all capabilities have direct procedures with live helpers, including six capture routes', () => {
  for (const [name, routes] of Object.entries(capabilities)) {
    const links = localLinks(read(entry(name)));
    for (const [ref, helper] of Object.entries(routes)) {
      assert.ok(links.includes('references/' + ref), name + ': missing direct mode ' + ref);
      assert.ok(read('skills/' + name + '/references/' + ref).includes(helper), ref + ': missing helper ' + helper);
      assert.ok(existsSync(join(root, 'scripts', helper)), helper);
    }
  }
  const clips = readdirSync(join(root, 'scripts')).filter(file => /^clip-.*\.mjs$/.test(file) && file !== 'clip-and-repoint.mjs');
  assert.deepEqual(clips.sort(), Object.values(capabilities['wiki-researcher']).filter(file => /^clip-/.test(file)).sort());
  for (const format of ['PDF', 'Word', 'PowerPoint', 'spreadsheet', 'GitHub', 'Confluence'])
    assert.ok(description('wiki-researcher').includes(format), 'capture discovery metadata: ' + format);
  assert.ok(localLinks(read(entry('wiki-user'))).includes('../wiki-maintainer/references/obsidian-cli.md'));
});

test('every recursively reachable local file and Markdown heading exists', () => {
  const result = referenceProblems(skills.map(entry));
  assert.deepEqual(result.problems, []);
  for (const name of skills) {
    const refs = join(root, 'skills', name, 'references');
    for (const file of readdirSync(refs).filter(file => file.endsWith('.md')))
      assert.ok(result.visited.has(join(refs, file)), name + ': unreachable reference ' + file);
  }
});

test('the recursive guard catches a broken second-hop link and missing heading but ignores code examples', () => {
  const files = new Map([
    [resolve(root, 'entry.md'), '[reference](nested/ref.md)'],
    [resolve(root, 'nested/ref.md'), '# Existing\n[broken](absent.md)\n[bad anchor](#missing)\n`[example](ignored.md)`\n'],
  ]);
  const result = referenceProblems(['entry.md'], file => files.get(file), file => files.has(file));
  assert.equal(result.problems.length, 2);
  assert.ok(result.problems.some(p => p.includes('absent.md')));
  assert.ok(result.problems.some(p => p.includes('#missing')));
});

test('roles load shared policy directly while ordinary search has a read-only startup', () => {
  for (const name of skills) {
    const links = localLinks(read(entry(name)));
    assert.ok(links.some(link => link.endsWith('/access.md')), name + ': access policy');
    assert.ok(links.some(link => link.endsWith('/operations.md')), name + ': completion policy');
  }
  const user = read(entry('wiki-user')), search = read('skills/wiki-user/references/search.md');
  assert.ok(localLinks(user).includes('references/search.md'));
  assert.doesNotMatch(user + search, /wiki-maintainer\/SKILL\.md/);
  assert.doesNotMatch(search, /op-begin\.mjs|\]\([^)]*operations\.md/);
  assert.match(search, /never writes content/);
  assert.match(search, /--include-raw/);
  for (const file of ['health.md', 'stale.md']) assert.doesNotMatch(read('skills/wiki-maintainer/references/' + file), /op-begin\.mjs/);
  const author = read('skills/wiki-user/references/authoring.md');
  assert.match(author, /before (?:the first |any )?writ/i);
  assert.match(author, /Done only/i);
});

test('operation examples expose both shells and all helper execution uses resolved absolute paths', () => {
  const text = read('skills/wiki-maintainer/references/operations.md');
  assert.match(text, /`{3}powershell/); assert.match(text, /`{3}sh/); assert.match(text, /finally/);
  for (const name of skills) {
    assert.doesNotMatch(read(entry(name)), /TOKEN=\$\(/);
    assert.doesNotMatch(read(entry(name)), /node (?:\.\.\/|scripts\/)/);
  }
  for (const [, block] of text.matchAll(/`{3}(?:powershell|sh)\n([\s\S]*?)`{3}/g)) {
    for (const [, script] of block.matchAll(/scripts\/([\w-]+\.mjs)/g)) assert.ok(existsSync(join(root, 'scripts', script)), script);
  }
});
