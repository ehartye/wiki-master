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
 regenerateBacklogRoadmaps(a,{apply:true});regenerateAuthoredMocs(a,{apply:true});regenerateIndex(a);
 refreshCatalogs(b,{apply:true});
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
 execFileSync('git',['init','-q'],{cwd:root});execFileSync('git',['add','.'],{cwd:root});
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
