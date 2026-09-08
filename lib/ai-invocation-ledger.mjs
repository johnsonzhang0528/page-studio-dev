import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { calculateUsageCost } from './price-registry.mjs';

const sha=value=>crypto.createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export const aiInvocationLedgerPath=project=>path.join(project,'.ai','telemetry','ai-invocations.jsonl');
const pendingPath=project=>`${aiInvocationLedgerPath(project)}.pending`;
const lockPath=project=>`${aiInvocationLedgerPath(project)}.lock`;
const readRows=file=>{
  if(!fs.existsSync(file)) return [];
  const raw=fs.readFileSync(file,'utf8'),lines=raw.split('\n'); if(lines.at(-1)!=='') throw Object.assign(new Error('AI_LEDGER_TRUNCATED'),{code:'AI_LEDGER_CORRUPT'});
  return lines.filter(Boolean).map((line,index)=>{ try{return JSON.parse(line);}catch{throw Object.assign(new Error(`AI_LEDGER_INVALID_JSON:${index+1}`),{code:'AI_LEDGER_CORRUPT'});} });
};
const durableReplace=(file,content)=>{ const dir=path.dirname(file),temporary=`${file}.${process.pid}.${crypto.randomUUID()}.tmp`; fs.mkdirSync(dir,{recursive:true}); const fd=fs.openSync(temporary,'wx',0o600); try{fs.writeFileSync(fd,content);fs.fsyncSync(fd);}finally{fs.closeSync(fd);} fs.renameSync(temporary,file); if(process.platform!=='win32'){const directory=fs.openSync(dir,'r');try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}} };
const validateReceipt=receipt=>{ if(receipt?.schema_version!==1||!receipt.provider||!receipt.model||!receipt.provider_request_id||!receipt.idempotency_key) throw Object.assign(new Error('AI_LEDGER_RECEIPT_INVALID'),{code:'AI_LEDGER_CORRUPT'}); return receipt; };
const applyPending=(project,receipt)=>{ const file=aiInvocationLedgerPath(project),rows=readRows(file),request=rows.find(row=>row.provider===receipt.provider&&row.provider_request_id===receipt.provider_request_id),idempotent=rows.find(row=>row.idempotency_key===receipt.idempotency_key); if(request||idempotent){ if(request&&idempotent&&request.receipt_id===idempotent.receipt_id&&request.provider_request_id===receipt.provider_request_id&&request.idempotency_key===receipt.idempotency_key) return {written:false,deduplicated:true,receipt:request}; throw Object.assign(new Error('AI_LEDGER_IDENTITY_CONFLICT'),{code:'AI_LEDGER_IDENTITY_CONFLICT',existing_request_receipt:request?.receipt_id??null,existing_idempotency_receipt:idempotent?.receipt_id??null}); } durableReplace(file,`${rows.map(JSON.stringify).join('\n')}${rows.length?'\n':''}${JSON.stringify(receipt)}\n`); return {written:true,deduplicated:false,receipt}; };
const acquireLock=file=>{ for(let attempt=0;attempt<2;attempt+=1){ try{ const fd=fs.openSync(file,'wx',0o600); fs.writeFileSync(fd,String(process.pid)); fs.fsyncSync(fd); return fd; }catch(error){ if(error.code!=='EEXIST')throw error; let owner=0;try{owner=Number(fs.readFileSync(file,'utf8'));}catch{} let alive=false;try{if(owner>0){process.kill(owner,0);alive=true;}}catch{} if(alive||attempt===1)throw Object.assign(new Error('AI_LEDGER_LOCKED'),{code:'AI_LEDGER_LOCKED'}); fs.unlinkSync(file); } } };

export function recoverAiInvocationLedger(project){
  const pending=pendingPath(project); if(!fs.existsSync(pending)) return {recovered:false};
  let receipt; try{receipt=validateReceipt(JSON.parse(fs.readFileSync(pending,'utf8')));}catch{throw Object.assign(new Error('AI_LEDGER_PENDING_CORRUPT'),{code:'AI_LEDGER_CORRUPT'});}
  const result=applyPending(project,receipt); fs.unlinkSync(pending); return {recovered:true,...result};
}

export function appendAiInvocationReceipt(project,details,{priceRegistry=null,now=new Date()}={}){
  const lock=lockPath(project); fs.mkdirSync(path.dirname(lock),{recursive:true}); const lockFd=acquireLock(lock);
  try{
    recoverAiInvocationLedger(project);
    if(!details?.provider||!details?.model||!details?.provider_request_id||!details?.idempotency_key) throw new Error('AI_LEDGER_IDENTITY_REQUIRED');
    const usage=details.usage??{},normalizedUsage={input_tokens:Number(usage.input_tokens??0),cached_input_tokens:Number(usage.cached_input_tokens??0),output_tokens:Number(usage.output_tokens??0),reasoning_tokens:Number(usage.reasoning_tokens??0)};
    for(const [key,value] of Object.entries(normalizedUsage)) if(!Number.isSafeInteger(value)||value<0) throw new Error(`AI_LEDGER_USAGE_INVALID:${key}`);
    const price=priceRegistry?.resolve(details.provider,details.model,now),priced=price?.ok===true,cost=priced?calculateUsageCost(normalizedUsage,price.entry):null;
    const receipt={schema_version:1,recorded_at:new Date(now).toISOString(),receipt_id:sha(`${details.provider}|${details.provider_request_id}|${details.idempotency_key}`),provider:details.provider,model:details.model,provider_request_id:details.provider_request_id,idempotency_key:details.idempotency_key,run_id:details.run_id??null,project:path.basename(project),phase:details.phase??null,unit_id:details.unit_id??null,attempt:Number(details.attempt??0),outcome:details.outcome??null,finish_reason:details.finish_reason??null,usage:normalizedUsage,usage_raw:details.usage_raw??null,token_breakdown:details.token_breakdown??{unattributed:0},pricing_status:priced?'priced':'unpriced',price_registry_version:priced?price.version:null,price_registry_fingerprint:priced?price.fingerprint:null,currency:priced?price.currency:null,final_cost_microusd:cost,request_sha256:details.request_sha256??null,response_sha256:details.response_sha256??null,quality_verdict:details.quality_verdict??null,machine_verification:details.machine_verification??null,wall_duration_ms:Math.max(0,Number(details.wall_duration_ms??0))};
    durableReplace(pendingPath(project),JSON.stringify(receipt)); const result=applyPending(project,receipt); fs.unlinkSync(pendingPath(project)); return result;
  } finally { if(lockFd!==undefined)fs.closeSync(lockFd); try{fs.unlinkSync(lock);}catch{} }
}
