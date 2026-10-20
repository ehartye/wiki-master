import { readFileSync, writeFileSync, readdirSync, existsSync, mkdtempSync, rmSync, rmdirSync, openSync, readSync, closeSync, renameSync, realpathSync } from 'node:fs';
import { join, extname, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { pdfToText, pdfToTextOcr, pdfClipContent, assessFidelity, ocrReachable, shouldTryOcr, preferBetterExtraction, planExtraction } from '../clip-pdf.mjs';
import { docxToText } from '../clip-docx.mjs';
import { xlsxToText } from '../clip-xlsx.mjs';
import { loadIssueLog, pendingReclips, recordIssue, disposeIssue, openIssues, issueKey } from './triage.mjs';
import { matchLocalFile } from './migrate.mjs';
import { swapSourceHash } from './repoint.mjs';

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
export function needsReclip(text, {requested = false} = {}) {
  return requested || layout(text) || !['','high'].includes(scalar(text,'fidelity')) || assessFidelity(text.slice(block(text)?.[0].length ?? 0)).degraded;
}
export function mergeReclip(original, clip) {
  const updated = metadata(original, {'source-hash':clip.hash, fidelity:clip.fidelity === 'high' ? undefined : clip.fidelity, extraction:clip.extraction});
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

export async function runReclips({vaultPath,apply=false,includeTabular=false,targets,mode='auto',onFailure='reopen',limit=Infinity,from,sourceFile,ownedPaths,quarantineReason,obtain=obtainSource,extract=extractForReclip}={}) {
  if (!['auto','reading-order','table'].includes(mode)) throw new Error('Invalid reading mode');
  if (!['reopen','quarantine'].includes(onFailure)) throw new Error('Invalid failure policy');
  if (!(limit>0) || (!Number.isInteger(limit) && limit!==Infinity)) throw new Error('Limit must be a positive integer');
  if (ownedPaths!==undefined && (!Array.isArray(ownedPaths)||!ownedPaths.every(x=>typeof x==='string'))) throw new Error('Ownership ledger must be a JSON path array');
  if (quarantineReason && targets===undefined) throw new Error('Quarantine needs explicit targets');
  const dir=resolve(vaultPath,'raw','clippings');const log=loadIssueLog(vaultPath);
  const requested=new Map(pendingReclips(log).map(r=>[norm(r.url),r]));
  const rel=path=>path.slice(resolve(vaultPath).length+1).split(sep).join('/');
  const owns=path=>!ownedPaths || ownedPaths.includes(rel(path));
  const assertOwned=paths=>{for(const path of paths) if(!owns(path)){const error=new Error(`Outside owned paths: ${rel(path)}`);error.code='OWNERSHIP';throw error;}};
  let files;
  if (targets!==undefined) {
    if (!Array.isArray(targets) || !targets.every(x=>typeof x==='string')) throw new Error('Targets must be a JSON path array');
    files=[...new Set(targets.map(p=>resolve(vaultPath,p)))];
    for(const path of files) if(!path.startsWith(dir+sep)||!path.endsWith('.md')||!realpathSync(path).startsWith(realpathSync(dir)+sep)) throw new Error('Target outside clipping scope');
  } else files=[...markdown(dir)];
  const selected=files.filter(path=>{
    const text=head(path); if(scalar(text,'citation-status')==='quarantined') return false;
    return targets!==undefined || requested.has(norm(scalar(text,'source'))) || (includeTabular && layout(text));
  }).slice(0,limit);
  if(sourceFile && selected.length!==1) throw new Error('--source-file requires exactly one selected clipping');
  const report={selected:selected.length,reclipped:0,quarantined:0,alreadyResolved:0,usedLocal:0,needsReview:[],failed:[],conflicts:[],changed:[],results:[]};
  const changed=new Set();const mark=path=>changed.add(rel(path));
  const settle=(url,disposition,note)=>{
    const kinds=new Set(['fidelity',...openIssues(loadIssueLog(vaultPath)).filter(x=>norm(x.url)===norm(url)).map(x=>x.kind)]);
    for(const kind of kinds) disposeIssue(vaultPath,{url,kind,disposition,note});
  };
  const citing=(text,path)=>{
    const hash=scalar(text,'source-hash');const raw=rel(path);
    return [...markdown(join(vaultPath,'wiki'))].map(p=>[p,readFileSync(p,'utf8')]).filter(([,value])=>value.includes(`[[${raw}`)||(hash&&value.includes(hash)));
  };
  const quarantine=(path,text,url,reason)=>{
    const pages=citing(text,path);assertOwned([path,...pages.map(([p])=>p)]);
    if(readFileSync(path,'utf8')!==text || pages.some(([p,t])=>readFileSync(p,'utf8')!==t)) {
      const error=new Error('Concurrent edit before quarantine');error.code='OWNERSHIP';throw error;
    }
    atomic(path,metadata(text,{'citation-status':'quarantined','citation-restriction':reason}));mark(path);
    for(const [page,value] of pages) {
      if(readFileSync(page,'utf8')!==value) throw new Error(`Concurrent page edit: ${rel(page)}`);
      const updated=metadata(value,{'citation-status':'restricted'});const fm=block(updated);
      atomic(page,updated.slice(0,fm[0].length)+`\n> Do not cite ${rel(path)}: ${reason}\n`+updated.slice(fm[0].length));mark(page);
    }
    settle(url,'quarantine',reason);report.quarantined++;
  };
  for(const path of selected) {
    const text=readFileSync(path,'utf8');const url=scalar(text,'source');
    if (!url) {report.failed.push({path:rel(path),reason:'Missing source identity'});continue;}
    if (!apply) {report.results.push({path:rel(path),url,status:'planned'});continue;}
    let resource;
    try {
      assertOwned([path]);
      if(quarantineReason){quarantine(path,text,url,quarantineReason);report.results.push({path:rel(path),url,status:'quarantined',reason:quarantineReason});continue;}
      resource=await obtain(url,{...requested.get(norm(url)),from,title:scalar(text,'title'),sourceFile});
      if (!resource?.path) throw new Error('Original source file unavailable');
      if(resource.local)report.usedLocal++;
      const clip=extract(resource.path,{title:scalar(text,'title'),source:url,quality:scalar(text,'quality')||'medium',created:scalar(text,'created'),topic:scalar(text,'topic')},{mode});
      if(readFileSync(path,'utf8')!==text) {report.conflicts.push(rel(path));continue;}
      if(!Number.isFinite(clip.wordCount) || clip.wordCount<100 || !['high','tabular'].includes(clip.fidelity) || assessFidelity(clip.md).degraded) throw new Error(`Extraction needs fidelity review (${clip.fidelity}, ${clip.wordCount} words)`);
      const old=scalar(text,'source-hash');
      const summaries=[...markdown(join(vaultPath,'wiki','sources'))].map(p=>[p,readFileSync(p,'utf8')]).filter(([,value])=>old&&value.includes(old));
      assertOwned(summaries.map(([p])=>p));
      atomic(path,mergeReclip(text,clip));mark(path);
      for(const [page,value] of summaries) {
        if(readFileSync(page,'utf8')!==value) throw new Error(`Concurrent page edit: ${rel(page)}`);
        const updated=swapSourceHash(value,old,clip.hash);if(updated!==value){atomic(page,updated);mark(page);}
      }
      if(clip.fidelity==='tabular') {
        report.needsReview.push({path:rel(path),url});recordIssue(vaultPath,{url,kind:'fidelity',source:rel(path),reason:'Re-clip retained reconstructed table rows; verify pairings before accepting'});
      } else settle(url,'acceptable','Re-clip completed with current extraction policy');
      report.reclipped++;report.results.push({path:rel(path),url,status:clip.fidelity==='tabular'?'needs-review':'reclipped',fidelity:clip.fidelity,warning:clip.warning});
    } catch(err) {
      if(err.code==='OWNERSHIP'||readFileSync(path,'utf8')!==text){report.conflicts.push(rel(path));continue;}
      const reason=String(err.message||err).slice(0,1000);
      if(onFailure==='quarantine') {
        try {quarantine(path,text,url,reason);report.results.push({path:rel(path),url,status:'quarantined',reason});}
        catch(qerr){if(qerr.code==='OWNERSHIP'||readFileSync(path,'utf8')!==text)report.conflicts.push(rel(path));else report.failed.push({path:rel(path),url,reason:String(qerr.message)});}
      }
      else {report.failed.push({path:rel(path),url,reason});recordIssue(vaultPath,{url,kind:'fidelity',source:rel(path),reason:`Re-clip failed: ${reason}`});}
    } finally {resource?.cleanup?.();}
  }
  report.changed=[...changed];return report;
}
