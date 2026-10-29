import { readFileSync, writeFileSync, readdirSync, existsSync, mkdtempSync, rmSync, rmdirSync, openSync, readSync, closeSync, renameSync, realpathSync, mkdirSync } from 'node:fs';
import { join, extname, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { pdfToText, pdfToTextOcr, pdfClipContent, assessFidelity, ocrReachable, shouldTryOcr, preferBetterExtraction, planExtraction } from '../clip-pdf.mjs';
import { docxToText } from '../clip-docx.mjs';
import { xlsxToText } from '../clip-xlsx.mjs';
import { loadIssueLog, pendingReclips, recordIssue, disposeIssue, openIssues, issueKey } from './triage.mjs';
import { matchLocalFile } from './migrate.mjs';
import { swapSourceHash } from './repoint.mjs';
import { parseNote } from './note.mjs';
import { buildNameIndex, resolveLinkTarget, wikilinks } from './graph.mjs';
import { acquireGate, lockAddress } from './cli-transport.mjs';
import { clippingKind, readPageForReclip, retainedShare, MIN_RETAINED } from './reclip-html.mjs';
import { olderCaptures } from './topic.mjs';

const norm = url => issueKey(url, '');
const layout = text => scalar(text, 'fidelity') === 'tabular' || ['table-aware','table-flattened'].includes(scalar(text,'extraction'));
const block = text => /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
function scalar(text, key) {
  const value = new RegExp(`^${key}:\\s*([^\\r\\n]*)`, 'm').exec(block(text)?.[1] ?? '')?.[1]?.trim();
  if (!value) return '';
  try { return JSON.parse(value); } catch { return value.startsWith("'") && value.endsWith("'") ? value.slice(1,-1).replaceAll("''", "'") : value; }
}
function metadata(text, values) {
  const fm = block(text); if (!fm) throw new Error('Clipping needs valid frontmatter');
  let header = fm[1];
  for (const [key,value] of Object.entries(values)) {
    const expression = new RegExp(`^${key}:[^\\r\\n]*(?:\\r?\\n[ \\t]+[^\\r\\n]*)*\\r?\\n?`, 'gm');
    header = header.replace(expression, '').trimEnd();
    if (value !== undefined && value !== '') header += `\n${key}: ${/^[a-z0-9-]+$/.test(value) ? value : JSON.stringify(value)}`;
  }
  return `---\n${header}\n---\n${text.slice(fm[0].length)}`;
}
export function mergeReclip(original, clip) {
  // The page fields are undefined for a PDF clip (so nothing is added or removed); for a page they follow what
  // clip.mjs writes: the checks counted, the page chrome set aside only when there was some.
  const updated = metadata(original, {'source-hash':clip.hash, fidelity:clip.fidelity === 'high' ? undefined : clip.fidelity, extraction:clip.extraction, 'fidelity-checks':clip.fidelityChecks, 'fidelity-ignored':clip.fidelityIgnored>0?clip.fidelityIgnored:undefined});
  return updated.slice(0,block(updated)[0].length) + `\n${clip.md}\n`;
}
export function extractForReclip(path, meta, {mode='auto', plan=planExtraction, readPdf=pdfToText, readOcr=pdfToTextOcr, canOcr=ocrReachable} = {}) {
  const ext=extname(path).toLowerCase();
  if (['.doc','.docx'].includes(ext)) return pdfClipContent({...meta,text:docxToText(path)});
  if (['.xls','.xlsx','.xlsm'].includes(ext)) return pdfClipContent({...meta,text:xlsxToText(path)});
  const selected=plan(path,{override:mode}).mode;
  if (selected.error) throw new Error(selected.error);
  let text;
  try { text=readPdf(path,selected.args); } catch (err) { if (!canOcr()) throw err; text=''; }
  let clip=pdfClipContent({...meta,text,extraction:selected.extraction,fidelityFloor:selected.fidelityFloor});
  if (shouldTryOcr(clip) && canOcr()) clip=preferBetterExtraction(clip,pdfClipContent({...meta,text:readOcr(path),extraction:'ocr',fidelityFloor:'ocr'}));
  return {...clip, warning:selected.warning};
}
function* markdown(dir) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir,{withFileTypes:true})) {
    const path=join(dir,e.name);
    if(e.isDirectory()) yield* markdown(path);
    else if(e.isFile() && e.name.endsWith('.md')) yield path;
  }
}
function head(path) {
  const fd=openSync(path,'r');
  try {
    const chunks=[];let size=0;
    while(size<1024*1024){const buf=Buffer.alloc(4096);const n=readSync(fd,buf,0,buf.length,null);if(!n)break;chunks.push(buf.subarray(0,n));size+=n;const text=Buffer.concat(chunks).toString('utf8');if(block(text))return text;}
    return Buffer.concat(chunks).toString('utf8');
  }
  finally {closeSync(fd);}
}
function atomic(path,text) {
  const tmp=`${path}.${randomUUID()}.tmp`;
  try {writeFileSync(tmp,text);renameSync(tmp,path);} finally {rmSync(tmp,{force:true});}
}
async function obtainSource(url, {file,from,title,sourceFile}={}) {
  const picked=sourceFile || (file && existsSync(file) ? file : null);
  if (picked) return {path:picked,local:true};
  if (from) {
    const name=matchLocalFile(title,readdirSync(from,{withFileTypes:true}).filter(x=>x.isFile()).map(x=>x.name));
    if (name) return {path:join(from,name),local:true};
  }
  if (!/^https?:\/\//i.test(url)) {
    if (existsSync(url)) return {path:url,local:true};
    throw new Error('Original source file unavailable');
  }
  const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const chunks=[];let size=0;
  for await (const chunk of response.body) {
    size+=chunk.length;if(size>64*1024*1024) throw new Error('Source exceeds 64 MiB download bound');chunks.push(chunk);
  }
  const bytes=Buffer.concat(chunks);
  if (!bytes.subarray(0,1024).includes(Buffer.from('%PDF-'))) throw new Error('Source URL did not return a PDF; supply the original file');
  const dir=mkdtempSync(join(tmpdir(),'wm-reclip-'));const path=join(dir,'source.pdf');writeFileSync(path,bytes);
  return {path,cleanup:()=>{rmSync(path,{force:true});rmdirSync(dir);}};
}

// A pending journal retains the original hash transition until every dependent update
// and the raw replacement finish. A retry resumes it rather than extracting again.
const SUPPLIED_REFUSAL='The text of this clipping was supplied by a person (extraction: manual), so a re-clip would replace it with a fetched page; to refresh it, save the page again from a signed-in browser and run `clip.mjs <url> --from-file <path> --recapture`';
const emptyReport=()=>({selected:0,reclipped:0,quarantined:0,alreadyResolved:0,usedLocal:0,needsReview:[],failed:[],refused:[],conflicts:[],conflictDetails:[],changed:[],results:[]});
export async function runReclips(options={}) {
  if(!options.apply)return runReclipsOwned(options);
  let release;
  try {
    const root=realpathSync(options.vaultPath);
    release=await acquireGate(lockAddress('wiki-master-reclip:'+ (process.platform==='win32'?root.toLowerCase():root)),1);
  } catch(err) {
    if(!['CLI_BUSY','CLI_LOCK'].includes(err.code))throw err;
    return {...emptyReport(),conflicts:['repair-session'],conflictDetails:[{path:'repair-session',reason:'Another repair owns this vault or its reservation is unavailable',pending:false}]};
  }
  try {return await runReclipsOwned(options);} finally {await release();}
}
async function runReclipsOwned({vaultPath,apply=false,includeTabular=false,targets,mode='auto',kind='auto',onFailure='reopen',limit=Infinity,from,sourceFile,ownedPaths,quarantineReason,obtain=obtainSource,extract=extractForReclip,readPage=readPageForReclip,write=atomic}={}) {
  if (!['auto','reading-order','table'].includes(mode)) throw new Error('Invalid reading mode');
  if (!['auto','pdf','html'].includes(kind)) throw new Error('Invalid kind (auto, pdf or html)');
  if (!['reopen','quarantine'].includes(onFailure)) throw new Error('Invalid failure policy');
  if (!(limit>0) || (!Number.isInteger(limit) && limit!==Infinity)) throw new Error('Limit must be a positive integer');
  if (ownedPaths!==undefined && (!Array.isArray(ownedPaths)||!ownedPaths.every(x=>typeof x==='string'))) throw new Error('Ownership ledger must be a JSON path array');
  if (quarantineReason && targets===undefined) throw new Error('Quarantine needs explicit targets');
  const root=resolve(vaultPath),dir=resolve(root,'raw','clippings');
  const rel=path=>path.slice(root.length+1).split(sep).join('/');
  const assertOwned=paths=>{for(const path of paths) if(ownedPaths&&!ownedPaths.includes(rel(path))){const e=new Error(`Outside owned paths: ${rel(path)}`);e.code='CONFLICT';throw e;}};
  const conflict=message=>{const e=new Error(message);e.code='CONFLICT';throw e;};
  const stateDir=join(root,'.wiki-master','reclip-transactions');
  const statePath=path=>join(stateDir,createHash('sha256').update(rel(path)).digest('hex')+'.json');
  const requested=new Map(pendingReclips(loadIssueLog(root)).map(r=>[norm(r.url),r]));
  const allRaw=[...markdown(dir)];
  let files=targets===undefined?allRaw:targets;
  if(!Array.isArray(files)||!files.every(x=>typeof x==='string'))throw new Error('Targets must be a JSON path array');
  if(targets!==undefined)files=[...new Set(files.map(p=>resolve(root,p)))];
  for(const path of files)if(!path.startsWith(dir+sep)||!path.endsWith('.md')||!realpathSync(path).startsWith(realpathSync(dir)+sep))throw new Error('Target outside clipping scope');
  // A recapture is a second clipping of a URL that names the first in `recapture-of`. A URL therefore no longer
  // identifies one capture: a request by URL repairs the newest and leaves the older evidence as it was written.
  let captures;
  const captureList=()=>captures??=allRaw.map(p=>{const text=head(p);return {path:rel(p),url:scalar(text,'source'),recaptureOf:scalar(text,'recapture-of')};});
  let older;
  const isOlderCapture=path=>(older??=olderCaptures(captureList(),norm)).has(rel(path));
  // A clipping whose text a person supplied (`extraction: manual`) is never replaced by a fetched page: it is refused here, so
  // neither a dry run nor an apply lists it as a target. A quarantine only restricts citations and leaves the text alone.
  const refused=[];
  const selected=files.filter(path=>{
    if(existsSync(statePath(path)))return true;
    const text=head(path);if(scalar(text,'citation-status')==='quarantined')return false;
    const wanted=targets!==undefined||(requested.has(norm(scalar(text,'source')))&&!isOlderCapture(path))||(includeTabular&&layout(text));
    if(wanted&&!quarantineReason&&scalar(text,'extraction')==='manual'){refused.push({path:rel(path),url:scalar(text,'source'),reason:SUPPLIED_REFUSAL});return false;}
    return wanted;
  }).slice(0,limit);
  if(sourceFile&&selected.length!==1)throw new Error('--source-file requires exactly one selected clipping');
  const report={...emptyReport(),selected:selected.length,refused};
  for(const r of refused)report.results.push({path:r.path,url:r.url,status:'refused',reason:r.reason});
  const changed=new Set(),mark=path=>changed.add(rel(path));
  let names;
  const citing=(text,path)=>{
    const wiki=[...markdown(join(root,'wiki'))];
    if(!names)names=buildNameIndex([...markdown(dir),...wiki].map(p=>{const parsed=parseNote(head(p));return {path:rel(p),name:rel(p).split('/').pop().slice(0,-3).toLowerCase(),metadata:parsed.metadata,aliases:parsed.aliases};}));
    const hash=scalar(text,'source-hash'),raw=rel(path);
    return wiki.filter(p=>{const value=readFileSync(p,'utf8');return (hash&&value.includes(hash))||wikilinks(value).some(t=>{const hit=resolveLinkTarget(names,t);return Array.isArray(hit)?hit.includes(raw):hit===raw;});});
  };
  const restrict=(value,path,reason)=>{
    const warning=`> Do not cite ${rel(path)}: ${reason}`;
    // A retired page already says it is not evidence; the warning is still added, but the marker is not replaced.
    const updated=block(value)&&scalar(value,'citation-status')!=='retired'?metadata(value,{'citation-status':'restricted'}):value;
    if(updated.includes(warning))return updated;
    const end=block(updated)?.[0].length??0;
    return updated.slice(0,end)+`\n${warning}\n`+updated.slice(end);
  };
  // The captures `path` follows, nearest first: they are older evidence of the same page, not other versions of it
  // that could still need the repair, so they do not keep a request open.
  const predecessors=path=>{
    const byPath=new Map(captureList().map(c=>[c.path.toLowerCase(),c]));
    const seen=new Set([rel(path).toLowerCase()]);
    for(let c=byPath.get(rel(path).toLowerCase());c?.recaptureOf;){
      const k=c.recaptureOf.toLowerCase();
      if(seen.has(k))break;
      seen.add(k);c=byPath.get(k);
    }
    return seen;
  };
  const peers=(url,path)=>{
    const own=predecessors(path);
    return allRaw.some(p=>p!==path&&!own.has(rel(p).toLowerCase())&&norm(scalar(head(p),'source'))===norm(url)&&scalar(head(p),'citation-status')!=='quarantined');
  };
  const settle=(url,path,disposition,note)=>{
    // A URL cannot identify one capture when multiple versions share it.
    if(peers(url,path))return;
    const repairKinds=new Set(['fidelity','failed','thin','wrong-node','blocked','gone']);
    const kinds=new Set(['fidelity',...openIssues(loadIssueLog(root)).filter(x=>norm(x.url)===norm(url)&&repairKinds.has(x.kind)).map(x=>x.kind)]);
    for(const kind of kinds)disposeIssue(root,{url,kind,disposition,note});
  };
  const save=(path,state)=>{mkdirSync(stateDir,{recursive:true});atomic(statePath(path),JSON.stringify(state));};
  const quarantineState=(path,text,url,reason)=>{
    const pages=citing(text,path);assertOwned([path,...pages]);
    // Build every transformation before a durable marker can suppress the item.
    for(const page of pages)restrict(readFileSync(page,'utf8'),path,reason);
    const state={kind:'quarantine',rawPath:rel(path),url,reason,rawBefore:text,rawAfter:metadata(text,{'citation-status':'quarantined','citation-restriction':reason}),pages:pages.map(rel)};
    save(path,state);return state;
  };
  const finish=(path,state)=>{
    if(state.rawPath!==rel(path)||!['repair','quarantine'].includes(state.kind))throw new Error('Invalid repair journal');
    const raw=readFileSync(path,'utf8');
    if(raw!==state.rawBefore&&raw!==state.rawAfter)conflict('Concurrent raw edit; pending repair retained');
    const dependencies=()=>{
      names=undefined;
      return state.kind==='quarantine'?citing(state.rawBefore,path):[...markdown(join(root,'wiki','sources'))].filter(p=>state.fromHash&&readFileSync(p,'utf8').includes(state.fromHash));
    };
    state.pages=[...new Set([...state.pages,...dependencies().map(rel)])];
    save(path,state);
    const pages=state.pages.map(p=>resolve(root,p));
    for(const page of pages)if(!page.startsWith(resolve(root,'wiki')+sep)||!realpathSync(page).startsWith(realpathSync(join(root,'wiki'))+sep))conflict('Pending page outside wiki scope');
    assertOwned([path,...pages]);
    const project=value=>state.kind==='quarantine'?restrict(value,path,state.reason):swapSourceHash(value,state.fromHash,state.toHash);
    const updates=pages.map(page=>{const before=readFileSync(page,'utf8');return {page,before,after:project(before)};});
    for(const u of updates){if(readFileSync(u.page,'utf8')!==u.before)conflict(`Concurrent page edit: ${rel(u.page)}`);if(u.after!==u.before){write(u.page,u.after);mark(u.page);}}
    const verifyMembership=()=>{
      const added=dependencies().map(rel).filter(p=>!state.pages.includes(p));
      if(added.length){state.pages.push(...added);save(path,state);conflict('Citation membership changed; pending repair retained');}
    };
    verifyMembership();
    // Raw last: failed dependent updates cannot hide quarantine work. The journal
    // still permits recovery if interruption happens after this final write.
    if(readFileSync(path,'utf8')!==raw)conflict('Concurrent raw edit');
    if(raw!==state.rawAfter){write(path,state.rawAfter);mark(path);}
    verifyMembership();
    if(readFileSync(path,'utf8')!==state.rawAfter||updates.some(u=>{const value=readFileSync(u.page,'utf8');return project(value)!==value;}))conflict('Dependent edit during completion; pending repair retained');
    if(state.kind==='quarantine'){
      settle(state.url,path,'quarantine',state.reason);report.quarantined++;
      report.results.push({path:rel(path),url:state.url,status:'quarantined',reason:state.reason});
    }else{
      const review=state.fidelity!=='high';
      if(review){report.needsReview.push({path:rel(path),url:state.url,fidelity:state.fidelity});recordIssue(root,{url:state.url,kind:'fidelity',source:rel(path),reason:`Re-clip retained ${state.fidelity} caution; verify against original before accepting`});}
      else settle(state.url,path,'acceptable','Re-clip completed with current extraction policy');
      report.reclipped++;report.results.push({path:rel(path),url:state.url,status:review?'needs-review':'reclipped',fidelity:state.fidelity,warning:state.warning,...(state.retained!==undefined?{retained:state.retained}:{})});
    }
    rmSync(statePath(path));
  };
  for(const path of selected){
    const text=readFileSync(path,'utf8'),url=scalar(text,'source');
    if(!url){report.failed.push({path:rel(path),reason:'Missing source identity'});continue;}
    if(!apply){report.results.push({path:rel(path),url,status:existsSync(statePath(path))?'pending':'planned'});continue;}
    let resource;
    try{
      assertOwned([path]);
      if(existsSync(statePath(path))){finish(path,JSON.parse(readFileSync(statePath(path),'utf8')));continue;}
      if(quarantineReason){finish(path,quarantineState(path,text,url,quarantineReason));continue;}
      // A page is read again through the clipper's own ladder; a PDF or document is obtained and extracted.
      const html=clippingKind(text,kind)==='html';
      let clip;
      if(html){clip=await readPage(url);}
      else{
        resource=await obtain(url,{...requested.get(norm(url)),from,title:scalar(text,'title'),sourceFile});
        if(!resource?.path)throw new Error('Original source file unavailable');
        if(resource.local)report.usedLocal++;
        clip=extract(resource.path,{title:scalar(text,'title'),source:url,quality:scalar(text,'quality')||'medium',created:scalar(text,'created'),topic:scalar(text,'topic')},{mode});
      }
      if(readFileSync(path,'utf8')!==text)conflict('Concurrent raw edit');
      // The glyph checks of assessFidelity read a PDF text layer; applied to a page they would trip on URLs and query strings.
      const allowed=html?['high','partial']:['high','tabular','ocr'];
      if(!Number.isFinite(clip.wordCount)||clip.wordCount<100||!allowed.includes(clip.fidelity)||(!html&&assessFidelity(clip.md).degraded))throw new Error(`Extraction needs fidelity review (${clip.fidelity}, ${clip.wordCount} words)`);
      // A page can have changed since it was clipped, and summaries quote the old text: a replacement that loses much of it is refused.
      let retained;
      if(html){
        retained=retainedShare(text.slice(block(text)?.[0].length??0),clip.md);
        if(retained<MIN_RETAINED)throw new Error(`The page has changed since it was clipped: the new text retains ${Math.round(retained*100)}% of the old, and ${Math.round(MIN_RETAINED*100)}% is needed to replace it; clip it again as a new source if the change is wanted`);
      }
      const old=scalar(text,'source-hash');
      // The same body again is not a repair: leave the file, the summaries and the triage rows as they are.
      if(html&&clip.hash===old){report.alreadyResolved++;report.results.push({path:rel(path),url,status:'unchanged',retained});continue;}
      const summaries=[...markdown(join(root,'wiki','sources'))].filter(p=>old&&readFileSync(p,'utf8').includes(old));
      assertOwned(summaries);
      const state={kind:'repair',rawPath:rel(path),url,rawBefore:text,rawAfter:mergeReclip(text,clip),fromHash:old,toHash:clip.hash,pages:summaries.map(rel),fidelity:clip.fidelity,warning:clip.warning,...(retained!==undefined?{retained}:{})};
      save(path,state);finish(path,state);
    }catch(err){
      if(err.code==='CONFLICT'||existsSync(statePath(path))||readFileSync(path,'utf8')!==text){report.conflicts.push(rel(path));report.conflictDetails.push({path:rel(path),reason:String(err.message),pending:existsSync(statePath(path))});continue;}
      const reason=String(err.message||err).slice(0,1000);
      if(onFailure==='quarantine'){
        try{finish(path,quarantineState(path,text,url,reason));}
        catch(qerr){if(qerr.code==='CONFLICT'||existsSync(statePath(path))){report.conflicts.push(rel(path));report.conflictDetails.push({path:rel(path),reason:String(qerr.message),pending:existsSync(statePath(path))});}else report.failed.push({path:rel(path),url,reason:String(qerr.message)});}
      }else{report.failed.push({path:rel(path),url,reason});recordIssue(root,{url,kind:'fidelity',source:rel(path),reason:`Re-clip failed: ${reason}`});}
    }finally{resource?.cleanup?.();}
  }
  report.changed=[...changed];return report;
}
