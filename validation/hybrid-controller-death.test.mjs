import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dispatchHybridControllerRoute,readReservationCredential } from '../lib/hybrid-controller-dispatch.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'hybrid-controller-death-'));fs.writeFileSync(path.join(root,'CLAUDE.md'),'safe');
const route={provider:'openai',model:'gpt-5.6-luna',verification_mode:'read_only',reason_code:'TARGETED_LOW_RISK_RECHECK_LUNA',run_id:'run-death',input_revision:1,unit:{id:'GF-DEATH',attempt:1}};
const rollout={mode:'canary',features:{hybrid_provider:true,openai_adapter:true,hybrid_routing:true,quota_coordinator:true}};
const limits={max_input_tokens:100,max_output_tokens:50,max_reasoning_tokens:50,max_cost_microusd:1000};let networkCalls=0;
const neverClient={async reserve(){networkCalls++;throw new Error('NETWORK_MUST_NOT_RUN');},async dispatch(){networkCalls++;throw new Error('NETWORK_MUST_NOT_RUN');}};
const invoke=(routing=route,config={rollout_effective:rollout,hybrid_provider:{limits}})=>dispatchHybridControllerRoute({project:root,phase:'architecture_gate',routing,config,objective:'verify',output_schema:{type:'object'},client:neverClient,reservation_credential:'reserve',controller_sha:'controller',parent_checkpoint:'checkpoint'});
try{
  const reject=async(id,name,promise)=>{await assert.rejects(promise);console.log(`DEATH_EVIDENCE ${id} ${name}`);};
  await reject('DT-062','shadow_route_dispatch',invoke(route,{rollout_effective:{...rollout,mode:'shadow'},hybrid_provider:{limits}}));
  await reject('DT-063','write_capable_route',invoke({...route,verification_mode:'isolated_write'}));
  await reject('DT-064','untrusted_reason_code',invoke({...route,reason_code:'UNTRUSTED_ROUTE'}));
  await reject('DT-065','invalid_cost_limit',invoke(route,{rollout_effective:rollout,hybrid_provider:{limits:{...limits,max_cost_microusd:0}}}));
  fs.renameSync(path.join(root,'CLAUDE.md'),path.join(root,'MISSING.md'));await reject('DT-066','missing_context_source',invoke());fs.renameSync(path.join(root,'MISSING.md'),path.join(root,'CLAUDE.md'));
  assert.throws(()=>readReservationCredential({credentialsDirectory:undefined}),error=>error.code==='HYBRID_CONTROLLER_DENIED');console.log('DEATH_EVIDENCE DT-067 missing_reservation_credential');
  let dispatches=0;await assert.rejects(dispatchHybridControllerRoute({project:root,phase:'architecture_gate',routing:route,config:{rollout_effective:rollout,hybrid_provider:{limits}},objective:'verify',output_schema:{type:'object'},client:{async reserve(){return {};},async dispatch(){dispatches++;}},reservation_credential:'reserve',controller_sha:'controller',parent_checkpoint:'checkpoint'}));assert.equal(dispatches,0);console.log('DEATH_EVIDENCE DT-068 malformed_reservation_response');
  assert.equal(networkCalls,0);
}finally{fs.rmSync(root,{recursive:true,force:true});}
console.log('HYBRID_CONTROLLER_DEATH_TESTS_OK cases=7');
