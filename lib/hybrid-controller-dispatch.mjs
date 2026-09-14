import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { buildHybridReadOnlyInvocation, executeHybridReadOnlyInvocation } from './hybrid-readonly-invocation.mjs';
import { createBillingGatewayUnixClient } from './billing-gateway-unix-client.mjs';

const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const denied=(message,code='HYBRID_CONTROLLER_DENIED')=>Object.assign(new Error(message),{code});
const gitHead=project=>{const result=spawnSync('git',['rev-parse','--verify','HEAD'],{cwd:project,encoding:'utf8'});if(result.status!==0)throw denied('HYBRID_PARENT_CHECKPOINT_UNAVAILABLE');return result.stdout.trim();};
const phaseAuthorityFiles={requirements_gate:['docs/requirements/REQUIREMENTS.md','docs/PRD.md']};

export function readReservationCredential({credentialsDirectory=process.env.CREDENTIALS_DIRECTORY,readFile=fs.readFileSync}={}){
  if(typeof credentialsDirectory!=='string'||!path.isAbsolute(credentialsDirectory))throw denied('HYBRID_RESERVATION_CREDENTIAL_UNAVAILABLE');
  const credential=String(readFile(path.join(credentialsDirectory,'billing_reservation_credential'),'utf8')).trim();
  if(!credential||credential.length>16384)throw denied('HYBRID_RESERVATION_CREDENTIAL_INVALID');return credential;
}

export async function dispatchHybridControllerRoute({project,phase,routing,config,objective,output_schema,client=null,reservation_credential=null,controller_sha=null,parent_checkpoint=null}={}){
  if(routing?.provider!=='openai')throw denied('HYBRID_CONTROLLER_ROUTE_MISMATCH');
  const unit=routing.unit??routing.task,unitId=unit?.id??phase,limits={max_input_tokens:8000,max_output_tokens:1600,max_reasoning_tokens:2000,max_cost_microusd:250000,max_context_file_bytes:65536,max_context_bytes:262144,...config?.hybrid_provider?.limits};
  const rollout=config?.rollout_effective??config?.rollout,credential=reservation_credential??readReservationCredential();
  const contextPaths=['CLAUDE.md',...(phaseAuthorityFiles[phase]??[]),...(unit?.source_files??[])].filter((value,index,array)=>typeof value==='string'&&value&&array.indexOf(value)===index&&fs.existsSync(path.join(project,value)));
  if(!contextPaths.length)throw denied('HYBRID_CONTEXT_REQUIRED');
  const contextSizes=contextPaths.map(relative=>fs.statSync(path.join(project,relative)).size),contextBytes=contextSizes.reduce((sum,size)=>sum+size,0);
  limits.max_context_file_bytes=Math.max(limits.max_context_file_bytes??0,...contextSizes);
  limits.max_input_tokens=Math.max(limits.max_input_tokens??0,contextBytes);
  const checkpoint=parent_checkpoint??gitHead(project),controllerSha=controller_sha??checkpoint,policyFingerprint=digest({rollout,hybrid_provider:config.hybrid_provider,reason_code:routing.reason_code});
  const storedAttempt=Number(unit?.attempt??0),attempt=Number.isSafeInteger(storedAttempt)&&storedAttempt>=0?storedAttempt+1:1;
  const spec=buildHybridReadOnlyInvocation({project,phase,unit_id:unitId,attempt,input_revision:Number(routing.input_revision??0),controller_sha:controllerSha,policy_fingerprint:policyFingerprint,objective,context_paths:contextPaths,route:routing,rollout,limits,output_schema,parent_checkpoint:checkpoint,run_id:String(routing.run_id)});
  const gateway=client??createBillingGatewayUnixClient({socket_path:config.hybrid_provider?.billing_gateway_socket??'/run/page-autodev/billing-gateway.sock',timeout_ms:Math.min(600000,limits.invocation_deadline_ms??120000)}),started=Date.now();
  // The rollout activation state (canary/active) is not a billing wave id.
  // Use the explicitly configured credential generation; production currently
  // mints controller credentials and caps under wave-a.
  const canaryWave=String(config?.hybrid_provider?.canary_wave??'wave-a');
  // A materially new input revision is a new budgeted work unit. Historical
  // spend remains in project/account windows, but must not consume the per-unit
  // retry cap of a later document revision.
  const workUnitBudgetId=`${routing.run_id}:${unitId}:r${spec.input_revision}`;
  const result=await executeHybridReadOnlyInvocation({client:gateway,reservation_credential:credential,spec,work_unit_budget_id:workUnitBudgetId,priority:'P2',canary_wave:canaryWave});
  if(result?.outcome!=='success'||!result.structured_output)throw denied('HYBRID_PROVIDER_RESULT_INVALID');
  return {code:0,stdout:JSON.stringify({structured_output:result.structured_output,provider_result:{invocation_id:result.invocation_id,provider_request_id:result.provider_request_id,usage:result.usage}}),stderr:'',wall_duration_ms:Number(result.wall_ms??Date.now()-started),hybrid_dispatch:true};
}
