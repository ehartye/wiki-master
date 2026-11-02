import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const root=path.resolve('eval/skill-consolidation/research');
const [scratch, candidate, baseline]=process.argv.slice(2);
const replacements=[[scratch,'<SCRATCH>'],[candidate,'<CANDIDATE>'],[baseline,'<BASELINE>'],[os.homedir(),'<HOME>']].filter(([v])=>v);
function scrub(s){for(const [source,label] of replacements){for(const p of new Set([source,source.replaceAll('\\','/'),source.replaceAll('/','\\'),source.replaceAll('\\','/').replace(/^([A-Za-z]):/,(_,d)=>'/'+d.toLowerCase())])){s=s.split(JSON.stringify(p).slice(1,-1)).join(label);s=s.split(p).join(label);}}return s.replace(/C--Users-[^/\\"\s]+/g,'<ENCODED_PROJECT_PATH>');}
for(const dirent of fs.readdirSync(root,{recursive:true,withFileTypes:true})){if(!dirent.isFile()||dirent.name.endsWith('.mjs'))continue;const p=path.join(dirent.parentPath??dirent.path,dirent.name);const before=fs.readFileSync(p,'utf8'),after=scrub(before);if(before!==after)fs.writeFileSync(p,after);}
