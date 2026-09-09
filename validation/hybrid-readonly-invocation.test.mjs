import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildHybridReadOnlyInvocation,executeHybridReadOnlyInvocation } from '../lib/hybrid-readonly-invocation.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'hybrid-readonly-'));
try{
  fs.mkdirSync(path.join(root,'docs'));fs.writeFileSync(path.join(root,'docs','finding.md'),'verify mapping');
  const rollout={mode:'canary',features:{hybrid_provider:true,openai_adapter:true,hybrid_routing:true,quota_coordinator:true}},route={provider:'openai',model:'gpt-5.6-luna',verification_mode:'read_only',reason_code:'TARGETED_LOW_RISK_RECHECK_LUNA'},limits={max_input_tokens:1000,max_output_tokens:200,max_reasoning_tokens:100,max_cost_microusd:1000},output_schema={type:'object',required:['outcome'],properties:{outcome:{type:'string'}},additionalProperties:false};
  const spec=buildHybridReadOnlyInvocation({project:root,phase:'architecture_gate',unit_id:'GF-1',controller_sha:'controller',policy_fingerprint:'policy',objective:'verify one finding',context_paths:['docs/finding.md'],route,rollout,limits,output_schema,parent_checkpoint:'checkpoint'});
  assert.equal(spec.provider,'openai');assert.equal(spec.model,'gpt-5.6-luna');assert.equal(spec.verification_mode,'read_only');assert.deepEqual(spec.allowed_write_scope,[]);assert.equal(spec.budget.max_api_round_trips,1);assert.equal(spec.context_manifest.files.length,1);
  const calls=[],client={async reserve(input){calls.push(['reserve',input]);return {reservation:{lease_id:'lease'},credential:'dispatch-token'};},async dispatch(input){calls.push(['dispatch',input]);return {outcome:'success'};}};
  assert.deepEqual(await executeHybridReadOnlyInvocation({client,reservation_credential:'reserve-token',spec,work_unit_budget_id:'GF-1'}),{outcome:'success'});assert.deepEqual(calls.map(row=>row[0]),['reserve','dispatch']);assert.equal(calls[1][1].spend_lease_id,'lease');
  assert.throws(()=>buildHybridReadOnlyInvocation({project:root,phase:'qa',unit_id:'QA',controller_sha:'x',policy_fingerprint:'x',objective:'x',context_paths:['docs/finding.md'],route:{...route,provider:'anthropic'},rollout,limits,output_schema,parent_checkpoint:'x'}),error=>error.code==='HYBRID_INVOCATION_DENIED');
  assert.throws(()=>buildHybridReadOnlyInvocation({project:root,phase:'qa',unit_id:'QA',controller_sha:'x',policy_fingerprint:'x',objective:'x',context_paths:['docs/finding.md'],route,rollout:{...rollout,mode:'shadow'},limits,output_schema,parent_checkpoint:'x'}),error=>error.code==='HYBRID_INVOCATION_DENIED');
  let dispatches=0;await assert.rejects(executeHybridReadOnlyInvocation({client:{async reserve(){return {};},async dispatch(){dispatches+=1;}},reservation_credential:'reserve-token',spec,work_unit_budget_id:'GF-1'}),error=>error.code==='HYBRID_INVOCATION_DENIED');assert.equal(dispatches,0);
}finally{fs.rmSync(root,{recursive:true,force:true});}
console.log('HYBRID_READONLY_INVOCATION_TESTS_OK');
