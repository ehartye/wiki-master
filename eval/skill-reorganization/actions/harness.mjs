// Candidate-only extension of the retained WP1 harness; baseline evidence stays unchanged.
// Evidence only: independent reviewers grade transcripts through evaluate-skill-behavior.mjs.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const [pluginArg, claude, condition = 'candidate', caseList = 'project,setup,search,init,recovery'] = process.argv.slice(2);
if (!pluginArg || !claude) throw new Error('usage: node harness.mjs <plugin> <claude> [baseline|candidate] [project,setup,search]');
const plugin = path.resolve(pluginArg), evidence = path.resolve('eval/skill-reorganization/actions');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-skill-reorganization-'));
const { scaffold } = await import(pathToFileURL(path.join(plugin, 'scripts/init.mjs')));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const write = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
function sanitize(s) {
  for (const [p, label] of [[scratch, '<SCRATCH>'], [plugin, '<PLUGIN>'], [os.homedir(), '<HOME>']]) {
    for (const v of new Set([p, p.replaceAll('\\', '/'), p.replaceAll('/', '\\'), p.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, d) => '/' + d.toLowerCase())])) {
      let escaped = v;
      const variants = [v];
      for (let depth = 0; depth < 3; depth++) { escaped = JSON.stringify(escaped).slice(1, -1); variants.unshift(escaped); }
      for (const variant of variants) s = s.split(variant).join(label);
    }
  }
  s = s.split(os.userInfo().username).join('<USER>');
  return s.replace(/C--Users-[^/\\"\s]+/g, '<ENCODED_PROJECT_PATH>').replace(/\/tmp\/wiki-skill-reorganization-[A-Za-z0-9]+/g, '<SCRATCH>').replace(/PATH=[^\r\n]*?(?=\\n|\r?\n|$)/g, 'PATH=<HOST_PATH>');
}
const save = (p, o) => write(path.join(evidence, p), sanitize(typeof o === 'string' ? o : JSON.stringify(o, null, 2) + '\n'));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
function snapshot(vault) {
  const files = {};
  function walk(dir) { for (const x of fs.readdirSync(dir, { withFileTypes: true })) {
    if (x.name === '.git') continue;
    const p = path.join(dir, x.name);
    if (x.isDirectory()) walk(p); else { const b = fs.readFileSync(p); files[path.relative(vault, p).replaceAll('\\', '/')] = { sha256: sha(b), bytes: b.length, content: b.toString('utf8') }; }
  } }
  walk(vault);
  return fs.existsSync(path.join(vault, '.git')) ? { files, head: git(vault, 'rev-parse', 'HEAD'), status: git(vault, 'status', '--porcelain'), remoteHead: git(vault, 'ls-remote', 'origin', 'refs/heads/main').split(/\s/)[0] } : { files, head: null, status: 'not a Git repository', remoteHead: null };
}
const authored = (kind, title, body, extra = '') => `---\ntype: authored\ncreated: 2026-10-01\nupdated: 2026-10-01\nreviewed: 2026-10-01\nstatus: maintained\nsources: []\nai-generated: true\nproject: beacon\nkind: ${kind}\n${extra}---\n# ${title}\n\n${body}\n`;
function fixture(name) {
  const vault = path.join(scratch, name), remote = path.join(scratch, name + '.git');
  if (name.endsWith('-init') || name.endsWith('-init-custom')) {
    write(path.join(vault, 'index.md'), '# Existing personal landing page\n\nPreserve this exact existing content.\n');
    if (name.endsWith('-init-custom')) write(path.join(vault, '_templates/authored-note.md'), '# Customized template\n\nThis exact owner-authored content must survive initialization.\n');
    return vault;
  }
  scaffold(vault, path.join(plugin, 'templates'));
  write(path.join(vault, 'AGENTS.md'), '# Controlled evaluation vault\nUse only this configured vault. The local bare origin is authorized for requested documentation publication. Preserve raw evidence and unrelated edits. Do not access other vaults, installed plugin caches or global settings. Diagnostic requests authorize no writes.\n');
  write(path.join(vault, 'wiki/authored/beacon/overview.md'), authored('overview', 'Beacon', 'A generic message relay project. See [[wiki/authored/beacon/architecture.md]].', 'repo: https://example.invalid/beacon\n'));
  write(path.join(vault, 'wiki/authored/beacon/architecture.md'), authored('architecture', 'Beacon architecture', 'The deployed relay persists messages in a local queue and dispatches them using one worker. A second worker is proposed, not implemented.'));
  write(path.join(vault, 'wiki/authored/beacon/backlog/parallel-workers.md'), authored('backlog-item', 'Parallel workers', 'Proposed: introduce a second worker. Acceptance: preserve per-key ordering. This has not shipped.', 'backlog-status: open\n'));
  const oldFixture = JSON.parse(fs.readFileSync(path.join(plugin, 'eval/skill-consolidation/baseline-search/fixture.json'), 'utf8'));
  for (const [p, s] of Object.entries(oldFixture)) if (!['AGENTS.md', 'vault-schema.md', '.gitignore'].includes(p)) write(path.join(vault, p), s);
  if(name.endsWith('-repair')) write(path.join(vault,'wiki/concepts/Repair Target.md'), '---\ntype: concept\nstatus: draft\nsources: ["[[raw/clippings/Missing Study.md]]"]\n---\n# Repair Target\nThe measured protocol delivered seven lantern messages. [[raw/clippings/Missing Study.md]]\n');
  if (name.endsWith('-raw-failed')) {
    // A real ENOTDIR from the unchanged helper, not a substituted tool response.
    // Keep original fixture evidence outside the vault while its raw mount is offline.
    const source = path.resolve(vault, 'raw'), target = path.resolve(scratch, name + '-raw-offline');
    for (const p of [source, target]) if (!p.startsWith(path.resolve(scratch) + path.sep)) throw new Error('Fixture move escaped scratch');
    fs.renameSync(source, target);
    write(source, 'Offline raw storage fixture: the expected raw directory is unavailable.\n');
  }
  git(vault, 'init', '-q', '--initial-branch=main'); git(vault, 'config', 'core.autocrlf', 'false');
  git(vault, 'config', 'user.name', 'Evaluation Fixture'); git(vault, 'config', 'user.email', 'fixture@example.invalid');
  git(vault, 'init', '-q', '--bare', remote); git(vault, 'remote', 'add', 'origin', remote);
  git(vault, 'add', '.'); git(vault, 'commit', '-qm', 'Initial controlled fixture'); git(vault, 'push', '-q', '-u', 'origin', 'main');
  return vault;
}
const prompts = {
 repair: 'Repair only the broken raw citation in wiki/concepts/Repair Target.md. Inspect its claim and actual evidence, correct the citation to the exact existing supported raw path, preserve raw bytes and unrelated pages. Validate owned changed paths, log and publish scoped completion to the configured local bare origin.',
 synthesis: 'File a provenance-derived synthesis answering how many lantern messages the measured Beacon protocol delivered, based on the actual captured Beacon Study. Inspect evidence, distinguish measurement from broader claims, create or update the appropriate synthesis with citations. This explicitly authorizes filing and scoped publication to the configured local bare origin.',
 native: 'Open wiki/authored/beacon/architecture.md in Obsidian, and independently read that exact file to report the deployed worker count. The disposable vault is not registered in the app. Use the guarded adapter for the requested app action; do not register or switch vaults, start the app, or retry uncertain mutations. If unavailable, report the app action honestly and still complete the filesystem read. No content changes.',
 purge: 'Preview only the removal of Beacon Protocol and its evidence. Generate and inspect a removal plan, explain selected seeds, collateral and blockers. Do not apply, reconcile, restore, move files, open operations, log, commit, sync or publish. Do not treat this request as approval to purge.',
 routing: 'Selection-only routing probe. For each request below choose the appropriate wiki role or none and actually read its main file to substantiate the boundary. Do not run vault workflows or change files. Requests: find a wiki passage; write original architecture; validate existing authored paths only; diagnose lexical-only search; count un-ingested captures; process un-ingested captures; file an explicitly authorized derived synthesis; open a note in Obsidian; fix a broken citation; preview topic purge; change the CSS of an unrelated application. Report read-only versus mutation scope for each. This is selection evidence, not executed workflow success.',
  'validation-only': 'Validate only wiki/authored/beacon/architecture.md and wiki/authored/beacon/backlog/parallel-workers.md, and report the actual findings and coverage. Do not repair content, initialize anything, refresh catalogs or indexes, create operations or logs, commit or sync. This is a validation-only request.',
  simple: 'Find the exact phrase "The copper heron carries seven lanterns" in the wiki. Open the matching passage and return a path/line citation with any retrieval coverage limit. This is a simple read-only lookup; do not change files.',
  'raw-failed': 'Search the wiki and explicitly include raw evidence for "quartz otter 817". Open available matching passages and give path/line citations. Explain whether raw evidence was actually searched and distinguish missing coverage from zero matches. This fixture has unavailable raw storage; do not repair it, change files, or read hidden/offline storage.',
  'init-custom': 'Initialize this local wiki vault safely, preserving every existing file byte-for-byte, including index.md and the customized _templates/authored-note.md. Do not overwrite existing content. If the initialization helper cannot safely satisfy that constraint, report the specific blocker and leave the existing content unchanged. Do not create a Git repository/remote, install dependencies or configure the app.',
  init: 'Initialize this new local wiki vault safely. Its existing index.md must remain byte-identical. Set up the standard filesystem structure and check it. No Git remote or app setup is authorized; report filesystem initialization separately from app integration and publication. Do not install dependencies or rewrite existing content.',
  recovery: 'The fixture contains an abandoned operation opened by this same evaluation session. Diagnose it, then perform the explicitly authorized recovery: abort that owned abandoned token, preserving every content file. Do not abort another operation or change content, logs, commits or remote state. Verify that the abandoned operation is no longer open.',
  project: 'Update Beacon architecture to reflect the verified implementation: the deployed relay has one dispatcher worker and persists each message in a local queue before acknowledgement. Update its parallel-workers backlog item to capture a proposed two-worker design, acceptance criteria preserving per-key order, and the requirement to benchmark it before shipping. Keep planned work distinct from as-built behavior. Update affected catalogs, validate only your changed paths, and complete scoped commit and publication to the configured local bare origin. This request authorizes that fixture publication.',
  setup: 'Validate only wiki/authored/beacon/architecture.md and wiki/authored/beacon/backlog/parallel-workers.md. Report vault health, freshness and lint findings, and diagnose why search currently lacks semantic coverage. Do not repair, initialize, install, rebuild indexes, edit files, log operations, commit or sync. Explain actual coverage limits. This is a read-only diagnostic request.',
  search: 'Perform read-only wiki lookups: find the exact phrase "The copper heron carries seven lanterns", the alias "Lantern Relay", and "Harbor" without assuming which similarly named page I mean. Explicitly retrieve raw evidence for "quartz otter 817" and trace its provenance where supported. Then answer whether Beacon already ships two dispatcher workers, using project-scoped retrieval and actual passages. Open matched passages and return path/line citations with coverage diagnostics. Do not write, log, refresh indexes or repair search.'
};
async function actor(kind) {
  const name = condition + '-' + kind;
  if (fs.existsSync(path.join(evidence, name))) throw new Error('Refusing to overwrite retained execution: ' + name);
  const vault = fixture(name), temp = path.join(scratch, name + '-temp'); fs.mkdirSync(temp);
  const env = { ...process.env, WIKI_MASTER_VAULT: vault, WIKI_MASTER_REQUIRE_VAULT: '1', OLLAMA_HOST: 'http://127.0.0.1:1', TEMP: temp, TMP: temp, TMPDIR: temp };
  let recovery = '';
  if (kind === 'recovery') {
    recovery = execFileSync(process.execPath, [path.join(plugin, 'scripts/op-begin.mjs'), '--op', 'relink'], { cwd: vault, env, encoding: 'utf8', windowsHide: true }).trim();
    save(name + '/fixture-preparation.json', { command: ['node', '<PLUGIN>/scripts/op-begin.mjs', '--op', 'relink'], stdout: recovery, ownership: 'Created by evaluation harness for this actor, no other active writers.' });
  }
  const without = condition === 'baseline' && kind !== 'search';
  const common = `Execute the requested task using actual helper commands and file inspection, not a proposed plan. Work only in the configured disposable vault. Helper installation: ${plugin}. Use absolute helper paths. Do not modify the plugin, installed caches or global settings. Ephemeral scratch files belong in TEMP/TMPDIR. `;
  const prompt = common + (without ? 'No skills are loaded for this baseline. You may inspect helper source, CLI help and the vault schema/templates, but do not read any SKILL.md or skills/ reference files. ' : 'Use the session-loaded wiki-master skill and its relevant references. ') + prompts[kind] + (recovery ? ' Owned token from op-begin: ' + recovery : '');
  const args = ['-p', prompt, ...(without ? ['--disable-slash-commands'] : ['--plugin-dir', plugin]), '--setting-sources', 'local', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'dontAsk', '--allowedTools', 'Skill,Read,Glob,Grep,Bash,PowerShell,Write,Edit'];
  save(name + '/before.json', snapshot(vault));
  save(name + '/request.json', { prompt, command: ['claude', ...args], condition: without ? 'without skill' : 'with current/candidate skill', revision: git(plugin, 'rev-parse', 'HEAD'), environment: { WIKI_MASTER_VAULT: vault, OLLAMA_HOST: env.OLLAMA_HOST }, scenario: prompts[kind] });
  console.log('START ' + name); const started = Date.now();
  const result = await new Promise(resolve => { const child = spawn(claude, args, { cwd: vault, env, windowsHide: true }); let stdout = '', stderr = ''; child.stdout.on('data', b => { stdout += b; fs.appendFileSync(path.join(scratch, name + '.jsonl'), b); }); child.stderr.on('data', b => stderr += b); child.on('error', e => resolve({ exit: null, error: e.message, stdout, stderr })); child.on('close', (exit, signal) => resolve({ exit, signal, stdout, stderr })); });
  save(name + '/transcript.jsonl', result.stdout); save(name + '/stderr.txt', result.stderr);
  save(name + '/execution.json', { exit: result.exit, signal: result.signal, error: result.error, durationMs: Date.now() - started });
  save(name + '/after.json', snapshot(vault));
  const events = result.stdout.split('\n').flatMap(s => { try { return [JSON.parse(s)]; } catch { return []; } });
  const init = events.find(e => e.type === 'system' && e.subtype === 'init');
  const tools = events.flatMap(e => e.type === 'assistant' ? (e.message?.content ?? []).filter(c => c.type === 'tool_use') : []);
  save(name + '/observations.json', { wikiSkills: init?.skills?.filter(s => s.startsWith('wiki-master:')), plugins: init?.plugins, skillInvocations: tools.filter(t => t.name === 'Skill'), reads: tools.filter(t => t.name === 'Read'), final: events.findLast(e => e.type === 'result'), grading: 'Not graded by executor; independent reviewer required.' });
  console.log('DONE ' + name + ' exit=' + result.exit);
}
const skillSources = {};
function collectSkills(dir) { for (const x of fs.readdirSync(dir, { withFileTypes: true })) {
  const p = path.join(dir, x.name);
  if (x.isDirectory()) collectSkills(p);
  else if (p.endsWith('.md')) { const b = fs.readFileSync(p); skillSources[path.relative(plugin, p).replaceAll('\\', '/')] = { sha256: sha(b), bytes: b.length, content: b.toString('utf8') }; }
} }
collectSkills(path.join(plugin, 'skills'));
const expectedSkills = condition === 'baseline-routing' ? ['wiki-init','wiki-maintainer','wiki-purge','wiki-researcher','wiki-user'] : ['wiki-maintainer', 'wiki-project', 'wiki-purge', 'wiki-researcher', 'wiki-search', 'wiki-setup'];
const actualSkills = Object.keys(skillSources).filter(p => /^skills\/[^/]+\/SKILL\.md$/.test(p)).map(p => p.split('/')[1]).sort();
if (JSON.stringify(actualSkills) !== JSON.stringify(expectedSkills)) throw new Error('Candidate catalog is not ready: ' + actualSkills.join(', '));
save(condition + '-source-' + caseList.replaceAll(',', '-') + '.json', skillSources);
save(condition + '-run-' + caseList.replaceAll(',', '-') + '.json', { started: new Date().toISOString(), host: execFileSync(claude, ['--version'], { encoding: 'utf8' }).trim(), scratch, cases: caseList.split(','), adaptation: 'skill-reorganization/harness.mjs; original five fixture requests unchanged; three additional boundary cases' });
console.log('SCRATCH ' + scratch);
await Promise.all(caseList.split(',').map(actor));
