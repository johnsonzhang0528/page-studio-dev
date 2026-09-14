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
  assert.equal(spec.project,path.basename(root),'Billing project identity must be the stable project id, not an absolute checkout path');assert.equal(spec.provider,'openai');assert.equal(spec.model,'gpt-5.6-luna');assert.equal(spec.verification_mode,'read_only');assert.deepEqual(spec.allowed_write_scope,[]);assert.equal(spec.budget.max_api_round_trips,1);assert.equal(spec.context_manifest.files.length,1);
  const identityArgs={project:root,phase:'architecture_gate',unit_id:'GF-1',attempt:1,input_revision:1,controller_sha:'controller',policy_fingerprint:'policy',context_paths:['docs/finding.md'],route,rollout,limits,output_schema,parent_checkpoint:'checkpoint',run_id:'run-1'};
  const sameA=buildHybridReadOnlyInvocation({...identityArgs,objective:'verify one finding'}),sameB=buildHybridReadOnlyInvocation({...identityArgs,objective:'verify one finding'}),changedObjective=buildHybridReadOnlyInvocation({...identityArgs,objective:'verify one finding and return finding_results'}),changedSchema=buildHybridReadOnlyInvocation({...identityArgs,objective:'verify one finding',output_schema:{...output_schema,required:['outcome','finding_results']}});
  assert.equal(sameA.idempotency_key,sameB.idempotency_key,'相同完整請求必須維持相同 idempotency key');assert.notEqual(sameA.idempotency_key,changedObjective.idempotency_key,'提示契約變更必須產生新的 billing identity');assert.notEqual(sameA.idempotency_key,changedSchema.idempotency_key,'輸出 schema 變更必須產生新的 billing identity');
  const calls=[],client={async reserve(input){calls.push(['reserve',input]);return {reservation:{lease_id:'lease'},credential:'dispatch-token'};},async dispatch(input){calls.push(['dispatch',input]);return {outcome:'success'};}};
  assert.deepEqual(await executeHybridReadOnlyInvocation({client,reservation_credential:'reserve-token',spec,work_unit_budget_id:'GF-1'}),{outcome:'success'});assert.deepEqual(calls.map(row=>row[0]),['reserve','dispatch']);assert.equal(calls[1][1].spend_lease_id,'lease');
  assert.throws(()=>buildHybridReadOnlyInvocation({project:root,phase:'qa',unit_id:'QA',controller_sha:'x',policy_fingerprint:'x',objective:'x',context_paths:['docs/finding.md'],route:{...route,provider:'anthropic'},rollout,limits,output_schema,parent_checkpoint:'x'}),error=>error.code==='HYBRID_INVOCATION_DENIED');
  assert.throws(()=>buildHybridReadOnlyInvocation({project:root,phase:'qa',unit_id:'QA',controller_sha:'x',policy_fingerprint:'x',objective:'x',context_paths:['docs/finding.md'],route,rollout:{...rollout,mode:'shadow'},limits,output_schema,parent_checkpoint:'x'}),error=>error.code==='HYBRID_INVOCATION_DENIED');
  let dispatches=0;await assert.rejects(executeHybridReadOnlyInvocation({client:{async reserve(){return {};},async dispatch(){dispatches+=1;}},reservation_credential:'reserve-token',spec,work_unit_budget_id:'GF-1'}),error=>error.code==='HYBRID_INVOCATION_DENIED');assert.equal(dispatches,0);
}finally{fs.rmSync(root,{recursive:true,force:true});}
console.log('HYBRID_READONLY_INVOCATION_TESTS_OK');
