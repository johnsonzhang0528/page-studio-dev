import crypto from 'node:crypto';
import {validateKeywordIdeasExpansionRequest} from './dataforseo-contract.mjs';
const fail=(code,evidence,known_microusd)=>Object.assign(new Error(code),{provider_evidence:evidence,known_microusd});
function providerCost(value){const number=Number(value);if(!Number.isFinite(number)||number<0)return null;const converted=number*1_000_000;return Number.isSafeInteger(Math.round(converted))?Math.round(converted):null;}
export async function dispatchKeywordIdeasExpansion({requests,path,lease_id,request_id,authority,client,on_task,expected_task_count=5}={}){
  if(![1,4,5].includes(expected_task_count)||!Array.isArray(requests)||requests.length!==expected_task_count)throw fail('EXPANSION_BATCH_INVALID',[],0);
  for(const [index,request] of requests.entries()){const v=validateKeywordIdeasExpansionRequest(request);if(!v.ok)throw fail(`TASK_${index}:${v.errors.join(',')}`,[],0);}
  if(typeof authority?.issue!=='function'||typeof client!=='function'||typeof on_task!=='function')throw fail('DISPATCH_DEPENDENCY_INVALID',[],0);
  const tasks=[],evidence=[];let known_microusd=0;
  for(let index=0;index<requests.length;index++){
    const body=Buffer.from(JSON.stringify([requests[index]])),body_sha256=crypto.createHash('sha256').update(body).digest('hex'),sub_request_id=`${request_id}:${index+1}`,gateway_assertion=authority.issue({request_id:sub_request_id,body_sha256,lease_id,path});
    let raw;try{raw=await client({gateway_assertion,request_id:sub_request_id,method:'POST',path,body,body_sha256,lease_id});}catch{throw fail('TRANSPORT_OUTCOME_UNKNOWN',evidence,null);}
    if(raw?.status!==200)throw fail(`HTTP_${raw?.status??'UNKNOWN'}`,evidence,null);
    let envelope;try{envelope=JSON.parse(raw.body.toString('utf8'));}catch{throw fail('PROVIDER_JSON_INVALID',evidence,null);}
    const task=Array.isArray(envelope.tasks)&&envelope.tasks.length===1?envelope.tasks[0]:null,cost=providerCost(task?.cost);
    if(cost===null)throw fail('PROVIDER_COST_INVALID',evidence,null);
    known_microusd+=cost;evidence.push({index,task_status_code:task?.status_code??null,cost_microusd:cost});
    if(envelope.status_code!==20000||task?.status_code!==20000)throw fail(`PROVIDER_TASK_${task?.status_code??envelope.status_code??'UNKNOWN'}`,evidence,known_microusd);
    tasks.push(task);
    try{await on_task({tasks:structuredClone(tasks),evidence:structuredClone(evidence),actual_microusd:known_microusd});}catch{throw fail('CHECKPOINT_WRITE_FAILED',evidence,known_microusd);}
  }
  return {envelope:{version:'expansion-single-task-v1',status_code:20000,status_message:'Ok.',tasks},actual_microusd:known_microusd,evidence};
}
