import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
const [wikiArg, reposArg, hartyeArg, studioArg, unrealArg]=process.argv.slice(2);
const wiki=path.resolve(wikiArg), repos=path.resolve(reposArg);
const roots={'hartye-skills':path.resolve(hartyeArg),'agent-game-studio':path.resolve(studioArg),'agent-unreal':path.resolve(unrealArg)};
const out=path.join(wiki,'eval/skill-reorganization');
const sanitize=s=>{for(const p of [wiki,repos,...Object.values(roots),os.homedir()]) for(const v of [p,p.replaceAll('\\','/'),p.replaceAll('/','\\')]) s=s.split(v).join('<LOCAL_PATH>').split(JSON.stringify(v).slice(1,-1)).join('<LOCAL_PATH>'); return s;};
const save=(file,value)=>fs.writeFileSync(path.join(out,file),sanitize(typeof value==='string'?value:JSON.stringify(value,null,2)+'\n'));
const run=(cwd,cmd,args)=>{const r=spawnSync(cmd,args,{cwd,encoding:'utf8',windowsHide:true});return {command:[cmd,...args],exit:r.status,stdout:r.stdout??'',stderr:r.stderr??''};};
const paths={'hartye-skills':['skills/spec-plan/SKILL.md','skills/q-master/SKILL.md'],'agent-game-studio':['references/plugin-map.md'],'agent-unreal':['scripts/sibling-skills.json']};
const checks=[];
for(const [repo,files] of Object.entries(paths)) {
 const root=roots[repo];
 for(const file of files){const text=fs.readFileSync(path.join(root,file),'utf8'); const base=run(root,'git',['show','HEAD:'+file]).stdout;
 const metadata=t=>t.match(/^---\r?\n[\s\S]*?\r?\n---/)?.[0].replaceAll('\r\n','\n');
 const relativeLinks=[...text.matchAll(/\[[^\]\n]*\]\(([^\s)]+)\)/g)].map(m=>m[1]).filter(s=>!/^https?:|^#/.test(s));
 const missingRelativeLinks=relativeLinks.filter(s=>!fs.existsSync(path.resolve(path.dirname(path.join(root,file)),s.split('#')[0])));
 checks.push({repo,path:file,sha256:crypto.createHash('sha256').update(text).digest('hex'),metadataUnchanged:metadata(text)===metadata(base),missingRelativeLinks});
 }
 checks.push({repo,...run(root,'git',['diff','--check'])});
}
const unrealBase=JSON.parse(run(roots['agent-unreal'],'git',['show','HEAD:scripts/sibling-skills.json']).stdout), unrealNow=JSON.parse(fs.readFileSync(path.join(roots['agent-unreal'],'scripts/sibling-skills.json'),'utf8'));
const names=fs.readdirSync(path.join(wiki,'skills')).filter(n=>fs.existsSync(path.join(wiki,'skills',n,'SKILL.md'))).sort();
checks.push({repo:'agent-unreal',wikiMasterSnapshotMatchesCandidate:JSON.stringify(unrealNow['wiki-master'])===JSON.stringify(names),otherPluginBlocksUnchanged:JSON.stringify(Object.entries(unrealBase).filter(([k])=>k!=='wiki-master'))===JSON.stringify(Object.entries(unrealNow).filter(([k])=>k!=='wiki-master'))});
const studio=run(roots['agent-game-studio'],'node',['scripts/check.mjs']);save('companion-studio-check.txt',studio.stdout+studio.stderr);
const unreal=run(roots['agent-unreal'],'node',['--test','scripts/release-consistency.test.mjs']);save('companion-unreal-check.txt',unreal.stdout+unreal.stderr);
save('companion-checks.json',{checkedAt:new Date().toISOString(),checks,studio:{command:studio.command,exit:studio.exit,receipt:'companion-studio-check.txt'},unreal:{command:unreal.command,exit:unreal.exit,receipt:'companion-unreal-check.txt'},limits:'Changed-file and dependency checks, not complete companion workflow execution. No release or installed-cache changes.'});
const prior=JSON.parse(fs.readFileSync(path.join(out,'caller-inventory-before.json'),'utf8'));
const pattern='wiki-user|wiki-init|wiki-maintainer/references/(health|stale|lint|maintenance)|wiki-maintainer\\\\references\\\\(health|stale|lint|maintenance)';
const sources=[],matches=[];
for(const src of prior.sources.filter(s=>s.kind==='source-repository'||s.kind==='unavailable-source')) {
 const sourceAlias=src.plugin==='h-superpowers'?'Hartye-superpowers':src.plugin;
 const root=roots[src.plugin]??path.join(repos,sourceAlias);
 if(src.kind==='unavailable-source'||!fs.existsSync(path.join(root,'.git'))){sources.push({...src,kind:'unavailable-source',disposition:'Unavailable source remains outside compatibility claim'});continue;}
 const revision=run(root,'git',['rev-parse','HEAD']).stdout.trim(); const dirty=run(root,'git',['status','--short']).stdout;
 const result=run(root,'git',['grep','-nI','-E',pattern,'--','.']);
 if(![0,1].includes(result.exit)) throw Error('Source scan failed for '+src.plugin+': '+result.stderr);
 sources.push({plugin:src.plugin,kind:'source-repository',revision,dirty:!!dirty,scanExit:result.exit,source:roots[src.plugin]?'isolated feature worktree':'existing source checkout; read-only scan',...(sourceAlias!==src.plugin?{sourceAlias}:{}),scope:'All Git-tracked text via git grep -nI'});
 for(const line of result.stdout.trim().split('\n').filter(Boolean)){const m=line.match(/^([^:]+):(\d+):(.*)$/);if(!m)throw Error('Unparsed git grep hit');const historical=/CHANGELOG|(^|\/)eval\/|docs\/superpowers\/specs\//.test(m[1]);matches.push({plugin:src.plugin,path:m[1],line:Number(m[2]),references:m[3].match(/wiki-user|wiki-init|wiki-maintainer[\\/]references[\\/](?:health|stale|lint|maintenance)/g),classification:historical?'historical':'maintained-caller',disposition:historical?'Preserved historical evidence':'UNRESOLVED'});}
}
save('caller-inventory-after.json',{recordedAt:new Date().toISOString(),stage:'after',companionCount:16,scope:prior.scope,pattern,sources,matches,coverage:{scannedSources:sources.filter(s=>s.kind==='source-repository'&&[0,1].includes(s.scanExit)).length,unavailableSources:sources.filter(s=>s.kind==='unavailable-source').map(s=>s.plugin)},unresolvedMaintained:matches.filter(m=>m.classification==='maintained-caller').length,installedCopies:{disposition:'Not edited; prior inventory records observed installed versions and old names. No claim of global installed-cache immutability across concurrent sessions.',evidence:'caller-inventory-before.json'},candidateNames:names});
console.log(JSON.stringify({studioExit:studio.exit,unrealExit:unreal.exit,checks:checks.length,unresolvedMaintained:matches.filter(m=>m.classification==='maintained-caller').length},null,2));
if(studio.exit||unreal.exit||checks.some(c=>c.exit||c.metadataUnchanged===false||c.missingRelativeLinks?.length||c.wikiMasterSnapshotMatchesCandidate===false||c.otherPluginBlocksUnchanged===false)||matches.some(m=>m.classification==='maintained-caller'))process.exitCode=1;
