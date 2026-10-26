import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refreshCatalogs } from '../scripts/refresh-catalogs.mjs';
import { regenerateBacklogRoadmaps } from '../scripts/backlog-gen.mjs';
import { regenerateAuthoredMocs } from '../scripts/moc-authored-gen.mjs';
import { regenerateIndex } from '../scripts/index-gen.mjs';
import { buildGraph } from '../scripts/lib/graph.mjs';
import { validateAuthored } from '../scripts/validate-authored.mjs';
function fixture(t) {
 const root=mkdtempSync(join(tmpdir(),'wm-refresh-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 for(const project of ['alpha','beta']) {
  mkdirSync(join(root,'wiki/authored',project,'backlog'),{recursive:true});
  for(const [name,kind] of [['overview','overview'],['shared','note'],['backlog/task','backlog-item']])
   writeFileSync(join(root,'wiki/authored',project,name+'.md'),`---\ntype: authored\nproject: ${project}\nkind: ${kind}\nbacklog-status: planned\nsources: []\n---\n# ${name}\n`);
 }return root;
}
test('batch builds once, scopes writes, preserves collisions and creates index entries for new catalogs',t=>{
 const root=fixture(t);let builds=0;
 const result=refreshCatalogs(root,{project:'alpha',apply:true,buildGraphImpl:p=>{builds++;return buildGraph(p)}});
 assert.equal(builds,1);assert.ok(result.changed.includes('index.md'));
 assert.ok(existsSync(join(root,'moc/alpha.md')));assert.ok(!existsSync(join(root,'moc/beta.md')));
 assert.ok(!existsSync(join(root,'wiki/authored/beta/roadmap.md')));
 assert.match(readFileSync(join(root,'moc/alpha.md'),'utf8'),/wiki\/authored\/alpha\/shared\|shared/);
 assert.match(readFileSync(join(root,'index.md'),'utf8'),/alpha/);
 const before=readFileSync(join(root,'index.md'),'utf8');
 regenerateIndex(root);assert.equal(readFileSync(join(root,'index.md'),'utf8'),before);
});
test('a repeat refresh writes nothing and leaves file times alone',t=>{
 const root=fixture(t);refreshCatalogs(root,{project:'alpha',apply:true});
 const files=['index.md','moc/alpha.md','wiki/authored/alpha/roadmap.md'];
 const times=files.map(p=>statSync(join(root,p)).mtimeMs);
 const r=refreshCatalogs(root,{project:'alpha',apply:true});assert.deepEqual(r.changed,[]);
 assert.deepEqual(files.map(p=>statSync(join(root,p)).mtimeMs),times);
});
test('batch dry run changes nothing; project traversal is rejected before scanning',t=>{
 const root=fixture(t);const r=refreshCatalogs(root,{project:'alpha'});assert.equal(r.applied,false);
 assert.ok(!existsSync(join(root,'moc')));assert.ok(!existsSync(join(root,'index.md')));
 for(const project of ['../escape','/abs','a/../b','a\\b','C:/x',''])
  assert.throws(()=>refreshCatalogs(root,{project,buildGraphImpl:()=>assert.fail('must not scan')}),/project/i);
});
test('batch output equals sequential generators, including first-created catalog collisions',t=>{
 const a=fixture(t),b=fixture(t);
 const now=new Date('2026-03-05T12:00:00Z');
 regenerateBacklogRoadmaps(a,{apply:true,now});regenerateAuthoredMocs(a,{apply:true});regenerateIndex(a);
 refreshCatalogs(b,{apply:true,now});
 for(const p of ['index.md','moc/alpha.md','moc/beta.md','wiki/authored/alpha/roadmap.md','wiki/authored/beta/roadmap.md'])
  assert.equal(readFileSync(join(a,p),'utf8'),readFileSync(join(b,p),'utf8'),p);
});
test('individual generators accept project scope and reject invalid selectors',t=>{
 const root=fixture(t);
 assert.deepEqual(regenerateBacklogRoadmaps(root,{project:'alpha',apply:true}).written,['alpha']);
 assert.deepEqual(regenerateAuthoredMocs(root,{project:'alpha',apply:true}).written,['alpha']);
 assert.ok(!existsSync(join(root,'moc/beta.md')));
 assert.throws(()=>regenerateBacklogRoadmaps(root,{project:'../x'}),/project/i);
});

test('owned paths exclude foreign untracked pages but never remove tracked pages',async t=>{
 const {execFileSync}=await import('node:child_process');const root=fixture(t);
 execFileSync('git',['init','-q'],{cwd:root});execFileSync('git',['config','core.autocrlf','false'],{cwd:root});execFileSync('git',['add','.'],{cwd:root});
 const foreign='wiki/authored/beta/unfinished.md';writeFileSync(join(root,foreign),'---\ntype: authored\nproject: beta\nkind: note\n---\n# Not ours\n');
 const ours='wiki/authored/alpha/ours.md';writeFileSync(join(root,ours),'---\ntype: authored\nproject: alpha\nkind: note\n---\n# Ours\n');
 refreshCatalogs(root,{project:'alpha',apply:true,ownedPaths:[ours]});
 const index=readFileSync(join(root,'index.md'),'utf8');assert.match(index,/ours/);assert.doesNotMatch(index,/unfinished/);assert.match(index,/beta\/overview/);
});

test('all generators reuse a supplied graph without scanning the vault',t=>{
 const root=fixture(t);const graph=buildGraph(root);const missing=join(root,'absent');
 assert.deepEqual(regenerateBacklogRoadmaps(missing,{project:'alpha',graph}).written,['alpha']);
 assert.deepEqual(regenerateAuthoredMocs(missing,{project:'alpha',graph}).written,['alpha']);
 assert.ok(regenerateIndex(missing,{graph,apply:false}).pages>0);
});

// A roadmap the refresh creates must satisfy validate-authored.mjs and be listed in its project's map.
const NOW = new Date('2026-03-05T23:59:59Z');

test('a refresh forwards now: the roadmap it creates carries all eight authored keys and validates', t => {
  const root = fixture(t);
  const result = refreshCatalogs(root, { project: 'alpha', apply: true, now: NOW });
  assert.ok(result.changed.includes('wiki/authored/alpha/roadmap.md'));
  const text = readFileSync(join(root, 'wiki/authored/alpha/roadmap.md'), 'utf8');
  assert.match(text, /^---\ntype: authored\ncreated: 2026-03-05\nupdated: 2026-03-05\nstatus: draft\nsources: \[\]\nai-generated: true\nproject: alpha\nkind: roadmap\n---\n/);
  assert.doesNotMatch(text, /^reviewed:/m);
  assert.deepEqual(validateAuthored(root, ['wiki/authored/alpha/roadmap.md']).defects, []);
});

test('a scoped refresh lists the new roadmap in the project map with a bare link when no other roadmap exists', t => {
  const root = fixture(t);
  refreshCatalogs(root, { project: 'alpha', apply: true, now: NOW });
  const moc = readFileSync(join(root, 'moc/alpha.md'), 'utf8');
  assert.match(moc, /## Roadmap\n- \[\[roadmap\]\]/);
  assert.match(readFileSync(join(root, 'index.md'), 'utf8'), /\[\[roadmap\]\]/);
});

test('an unscoped refresh lists each new roadmap under its own project with a path link', t => {
  const root = fixture(t);
  refreshCatalogs(root, { apply: true, now: NOW });
  for (const project of ['alpha', 'beta']) {
    const moc = readFileSync(join(root, `moc/${project}.md`), 'utf8');
    assert.match(moc, new RegExp(`## Roadmap\\n- \\[\\[wiki/authored/${project}/roadmap\\|roadmap\\]\\]`), project);
    assert.deepEqual(validateAuthored(root, [`wiki/authored/${project}/roadmap.md`]).defects, [], project);
  }
});

test('a refresh dry run with now creates no roadmap, and now: undefined falls through to the current day', t => {
  const root = fixture(t);
  const dry = refreshCatalogs(root, { project: 'alpha', now: NOW });
  assert.equal(dry.applied, false);
  assert.ok(!existsSync(join(root, 'wiki/authored/alpha/roadmap.md')));
  const before = new Date().toISOString().slice(0, 10);
  refreshCatalogs(root, { project: 'alpha', apply: true, now: undefined });
  const after = new Date().toISOString().slice(0, 10);
  const day = readFileSync(join(root, 'wiki/authored/alpha/roadmap.md'), 'utf8').match(/^created: (\S+)$/m)[1];
  assert.ok(day === before || day === after, day);
});

test('an invalid now fails before any catalog is written', t => {
  const root = fixture(t);
  assert.throws(() => refreshCatalogs(root, { project: 'alpha', apply: true, now: 'today' }), /now must be a valid Date/);
  assert.ok(!existsSync(join(root, 'wiki/authored/alpha/roadmap.md')));
  assert.ok(!existsSync(join(root, 'moc')));
  assert.ok(!existsSync(join(root, 'index.md')));
});

// ---------------------------------------- catalogs another project left stale --
// A page whose file name another project already uses turns that project's generated bare link
// into an ambiguous one, and a refresh scoped to the new page's project does not touch the other
// project's catalog. The refresh cannot know which other catalogs to regenerate, so it names them.
function twoProjects(t) {
  const root = mkdtempSync(join(tmpdir(), 'wm-stale-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (project, rel, kind, extra = '') => {
    const file = join(root, 'wiki/authored', project, rel);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, `---\ntype: authored\nproject: ${project}\nkind: ${kind}\n${extra}sources: []\n---\n# ${rel}\n`);
  };
  put('one', 'overview.md', 'overview');
  put('one', 'reference/runbook.md', 'reference');
  put('one', 'backlog/task.md', 'backlog-item', 'backlog-status: planned\n');
  refreshCatalogs(root, { apply: true });
  put('two', 'overview.md', 'overview');
  put('two', 'reference/runbook.md', 'reference');
  put('two', 'backlog/task.md', 'backlog-item', 'backlog-status: planned\n');
  return root;
}

test('a scoped refresh names the other project catalogs whose bare link a new page made ambiguous', t => {
  const root = twoProjects(t);
  assert.match(readFileSync(join(root, 'moc/one.md'), 'utf8'), /\[\[runbook\]\]/, 'bare while the name was unique');
  const r = refreshCatalogs(root, { project: 'two', apply: true });
  assert.deepEqual(r.staleCatalogs, [
    { path: 'moc/one.md', names: ['overview', 'roadmap', 'runbook'] },
    { path: 'wiki/authored/one/roadmap.md', names: ['task'] },
  ]);
  assert.ok(!r.changed.includes('moc/one.md'), 'it reports; it does not edit another project');
});

test('refreshing the named project clears the report', t => {
  const root = twoProjects(t);
  refreshCatalogs(root, { project: 'two', apply: true });
  const fixed = refreshCatalogs(root, { project: 'one', apply: true });
  assert.equal(fixed.staleCatalogs, undefined);
  assert.match(readFileSync(join(root, 'moc/one.md'), 'utf8'), /wiki\/authored\/one\/reference\/runbook\|runbook/);
  assert.equal(refreshCatalogs(root, { project: 'two', apply: true }).staleCatalogs, undefined);
});

test('an unscoped refresh regenerates everything, so nothing is stale; a dry run still reports', t => {
  const root = twoProjects(t);
  const dry = refreshCatalogs(root, { project: 'two' });
  assert.deepEqual(dry.staleCatalogs.map(x => x.path), ['moc/one.md', 'wiki/authored/one/roadmap.md']);
  assert.equal(refreshCatalogs(root, { apply: true }).staleCatalogs, undefined);
});

test('the selected project own catalogs are never reported, and a hand-written link is not a catalog', t => {
  const root = twoProjects(t);
  writeFileSync(join(root, 'wiki/authored/one/notes.md'), '---\ntype: authored\nproject: one\nkind: note\nsources: []\n---\nSee [[runbook]].\n');
  const r = refreshCatalogs(root, { project: 'one', apply: true });
  assert.equal(r.staleCatalogs, undefined);
});

test('a dry run does not report the selected project own catalogs, which the same run would regenerate', t => {
  const root = twoProjects(t);
  const dry = refreshCatalogs(root, { project: 'one' });
  assert.equal(dry.staleCatalogs, undefined);
});
