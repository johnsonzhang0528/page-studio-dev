import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { appendAiInvocationReceipt } from './ai-invocation-ledger.mjs';

const number=value=>Number.isFinite(Number(value))?Number(value):0;
const sha=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const first=(object,names)=>names.find(name=>object?.[name]!==undefined);
const value=(object,names)=>{ const key=first(object,names); return key?number(object[key]):0; };
export const usageLedgerPath=project=>path.join(project,'.ai','telemetry','claude-invocations.jsonl');

export function parseClaudeInvocation(raw){
  let outer={}; try{ outer=JSON.parse(String(raw??'').trim()); }catch{}
  const top=outer.usage??{},models=Object.values(outer.modelUsage??outer.model_usage??{});
  const sum=names=>models.reduce((total,item)=>total+value(item,names),0);
  const tokens={
    input_tokens:value(top,['input_tokens','inputTokens'])||sum(['input_tokens','inputTokens']),
    cache_creation_input_tokens:value(top,['cache_creation_input_tokens','cacheCreationInputTokens'])||sum(['cache_creation_input_tokens','cacheCreationInputTokens']),
    cache_read_input_tokens:value(top,['cache_read_input_tokens','cacheReadInputTokens'])||sum(['cache_read_input_tokens','cacheReadInputTokens']),
    output_tokens:value(top,['output_tokens','outputTokens'])||sum(['output_tokens','outputTokens']),
    thinking_tokens:value(top,['thinking_tokens','thinkingTokens'])||sum(['thinking_tokens','thinkingTokens'])
  };
  const rawFingerprint=sha(raw),messageId=outer.message_id??outer.messageId??outer.uuid??outer.result?.message_id??null;
  return {message_id:messageId?String(messageId):`raw-${rawFingerprint}`,session_id:outer.session_id??outer.sessionId??null,tokens,raw_fingerprint:rawFingerprint};
}

export function appendInvocationReceipt(project,details){
  const parsed=parseClaudeInvocation(details.raw),file=usageLedgerPath(project),dir=path.dirname(file); fs.mkdirSync(dir,{recursive:true});
  const dedupeKey=sha(`${parsed.message_id}|${parsed.raw_fingerprint}`),existing=fs.existsSync(file)?fs.readFileSync(file,'utf8').split(/\r?\n/).filter(Boolean):[];
  for(const line of existing){ try{ if(JSON.parse(line).dedupe_key===dedupeKey) return {written:false,deduplicated:true,dedupe_key:dedupeKey}; }catch{} }
  const receipt={schema_version:1,recorded_at:new Date().toISOString(),dedupe_key:dedupeKey,run_id:details.run_id??null,project:path.basename(project),phase:details.phase,unit_id:details.unit_id??null,attempt:Number(details.attempt??0),model:details.model??null,effort:details.effort??null,reason_code:details.reason_code??null,outcome:details.outcome??null,exit_code:details.exit_code??null,message_id:parsed.message_id,session_id:parsed.session_id,...parsed.tokens,wall_duration_ms:Math.max(0,Number(details.wall_duration_ms??0)),active_duration_ms:Math.max(0,Number(details.active_duration_ms??details.wall_duration_ms??0)),queue_duration_ms:Math.max(0,Number(details.queue_duration_ms??0)),quota_wait_duration_ms:Math.max(0,Number(details.quota_wait_duration_ms??0)),retry_duration_ms:Math.max(0,Number(details.retry_duration_ms??0))};
  const descriptor=fs.openSync(file,'a',0o600); try{ fs.writeSync(descriptor,`${JSON.stringify(receipt)}\n`); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  return {written:true,deduplicated:false,receipt};
}

export function appendDualInvocationReceipt(project,details,options={}){
  const legacy=appendInvocationReceipt(project,details),parsed=parseClaudeInvocation(details.raw),providerRequestId=details.provider_request_id??parsed.message_id,idempotencyKey=details.idempotency_key??sha(`${details.run_id??''}|${details.phase??''}|${details.unit_id??''}|${details.attempt??0}|${providerRequestId}`);
  const neutral=appendAiInvocationReceipt(project,{provider:'claude',model:details.model??'unknown',provider_request_id:providerRequestId,idempotency_key:idempotencyKey,run_id:details.run_id,phase:details.phase,unit_id:details.unit_id,attempt:details.attempt,outcome:details.outcome,finish_reason:details.finish_reason??null,usage:{input_tokens:parsed.tokens.input_tokens+parsed.tokens.cache_creation_input_tokens,cached_input_tokens:parsed.tokens.cache_read_input_tokens,output_tokens:parsed.tokens.output_tokens,reasoning_tokens:parsed.tokens.thinking_tokens},usage_raw:parsed.tokens,token_breakdown:{direct_input:parsed.tokens.input_tokens,cache_creation_input:parsed.tokens.cache_creation_input_tokens,cached_input:parsed.tokens.cache_read_input_tokens,output:parsed.tokens.output_tokens,reasoning:parsed.tokens.thinking_tokens},wall_duration_ms:details.wall_duration_ms},options);
  return {legacy,neutral};
}
