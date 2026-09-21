import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {atomicExpansionArtifact} from './expansion-preflight.mjs';

// Per-query durable state for paid SERP runs.
// Invariant: a provider response that cost money is persisted to its own raw file
// (fsync + atomic rename) BEFORE the aggregate report is attempted, so a later
// query timeout, crash or restart can never lose already-paid data.

export const QUERY_STATUS=Object.freeze({
  NOT_STARTED:'NOT_STARTED',
  SETTLED:'SETTLED',                                 // paid + raw result on disk
  SETTLED_RESULT_UNRECOVERABLE:'SETTLED_RESULT_UNRECOVERABLE', // paid, raw lost, provider cannot re-serve
  UNKNOWN_HOLD:'UNKNOWN_HOLD',                       // dispatched, outcome unknown -> reconciliation only
  FAILED_BEFORE_DISPATCH:'FAILED_BEFORE_DISPATCH',   // provider never received it -> safe to retry
  FAILED_AFTER_DISPATCH:'FAILED_AFTER_DISPATCH'      // billing-ambiguous -> never auto-retry
});

// Statuses that must never trigger a new paid dispatch on resume.
const NO_REDISPATCH=new Set([
  QUERY_STATUS.SETTLED,
  QUERY_STATUS.SETTLED_RESULT_UNRECOVERABLE,
  QUERY_STATUS.UNKNOWN_HOLD,
  QUERY_STATUS.FAILED_AFTER_DISPATCH
]);

export function slugify(keyword,index){
  const hex=Buffer.from(keyword,'utf8').toString('hex').slice(0,16);
  return `${String(index+1).padStart(2,'0')}-${hex}`;
}

export class SerpRunStore{
  constructor({root,run_id}={}){
    if(typeof root!=='string'||!path.isAbsolute(root))throw new Error('RUN_STORE_ROOT_INVALID');
    if(typeof run_id!=='string'||!/^[A-Za-z0-9_-]{4,64}$/.test(run_id))throw new Error('RUN_ID_INVALID');
    this.dir=path.join(root,'serp',run_id);
    this.statePath=path.join(this.dir,'state.json');
    fs.mkdirSync(this.dir,{recursive:true,mode:0o700});
    this.state=fs.existsSync(this.statePath)
      ? JSON.parse(fs.readFileSync(this.statePath,'utf8'))
      : {schema_version:1,run_id,created_at:new Date().toISOString(),queries:{}};
  }

  #persistState(){
    this.state.updated_at=new Date().toISOString();
    atomicExpansionArtifact(this.statePath,this.state);
  }

  get(key){return this.state.queries[key]??{status:QUERY_STATUS.NOT_STARTED};}

  /** True when this query must not produce a new paid dispatch. */
  isRedispatchForbidden(key){
    const record=this.get(key);
    if(record.status===QUERY_STATUS.SETTLED)return !!record.raw_response_path&&fs.existsSync(record.raw_response_path);
    return NO_REDISPATCH.has(record.status);
  }

  /** Reusable only when paid AND the raw file is still on disk. */
  isReusable(key){
    const record=this.get(key);
    return record.status===QUERY_STATUS.SETTLED&&!!record.raw_response_path&&fs.existsSync(record.raw_response_path);
  }

  markDispatched(key,fields){
    this.state.queries[key]={...this.get(key),...fields,status:QUERY_STATUS.UNKNOWN_HOLD,started_at:new Date().toISOString()};
    this.#persistState();
  }

  /**
   * Step 1 of settlement: persist the paid provider response to its own file.
   * Must be called before ledger settle and before any aggregate work.
   */
  persistRawResponse(key,{index,keyword,envelope}){
    const file=path.join(this.dir,`${slugify(keyword,index)}.json`);
    atomicExpansionArtifact(file,envelope);
    const bytes=fs.readFileSync(file);
    const record={...this.get(key),raw_response_path:file,response_sha256:crypto.createHash('sha256').update(bytes).digest('hex'),
      provider_completed_at:new Date().toISOString()};
    this.state.queries[key]=record;
    this.#persistState();
    return record;
  }

  /** Step 2: record settlement once the ledger has settled. */
  markSettled(key,fields){
    const record=this.get(key);
    if(!record.raw_response_path||!fs.existsSync(record.raw_response_path))throw new Error('SETTLE_WITHOUT_RAW_RESULT');
    this.state.queries[key]={...record,...fields,status:QUERY_STATUS.SETTLED,settled_at:new Date().toISOString()};
    this.#persistState();
  }

  markFailed(key,{status,error,actual_microusd=null}){
    if(!Object.values(QUERY_STATUS).includes(status))throw new Error('FAIL_STATUS_INVALID');
    this.state.queries[key]={...this.get(key),status,error:String(error).slice(0,300),actual_microusd,failed_at:new Date().toISOString()};
    this.#persistState();
  }

  /** Records a query that was paid for but whose result cannot be recovered from the provider. */
  markUnrecoverable(key,{reason,actual_microusd}){
    this.state.queries[key]={...this.get(key),status:QUERY_STATUS.SETTLED_RESULT_UNRECOVERABLE,
      unrecoverable_reason:String(reason).slice(0,300),actual_microusd,recorded_at:new Date().toISOString()};
    this.#persistState();
  }

  summary(){
    const counts={};
    for(const record of Object.values(this.state.queries))counts[record.status]=(counts[record.status]??0)+1;
    return {run_id:this.state.run_id,dir:this.dir,counts,queries:this.state.queries};
  }
}
