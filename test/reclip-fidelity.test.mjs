import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractForReclip, needsReclip, mergeReclip, runReclips } from '../scripts/lib/reclip.mjs';
import { pdfClipContent } from '../scripts/clip-pdf.mjs';
import { recordIssue, loadIssueLog, openIssues, settledKeys, issueKey } from '../scripts/lib/triage.mjs';
import { fidelityFlagged, collectTriage } from '../scripts/triage.mjs';
import { makePdf } from './fixtures/make-pdf.mjs';
import { pdftotextPresent } from '../scripts/lib/pdf-extract.mjs';

const prose = 'This reference provides clear and useful explanations for the reader. '.repeat(20);
const original = (fidelity='tabular', extraction='table-aware') => `---\ntitle: "Example"\nsource: "https://example.org/source.pdf"\nauthor: "Example author"\npublished: 2020-01-01\ncreated: 2025-01-01\ntopic: "Reference review"\ntags: [clippings, reference]\nsource-hash: oldhash\nfidelity: ${fidelity}\nextraction: ${extraction}\nfigures:\n  - "[[raw/figures/example.png]]"\n---\n\n${prose}\n`;

test('clean characters do not resolve layout-derived fidelity or an explicit request', () => {
  assert.equal(needsReclip(original()), true);
  assert.equal(needsReclip(original('degraded','table-flattened')), true);
  const clean = original().replace('fidelity: tabular\n','').replace('extraction: table-aware\n','');
  assert.equal(needsReclip(clean), false);
  assert.equal(needsReclip(clean, { requested: true }), true);
});

test('PDF reclip honors the shared plan, mode arguments, fidelity floor and OCR caution', () => {
  let selected;
  const clip = extractForReclip('example.pdf', {title:'Example',source:'https://example.org'}, {
    mode:'table', plan:(path,{override})=>{assert.equal(override,'table');return {mode:{args:['-table'],extraction:'table-aware',fidelityFloor:'tabular'}};},
    readPdf:(path,args)=>{selected=args;return prose;}, canOcr:()=>false,
  });
  assert.deepEqual(selected,['-table']);
  assert.equal(clip.fidelity,'tabular');
  const ocr = extractForReclip('example.pdf', {title:'Example',source:'https://example.org'}, {
    plan:()=>({mode:{args:[],extraction:undefined}}), readPdf:()=>'', canOcr:()=>true, readOcr:()=>prose,
  });
  assert.equal(ocr.extraction,'ocr');
  assert.equal(ocr.fidelity,'ocr');
  assert.throws(()=>extractForReclip('x.pdf',{}, {plan:()=>({mode:{error:'cannot honor table mode'}})}),/cannot honor/);
});

test('replacement keeps unrelated metadata and removes obsolete layout stamps', () => {
  const clip=pdfClipContent({title:'Example',source:'https://example.org/source.pdf',text:prose,extraction:'reading-order-forced'});
  const merged=mergeReclip(original(),clip);
  for(const expected of ['author: "Example author"','published: 2020-01-01','created: 2025-01-01','topic: "Reference review"','tags: [clippings, reference]','figures:']) assert.ok(merged.includes(expected));
  assert.doesNotMatch(merged,/^fidelity:/m);
  assert.match(merged,/extraction: reading-order-forced/);
  assert.ok(merged.includes(clip.hash));
});

function vault(t) {
  const root=mkdtempSync(join(tmpdir(),'wm-reclip-'));
  for(const dir of ['raw/clippings','wiki/sources'])mkdirSync(join(root,dir),{recursive:true});
  writeFileSync(join(root,'raw/clippings/example.md'),original());
  writeFileSync(join(root,'wiki/sources/example.md'),'---\ntype: source\nsources: ["[[raw/clippings/example.md]]"]\nsource-hashes: [oldhash]\n---\n\nPrior summary.\n');
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  return root;
}

test('dry run is read-only; explicit repair writes planned extraction and updates summary hash', async t => {
  const root=vault(t); const path=join(root,'raw/clippings/example.md'); const before=readFileSync(path,'utf8');
  const clip=pdfClipContent({title:'Example',source:'https://example.org/source.pdf',text:prose+' Updated.',extraction:'reading-order-forced'});
  const deps={obtain:async()=>({path:'source.pdf'}),extract:()=>clip};
  const preview=await runReclips({vaultPath:root,includeTabular:true,...deps});
  assert.equal(preview.selected,1);assert.equal(readFileSync(path,'utf8'),before);
  const result=await runReclips({vaultPath:root,apply:true,includeTabular:true,...deps});
  assert.equal(result.reclipped,1);
  assert.ok(readFileSync(join(root,'wiki/sources/example.md'),'utf8').includes(clip.hash));
  assert.equal(fidelityFlagged(root).length,0);
  assert.ok(settledKeys(loadIssueLog(root)).has(issueKey('https://example.org/source.pdf','fidelity')));
});

test('failed repair can quarantine without changing raw body; restriction is durable and triage stays closed',async t=>{
  const root=vault(t);const path=join(root,'raw/clippings/example.md');const body=readFileSync(path,'utf8').split('---\n')[2];
  recordIssue(root,{url:'https://example.org/source.pdf',kind:'fidelity',reason:'layout suspect'});
  const result=await runReclips({vaultPath:root,apply:true,includeTabular:true,onFailure:'quarantine',obtain:async()=>{throw new Error('source unavailable');}});
  assert.equal(result.quarantined,1);
  assert.equal(readFileSync(path,'utf8').split('---\n')[2],body);
  assert.match(readFileSync(path,'utf8'),/^citation-status: quarantined$/m);
  assert.match(readFileSync(join(root,'wiki/sources/example.md'),'utf8'),/Do not cite/i);
  assert.equal(openIssues(loadIssueLog(root)).length,0);
  assert.equal(fidelityFlagged(root).length,0);
  assert.deepEqual((await runReclips({vaultPath:root,includeTabular:true})).selected,0);
  // Another machine may retain stale local issue history; tracked quarantine still wins.
  recordIssue(root,{url:'https://example.org/source.pdf',kind:'failed',reason:'old retry'});
  const queue=collectTriage(root);
  assert.equal(queue.clipFailures.length,0);assert.equal(queue.fidelity.length,0);assert.equal(queue.backlogTotal,0);
});

test('ownership restrictions prevent quarantine and raw replacement from sweeping other pages',async t=>{
 const root=vault(t);const path=join(root,'raw/clippings/example.md');const before=readFileSync(path,'utf8');
 const result=await runReclips({vaultPath:root,apply:true,includeTabular:true,onFailure:'quarantine',ownedPaths:['raw/clippings/example.md'],obtain:async()=>{throw new Error('unavailable');}});
 assert.equal(result.conflicts.length,1);assert.equal(result.quarantined,0);assert.equal(readFileSync(path,'utf8'),before);
});

test('explicitly unverifiable table can be quarantined after visual review without another extraction',async t=>{
 const root=vault(t);let attempted=false;
 const result=await runReclips({vaultPath:root,apply:true,targets:['raw/clippings/example.md'],quarantineReason:'Row pairing could not be verified',obtain:async()=>{attempted=true;}});
 assert.equal(result.quarantined,1);assert.equal(attempted,false);assert.equal(fidelityFlagged(root).length,0);
});

test('a recovered true table retains tabular fidelity and requires verification',async t=>{
 const root=vault(t);const clip=pdfClipContent({title:'Example',source:'https://example.org/source.pdf',text:prose,fidelityFloor:'tabular',extraction:'table-aware'});
 const result=await runReclips({vaultPath:root,apply:true,includeTabular:true,onFailure:'quarantine',obtain:async()=>({path:'example.pdf'}),extract:()=>clip});
 assert.equal(result.needsReview.length,1);assert.equal(result.quarantined,0);
 assert.match(readFileSync(join(root,'raw/clippings/example.md'),'utf8'),/^fidelity: tabular$/m);
 assert.equal(openIssues(loadIssueLog(root))[0].kind,'fidelity');
});

test('default failure reopens; scope traversal and concurrent raw edits are refused',async t=>{
 const root=vault(t);
 const failed=await runReclips({vaultPath:root,apply:true,includeTabular:true,obtain:async()=>{throw new Error('failed');}});
 assert.equal(failed.failed.length,1);assert.equal(openIssues(loadIssueLog(root)).length,1);
 await assert.rejects(runReclips({vaultPath:root,targets:['../outside.md']}),/scope/);
 const r=await runReclips({vaultPath:root,apply:true,includeTabular:true,onFailure:'quarantine',obtain:async()=>{writeFileSync(join(root,'raw/clippings/example.md'),original()+'Other edit');return {path:'x.pdf'};},extract:()=>pdfClipContent({title:'x',source:'x',text:prose})});
 assert.equal(r.conflicts.length,1);assert.equal(r.quarantined,0);
 assert.ok(readFileSync(join(root,'raw/clippings/example.md'),'utf8').endsWith('Other edit'));
});

test('real PDF repair uses explicit reading-order mode and preserves metadata end to end', {skip:!pdftotextPresent()}, async t=>{
 const root=vault(t);const pdf=join(root,'original.pdf');
 const sentence='A readable reference paragraph describes the example clearly and retains its original source meaning.';
 makePdf([Array.from({length:12},(_,i)=>({x:40,y:740-i*35,text:sentence}))],pdf);
 const result=await runReclips({vaultPath:root,apply:true,targets:['raw/clippings/example.md'],mode:'reading-order',sourceFile:pdf});
 assert.equal(result.reclipped,1);assert.equal(result.failed.length,0);assert.equal(result.usedLocal,1);
 const text=readFileSync(join(root,'raw/clippings/example.md'),'utf8');
 assert.ok(text.includes('A readable reference paragraph'));assert.match(text,/author: "Example author"/);
 assert.doesNotMatch(text,/^fidelity: (?:tabular|degraded)$/m);
});

test('interrupted hash propagation retains the old transition and resumes without re-extraction',async t=>{
 const root=vault(t);const raw=join(root,'raw/clippings/example.md');const summary=join(root,'wiki/sources/example.md');const before=readFileSync(summary,'utf8');
 const clip=pdfClipContent({title:'Example',source:'https://example.org/source.pdf',text:prose+' Changed.'});
 const first=await runReclips({vaultPath:root,apply:true,includeTabular:true,obtain:async()=>({path:'x.pdf'}),extract:()=>clip,write:(path,text)=>{writeFileSync(path,text);if(path===raw)writeFileSync(summary,before+'Concurrent note.\n');}});
 assert.equal(first.conflicts.length,1);
 const retry=await runReclips({vaultPath:root,apply:true,includeTabular:true,obtain:async()=>{throw new Error('must resume saved extraction');}});
 assert.equal(retry.reclipped,1);assert.ok(readFileSync(summary,'utf8').includes(clip.hash));assert.ok(readFileSync(summary,'utf8').includes('Concurrent note.'));
});

test('quarantine supports valid extensionless citations and resumes an interrupted page restriction',async t=>{
 const root=vault(t);const page=join(root,'wiki/sources/example.md');writeFileSync(page,'Prior text cites [[raw/clippings/example|Example]].\n');
 const refused=await runReclips({vaultPath:root,apply:true,targets:['raw/clippings/example.md'],quarantineReason:'Unverified',ownedPaths:['raw/clippings/example.md']});
 assert.equal(refused.conflicts.length,1);assert.doesNotMatch(readFileSync(join(root,'raw/clippings/example.md'),'utf8'),/citation-status/);
 const first=await runReclips({vaultPath:root,apply:true,targets:['raw/clippings/example.md'],quarantineReason:'Unverified',write:()=>{throw new Error('interrupted write');}});
 assert.equal(first.conflicts.length,1);
 const retry=await runReclips({vaultPath:root,apply:true,includeTabular:true});
 assert.equal(retry.quarantined,1);assert.match(readFileSync(page,'utf8'),/Do not cite/);
});

test('clean OCR enters review without losing its fidelity caution',async t=>{
 const root=vault(t);const clip=pdfClipContent({title:'Example',source:'https://example.org/source.pdf',text:prose,fidelityFloor:'ocr',extraction:'ocr'});
 const result=await runReclips({vaultPath:root,apply:true,includeTabular:true,onFailure:'quarantine',obtain:async()=>({path:'x.pdf'}),extract:()=>clip});
 assert.equal(result.quarantined,0);assert.equal(result.needsReview.length,1);
 assert.match(readFileSync(join(root,'raw/clippings/example.md'),'utf8'),/^fidelity: ocr$/m);
});

test('successful repair preserves unrelated attention work',async t=>{
 const root=vault(t);recordIssue(root,{url:'https://example.org/source.pdf',kind:'attention',reason:'Check permission to quote'});
 await runReclips({vaultPath:root,apply:true,includeTabular:true,obtain:async()=>({path:'x.pdf'}),extract:()=>pdfClipContent({title:'Example',source:'https://example.org/source.pdf',text:prose})});
 assert.equal(openIssues(loadIssueLog(root))[0].kind,'attention');
});

test('quarantining one exact capture does not settle another capture sharing its URL',async t=>{
 const root=vault(t);writeFileSync(join(root,'raw/clippings/other.md'),original().replace('oldhash','anotherhash'));
 const result=await runReclips({vaultPath:root,apply:true,targets:['raw/clippings/example.md'],quarantineReason:'First capture unverifiable'});
 assert.equal(result.quarantined,1);
 const queue=collectTriage(root);assert.equal(queue.fidelity.length,1);assert.equal(queue.fidelity[0].title,'other');
 recordIssue(root,{url:'https://example.org/source.pdf',kind:'failed',source:'raw/clippings/other.md',reason:'Other capture still needs repair'});
 assert.equal(collectTriage(root).clipFailures.length,1);
});
