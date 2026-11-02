// Disposable actor fixture runner, adapted from skill-consolidation/research/harness.mjs.
// Evidence only: independent reviewers grade transcripts through evaluate-skill-behavior.mjs.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const [pluginArg, claude, condition = 'baseline', caseList = 'project,setup,search'] = process.argv.slice(2);
if (!pluginArg || !claude) throw new Error('usage: node harness.mjs <plugin> <claude> [baseline|candidate] [project,setup,search]');
const plugin = path.resolve(pluginArg), evidence = path.resolve('eval/skill-reorganization');
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
  if (name.endsWith('-init')) {
    write(path.join(vault, 'index.md'), '# Existing personal landing page\n\nPreserve this exact existing content.\n');
    return vault;
  }
  scaffold(vault, path.join(plugin, 'templates'));
  write(path.join(vault, 'AGENTS.md'), '# Controlled evaluation vault\nUse only this configured vault. The local bare origin is authorized for requested documentation publication. Preserve raw evidence and unrelated edits. Do not access other vaults, installed plugin caches or global settings. Diagnostic requests authorize no writes.\n');
  write(path.join(vault, 'wiki/authored/beacon/overview.md'), authored('overview', 'Beacon', 'A generic message relay project. See [[wiki/authored/beacon/architecture.md]].', 'repo: https://example.invalid/beacon\n'));
  write(path.join(vault, 'wiki/authored/beacon/architecture.md'), authored('architecture', 'Beacon architecture', 'The deployed relay persists messages in a local queue and dispatches them using one worker. A second worker is proposed, not implemented.'));
  write(path.join(vault, 'wiki/authored/beacon/backlog/parallel-workers.md'), authored('backlog-item', 'Parallel workers', 'Proposed: introduce a second worker. Acceptance: preserve per-key ordering. This has not shipped.', 'backlog-status: open\n'));
  const oldFixture = JSON.parse(fs.readFileSync(path.join(plugin, 'eval/skill-consolidation/baseline-search/fixture.json'), 'utf8'));
  for (const [p, s] of Object.entries(oldFixture)) if (!['AGENTS.md', 'vault-schema.md', '.gitignore'].includes(p)) write(path.join(vault, p), s);
  git(vault, 'init', '-q', '--initial-branch=main'); git(vault, 'config', 'core.autocrlf', 'false');
  git(vault, 'config', 'user.name', 'Evaluation Fixture'); git(vault, 'config', 'user.email', 'fixture@example.invalid');
  git(vault, 'init', '-q', '--bare', remote); git(vault, 'remote', 'add', 'origin', remote);
  git(vault, 'add', '.'); git(vault, 'commit', '-qm', 'Initial controlled fixture'); git(vault, 'push', '-q', '-u', 'origin', 'main');
  return vault;
}
const prompts = {
  init: 'Initialize this new local wiki vault safely. Its existing index.md must remain byte-identical. Set up the standard filesystem structure and check it. No Git remote or app setup is authorized; report filesystem initialization separately from app integration and publication. Do not install dependencies or rewrite existing content.',
  recovery: 'The fixture contains an abandoned operation opened by this same evaluation session. Diagnose it, then perform the explicitly authorized recovery: abort that owned abandoned token, preserving every content file. Do not abort another operation or change content, logs, commits or remote state. Verify that the abandoned operation is no longer open.',
  project: 'Update Beacon architecture to reflect the verified implementation: the deployed relay has one dispatcher worker and persists each message in a local queue before acknowledgement. Update its parallel-workers backlog item to capture a proposed two-worker design, acceptance criteria preserving per-key order, and the requirement to benchmark it before shipping. Keep planned work distinct from as-built behavior. Update affected catalogs, validate only your changed paths, and complete scoped commit and publication to the configured local bare origin. This request authorizes that fixture publication.',
  setup: 'Validate only wiki/authored/beacon/architecture.md and wiki/authored/beacon/backlog/parallel-workers.md. Report vault health, freshness and lint findings, and diagnose why search currently lacks semantic coverage. Do not repair, initialize, install, rebuild indexes, edit files, log operations, commit or sync. Explain actual coverage limits. This is a read-only diagnostic request.',
  search: 'Perform read-only wiki lookups: find the exact phrase "The copper heron carries seven lanterns", the alias "Lantern Relay", and "Harbor" without assuming which similarly named page I mean. Explicitly retrieve raw evidence for "quartz otter 817" and trace its provenance where supported. Then answer whether Beacon already ships two dispatcher workers, using project-scoped retrieval and actual passages. Open matched passages and return path/line citations with coverage diagnostics. Do not write, log, refresh indexes or repair search.'
};
async function actor(kind) {
  const name = condition + '-' + kind, vault = fixture(name), temp = path.join(scratch, name + '-temp'); fs.mkdirSync(temp);
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
save(condition + '-run-' + caseList.replaceAll(',', '-') + '.json', { started: new Date().toISOString(), host: execFileSync(claude, ['--version'], { encoding: 'utf8' }).trim(), scratch, cases: caseList.split(','), adaptation: 'skill-consolidation/research/harness.mjs' });
console.log('SCRATCH ' + scratch);
await Promise.all(caseList.split(',').map(actor));
