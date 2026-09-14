import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dispatchHybridControllerRoute,readReservationCredential } from '../lib/hybrid-controller-dispatch.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'hybrid-controller-'));fs.writeFileSync(path.join(root,'CLAUDE.md'),'bounded context');fs.mkdirSync(path.join(root,'docs','requirements'),{recursive:true});fs.writeFileSync(path.join(root,'docs','requirements','REQUIREMENTS.md'),'requirements authority');fs.writeFileSync(path.join(root,'docs','PRD.md'),'prd authority');
const routing={provider:'openai',model:'gpt-5.6-luna',verification_mode:'read_only',reason_code:'TARGETED_LOW_RISK_RECHECK_LUNA',run_id:'run-1',input_revision:2,unit:{id:'GF-1',attempt:1}};
const config={rollout_effective:{mode:'canary',features:{hybrid_provider:true,openai_adapter:true,hybrid_routing:true,quota_coordinator:true}},hybrid_provider:{limits:{max_input_tokens:1000,max_output_tokens:200,max_reasoning_tokens:100,max_cost_microusd:1000}}};
try{
  let calls=0,lastReserve=null;const client={async reserve(input){calls++;lastReserve=input;assert.equal(input.credential,'reserve');return {reservation:{lease_id:'lease-1'},credential:'dispatch'};},async dispatch(input){calls++;assert.equal(input.spend_lease_id,'lease-1');return {invocation_id:input.spec.invocation_id,outcome:'success',structured_output:{outcome:'pass',summary:'ok',evidence:[],blocker:null},provider_request_id:'provider-1',usage:{input_tokens:1,cached_input_tokens:0,output_tokens:1,reasoning_tokens:0},wall_ms:2};}};
  const result=await dispatchHybridControllerRoute({project:root,phase:'requirements_gate',routing,config,objective:'verify',output_schema:{type:'object'},client,reservation_credential:'reserve',controller_sha:'controller',parent_checkpoint:'checkpoint'});assert.equal(result.code,0);assert.equal(JSON.parse(result.stdout).structured_output.outcome,'pass');assert.equal(calls,2);assert.equal(lastReserve.canary_wave,'wave-a');assert.equal(lastReserve.spec.attempt,2);assert.deepEqual(lastReserve.spec.context_manifest.files.map(file=>file.path),['CLAUDE.md','docs/PRD.md','docs/requirements/REQUIREMENTS.md']);assert.ok(lastReserve.spec.budget.max_input_tokens>=lastReserve.spec.context_manifest.total_bytes);
  let deniedCalls=0;await assert.rejects(dispatchHybridControllerRoute({project:root,phase:'architecture_gate',routing,config:{...config,rollout_effective:{...config.rollout_effective,mode:'shadow'}},objective:'verify',output_schema:{type:'object'},client:{async reserve(){deniedCalls++;}},reservation_credential:'reserve',controller_sha:'controller',parent_checkpoint:'checkpoint'}));assert.equal(deniedCalls,0);
  assert.throws(()=>readReservationCredential({credentialsDirectory:'relative',readFile(){return 'x';}}),error=>error.code==='HYBRID_CONTROLLER_DENIED');
}finally{fs.rmSync(root,{recursive:true,force:true});}
console.log('HYBRID_CONTROLLER_DISPATCH_TESTS_OK');
