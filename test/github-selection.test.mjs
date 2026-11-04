import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync, mkdirSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { captureSelection, selectionOptions, validSelectedPath, githubObjectReader, publishImmutable } from '../scripts/lib/github-selection.mjs';
import { writeDigest, main } from '../scripts/clip-gh.mjs';
import { recordWritten, readWritten } from '../scripts/lib/op-ledger.mjs';
import { recordDecline, loadDeclines } from '../scripts/lib/decline.mjs';
const sha = x=>createHash('sha1').update(x).digest('hex'), COMMIT='1'.repeat(40);
function fixture(t, sources = {'README.md':'# Fixture\n','LICENSE':'license text\n','NOTICE':'notice text\n','package.json':'{}\n','package-lock.json':'{"lockfileVersion":3}\n','vite.config.js':'export default {};\n','test/component.test.js':'test();\n'}) {
  const vaultPath=mkdtempSync(join(tmpdir(),'wiki-gh-select-')); t.after(()=>rmSync(vaultPath,{recursive:true,force:true}));
  const objects=new Map(), root={}, calls=[];
  for(const [path,value] of Object.entries(sources)) {
    let dir=root;const parts=path.split('/');for(const p of parts.slice(0,-1))dir=dir[p]??={};
    const buffer=Buffer.isBuffer(value)?value:Buffer.from(value),id=createHash('sha1').update(`blob ${buffer.length}\0`).update(buffer).digest('hex');
    objects.set(`git/blobs/${id}`,{sha:id,size:buffer.length,encoding:'base64',content:buffer.toString('base64')});
    dir[parts.at(-1)]={type:'blob',mode:'100644',sha:id,size:buffer.length};
  }
  function tree(dir){const entries=Object.entries(dir).map(([path,e])=> e.type?{path,...e}:{path,type:'tree',mode:'040000',sha:tree(e)});const id=sha(JSON.stringify(entries));objects.set(`git/trees/${id}`,{sha:id,truncated:false,tree:entries});return id;}
  const treeId=tree(root);
  function read(route){calls.push(route);if(route.startsWith('commits/'))return {sha:COMMIT,tree:treeId};assert.ok(objects.has(route),route);return structuredClone(objects.get(route));}
  const options={owner:'owner',repo:'repo',vaultPath,selection:{paths:['package.json','package-lock.json','vite.config.js','test/component.test.js'],readmeOnly:false,ref:'feature/review'},read,topic:'review topic'};
  return {vaultPath,objects,treeId,calls,read,options};
}
const files = dir=>readdirSync(dir).sort();
const snapshot=dir=>Object.fromEntries(files(dir).map(n=>[n,readFileSync(join(dir,n),'utf8')]));

test('options are opt-in, bounded, exact, and mutually exclusive before side effects',()=>{
  assert.equal(selectionOptions(['o/r']),null);
  assert.deepEqual(selectionOptions(['o/r','--path=b','--path=a','--ref=tag']),{paths:['a','b'],ref:'tag',readmeOnly:false});
  for(const args of [['--path='],['--path=a','--path=a'],['--path=a','--readme-only'],['--readme-only','--force-full'],['--readme-only','--max-files=1'],['--path=a','extra'],['--readme-only','--decline=no'],['--path=a','--ref='],['--path=a','--quality=oops'],Array.from({length:33},(_,i)=>`--path=f${i}`)])assert.throws(()=>selectionOptions(['o/r',...args]));
  for(const p of ['../x','a/../x','/x','C:/x','a\\x','a//b','./a','a\0b','a\nb','a/'.repeat(17)+'b'])assert.equal(validSelectedPath(p),false,p);
  assert.equal(validSelectedPath('src/a #?%.js'),true);
});
test('CLI rejects unknown/unsafe/conflicting selection before choosing a vault or fetching',t=>{
  const f=fixture(t);
  for(const args of [['--path=../x'],['--path=x','--oops'],['--readme-only','--max-files=1']]){
    const r=spawnSync(process.execPath,['scripts/clip-gh.mjs','o/r',...args],{encoding:'utf8',env:{...process.env,WIKI_MASTER_VAULT:f.vaultPath,WIKI_MASTER_REQUIRE_VAULT:'1'}});
    assert.equal(r.status,2,r.stderr);assert.deepEqual(files(f.vaultPath),[]);
  }
});
test('captures manifests/config/test bodies plus root notices without fetching excluded fixtures',t=>{
  const f=fixture(t);const root=f.objects.get(`git/trees/${f.treeId}`);root.tree.push({path:'fixtures',type:'tree',mode:'040000',sha:'9'.repeat(40)});
  const recorded=[],r=captureSelection({...f.options,record:p=>recorded.push(p)});
  assert.equal(r.status,'clipped');assert.equal(r.requested,4);assert.equal(r.selected,6);assert.equal(r.clipped,6);assert.equal(recorded.length,7);
  assert.ok(!f.calls.some(c=>c.includes('9'.repeat(40))));assert.equal(f.calls.filter(c=>c.startsWith('commits/')).length,1);
  const manifest=readFileSync(join(r.outDir,r.manifest),'utf8'),data=JSON.parse(/```json\n([\s\S]*)\n```/.exec(manifest)[1]);assert.equal(data.schema,'wiki-master/github-selection@1');assert.equal(data.selected,6);assert.equal(data.files.length,6);assert.equal(data.bytes,r.entries.reduce((n,e)=>n+e.bytes,0));
  for(const e of r.entries){assert.equal(e.status,'clipped');const clip=Object.values(snapshot(r.outDir)).find(s=>s.includes(`source: "https://github.com/owner/repo/blob/${COMMIT}/${e.path}"`));assert.ok(clip,e.path);assert.match(clip,/topic: "review topic"/);assert.ok(clip.includes(`github-blob: "${e.blob}"`));assert.ok(clip.includes(`supplied-sha256: ${e.sha256}`));assert.ok(clip.includes(`/blob/${COMMIT}/`));}
  const before=snapshot(r.outDir),again=captureSelection(f.options);assert.equal(again.clipped,0);assert.equal(again.unchanged,6);assert.equal(again.manifestWritten,false);assert.deepEqual(snapshot(r.outDir),before);
});
test('README is a deterministic preset of the same route, including bounded root notices',t=>{
  const f=fixture(t,{'README.txt':'plain','README.md':'# preferred','LICENSE':'legal','other.js':'no'});
  const r=captureSelection({...f.options,selection:{paths:[],readmeOnly:true,ref:COMMIT}});
  assert.equal(r.status,'clipped');assert.equal(r.selected,2);assert.deepEqual(r.entries.map(e=>e.path),['LICENSE','README.md']);assert.equal(f.calls[0],`commits/${COMMIT}`);
});
test('missing README refuses without clipping only the notices',t=>{
  const f=fixture(t,{'LICENSE':'legal'}),r=captureSelection({...f.options,selection:{paths:[],readmeOnly:true,ref:'HEAD'}});
  assert.equal(r.refused,1);assert.deepEqual(files(f.vaultPath),[]);
});
test('unsafe direct calls refuse before the reader is called',t=>{
  const f=fixture(t);const r=captureSelection({...f.options,selection:{paths:['../escape'],ref:'HEAD'}});assert.equal(r.status,'failed');assert.deepEqual(f.calls,[]);assert.deepEqual(files(f.vaultPath),[]);
});
test('missing file refuses entire selection before any raw write, retaining per-path diagnostics',t=>{
  const f=fixture(t);f.options.selection.paths.push('absent.js');const r=captureSelection(f.options);assert.equal(r.status,'failed');assert.equal(r.clipped,0);assert.equal(r.refused,1);assert.equal(r.entries.find(e=>e.path==='package.json').status,'selected');assert.deepEqual(files(f.vaultPath),[]);
});
for(const [label,value] of [['binary',Buffer.from([0,1])],['invalid UTF8',Buffer.from([0xc0,0xaf])],['oversize','x'.repeat(256*1024+1)]])test(`${label} is refused with no writes`,t=>{
  const f=fixture(t,{'target':value}),r=captureSelection({...f.options,selection:{paths:['target'],ref:'HEAD'}});assert.equal(r.refused,1);assert.equal(r.clipped,0);assert.deepEqual(files(f.vaultPath),[]);
});
for(const [type,mode] of [['blob','120000'],['commit','160000'],['tree','040000']])test(`${mode} target never follows symlinks/submodules/directories`,t=>{
  const f=fixture(t,{'target':'content'});const entry=f.objects.get(`git/trees/${f.treeId}`).tree[0];Object.assign(entry,{type,mode});
  const r=captureSelection({...f.options,selection:{paths:['target'],ref:'HEAD'}});assert.equal(r.refused,1);assert.ok(!f.calls.some(c=>c.startsWith('git/blobs')));
});
test('symlink ancestor is refused without following its blob',t=>{
  const f=fixture(t,{'target':'content'});f.objects.get(`git/trees/${f.treeId}`).tree[0].mode='120000';const r=captureSelection({...f.options,selection:{paths:['target/child'],ref:'HEAD'}});assert.equal(r.refused,1);
});
for(const corruption of ['truncated','duplicate','identity','blob-hash','base64','size','commit'])test(`rejects ${corruption} response rather than inventing provenance`,t=>{
  const f=fixture(t,{'target':'content'});const root=f.objects.get(`git/trees/${f.treeId}`),blob=f.objects.get(`git/blobs/${root.tree[0].sha}`);
  if(corruption==='truncated')root.truncated=true;if(corruption==='duplicate')root.tree.push({...root.tree[0]});if(corruption==='identity')root.sha='2'.repeat(40);
  if(corruption==='blob-hash')blob.content=Buffer.from('CONTENT').toString('base64');if(corruption==='base64')blob.content+='!';if(corruption==='size')blob.size++;
  const r=captureSelection({...f.options,selection:{paths:['target'],ref:corruption==='commit'?'2'.repeat(40):'HEAD'}});assert.equal(r.status,'failed');assert.deepEqual(files(f.vaultPath),[]);
});
test('root legal overflow refuses instead of silently dropping notices',t=>{
  const f=fixture(t,Object.fromEntries([['README.md','readme'],...Array.from({length:9},(_,i)=>[`LICENSE.${i}`,'license'])]));const r=captureSelection({...f.options,selection:{paths:[],readmeOnly:true,ref:'HEAD'}});assert.equal(r.status,'failed');assert.match(r.error,/8 root legal/);assert.deepEqual(files(f.vaultPath),[]);
});
test('raw CRLF/BOM identity differs from rendered hash; special URLs and backticks stay faithful',t=>{
  const path='src/a #?%.js',data=Buffer.from('\ufeffconst x = ` ``` `;\r\n');const f=fixture(t,{[path]:data});
  const r=captureSelection({...f.options,selection:{paths:[path],ref:'moving/branch'}});assert.equal(r.status,'clipped');const clip=Object.values(snapshot(r.outDir)).find(s=>s.includes('github-blob:'));
  assert.ok(clip.includes('/src/a%20%23%3F%25.js'));assert.ok(clip.includes('\n````\n'));assert.ok(clip.includes(`supplied-sha256: ${createHash('sha256').update(data).digest('hex')}`));
});
test('different topics/commits preserve prior immutable captures and exact identity',t=>{
  const f=fixture(t),a=captureSelection(f.options),before=snapshot(a.outDir);const b=captureSelection({...f.options,topic:'another topic'});assert.equal(b.clipped,6);
  for(const [n,body]of Object.entries(before))assert.equal(readFileSync(join(a.outDir,n),'utf8'),body);
  const c=captureSelection({...f.options,read:route=>route.startsWith('commits/')?{sha:'2'.repeat(40),tree:f.treeId}:f.read(route)});assert.equal(c.clipped,6);
});
test('modified immutable destination is refused without overwriting any prior evidence',t=>{
  const f=fixture(t),r=captureSelection(f.options);const name=files(r.outDir).find(n=>!n.startsWith('_selection'));writeFileSync(join(r.outDir,name),'owner edit');const before=snapshot(r.outDir);
  const again=captureSelection(f.options);assert.equal(again.status,'failed');assert.equal(again.clipped,0);assert.deepEqual(snapshot(r.outDir),before);
});
test('partial publication retains honest counts and no completion manifest',t=>{
  const f=fixture(t);let records=0;const r=captureSelection({...f.options,record(){if(++records===2)throw Error('simulated interruption');}});assert.equal(r.status,'failed');assert.equal(r.partial,true);assert.equal(r.clipped,1);assert.ok(!files(r.outDir).some(n=>n.startsWith('_selection')));
  const retry=captureSelection(f.options);assert.equal(retry.status,'clipped');assert.equal(retry.unchanged,1);assert.equal(retry.clipped,5);
});
test('manifest ledger failure precedes creation; same-operation retry retains exact ownership',t=>{
  const f=fixture(t),token='1234567890abcdef',ops=join(f.vaultPath,'.wiki-master','ops');mkdirSync(ops,{recursive:true});writeFileSync(join(ops,token+'.json'),'{}');
  const reserve=path=>recordWritten(f.vaultPath,token,[path]);
  const r=captureSelection({...f.options,record:path=>{if(path.includes('_selection-'))throw Error('manifest ledger unavailable');reserve(path);}});
  assert.equal(r.status,'failed');assert.equal(r.clipped,6);assert.equal(r.manifestWritten,false);assert.equal(r.partial,true);assert.equal(readWritten(f.vaultPath,token).length,6);assert.equal(files(r.outDir).length,6);
  const again=captureSelection({...f.options,record:reserve});assert.equal(again.status,'clipped');assert.equal(again.unchanged,6);assert.equal(again.manifestWritten,true);assert.equal(readWritten(f.vaultPath,token).length,7);
});

test('a symlinked vault root preserves caller-relative ledger ownership',t=>{
  const f=fixture(t),alias=f.vaultPath+'-alias',token='abcdef1234567890';
  symlinkSync(f.vaultPath,alias,process.platform==='win32'?'junction':'dir');
  t.after(()=>rmSync(alias,{recursive:true,force:true}));
  const ops=join(alias,'.wiki-master','ops');mkdirSync(ops,{recursive:true});writeFileSync(join(ops,token+'.json'),'{}');
  const r=captureSelection({...f.options,vaultPath:alias,record:path=>recordWritten(alias,token,[path])});
  assert.equal(r.status,'clipped',r.error);assert.equal(r.clipped,6);assert.equal(readWritten(alias,token).length,7);
  assert.equal(r.outDir,join(alias,'raw','clippings','gh-selected','owner','repo'));
});
test('strict ledger refusal creates no raw files and does not adopt unchanged evidence',t=>{
  const f=fixture(t),r=captureSelection({...f.options,record(){throw Error('closed operation');}});assert.equal(r.clipped,0);assert.equal(r.failed,1);assert.deepEqual(files(r.outDir),[]);
  const a=captureSelection(f.options);let records=0;const again=captureSelection({...f.options,record(){records++;}});assert.equal(again.unchanged,6);assert.equal(records,0);assert.equal(again.manifestWritten,false);
});
test('concurrent conflicting file after reservation is preserved, never overwritten',t=>{
  const f=fixture(t);let target;const r=captureSelection({...f.options,record:path=>{target=path;writeFileSync(path,'concurrent owner content',{flag:'wx'});}});
  assert.equal(r.status,'failed');assert.equal(r.clipped,0);assert.equal(r.failed,1);assert.equal(readFileSync(target,'utf8'),'concurrent owner content');
});
test('legacy digest pruning cannot reach selective capture namespace',t=>{
  const f=fixture(t),r=captureSelection(f.options),before=snapshot(r.outDir),outDir=join(f.vaultPath,'raw','clippings','gh','owner','repo'),tmp=join(f.vaultPath,'clone');mkdirSync(outDir,{recursive:true});mkdirSync(tmp);writeFileSync(join(outDir,'old.md'),'stale legacy digest');
  writeDigest({owner:'owner',repo:'repo',resolvedRef:COMMIT,included:[],excluded:[],meta:{},quality:'medium',outDir,tmp});assert.deepEqual(snapshot(r.outDir),before);assert.equal(existsSync(join(outDir,'old.md')),false);
});
test('symlinked output parents are refused without modifying their target',t=>{
  const f=fixture(t),outside=mkdtempSync(join(tmpdir(),'wiki-gh-outside-'));t.after(()=>rmSync(outside,{recursive:true,force:true}));
  try{symlinkSync(outside,join(f.vaultPath,'raw'),process.platform==='win32'?'junction':'dir');}catch(e){if(e.code==='EPERM'){t.skip('host cannot create links');return;}throw e;}
  const r=captureSelection(f.options);assert.equal(r.status,'failed');assert.deepEqual(files(outside),[]);
});
test('authenticated reader fixes host, shell-free arguments, timeout, buffer and request budgets',()=>{
  let count=0,time=0;
  const read=githubObjectReader('owner','repo',{now:()=>time,run(command,args,options){count++;assert.equal(command,'gh');assert.deepEqual(args.slice(0,6),['api','--hostname','github.com','--method','GET','repos/owner/repo/git/trees/id']);assert.equal(options.shell,undefined);assert.ok(options.timeout>0&&options.timeout<=30000);assert.equal(options.maxBuffer,2*1024*1024);return '{}';}});
  for(let i=0;i<128;i++)read('git/trees/id');assert.throws(()=>read('git/trees/id'),/budget/);assert.equal(count,128);
  const expired=githubObjectReader('o','r',{now:()=>time,run(){throw Error('must not execute');}});time=90000;assert.throws(()=>expired('git/trees/id'),/budget/);
});
test('aggregate byte cap refuses all publication, including otherwise valid files',t=>{
  const sources=Object.fromEntries(Array.from({length:32},(_,i)=>[`f${i}`,Buffer.alloc(256*1024,65)]));sources.LICENSE='license';const f=fixture(t,sources);
  const r=captureSelection({...f.options,selection:{paths:Object.keys(sources).filter(p=>p!=='LICENSE'),ref:'HEAD'}});assert.equal(r.status,'failed');assert.equal(r.refused,1);assert.deepEqual(files(f.vaultPath),[]);
});
test('network failure is a failed file distinct from refusal; no partial preflight writes',t=>{
  const f=fixture(t);const r=captureSelection({...f.options,read:route=>{if(route.startsWith('git/blobs/'))throw Error('fixture network failure');return f.read(route);}});
  assert.equal(r.status,'failed');assert.equal(r.failed,6);assert.equal(r.refused,0);assert.equal(r.clipped,0);assert.deepEqual(files(f.vaultPath),[]);
});
test('main preserves declines on failure and finishes only a complete authorized capture with an exact ledger',t=>{
  const f=fixture(t),previous=process.env.WIKI_MASTER_VAULT,exit=process.exitCode;process.env.WIKI_MASTER_VAULT=f.vaultPath;
  t.after(()=>{if(previous===undefined)delete process.env.WIKI_MASTER_VAULT;else process.env.WIKI_MASTER_VAULT=previous;process.exitCode=exit;});
  t.mock.method(console,'log',()=>{});
  recordDecline(f.vaultPath,'github.com/owner/repo','thin content');
  const opts={readSelected:f.read};assert.equal(main(['owner/repo','--path=package.json'],opts).status,'declined');assert.deepEqual(f.calls,[]);
  assert.equal(main(['owner/repo','--path=missing','--override-decline'],opts).status,'failed');assert.equal(loadDeclines(f.vaultPath).length,1);
  const token='abcdef1234567890',ops=join(f.vaultPath,'.wiki-master','ops');mkdirSync(ops,{recursive:true});writeFileSync(join(ops,token+'.json'),'{}');
  const r=main(['owner/repo','--path=package.json','--override-decline','--since='+token],opts);assert.equal(r.status,'clipped');assert.equal(loadDeclines(f.vaultPath).length,0);assert.equal(readWritten(f.vaultPath,token).length,r.clipped+1);
});
test('missing explicit-vault enforcement refuses before remote capture',t=>{
  const f=fixture(t),env={...process.env,WIKI_MASTER_REQUIRE_VAULT:'1'};delete env.WIKI_MASTER_VAULT;
  const r=spawnSync(process.execPath,['scripts/clip-gh.mjs','owner/repo','--path=package.json'],{encoding:'utf8',env});assert.equal(r.status,2);assert.match(r.stderr,/no vault is chosen/);assert.deepEqual(files(f.vaultPath),[]);
});
test('failure after exclusive staged-file creation never exposes incomplete immutable bytes',t=>{
  const f=fixture(t),r=captureSelection({...f.options,publish:(path,body)=>publishImmutable(path,body,{write(fd){writeFileSync(fd,'partial');throw Object.assign(Error('disk full after partial write'),{code:'ENOSPC'});}})});
  assert.equal(r.status,'failed');assert.equal(r.clipped,0);assert.equal(r.partial,false);assert.equal(r.failed,1);assert.deepEqual(files(r.outDir),[]);
  const retry=captureSelection(f.options);assert.equal(retry.status,'clipped');assert.equal(retry.clipped,6);
});
test('publication failure after complete staging leaves no destination and no hidden stage',t=>{
  const f=fixture(t),r=captureSelection({...f.options,publish:(path,body)=>publishImmutable(path,body,{link(){throw Object.assign(Error('hard links unavailable'),{code:'ENOTSUP'});}})});
  assert.equal(r.status,'failed');assert.equal(r.clipped,0);assert.deepEqual(files(r.outDir),[]);
});
