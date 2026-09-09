import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeDurableJson } from './transactions.mjs';
import { quarantineCorruptArtifact } from './state-store.mjs';

const scopePatterns=phase=>({requirements_gate:[/^docs\/(input|requirements)\//,/^docs\/PRD\.md$/,/^\.ai\/INPUT_INDEX\.json$/],architecture_gate:[/^docs\/(requirements|architecture|decisions)\//,/^docs\/PRD\.md$/],specification_gate:[/^docs\/(requirements|architecture|decisions|specs)\//,/^docs\/PRD\.md$/],planning_gate:[/^docs\/(requirements|specs)\//,/^docs\/IMPLEMENTATION_PLAN\.md$/,/^\.ai\/TASK_GRAPH\.json$/],implementation_gate:[/^docs\/(requirements|specs)\//,/^src\//,/^app\//,/^lib\//,/^test(s)?\//,/^package(-lock)?\.json$/],qa:[/^docs\/(requirements|specs)\//,/^src\//,/^app\//,/^lib\//,/^test(s)?\//,/^package(-lock)?\.json$/]}[phase]??[/^docs\//,/^src\//,/^app\//,/^lib\//,/^test(s)?\//]);
const excluded=relative=>/(^|\/)(node_modules|dist|build|coverage|\.git)(\/|$)/.test(relative)||/^\.ai\/(runtime|logs|telemetry|handoffs|transactions|archive)\//.test(relative);
const hashFile=file=>{ const hash=crypto.createHash('sha256'),fd=fs.openSync(file,'r'),buffer=Buffer.allocUnsafe(1024*1024); try{ let read=0; while((read=fs.readSync(fd,buffer,0,buffer.length,null))>0) hash.update(buffer.subarray(0,read)); return hash.digest('hex'); }finally{ fs.closeSync(fd); } };
const artifactIdentity=file=>{ const stat=fs.lstatSync(file),mode=stat.mode&0o7777; if(stat.isSymbolicLink()) return {kind:'symlink',mode,target:fs.readlinkSync(file)}; if(stat.isFile()) return {kind:'file',mode,sha256:hashFile(file)}; return {kind:'other',mode}; };
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const cachePath=project=>path.join(project,'.ai','GATE_CACHE.json');
const cacheKey=(phase,unit)=>`${phase}:${unit.id}`;
const load=(project,version)=>{
  const file=cachePath(project); if(!fs.existsSync(file)) return {schema_version:version,entries:{}}; let raw;
  try{ raw=fs.readFileSync(file); const value=JSON.parse(raw.toString('utf8')); if(value.schema_version!==version) return {schema_version:version,entries:{}}; if(!value.entries||Array.isArray(value.entries)||typeof value.entries!=='object'){ const error=new Error('GATE_CACHE.entries 必須是 object'); error.code='INVALID_CACHE_SCHEMA'; throw error; } return value; }
  catch(error){ if(raw!==undefined) quarantineCorruptArtifact(project,{kind:'corrupt_rebuildable_cache',file,raw,error}); return {schema_version:version,entries:{}}; }
};

export function gateArtifactManifest(project,phase,unit,context={},policy={}){
  const verification_mode=context.gate_verification_mode??context.verification_mode??'full',active_findings=[...(context.finding_instance_keys??context.active_findings??[])].map(String).sort(),listed=spawnSync('git',['ls-files','-co','--exclude-standard','-z'],{cwd:project,encoding:'utf8'}),patterns=scopePatterns(phase),all=String(listed.stdout??'').split('\0').filter(Boolean).map(file=>file.replaceAll('\\','/'));
  const files=all.filter(file=>patterns.some(pattern=>pattern.test(file))).sort(),scoped=new Set(['implementation_gate','qa']).has(phase)?all.filter(file=>!excluded(file)).sort():files,manifest={};
  for(const relative of scoped){ const full=path.join(project,relative); try{ manifest[relative]=artifactIdentity(full); }catch{} }
  manifest['@policy']=crypto.createHash('sha256').update(`${policy.cache_version}|${phase}|${unit?.id??''}|${unit?.prompt??''}|${policy.result_schema??''}|${JSON.stringify(stable({verification_mode,active_findings}))}|${policy.policy_fingerprint??''}`).digest('hex'); return manifest;
}
export function gateCacheProbe(project,phase,unit,context={},policy={}){
  const manifest=gateArtifactManifest(project,phase,unit,context,policy),cache=load(project,policy.cache_version),previous=cache.entries?.[cacheKey(phase,unit)],fingerprint=crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),changed=previous?.manifest?[...new Set([...Object.keys(previous.manifest),...Object.keys(manifest)])].filter(file=>previous.manifest[file]!==manifest[file]&&file!=='@policy'):Object.keys(manifest).filter(file=>file!=='@policy');
  return {hit:Boolean(previous?.outcome==='pass'&&previous.fingerprint===fingerprint),fingerprint,manifest,changed,previous};
}
export function saveGateCachePass(project,phase,unit,verdict,context={},policy={}){
  const probe=gateCacheProbe(project,phase,unit,context,policy),cache=load(project,policy.cache_version); cache.entries??={}; cache.entries[cacheKey(phase,unit)]={outcome:'pass',fingerprint:probe.fingerprint,manifest:probe.manifest,summary:String(verdict.summary??'').slice(0,1200),evidence:(verdict.evidence??[]).slice(0,8),updated_at:new Date().toISOString()}; cache.updated_at=new Date().toISOString(); writeDurableJson(cachePath(project),cache); return probe;
}
export function gateDeltaContext(project,phase,unit,context={},policy={}){ const probe=gateCacheProbe(project,phase,unit,context,policy); if(!probe.previous) return {probe,text:'尚無可信任的前次 Gate 基線，本輪必須執行完整審查。'}; return {probe,text:probe.changed.length?`相對前次通過基線的變更檔案（${probe.changed.length}）：\n${probe.changed.map(file=>`- ${file}`).join('\n')}\n先審查這些差異及其直接相依；最終結論仍須確認未變更區域的既有通過假設沒有失效。`:'來源內容未變更；控制器應直接使用 hash 快取，不應啟動模型。'}; }
export { cacheKey as gateCacheKey };
