// Replay requested repairs or explicitly selected layout-flagged captures. Dry run by default.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { resolveVault } from './lib/vault.mjs';
import { runReclips } from './lib/reclip.mjs';

export async function main(argv=process.argv.slice(2)) {
  const {values}=parseArgs({args:argv,options:{apply:{type:'boolean'},from:{type:'string'},limit:{type:'string'},mode:{type:'string',default:'auto'},kind:{type:'string',default:'auto'},'include-tabular':{type:'boolean'},'targets-file':{type:'string'},'owned-paths-file':{type:'string'},'source-file':{type:'string'},'on-failure':{type:'string',default:'reopen'},'quarantine-reason':{type:'string'},help:{type:'boolean'}}});
  if(values.help){console.log('apply-reclips.mjs [--apply] [--include-tabular | --targets-file paths.json] [--owned-paths-file ledger.json] [--source-file original.pdf] [--from directory] [--mode auto|reading-order|table] [--kind auto|pdf|html] [--on-failure reopen|quarantine] [--limit N] [--quarantine-reason reason]');return;}
  const report=await runReclips({vaultPath:resolveVault().path,apply:!!values.apply,includeTabular:!!values['include-tabular'],targets:values['targets-file']?JSON.parse(readFileSync(values['targets-file'],'utf8')):undefined,ownedPaths:values['owned-paths-file']?JSON.parse(readFileSync(values['owned-paths-file'],'utf8')):undefined,sourceFile:values['source-file'],from:values.from,limit:values.limit===undefined?Infinity:Number(values.limit),mode:values.mode,kind:values.kind,onFailure:values['on-failure'],quarantineReason:values['quarantine-reason']});
  console.log(JSON.stringify({type:'apply-reclips',applied:!!values.apply,...report}));
  if(!values.apply)console.error('dry run; re-run with --apply to perform the re-clips');
  if(report.failed.length||report.conflicts.length)process.exitCode=1;
  return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(err=>{console.error(`apply-reclips: ${err.message}`);process.exitCode=1;});
