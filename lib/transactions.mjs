import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const TRANSACTION_TYPES=['ARCH_REPAIR','GATE_COMMIT','STAGE_APPROVAL_MIGRATION'];
export const TRANSACTION_STATES=['PREPARED','APPLYING','APPLIED','VERIFYING','COMMITTED','ABORTED'];
const TERMINAL=new Set(['COMMITTED','ABORTED']);
const TRANSITIONS={
  PREPARED:new Set(['APPLYING','ABORTED']),
  APPLYING:new Set(['APPLIED','ABORTED']),
  APPLIED:new Set(['VERIFYING','COMMITTED','ABORTED']),
  VERIFYING:new Set(['COMMITTED','ABORTED']),
  COMMITTED:new Set([]),
  ABORTED:new Set([])
};
const now=()=>new Date().toISOString();
export const transactionsDir=project=>path.join(project,'.ai','transactions');

// Canonical JSON：鍵排序，確保同一 logical 內容產生 byte-identical 輸出（idempotent evidence 的前提）。
export function canonicalJson(value){
  const walk=node=>{
    if(Array.isArray(node)) return node.map(walk);
    if(node&&typeof node==='object'){ const out={}; for(const key of Object.keys(node).sort()) out[key]=walk(node[key]); return out; }
    return node;
  };
  return JSON.stringify(walk(value),null,2)+'\n';
}

// Durable write：temp → fsync file → atomic rename → fsync parent directory（平台支援時）。
// 純 writeFileSync 不足以宣稱 durable；crash 可能留下半寫入內容。
export function writeDurable(file,text){
  const dir=path.dirname(file);
  fs.mkdirSync(dir,{recursive:true});
  const temp=path.join(dir,`.${path.basename(file)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  let handle;
  try{
    handle=fs.openSync(temp,'w');
    fs.writeFileSync(handle,text);
    fs.fsyncSync(handle);
  } finally { if(handle!==undefined) try{ fs.closeSync(handle); }catch{} }
  fs.renameSync(temp,file);
  let directoryFsync='applied';
  let dirHandle;
  try{ dirHandle=fs.openSync(dir,'r'); fs.fsyncSync(dirHandle); }
  catch(error){ directoryFsync=`unsupported:${error.code??error.message}`; }
  finally { if(dirHandle!==undefined) try{ fs.closeSync(dirHandle); }catch{} }
  return {file,directoryFsync};
}
export const writeDurableJson=(file,value)=>writeDurable(file,canonicalJson(value));

export function transactionPath(project,id){ return path.join(transactionsDir(project),`${id}.json`); }
export function readTransaction(project,id){ try{ return JSON.parse(fs.readFileSync(transactionPath(project,id),'utf8')); }catch{ return null; } }

export function beginTransaction(project,{type,phase=null,gatePhase=null,inputRevision=0,sourceManifestFingerprint=null,semanticTargets=[],deterministicActions=[],derivedInvalidations=[],findingInstanceKeys=[],details={}}){
  if(!TRANSACTION_TYPES.includes(type)) throw new Error(`未知的 transaction type：${type}`);
  const record={
    transaction_id:`TX-${type}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
    type,project:path.basename(project),input_revision:Number(inputRevision??0),
    phase,gate_phase:gatePhase,
    source_manifest_fingerprint:sourceManifestFingerprint,
    semantic_targets:[...semanticTargets],deterministic_actions:[...deterministicActions],
    derived_invalidations:[...derivedInvalidations],finding_instance_keys:[...findingInstanceKeys],
    details,state:'PREPARED',created_at:now(),updated_at:now()
  };
  // PREPARED 必須先 durable，才可以開始 mutation project state。
  writeDurableJson(transactionPath(project,record.transaction_id),record);
  return record;
}

export function advanceTransaction(project,record,state,patch={}){
  if(!TRANSACTION_STATES.includes(state)) throw new Error(`未知的 transaction state：${state}`);
  const allowed=TRANSITIONS[record.state]??new Set();
  if(!allowed.has(state)) throw new Error(`transaction ${record.transaction_id} 不允許 ${record.state} → ${state}`);
  const next={...record,...patch,state,updated_at:now()};
  writeDurableJson(transactionPath(project,record.transaction_id),next);
  return next;
}

export function pendingTransactions(project){
  const dir=transactionsDir(project);
  let names=[]; try{ names=fs.readdirSync(dir).filter(name=>name.endsWith('.json')); }catch{ return []; }
  return names.map(name=>{ try{ return JSON.parse(fs.readFileSync(path.join(dir,name),'utf8')); }catch{ return null; } })
    .filter(record=>record&&!TERMINAL.has(record.state))
    .sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)));
}

// 若 PREPARED 時記錄的 source 與現況不符，代表計畫已過期：ABORT 並重算，不得盲目 roll forward。
export function reconcilePendingTransactions(project,{currentSourceFingerprint=null,rollForward=null}={}){
  const results=[];
  for(const record of pendingTransactions(project)){
    if(record.source_manifest_fingerprint&&currentSourceFingerprint&&record.source_manifest_fingerprint!==currentSourceFingerprint){
      advanceTransaction(project,record,'ABORTED',{abort_reason:'source_manifest_fingerprint 與現況不符，計畫已過期'});
      results.push({transaction_id:record.transaction_id,type:record.type,disposition:'ABORTED_STALE_SOURCE'});
      continue;
    }
    const outcome=typeof rollForward==='function'?rollForward(record):{disposition:'DEFERRED'};
    results.push({transaction_id:record.transaction_id,type:record.type,...outcome});
  }
  return results;
}
