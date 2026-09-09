import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const BILLING_OUTBOX_VERSION = 1;

const makeError=(message,code)=>Object.assign(new Error(message),{code});
const statePath=root=>path.join(root,'billing-dispatch-outbox.json');
const intentPath=root=>`${statePath(root)}.intent`;
const lockPath=root=>`${statePath(root)}.lock`;
const emptyState=()=>({schema_version:1,generation:0,records:{},quarantine:[]});
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const validateState=state=>{
  if(state?.schema_version!==1||!Number.isSafeInteger(state.generation)||state.generation<0||!state.records||typeof state.records!=='object'||!Array.isArray(state.quarantine))throw makeError('BILLING_OUTBOX_CORRUPT','BILLING_OUTBOX_CORRUPT');
  return state;
};
const durableReplace=(file,value)=>{
  const dir=path.dirname(file),temporary=`${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.mkdirSync(dir,{recursive:true});
  const fd=fs.openSync(temporary,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(temporary,file);
  if(process.platform!=='win32'){const directory=fs.openSync(dir,'r');try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}}
};
const readState=root=>{
  if(!fs.existsSync(statePath(root)))return emptyState();
  try{return validateState(JSON.parse(fs.readFileSync(statePath(root),'utf8')));}catch(error){if(error?.code==='BILLING_OUTBOX_CORRUPT')throw error;throw makeError('BILLING_OUTBOX_CORRUPT','BILLING_OUTBOX_CORRUPT');}
};
const waitBuffer=new Int32Array(new SharedArrayBuffer(4));
const acquireLock=file=>{
  const deadline=Date.now()+5000;
  while(Date.now()<=deadline){try{const fd=fs.openSync(file,'wx',0o600);fs.writeFileSync(fd,String(process.pid));fs.fsyncSync(fd);return fd;}catch(error){if(error.code!=='EEXIST'&&!(process.platform==='win32'&&error.code==='EPERM'))throw error;Atomics.wait(waitBuffer,0,0,10);}}
  throw makeError('BILLING_OUTBOX_LOCK_TIMEOUT','BILLING_OUTBOX_UNAVAILABLE');
};
const persist=(root,previous,next,operation)=>{
  const intent={schema_version:1,previous_generation:previous.generation,next_generation:next.generation,operation,next_state:next,next_sha256:digest(next)};
  durableReplace(intentPath(root),intent);durableReplace(statePath(root),next);fs.unlinkSync(intentPath(root));
};

export function recoverBillingDispatchOutbox(root){
  if(!fs.existsSync(intentPath(root)))return {recovered:false};
  let intent;
  try{intent=JSON.parse(fs.readFileSync(intentPath(root),'utf8'));if(intent?.schema_version!==1||digest(intent.next_state)!==intent.next_sha256)throw new Error();validateState(intent.next_state);}catch{throw makeError('BILLING_OUTBOX_INTENT_CORRUPT','BILLING_OUTBOX_CORRUPT');}
  const current=readState(root);
  if(current.generation===intent.previous_generation)durableReplace(statePath(root),intent.next_state);
  else if(current.generation!==intent.next_generation)throw makeError('BILLING_OUTBOX_GENERATION_CONFLICT','BILLING_OUTBOX_CORRUPT');
  fs.unlinkSync(intentPath(root));return {recovered:true,generation:intent.next_generation};
}

export function createBillingDispatchOutbox({root,clock=()=>Date.now()}={}){
  if(!root)throw makeError('BILLING_OUTBOX_ROOT_REQUIRED','BILLING_OUTBOX_CONFIG_INVALID');
  const transact=operation=>{fs.mkdirSync(root,{recursive:true});const fd=acquireLock(lockPath(root));try{recoverBillingDispatchOutbox(root);const previous=readState(root),result=operation(structuredClone(previous));if(result.no_write)return result.value;result.state.generation=previous.generation+1;persist(root,previous,result.state,result.operation);return result.value;}finally{fs.closeSync(fd);try{fs.unlinkSync(lockPath(root));}catch{}}};
  return Object.freeze({
    createIntent({invocation_id,idempotency_key,lease_id,request_sha256,parent_checkpoint}){return transact(state=>{if(!invocation_id||!idempotency_key||!lease_id||!parent_checkpoint||!/^[a-f0-9]{64}$/i.test(request_sha256??''))throw makeError('BILLING_OUTBOX_INTENT_INVALID','BILLING_OUTBOX_INVALID');const existing=state.records[invocation_id];if(existing){if(existing.idempotency_key===idempotency_key&&existing.lease_id===lease_id&&existing.request_sha256===request_sha256)return {no_write:true,value:structuredClone(existing)};throw makeError('BILLING_OUTBOX_IDENTITY_CONFLICT','BILLING_OUTBOX_CONFLICT');}const record={schema_version:1,invocation_id,idempotency_key,lease_id,request_sha256,parent_checkpoint,fencing_generation:1,status:'INTENT_DURABLE',created_at_ms:clock(),dispatch_token:null,provider_request_id:null,result_sha256:null};state.records[invocation_id]=record;return {state,operation:'create_intent',value:structuredClone(record)};});},
    authorizeDispatch(invocation_id){return transact(state=>{const record=state.records[invocation_id];if(!record)throw makeError('BILLING_OUTBOX_INTENT_REQUIRED','BILLING_OUTBOX_DISPATCH_DENIED');if(record.status!=='INTENT_DURABLE')throw makeError('BILLING_OUTBOX_ALREADY_DISPATCHED','BILLING_OUTBOX_DISPATCH_DENIED');record.status='DISPATCH_AUTHORIZED';record.dispatch_token=crypto.randomUUID();record.authorized_at_ms=clock();return {state,operation:'authorize_dispatch',value:{invocation_id,dispatch_token:record.dispatch_token,fencing_generation:record.fencing_generation,request_sha256:record.request_sha256}};});},
    markAccepted(invocation_id,{dispatch_token,fencing_generation,provider_request_id}){return transact(state=>{const record=state.records[invocation_id];if(!record||record.status!=='DISPATCH_AUTHORIZED'||record.dispatch_token!==dispatch_token||record.fencing_generation!==fencing_generation||!provider_request_id)throw makeError('BILLING_OUTBOX_ACCEPTANCE_REJECTED','BILLING_OUTBOX_FENCE_REJECTED');record.status='PROVIDER_ACCEPTED';record.provider_request_id=provider_request_id;record.accepted_at_ms=clock();return {state,operation:'provider_accepted',value:structuredClone(record)};});},
    markUnknown(invocation_id,{reason}){return transact(state=>{const record=state.records[invocation_id];if(!record||!['DISPATCH_AUTHORIZED','PROVIDER_ACCEPTED'].includes(record.status))throw makeError('BILLING_OUTBOX_UNKNOWN_INVALID','BILLING_OUTBOX_INVALID');record.status='RECONCILIATION_REQUIRED';record.unknown_reason=String(reason||'PROVIDER_OUTCOME_UNKNOWN');record.unknown_at_ms=clock();return {state,operation:'unknown_outcome',value:structuredClone(record)};});},
    supersede(invocation_id,{reconciled_evidence_sha256}){return transact(state=>{const record=state.records[invocation_id];if(!record||record.status!=='RECONCILIATION_REQUIRED'||!/^[a-f0-9]{64}$/i.test(reconciled_evidence_sha256??''))throw makeError('BILLING_OUTBOX_SUPERSEDE_DENIED','BILLING_OUTBOX_INVALID');record.fencing_generation+=1;record.status='INTENT_DURABLE';record.dispatch_token=null;record.provider_request_id=null;record.reconciled_evidence_sha256=reconciled_evidence_sha256;return {state,operation:'supersede',value:structuredClone(record)};});},
    stageResult(invocation_id,{dispatch_token,fencing_generation,provider_request_id,result_sha256}){return transact(state=>{const record=state.records[invocation_id],valid=record&&record.status==='PROVIDER_ACCEPTED'&&record.dispatch_token===dispatch_token&&record.fencing_generation===fencing_generation&&record.provider_request_id===provider_request_id&&/^[a-f0-9]{64}$/i.test(result_sha256??'');if(!valid){state.quarantine.push({invocation_id,dispatch_token:dispatch_token??null,fencing_generation:fencing_generation??null,provider_request_id:provider_request_id??null,result_sha256:result_sha256??null,quarantined_at_ms:clock(),reason:'STALE_OR_INVALID_FENCE'});return {state,operation:'quarantine_result',value:{staged:false,quarantined:true}};}record.status='RESULT_STAGED';record.result_sha256=result_sha256;record.staged_at_ms=clock();return {state,operation:'stage_result',value:{staged:true,quarantined:false,fencing_generation}};});},
    snapshot(){return transact(state=>({no_write:true,value:structuredClone(state)}));}
  });
}
