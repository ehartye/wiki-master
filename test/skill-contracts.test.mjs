import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const expected = ['wiki-maintainer', 'wiki-project', 'wiki-purge', 'wiki-researcher', 'wiki-search', 'wiki-setup'];
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
  'wiki-search': { 'advanced.md': 'search.mjs', 'answers.md': 'resolve-evidence.mjs' },
  'wiki-project': { 'authoring.md': 'refresh-index.mjs', 'backlog.md': 'backlog-list.mjs', 'catalogs.md': 'refresh-index.mjs' },
  'wiki-researcher': { 'discover.md': 'known-urls.mjs', 'capture.md': 'clip.mjs', 'ingest.md': 'health.mjs',
    'clip-pdf.md': 'clip-pdf.mjs', 'clip-docx.md': 'clip-docx.mjs', 'clip-pptx.md': 'clip-pptx.mjs',
    'clip-xlsx.md': 'clip-xlsx.mjs', 'clip-gh.md': 'clip-gh.mjs', 'clip-confluence.md': 'clip-confluence.mjs' },
  'wiki-maintainer': { 'lint.md': 'lint-disposition.mjs',
    'repair.md': 'health.mjs', 'relink.md': 'relationships.mjs', 'triage.md': 'triage.mjs', 'obsidian-cli.md': 'obsidian.mjs' },
  'wiki-setup': { 'initialization.md': 'init.mjs', 'validation.md': 'validate-authored.mjs',
    'checks.md': 'health.mjs', 'search-diagnostics.md': 'search.mjs',
    'capture-prerequisites.md': 'doctor.mjs', 'app-access.md': 'obsidian.mjs', 'operation-recovery.md': 'refresh-index.mjs' },
  'wiki-purge': { 'purge.md': 'purge.mjs' },
};

test('exactly six portable entry points teach workflows with examples and completion conditions', () => {
  assert.deepEqual(skills, expected);
  assert.deepEqual(readdirSync(join(root, 'skills')).sort(), expected, 'no retired forwarding folders');
  for (const name of skills) {
    const text = read(entry(name));
    assert.equal(text.match(/^name: (.+)$/m)?.[1], name);
    assert.ok(description(name) && description(name).length <= 1024, name + ': description budget');
    assert.match(description(name), /when|asked|request/i, name + ': concrete trigger');
    assert.match(text, /^## (?:Workflow|Simple search)/m, name + ': ordered ordinary workflow');
    assert.match(text, /^1\. /m, name + ': executable ordered steps');
    assert.match(text, /Request:.*[“"]/s, name + ': concrete request example');
    assert.match(text, /Action:/, name + ': example action');
    assert.match(text, /Result:/, name + ': observable example result');
    assert.match(text, /^## Best practices/m, name + ': practical guidance');
    assert.match(text, /^## (?:Advanced references|Advanced search)/m, name + ': conditional depth');
    assert.match(text, /^## Done/m, name + ': observable completion');
    assert.doesNotMatch(text, /^when_to_use:/m, name + ': portable metadata');
  }
});

test('the skill catalog exactly equals current candidate names and descriptions', () => {
  const catalog = '# Skill catalog (names and descriptions only)\n\n' +
    skills.map(name => '- **' + name + '** — ' + description(name)).join('\n') + '\n';
  assert.equal(read('eval/skill-catalog.md'), catalog, 'regenerate catalog when metadata changes');
});

for (const [name, routes] of Object.entries(capabilities)) {
  test(name + ': every capability has a direct procedure with a live helper', () => {
    const links = localLinks(read(entry(name))).map(link => link.split('#')[0]);
    for (const [ref, helper] of Object.entries(routes)) {
      assert.ok(links.includes('references/' + ref), name + ': missing direct mode ' + ref);
      assert.ok(read('skills/' + name + '/references/' + ref).includes(helper), ref + ': missing helper ' + helper);
      assert.ok(existsSync(join(root, 'scripts', helper)), helper);
    }
  });
}

test('all six capture routes are discoverable and synthesis filing stays direct', () => {
  const clips = readdirSync(join(root, 'scripts')).filter(file => /^clip-.*\.mjs$/.test(file));
  assert.deepEqual(clips.sort(), Object.values(capabilities['wiki-researcher']).filter(file => /^clip-/.test(file)).sort());
  for (const format of ['PDF', 'Word', 'PowerPoint', 'spreadsheet', 'GitHub', 'Confluence'])
    assert.ok(description('wiki-researcher').includes(format), 'capture discovery metadata: ' + format);
  assert.ok(localLinks(read(entry('wiki-maintainer'))).includes('references/synthesis-filing.md'));
});

// The capture docs say what clip.mjs does with a JavaScript page. `scripts/doctor.mjs` is the plugin's own doctor: the
// Confluence section of capture-prerequisites.md also names confluencer's, which says nothing about a browser.
const missingFrom = (file, wanted) => wanted.filter(text => !read(file).includes(text));
for (const file of ['skills/wiki-researcher/references/capture.md', 'skills/wiki-setup/references/capture-prerequisites.md']) {
  test(file + ' describes the browser render and the plain-text recipe', () => {
    assert.deepEqual(missingFrom(file, ['extraction: rendered', 'scripts/doctor.mjs', '.md.txt']), []);
  });
}

test('discover.md checks for a browser with doctor.mjs before a batch', () => {
  assert.deepEqual(missingFrom('skills/wiki-researcher/references/discover.md', ['scripts/doctor.mjs']), []);
});

test('every recursively reachable local file and Markdown heading exists', () => {
  const result = referenceProblems([...skills.map(entry), 'README.md', 'docs/codex.md',
    'docs/skill-migration.md', 'docs/skill-reliability.md', 'docs/wiki-integrity.md',
    'docs/wiki-efficacy.md', 'docs/cli-transport-guards.md', 'docs/clipping-fidelity.md', 'docs/reclipping.md']);
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
  for (const name of skills.filter(name => name !== 'wiki-search')) {
    const links = localLinks(read(entry(name)));
    assert.ok(links.some(link => link.endsWith('/access.md')), name + ': access policy');
    assert.ok(links.some(link => link.endsWith('/operations.md')), name + ': completion policy');
  }
  const search = read(entry('wiki-search'));
  assert.match(search, /## Simple search/);
  assert.match(search, /search\.mjs.*--json --limit=10/);
  assert.doesNotMatch(search, /\]\([^)]*operations\.md/);
  assert.match(search, /never writes\s+content/);
  assert.match(search, /--include-raw/);
  assert.match(read('skills/wiki-setup/references/checks.md'), /Read-only reports write no\s+log/);
});

test('original authoring ends with the refresh and says when it is done', () => {
  const author = read('skills/wiki-project/references/authoring.md');
  assert.match(author, /refresh-index\.mjs/);
  assert.match(author, /Done only/i);
});

test('checks and original documentation have canonical owners with direct task obligations', () => {
  assert.ok(!existsSync(join(root, 'skills/wiki-maintainer/references/health.md')));
  assert.ok(!existsSync(join(root, 'skills/wiki-maintainer/references/stale.md')));
  for (const name of ['wiki-project', 'wiki-maintainer', 'wiki-researcher', 'wiki-purge']) {
    assert.ok(localLinks(read(entry(name))).some(link => link.split('#')[0] === '../wiki-setup/references/validation.md'), name + ': direct validation obligation');
  }
  const search = read(entry('wiki-search'));
  assert.ok(localLinks(search).includes('../wiki-project/SKILL.md'));
  assert.ok(localLinks(search).includes('../wiki-maintainer/references/synthesis-filing.md'));
  const filing = read('skills/wiki-maintainer/references/synthesis-filing.md');
  assert.match(filing, /authoriz/i);
  assert.match(filing, /--op query/);
  assert.ok(localLinks(filing).includes('operations.md'));
  const setup = read(entry('wiki-setup'));
  assert.match(setup, /Reports, validation and\s+diagnosis are read-only/);
  assert.match(setup, /does\s+not authorize installing tools, rebuilding indexes, editing content or adding a remote/);
});

test('the completion contract is one short page, in the order every authoring task follows', () => {
  const text = read('skills/wiki-maintainer/references/operations.md');
  assert.ok(text.trimEnd().split('\n').length <= 60, 'about a screen long');
  const steps = ['validate-authored.mjs', 'log-entry.mjs', 'refresh-index.mjs'].map(helper => text.indexOf(helper));
  assert.ok(steps.every(at => at >= 0) && steps[0] < steps[1] && steps[1] < steps[2], 'validate, then log, then refresh');
  assert.ok(localLinks(text).some(link => link.endsWith('operation-recovery.md#written-but-not-refreshed')));
  const flat = text.replace(/\s+/g, ' ');
  assert.match(flat, /once per task/i);
  assert.match(flat, /on disk and that Obsidian Git publishes it/);
  assert.match(flat, /offer that fix to the user, don't apply it unasked/i);
  assert.match(flat, /written but not refreshed/i);
  assert.match(flat, /keep your edits to what your task needs/i);
});

test('completion examples expose both shells and all helper execution uses resolved absolute paths', () => {
  const text = read('skills/wiki-maintainer/references/operations.md');
  assert.match(text, /`{3}powershell/); assert.match(text, /`{3}sh/);
  for (const name of skills) assert.doesNotMatch(read(entry(name)), /node (?:\.\.\/|scripts\/)/);
  for (const [, block] of text.matchAll(/`{3}(?:powershell|sh)\n([\s\S]*?)`{3}/g)) {
    for (const [, script] of block.matchAll(/scripts\/([\w-]+\.mjs)/g)) assert.ok(existsSync(join(root, 'scripts', script)), script);
  }
});

// Decision 16: log once and refresh once per task, so a worker stops after validating. operations.md is the source.
const delegated = /delegated (?:worker|writer) writes and validates[^.]*reports the paths[^.]*the enclosing task[^.]*logs once and runs the refresh/i;
for (const file of ['skills/wiki-maintainer/references/operations.md', 'skills/wiki-project/references/authoring.md', 'skills/wiki-researcher/references/ingest.md', 'skills/wiki-maintainer/references/repair.md']) {
  test(file + ': a delegated worker writes and validates, and the enclosing task logs and refreshes', () => {
    assert.match(read(file).replace(/\s+/g, ' '), delegated);
  });
}

// Criterion 5: the standard sentence. wiki-setup and the vault schema have theirs pinned beside their own tests.
for (const file of ['skills/wiki-maintainer/references/operations.md', 'README.md']) {
  test(file + ' carries the standard sentence', () => {
    assert.ok(read(file).includes('Obsidian Git handles all git operations.'));
  });
}

// Decision 10: Ollama and a running Obsidian are needed to finish authoring, so the README can't call them optional.
test('the README requirements state Obsidian Git and what finishing authoring needs', () => {
  const requirements = read('README.md').split(/^## Requirements$/m)[1].split(/^## /m)[0];
  assert.match(requirements, /Obsidian Git handles all git operations\./);
  assert.match(requirements, /setup-obsidian-git\.mjs/);
  assert.match(requirements, /refresh-index\.mjs/);
  assert.match(requirements, /\*\*Obsidian\*\*[^\n]*\n?[^\n]*[Rr]equired to finish authoring/);
  assert.match(requirements, /\*\*Ollama\*\*[^\n]*\n?[^\n]*[Rr]equired to finish authoring/);
  assert.doesNotMatch(requirements, /Optional:[^\n]*Ollama|do not require a running app/);
  assert.match(requirements, /Reading and searching work without/);
});

test('every script the README and docs name exists, and the README names the two new commands', () => {
  const files = ['README.md', ...scanFiles('docs').filter(file => file.endsWith('.md'))];
  const named = files.flatMap(file => [...read(file).matchAll(/(?<![\w/.-])(?:scripts\/)?([\w-]+\.mjs)\b/g)].map(m => [file, m[1]]));
  const known = new Set([...readdirSync(join(root, 'scripts')), ...readdirSync(join(root, 'scripts', 'lib'))]);
  assert.deepEqual(named.filter(([, script]) => !known.has(script)), []);
  const inReadme = new Set(named.filter(([file]) => file === 'README.md').map(([, script]) => script));
  for (const script of ['refresh-index.mjs', 'setup-obsidian-git.mjs']) assert.ok(inReadme.has(script), script);
});

// Criterion 9: refresh-index.mjs is the last numbered step of every authoring workflow. A paragraph after the list is
// not a step, so a read-only handoff can follow it.
function finalStep(text, heading) {
  const section = text.split(new RegExp('^## ' + heading + '\\b.*$', 'm'))[1]?.split(/^## /m)[0] ?? '';
  const lines = section.split('\n');
  const start = lines.findLastIndex(line => /^\d+\. /.test(line));
  if (start < 0) return '';
  let end = start + 1;
  while (end < lines.length && (!lines[end].trim() || /^\s/.test(lines[end]))) end++;
  return lines.slice(start, end).join('\n');
}

const authoringWorkflows = [
  ['wiki-project', entry('wiki-project'), 'Workflow'],
  ['wiki-maintainer', entry('wiki-maintainer'), 'Workflow'],
  ['wiki-researcher', entry('wiki-researcher'), 'Workflow'],
  ['wiki-purge', entry('wiki-purge'), 'Workflow'],
  ['wiki-setup first run', entry('wiki-setup'), 'First run'],
  ['wiki-setup initialization', 'skills/wiki-setup/references/initialization.md', 'Initialize and verify'],
];
for (const [name, file, heading] of authoringWorkflows) {
  test(name + ' names refresh-index.mjs as its final step', () => {
    const step = finalStep(read(file), heading);
    assert.notEqual(step, '', file + ': no numbered steps under ## ' + heading);
    assert.match(step, /refresh-index\.mjs/, file + ': final step is:\n' + step);
  });
}

// wiki-maintainer's writing procedures finish through the shared contract instead of carrying their own copy of it.
const maintainerFiles = readdirSync(join(root, 'skills/wiki-maintainer/references')).map(ref => 'skills/wiki-maintainer/references/' + ref);
for (const ref of ['repair.md', 'lint.md', 'relink.md', 'synthesis-filing.md', 'triage.md', 'maintenance.md', 'obsidian-cli.md']) {
  test('wiki-maintainer ' + ref + ' finishes through the completion contract', () => {
    assert.ok(localLinks(read('skills/wiki-maintainer/references/' + ref)).includes('operations.md'));
  });
}

test('wiki-maintainer keeps no concept of an operation beyond the log entry', () => {
  const retired = /\b(?:owned|scoped|enclosing|competing|content|lint|relink|query) (?:operations?|commits?|ledger|paths?)\b|operation (?:ledger|lifecycle|semantics|completion)|complete the operation|staleCatalogs/gi;
  for (const file of [entry('wiki-maintainer'), ...maintainerFiles]) {
    assert.deepEqual(read(file).replace(/\s+/g, ' ').match(retired), null, file);
  }
});

test('obsidian-cli.md says the refresh asks about the active vault, so another vault in focus stops it', () => {
  const flat = read('skills/wiki-maintainer/references/obsidian-cli.md').replace(/\s+/g, ' ');
  assert.match(flat, /refresh-index\.mjs[^.]*active vault/);
  assert.match(flat, /another vault[^.]*(?:stops|refuses)/);
});

test('wiki-maintainer says a filesystem edit needs no app but the refresh does', () => {
  assert.match(read(entry('wiki-maintainer')).replace(/\s+/g, ' '), /need no running app[^.]*refresh/i);
  assert.match(read('skills/wiki-maintainer/references/access.md').replace(/\s+/g, ' '), /refresh-index\.mjs[^.]*needs? (?:Obsidian|the app)/);
});

// wiki-researcher: an ingest is an authoring workflow and ends with the contract. A capture that wrote no wiki page logs
// once and stops, because clippings and log entries enter neither the catalogs nor the search index, which
// refresh-index.test.mjs pins.
const researcherRefs = readdirSync(join(root, 'skills/wiki-researcher/references')).map(ref => 'skills/wiki-researcher/references/' + ref);
const flatten = text => text.replace(/\s+/g, ' ');

test('wiki-researcher keeps no concept of an operation beyond the log entry', () => {
  for (const file of [entry('wiki-researcher'), ...researcherRefs]) {
    const words = flatten(read(file).replace(/\]\([^)]*\)/g, ']'));
    assert.deepEqual(words.match(/\boperations?\b|\bowned[ -](?:path|catalog)s?\b|<saved-token>/gi), null, file);
  }
});

test('wiki-researcher ingestion validates, logs and then refreshes, as its last step', () => {
  const heading = 'Ingest and complete the selected set';
  const ingest = read('skills/wiki-researcher/references/ingest.md');
  assert.match(finalStep(ingest, heading), /refresh-index\.mjs/);
  const section = ingest.slice(ingest.indexOf('## ' + heading));
  const steps = ['validate-authored.mjs', 'log-entry.mjs', 'refresh-index.mjs'].map(helper => section.indexOf(helper));
  assert.ok(steps.every(at => at >= 0) && steps[0] < steps[1] && steps[1] < steps[2], 'validate, then log, then refresh');
  assert.ok(localLinks(section).includes('../../wiki-maintainer/references/operations.md'));
});

test('a capture that wrote no wiki page logs once and needs no refresh, and says why', () => {
  const noRefresh = /capture that wrote no wiki page[^.]*no refresh/i;
  for (const file of [entry('wiki-researcher'), 'skills/wiki-researcher/references/capture.md', 'skills/wiki-maintainer/references/operations.md']) {
    assert.match(flatten(read(file)), noRefresh, file);
  }
  const finish = read('skills/wiki-researcher/references/capture.md').split('## Finish capture and report')[1].split(/^## /m)[0];
  assert.match(flatten(finish), /log-entry\.mjs[^.]*--op discover/);
  assert.match(flatten(finish), /enter neither the catalogs nor the search index/);
  assert.match(flatten(finish), /refresh-index\.mjs/, 'a capture that also wrote wiki pages still refreshes');
});

test('every clip route finishes through the capture procedure, not a copy of it', () => {
  for (const file of researcherRefs.filter(file => /\/clip-[a-z]+\.md$/.test(file))) {
    const completion = read(file).split(/^## Completion$/m)[1];
    assert.ok(completion, file + ': no Completion section');
    assert.ok(localLinks(completion).includes('capture.md#finish-capture-and-report'), file);
    assert.doesNotMatch(completion, /log-entry|refresh-index/, file);
  }
});

test('the wiki-researcher search handoff follows the numbered list and is not a step', () => {
  const skill = read(entry('wiki-researcher'));
  assert.doesNotMatch(finalStep(skill, 'Workflow'), /wiki-search/);
  const workflow = skill.split(/^## Workflow$/m)[1].split(/^## /m)[0];
  const afterList = workflow.slice(workflow.indexOf(finalStep(skill, 'Workflow')));
  assert.ok(localLinks(afterList).includes('../wiki-search/SKILL.md'));
});

test('wiki-search is read-only and does not gain the refresh step', () => {
  const references = readdirSync(join(root, 'skills/wiki-search/references')).map(ref => 'skills/wiki-search/references/' + ref);
  for (const file of [entry('wiki-search'), ...references]) assert.doesNotMatch(read(file), /refresh-index\.mjs/, file);
});

// wiki-project and wiki-purge: original authoring ends with the contract, the catalogs have one command, and a purge has
// one approval. A log entry's --op is the only operation left.
const projectFiles = [entry('wiki-project'), ...readdirSync(join(root, 'skills/wiki-project/references')).map(ref => 'skills/wiki-project/references/' + ref)];
const purgeFiles = [entry('wiki-purge'), 'skills/wiki-purge/references/purge.md'];

test('wiki-project and wiki-purge keep no concept of an operation beyond the log entry', () => {
  for (const file of [...projectFiles, ...purgeFiles]) {
    const words = flatten(read(file).replace(/\]\([^)]*\)/g, ']'));
    assert.deepEqual(words.match(/\boperations?\b|\bowned\b|\bownership\b|staleCatalogs|<saved-token>/gi), null, file);
  }
});

test('catalogs.md is short: one command for the whole vault, and fences it overwrites', () => {
  const text = read('skills/wiki-project/references/catalogs.md');
  assert.ok(text.trimEnd().split('\n').length <= 20, 'about ten lines of prose');
  assert.match(flatten(text), /refresh-index\.mjs[^.]*whole vault/);
  assert.match(flatten(text), /overwritten/);
  assert.doesNotMatch(text, /--project|--paths-file|--diff|--apply|dry run/i);
  assert.ok(localLinks(text).includes('../../wiki-maintainer/references/operations.md'));
});

test('read-only backlog listing stays and needs no refresh', () => {
  const flat = flatten(read('skills/wiki-project/references/backlog.md'));
  assert.match(flat, /Read-only listing[^.]*no refresh/i);
  assert.match(flat, /backlog-list\.mjs/);
  assert.match(flatten(read(entry('wiki-project'))), /Backlog listing\.[^]*no writes or refresh/);
});

test('a purge has one approval, and it says what publishes the removal', () => {
  for (const flat of [description('wiki-purge'), ...purgeFiles.map(file => flatten(read(file)))]) {
    assert.match(flat, /Obsidian Git publishes the removal/);
    assert.doesNotMatch(flat, /publication approval|push approval|before pushing|publish this purge/i);
  }
  assert.match(description('wiki-purge'), /one explicit approval/);
  assert.match(flatten(read('skills/wiki-purge/references/purge.md')), /one explicit yes/);
});

test('purge writes its own log entry and the skill does not write a second one', () => {
  for (const file of purgeFiles) assert.match(flatten(read(file)), /no second (?:log )?entry/i, file);
  const steps = read('skills/wiki-purge/references/purge.md').split(/^## Steps$/m)[1].split(/^## /m)[0];
  assert.doesNotMatch(steps, /log-entry\.mjs/);
  const from = steps.indexOf('**Apply');
  const order = ['--apply', 'refresh-index.mjs', 'broken-link'].map(word => steps.indexOf(word, from));
  assert.ok(from >= 0 && order[0] < order[1] && order[1] < order[2], 'apply, refresh, then the count: catalogs list purged pages until the refresh');
});

test('purge recovery matches what purge.mjs does when it fails', () => {
  const flat = flatten(read('skills/wiki-purge/references/purge.md'));
  assert.match(flat, /--reconcile[^.]*by hand/, 'stays manual on other machines');
  assert.match(flat, /timer[^.]*never/i, 'timer pulls do not trigger it');
  assert.match(flat, /UNREADABLE manifest/, 'it does not change the exit code');
  assert.match(flat, /MISSING/);
  assert.match(flat, /Do not rerun `--apply`/);
  assert.match(flat, /only replayed declines[^.]*no refresh/i);
});

test('purge repairs hand-written references: a generated fence clears itself at the refresh', () => {
  const steps = flatten(read('skills/wiki-purge/references/purge.md').split(/^## Steps$/m)[1].split(/^## /m)[0]);
  assert.match(steps, /hand-written/);
  assert.match(steps, /generated fence[^.]*clears itself at the refresh/i);
  assert.match(flatten(read(entry('wiki-purge'))), /generated fence[^.]*clears itself at the refresh/i);
});

test('purge runs no history check: it cannot do that job on a timer, and a rewrite is the owner\'s to handle', () => {
  for (const file of purgeFiles) assert.doesNotMatch(read(file), /merge-base|unrelated histor|upstream/i, file);
  const flat = flatten(read('skills/wiki-purge/references/purge.md'));
  assert.match(flat, /history rewrite is the owner's decision/i);
  assert.match(flat, /old history can bring removed files back on its next run/i);
  assert.match(flat, /If a removed file reappears, tell the owner/);
});

// No skill tells an agent to run git. A command shows up in a code span, at the start of a line, as in a fence, or after a
// verb that runs it. Prose about a git repository or git commands names no command, and that is how wiki-setup describes
// the owner's repository and upstream setup, so there is no exception to carry.
const GIT_COMMAND = /(?:`|^[ \t]*|\b(?:[Rr]un|[Rr]uns|[Rr]unning|[Uu]se|[Tt]ry|[Ee]xecute)\s+)git(?:\s+-[cC]\s+\S+)*\s+(?!(?:repositor|remote\s+URL|client|command|operation|polic|history|handles)\w*)[a-z][a-z-]*/gm;
const gitCommands = text => [...text.matchAll(GIT_COMMAND)].map(m => m[0].trim());

test('no skill or reference tells an agent to run a git command', () => {
  const files = skills.flatMap(name => readdirSync(join(root, 'skills', name), { recursive: true }).map(file => 'skills/' + name + '/' + String(file).replaceAll('\\', '/')))
    .filter(file => file.endsWith('.md'));
  assert.ok(files.includes('skills/wiki-setup/references/operation-recovery.md'));
  const found = files.flatMap(file => gitCommands(read(file)).map(command => file + ': ' + command));
  assert.deepEqual(found, []);
});

test('the git command check catches a command in any of its forms and ignores prose about git', () => {
  for (const text of ['Run `git status` first.', '```sh\ngit -C "<vault>" merge-base HEAD x\n```', 'then run git add .', 'use git blame here']) {
    assert.equal(gitCommands(text).length, 1, text);
  }
  for (const text of ['a git repository', 'git repository and upstream', 'Obsidian Git handles all git operations.', 'work around it with git commands', 'their own git client', '(a git remote URL)']) {
    assert.deepEqual(gitCommands(text), [], text);
  }
});

// Criterion 4: no advice to commit. Only prose and the strings a script holds are scanned. Each allow-list entry is
// `path | substring | reason`. A path ending in / covers its folder, and a space in a substring matches any whitespace,
// so a hard wrap does not break an entry. An entry clears only the words inside its substring, never the rest of a line.
// Beyond the criterion's four words: a git verb in command form, and the bare `pull` and `rebase` that advise doing it.
// Their other tenses only state what happened ("the model is not pulled"), so they are not scanned.
const GIT_WORD = /\bgit(?:\s+-[cC]\s+\S+)*\s+(?:add|commit|push|pull|fetch|rebase|merge|stash|reset|checkout|switch|clean|restore|rm|mv|tag|branch|worktree)\b|\b(?:commit(?:s|ted|ting)?|push(?:es|ed|ing)?|publish(?:es|ed|ing)?|sync(?:s|ed|ing)?|pull|rebase)\b/gi;
const JAVASCRIPT = /\.(?:mjs|cjs|js)$/;
const SCANNED_TEXT = /\.(?:md|base|json|html|py|mjs|cjs|js)$/;
const WORDS_BEFORE_REGEX = new Set(['return', 'typeof', 'case', 'of', 'in', 'void', 'delete', 'throw', 'yield', 'await', 'else', 'do']);

// A script's source with everything but its string and template text blanked, keeping offsets and lines. Comments and
// identifiers such as `failed.push` never count; every message counts, however it reaches the user (console, a thrown
// error, a `hint:` field or a helper's argument). A file it cannot read throws rather than passing quietly.
function stringsOnly(source, file = 'source') {
  const out = source.replace(/[^\n]/g, ' ').split('');
  const keep = (from, to) => { for (let k = from; k < to; k++) out[k] = source[k]; };
  const misread = at => new Error(file + ':' + source.slice(0, at).split('\n').length + ': unterminated literal');
  let i = source.startsWith('#!') ? source.indexOf('\n') : 0;
  function template() {
    let start = i++;
    while (i < source.length && source[i] !== '`') {
      if (source[i] === '\\') i += 2;
      else if (source[i] === '$' && source[i + 1] === '{') { keep(start, i); i += 2; code(true); start = i; }
      else i++;
    }
    if (i >= source.length) throw misread(start);
    keep(start, ++i);
  }
  function code(inExpression) {
    let depth = 0, previous = '';
    while (i < source.length) {
      const c = source[i];
      if (/\s/.test(c)) i++;
      else if (source.startsWith('//', i)) { const end = source.indexOf('\n', i); i = end < 0 ? source.length : end; }
      else if (source.startsWith('/*', i)) { const end = source.indexOf('*/', i); if (end < 0) throw misread(i); i = end + 2; }
      else if (c === "'" || c === '"') {
        let j = i + 1;
        while (source[j] !== c) { if (j >= source.length || source[j] === '\n') throw misread(i); j += source[j] === '\\' ? 2 : 1; }
        keep(i, j + 1); i = j + 1; previous = c;
      } else if (c === '`') { template(); previous = c; }
      else if (c === '/' && (!previous || /[(,=:[!&|?{};+\-*%<>~^}]/.test(previous) || WORDS_BEFORE_REGEX.has(previous))) {
        let j = i + 1, inClass = false;
        while (source[j] !== '/' || inClass) {
          if (j >= source.length || source[j] === '\n') throw misread(i);
          if (source[j] === '\\') j++;
          else if (source[j] === '[') inClass = true;
          else if (source[j] === ']') inClass = false;
          j++;
        }
        i = j + 1; previous = '/regex/';
      } else if (/[\w$]/.test(c)) {
        let j = i; while (j < source.length && /[\w$]/.test(source[j])) j++;
        previous = source.slice(i, j); i = j;
      } else {
        if (c === '{') depth++;
        if (c === '}' && inExpression && depth-- === 0) { i++; return; }
        previous = c; i++;
      }
    }
  }
  code(false);
  return out.join('');
}

function parseAllowList(text) {
  return text.split(/\r?\n/).filter(line => line.trim() && !line.startsWith('#')).map(line => {
    const [path, substring, reason, ...rest] = line.split(' | ');
    assert.ok(path && substring && reason?.trim() && !rest.length, 'allow-list entry needs path | substring | reason: ' + line);
    const spans = new RegExp(substring.split(' ').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'g');
    return { path, substring, reason, spans, used: 0 };
  });
}

function languageHits(file, raw, entries) {
  const text = JAVASCRIPT.test(file) ? stringsOnly(raw, file) : raw;
  const covers = entries.filter(entry => entry.path === file || (entry.path.endsWith('/') && file.startsWith(entry.path)))
    .flatMap(entry => [...text.matchAll(entry.spans)].map(m => ({ entry, from: m.index, to: m.index + m[0].length })));
  const lines = raw.split('\n');
  const hits = [];
  for (const match of text.matchAll(GIT_WORD)) {
    const cover = covers.find(span => span.from <= match.index && match.index + match[0].length <= span.to);
    if (cover) { cover.entry.used++; continue; }
    const line = text.slice(0, match.index).split('\n').length;
    hits.push({ file, line, word: match[0], text: lines[line - 1].trim().slice(0, 160) });
  }
  return hits;
}

function scanFiles(area) {
  const absolute = join(root, area);
  if (!statSync(absolute).isDirectory()) return [area];
  return readdirSync(absolute, { recursive: true }).map(name => area + '/' + String(name).replaceAll('\\', '/'))
    .filter(file => SCANNED_TEXT.test(file) && !file.startsWith('docs/superpowers/') && !file.includes('/node_modules/'));
}

const languageAreas = [...skills.map(name => 'skills/' + name), 'docs', 'README.md', 'templates', 'scripts'];

for (const area of languageAreas) {
  test('no git language outside the allow list: ' + area, () => {
    const entries = parseAllowList(read('test/fixtures/git-language-allow.txt'));
    const hits = scanFiles(area).flatMap(file => languageHits(file, read(file), entries));
    assert.equal(hits.length, 0, hits.length + ' hit(s) in ' + area + ':\n' +
      hits.map(hit => hit.file + ':' + hit.line + ': ' + hit.word + ': ' + hit.text).join('\n'));
  });
}

test('the language scan catches other git verbs and the bare words that advise them', () => {
  const words = text => languageHits('docs/x.md', text, []).map(hit => hit.word);
  assert.deepEqual(words('Run git add and git pull --rebase.'), ['git add', 'git pull', 'rebase']);
  assert.deepEqual(words('Use git -C "<vault>" stash, then git\nfetch.'), ['git -C "<vault>" stash', 'git\nfetch']);
  assert.deepEqual(words('Then pull and rebase.'), ['pull', 'rebase']);
  assert.deepEqual(words('The model was pulled. A git repository holds it, and rebased pages stay.'), []);
});

test('every allow-list entry names a real path and still clears a hit', () => {
  const entries = parseAllowList(read('test/fixtures/git-language-allow.txt'));
  for (const area of languageAreas) for (const file of scanFiles(area)) languageHits(file, read(file), entries);
  for (const entry of entries) assert.ok(existsSync(join(root, entry.path)), 'no such path: ' + entry.path);
  assert.deepEqual(entries.filter(entry => !entry.used).map(entry => entry.path + ' | ' + entry.substring), []);
});

test('the language scan reads messages however a script delivers them, and clears only what an entry covers', () => {
  const script = [
    '// commit in a comment is not a message',
    'failed.push({ path, why: commit.sha });',
    "throw new Error('Commit or finish your edits');",
    'console.log(`run ${sync} and push now`);',
    "report({ message: 'sync it', reason: 'pushed late', fix: 'publish', hint: 'committing' });",
    "throw failure(\n  'then commits',\n);",
    "const r = /don't push/.test(text), half = a / 2;",
  ].join('\n');
  const words = languageHits('scripts/x.mjs', script, []).map(hit => hit.line + ':' + hit.word);
  assert.deepEqual(words, ['3:Commit', '4:push', '5:sync', '5:pushed', '5:publish', '5:committing', '7:commits']);
  assert.throws(() => stringsOnly("const a = 'never closed\n", 'scripts/x.mjs'), /scripts\/x\.mjs:1: unterminated/);

  const prose = 'Obsidian Git\npublishes it. Commit it too.\n';
  const entries = parseAllowList('docs/ | Obsidian Git publishes | Says Obsidian Git does it.\nother.md | Commit it | Elsewhere.');
  assert.deepEqual(languageHits('docs/x.md', prose, entries).map(hit => hit.line + ':' + hit.word), ['2:Commit']);
  assert.equal(entries[0].used, 1);
  assert.equal(entries[1].used, 0);
  assert.throws(() => parseAllowList('docs/x.md | only a substring'), /path \| substring \| reason/);
});
