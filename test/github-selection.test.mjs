import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync, mkdirSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { captureSelection, selectionOptions, validSelectedPath, githubObjectReader, publishImmutable } from '../scripts/lib/github-selection.mjs';
import { writeDigest, main } from '../scripts/clip-gh.mjs';
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
test('a selection refuses --since in both spellings, before choosing a vault or fetching',t=>{
  const f=fixture(t);
  for(const args of [['--since','aaaaaaaaaaaaaaaa'],['--since=aaaaaaaaaaaaaaaa']]){
    const r=spawnSync(process.execPath,['scripts/clip-gh.mjs','o/r','--path=x',...args],{encoding:'utf8',env:{...process.env,WIKI_MASTER_VAULT:f.vaultPath,WIKI_MASTER_REQUIRE_VAULT:'1'}});
    assert.equal(r.status,2,r.stderr);assert.match(r.stderr,/unknown option --since/);assert.deepEqual(files(f.vaultPath),[]);
  }
  t.mock.method(console,'error',()=>{});
  const exit=process.exitCode;t.after(()=>{process.exitCode=exit;});
  assert.equal(main(['owner/repo','--path=package.json','--since=aaaaaaaaaaaaaaaa'],{readSelected:f.read}).status,'failed');
  assert.equal(main(['owner/repo','--path=package.json','--since','aaaaaaaaaaaaaaaa'],{readSelected:f.read}).status,'failed');
  assert.deepEqual(f.calls,[]);assert.deepEqual(files(f.vaultPath),[]);
});
test('captures manifests/config/test bodies plus root notices without fetching excluded fixtures',t=>{
  const f=fixture(t);const root=f.objects.get(`git/trees/${f.treeId}`);root.tree.push({path:'fixtures',type:'tree',mode:'040000',sha:'9'.repeat(40)});
  const r=captureSelection(f.options);
  assert.equal(r.status,'clipped');assert.equal(r.requested,4);assert.equal(r.selected,6);assert.equal(r.clipped,6);assert.equal(files(r.outDir).length,7);
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
for(const [label,value] of [['binary',Buffer.from([0,1])],['invalid UTF8',Buffer.from([0xc0,0xaf])]])test(`${label} is refused with no writes`,t=>{
  const f=fixture(t,{'target':value}),r=captureSelection({...f.options,selection:{paths:['target'],ref:'HEAD'}});assert.equal(r.refused,1);assert.equal(r.clipped,0);assert.deepEqual(files(f.vaultPath),[]);
});

// ---- the per-file cap: --max-file-size, skip-and-report ----

const KB = n => 'x'.repeat(n * 1000);
test('--max-file-size is parsed, bounded and kept out of the pinned selection shape when absent',()=>{
  assert.deepEqual(selectionOptions(['o/r','--path=a']),{paths:['a'],ref:'HEAD',readmeOnly:false});
  assert.equal(selectionOptions(['o/r','--path=a','--max-file-size=512K']).maxFileSize,512*1024);
  assert.equal(selectionOptions(['o/r','--path=a','--max-file-size=1M']).maxFileSize,1024*1024);
  assert.equal(selectionOptions(['o/r','--path=a','--max-file-size=300000']).maxFileSize,300000);
  for(const v of ['0','2M','1048577','1.5M','big',''])assert.throws(()=>selectionOptions(['o/r','--path=a',`--max-file-size=${v}`]),/max-file-size/,v);
  assert.throws(()=>selectionOptions(['o/r','--path=a','--max-file-size=512K','--max-file-size=1M']),/one --max-file-size/);
});
test('the oversized files of a selection are skipped and named, and the rest are captured',t=>{
  const f=fixture(t,{'docs/spec.md':KB(363),'docs/guide.md':KB(268),'src/core.js':KB(491),'src/small.js':'export {};\n',LICENSE:'license text\n'});
  const selection={paths:['docs/guide.md','docs/spec.md','src/core.js','src/small.js'],readmeOnly:false,ref:'HEAD'};
  const r=captureSelection({...f.options,selection});
  assert.equal(r.status,'partial');assert.equal(r.skipped,3);assert.equal(r.clipped,2,'the small file and the notice');
  const skipped=r.entries.filter(e=>e.status==='skipped');
  assert.deepEqual(skipped.map(e=>e.path),['docs/guide.md','docs/spec.md','src/core.js']);
  assert.match(skipped.find(e=>e.path==='src/core.js').reason,/^491000 bytes is over the 256K per-file cap; rerun with --max-file-size=480K \(ceiling 1024K\)$/);
  const data=JSON.parse(/```json\n([\s\S]*)\n```/.exec(readFileSync(join(r.outDir,r.manifest),'utf8'))[1]);
  assert.deepEqual(data.skipped.map(s=>s.path),skipped.map(e=>e.path),'the manifest says what was not captured');
  assert.ok(!data.files.some(x=>skipped.some(e=>e.path===x.path)));
  // The same selection with the cap raised takes the three; what was already written is unchanged, and the cap
  // never enters a clipping, so another cap later reports every file unchanged.
  const raised=captureSelection({...f.options,selection:{...selection,maxFileSize:512*1024}});
  assert.equal(raised.status,'clipped');assert.equal(raised.skipped,0);assert.equal(raised.clipped,3);assert.equal(raised.unchanged,2);
  const again=captureSelection({...f.options,selection:{...selection,maxFileSize:1024*1024}});
  assert.equal(again.status,'clipped');assert.equal(again.clipped,0);assert.equal(again.unchanged,5);
});
test('a selection whose every requested file is over the cap writes nothing',t=>{
  const f=fixture(t,{'target':'x'.repeat(256*1024+1)}),r=captureSelection({...f.options,selection:{paths:['target'],ref:'HEAD'}});
  assert.equal(r.status,'failed');assert.equal(r.skipped,1);assert.equal(r.refused,0);assert.match(r.error,/Every requested file is over the per-file cap/);assert.deepEqual(files(f.vaultPath),[]);
});
test('an oversized root notice still refuses the whole selection',t=>{
  const f=fixture(t,{'a.js':'export {};\n',LICENSE:'x'.repeat(256*1024+1)});
  const r=captureSelection({...f.options,selection:{paths:['a.js'],ref:'HEAD'}});
  assert.equal(r.status,'failed');assert.equal(r.refused,1);assert.equal(r.entries.find(e=>e.path==='LICENSE').status,'refused');assert.deepEqual(files(f.vaultPath),[]);
});
test('a file at the 1 MiB ceiling is captured and a rerun finds it unchanged, within the reader buffer',t=>{
  const f=fixture(t,{'big.txt':'y'.repeat(1024*1024)});
  const selection={paths:['big.txt'],ref:'HEAD',maxFileSize:1024*1024};
  assert.equal(captureSelection({...f.options,selection}).clipped,1);
  const again=captureSelection({...f.options,selection});assert.equal(again.status,'clipped');assert.equal(again.unchanged,1);
  // What gh returns for it, base64 in a JSON object, must fit the reader's 2 MiB maxBuffer.
  assert.ok(JSON.stringify(f.objects.get(`git/blobs/${again.entries[0].blob}`)).length<2*1024*1024);
});
test('main: a partial capture exits 1, keeps the decline, and the rerun with the flag finishes it',t=>{
  const f=fixture(t,{'docs/spec.md':KB(363),'src/small.js':'export {};\n'}),previous=process.env.WIKI_MASTER_VAULT,exit=process.exitCode;process.env.WIKI_MASTER_VAULT=f.vaultPath;
  t.after(()=>{if(previous===undefined)delete process.env.WIKI_MASTER_VAULT;else process.env.WIKI_MASTER_VAULT=previous;process.exitCode=exit;});
  t.mock.method(console,'log',()=>{});const errors=[];t.mock.method(console,'error',m=>errors.push(m));
  recordDecline(f.vaultPath,'github.com/owner/repo','thin content');
  const opts={readSelected:f.read},args=['owner/repo','--path=docs/spec.md','--path=src/small.js','--override-decline'];
  process.exitCode=0;
  assert.equal(main(args,opts).status,'partial');assert.equal(process.exitCode,1);assert.equal(loadDeclines(f.vaultPath).length,1,'the decline stays');
  assert.ok(errors.some(m=>/^skipped docs\/spec\.md: 363000 bytes .* --max-file-size=355K/.test(m)),errors.join('\n'));
  process.exitCode=0;
  const done=main([...args,'--max-file-size=512K'],opts);assert.equal(done.status,'clipped');assert.equal(done.unchanged,1);assert.equal(loadDeclines(f.vaultPath).length,0);
});
test('CLI refuses an unbounded or malformed --max-file-size before choosing a vault or fetching',t=>{
  const f=fixture(t);
  for(const args of [['--path=a','--max-file-size=2M'],['--max-file-size=lots'],['--path=a','--max-file-size=1K','--max-file-size=2K']]){
    const r=spawnSync(process.execPath,['scripts/clip-gh.mjs','o/r',...args],{encoding:'utf8',env:{...process.env,WIKI_MASTER_VAULT:f.vaultPath,WIKI_MASTER_REQUIRE_VAULT:'1'}});
    assert.equal(r.status,2,`${args.join(' ')}: ${r.stderr}`);assert.match(r.stderr,/max-file-size/);assert.deepEqual(files(f.vaultPath),[]);
  }
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
  const f=fixture(t);let writes=0;const r=captureSelection({...f.options,publish(path,body){if(++writes===2)throw Error('simulated interruption');return publishImmutable(path,body);}});assert.equal(r.status,'failed');assert.equal(r.partial,true);assert.equal(r.clipped,1);assert.ok(!files(r.outDir).some(n=>n.startsWith('_selection')));
  const retry=captureSelection(f.options);assert.equal(retry.status,'clipped');assert.equal(retry.unchanged,1);assert.equal(retry.clipped,5);
});
test('a failed manifest write leaves no manifest and honest counts, and a retry completes it',t=>{
  const f=fixture(t);
  const r=captureSelection({...f.options,publish(path,body){if(path.includes('_selection-'))throw Error('manifest write failed');return publishImmutable(path,body);}});
  assert.equal(r.status,'failed');assert.equal(r.clipped,6);assert.equal(r.manifestWritten,false);assert.equal(r.partial,true);assert.equal(files(r.outDir).length,6);
  const again=captureSelection(f.options);assert.equal(again.status,'clipped');assert.equal(again.unchanged,6);assert.equal(again.manifestWritten,true);assert.equal(files(again.outDir).length,7);
});

test('a symlinked vault root keeps the spelling the caller gave in the output path',t=>{
  const f=fixture(t),alias=f.vaultPath+'-alias';
  symlinkSync(f.vaultPath,alias,process.platform==='win32'?'junction':'dir');
  t.after(()=>rmSync(alias,{recursive:true,force:true}));
  const r=captureSelection({...f.options,vaultPath:alias});
  assert.equal(r.status,'clipped',r.error);assert.equal(r.clipped,6);assert.equal(files(r.outDir).length,7);
  assert.equal(r.outDir,join(alias,'raw','clippings','gh-selected','owner','repo'));
});
test('concurrent conflicting file before publication is preserved, never overwritten',t=>{
  const f=fixture(t);let target;const r=captureSelection({...f.options,publish(path,body){target=path;writeFileSync(path,'concurrent owner content',{flag:'wx'});return publishImmutable(path,body);}});
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
test('main preserves declines on failure and finishes only a complete authorized capture',t=>{
  const f=fixture(t),previous=process.env.WIKI_MASTER_VAULT,exit=process.exitCode;process.env.WIKI_MASTER_VAULT=f.vaultPath;
  t.after(()=>{if(previous===undefined)delete process.env.WIKI_MASTER_VAULT;else process.env.WIKI_MASTER_VAULT=previous;process.exitCode=exit;});
  t.mock.method(console,'log',()=>{});
  recordDecline(f.vaultPath,'github.com/owner/repo','thin content');
  const opts={readSelected:f.read};assert.equal(main(['owner/repo','--path=package.json'],opts).status,'declined');assert.deepEqual(f.calls,[]);
  assert.equal(main(['owner/repo','--path=missing','--override-decline'],opts).status,'failed');assert.equal(loadDeclines(f.vaultPath).length,1);
  const r=main(['owner/repo','--path=package.json','--override-decline'],opts);assert.equal(r.status,'clipped');assert.equal(loadDeclines(f.vaultPath).length,0);assert.equal(files(r.outDir).length,r.clipped+1);
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
