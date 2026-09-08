import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { quarantineCorruptArtifact } from './state-store.mjs';

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
const TRANSACTION_SCHEMA_VERSION=1;
const withIntegrity=record=>{ const base={...record,schema_version:TRANSACTION_SCHEMA_VERSION}; delete base.integrity_hash; return {...base,integrity_hash:crypto.createHash('sha256').update(canonicalJson(base)).digest('hex')}; };
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
export function writeDurable(file,text,{faultInjector=null}={}){
  const inject=stage=>{ if(typeof faultInjector==='function') faultInjector(stage); };
  const dir=path.dirname(file);
  fs.mkdirSync(dir,{recursive:true});
  const temp=path.join(dir,`.${path.basename(file)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  let handle;
  try{
    handle=fs.openSync(temp,'w');
    fs.writeFileSync(handle,text);
    inject('after_write');
    fs.fsyncSync(handle);
    inject('after_file_fsync');
  } finally { if(handle!==undefined) try{ fs.closeSync(handle); }catch{} }
  fs.renameSync(temp,file);
  inject('after_rename');
  let directoryFsync='applied';
  let dirHandle;
  try{ dirHandle=fs.openSync(dir,'r'); fs.fsyncSync(dirHandle); }
  catch(error){ directoryFsync=`unsupported:${error.code??error.message}`; }
  finally { if(dirHandle!==undefined) try{ fs.closeSync(dirHandle); }catch{} }
  inject('after_directory_fsync');
  return {file,directoryFsync};
}
export const writeDurableJson=(file,value,options)=>writeDurable(file,canonicalJson(value),options);

export function transactionPath(project,id){ return path.join(transactionsDir(project),`${id}.json`); }
export function readTransaction(project,id){
  const file=transactionPath(project,id); let raw;
  try { raw=fs.readFileSync(file); const record=JSON.parse(raw.toString('utf8')),expected=withIntegrity(record).integrity_hash; if(record.integrity_hash!==expected) { const error=new Error(`transaction ${id} integrity mismatch`); error.code='INTEGRITY_MISMATCH'; throw error; } return record; }
  catch(error){ if(raw!==undefined){ const receipt=quarantineCorruptArtifact(project,{kind:'corrupt_transaction',file,raw,error}); error.quarantine_receipt=receipt; } throw error; }
}

export function beginTransaction(project,{type,phase=null,gatePhase=null,inputRevision=0,sourceManifestFingerprint=null,semanticTargets=[],deterministicActions=[],derivedInvalidations=[],findingInstanceKeys=[],details={},faultInjector=null}){
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
  const sealed=withIntegrity(record); writeDurableJson(transactionPath(project,sealed.transaction_id),sealed,{faultInjector});
  return sealed;
}

export function advanceTransaction(project,record,state,patch={},options={}){
  if(!TRANSACTION_STATES.includes(state)) throw new Error(`未知的 transaction state：${state}`);
  const allowed=TRANSITIONS[record.state]??new Set();
  if(!allowed.has(state)) throw new Error(`transaction ${record.transaction_id} 不允許 ${record.state} → ${state}`);
  const next=withIntegrity({...record,...patch,state,updated_at:now()});
  writeDurableJson(transactionPath(project,record.transaction_id),next,options);
  return next;
}

// 將一筆交易由任意非終態收斂至 COMMITTED。apply/commit 必須以 transaction_id
// 作為 idempotency key；crash 後可能再次呼叫，但不得重複 promotion 或 finding finalization。
export function convergeTransaction(project,record,{apply,verify,commit,faultInjector=null}={}){
  const inject=stage=>{ if(typeof faultInjector==='function') faultInjector(stage); };
  let current=readTransaction(project,record.transaction_id);
  while(!TERMINAL.has(current.state)){
    if(current.state==='PREPARED'){
      current=advanceTransaction(project,current,'APPLYING',{recovered_at:now()});
      inject('after_applying');
      continue;
    }
    if(current.state==='APPLYING'){
      if(typeof apply!=='function') return {record:current,disposition:'APPLY_HANDLER_REQUIRED'};
      apply(current);
      inject('after_apply_effect');
      current=advanceTransaction(project,current,'APPLIED',{applied_at:now()});
      inject('after_applied');
      continue;
    }
    if(current.state==='APPLIED'){
      current=advanceTransaction(project,current,'VERIFYING',{verification_started_at:now()});
      inject('after_verifying');
      continue;
    }
    if(current.state==='VERIFYING'){
      if(typeof verify!=='function') return {record:current,disposition:'VERIFY_HANDLER_REQUIRED'};
      const verification=verify(current);
      if(verification!==true&&verification?.ok!==true) return {record:current,disposition:'VERIFICATION_FAILED',verification};
      if(typeof commit!=='function') return {record:current,disposition:'COMMIT_HANDLER_REQUIRED'};
      commit(current,verification);
      inject('after_commit_effect');
      current=advanceTransaction(project,current,'COMMITTED',{committed_at:now()});
      inject('after_committed');
      continue;
    }
    throw new Error(`transaction ${current.transaction_id} 無法由未知狀態 ${current.state} 收斂`);
  }
  return {record:current,disposition:current.state};
}

export function pendingTransactions(project){
  const dir=transactionsDir(project);
  let names=[]; try{ names=fs.readdirSync(dir).filter(name=>name.endsWith('.json')); }catch{ return []; }
  return names.map(name=>{ try{ return readTransaction(project,path.basename(name,'.json')); }catch(error){ return {transaction_id:path.basename(name,'.json'),state:'CORRUPT',error:error.message,created_at:''}; } })
    .filter(record=>record.state==='CORRUPT'||!TERMINAL.has(record.state))
    .sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)));
}

// 若 PREPARED 時記錄的 source 與現況不符，代表計畫已過期：ABORT 並重算，不得盲目 roll forward。
export function reconcilePendingTransactions(project,{currentSourceFingerprint=null,rollForward=null}={}){
  const results=[];
  for(const record of pendingTransactions(project)){
    if(record.state==='CORRUPT'){ results.push({transaction_id:record.transaction_id,disposition:'QUARANTINED_CORRUPT',error:record.error}); continue; }
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
