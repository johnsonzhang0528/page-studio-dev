import crypto from 'node:crypto';
import {validateBalancedKeywordIdeasBatch} from './dataforseo-contract.mjs';

const microusd=value=>Math.round(Number(value??0)*1_000_000);
const fail=(code,evidence,known_microusd)=>Object.assign(new Error(code),{code,provider_evidence:evidence,known_microusd});

export async function dispatchBalancedKeywordIdeas({requests,path,lease_id,request_id,authority,client}={}){
  const validation=validateBalancedKeywordIdeasBatch(requests);
  if(!validation.ok)throw fail(`BALANCED_CONTRACT:${validation.errors.join(',')}`,[],0);
  if(typeof client!=='function'||typeof authority?.issue!=='function')throw fail('DISPATCH_DEPENDENCY_INVALID',[],0);
  const tasks=[],evidence=[];let known_microusd=0;
  for(let index=0;index<requests.length;index+=1){
    const body=Buffer.from(JSON.stringify([requests[index]])),body_sha256=crypto.createHash('sha256').update(body).digest('hex'),sub_request_id=`${request_id}:${index+1}`;
    const gateway_assertion=authority.issue({request_id:sub_request_id,body_sha256,lease_id,path});
    const raw=await client({gateway_assertion,request_id:sub_request_id,method:'POST',path,body,body_sha256,lease_id});
    if(raw?.status!==200)throw fail(`HTTP_${raw?.status??'UNKNOWN'}`,evidence);
    let envelope;try{envelope=JSON.parse(raw.body.toString('utf8'));}catch{throw fail('PROVIDER_JSON_INVALID',evidence);}
    const task=Array.isArray(envelope.tasks)&&envelope.tasks.length===1?envelope.tasks[0]:null,taskCost=microusd(task?.cost);
    if(!Number.isSafeInteger(taskCost)||taskCost<0)throw fail('PROVIDER_COST_INVALID',evidence);
    known_microusd+=taskCost;
    evidence.push({index,source_status_code:envelope.status_code??null,task_status_code:task?.status_code??null,task_status_message:String(task?.status_message??'').slice(0,160),cost_microusd:taskCost});
    if(envelope.status_code!==20000||!task||task.status_code!==20000)throw fail(`PROVIDER_TASK_${task?.status_code??envelope.status_code??'UNKNOWN'}`,evidence,known_microusd);
    tasks.push(task);
  }
  return Object.freeze({envelope:{version:'balanced-single-task-v1',status_code:20000,status_message:'Ok.',tasks},actual_microusd:known_microusd,evidence});
}
