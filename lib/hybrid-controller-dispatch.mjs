import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { buildHybridReadOnlyInvocation, executeHybridReadOnlyInvocation } from './hybrid-readonly-invocation.mjs';
import { createBillingGatewayUnixClient } from './billing-gateway-unix-client.mjs';

const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const denied=(message,code='HYBRID_CONTROLLER_DENIED')=>Object.assign(new Error(message),{code});
const gitHead=project=>{const result=spawnSync('git',['rev-parse','--verify','HEAD'],{cwd:project,encoding:'utf8'});if(result.status!==0)throw denied('HYBRID_PARENT_CHECKPOINT_UNAVAILABLE');return result.stdout.trim();};

export function readReservationCredential({credentialsDirectory=process.env.CREDENTIALS_DIRECTORY,readFile=fs.readFileSync}={}){
  if(typeof credentialsDirectory!=='string'||!path.isAbsolute(credentialsDirectory))throw denied('HYBRID_RESERVATION_CREDENTIAL_UNAVAILABLE');
  const credential=String(readFile(path.join(credentialsDirectory,'billing_reservation_credential'),'utf8')).trim();
  if(!credential||credential.length>16384)throw denied('HYBRID_RESERVATION_CREDENTIAL_INVALID');return credential;
}

export async function dispatchHybridControllerRoute({project,phase,routing,config,objective,output_schema,client=null,reservation_credential=null,controller_sha=null,parent_checkpoint=null}={}){
  if(routing?.provider!=='openai')throw denied('HYBRID_CONTROLLER_ROUTE_MISMATCH');
  const unit=routing.unit??routing.task,unitId=unit?.id??phase,limits={max_input_tokens:8000,max_output_tokens:1600,max_reasoning_tokens:2000,max_cost_microusd:250000,max_context_file_bytes:65536,max_context_bytes:262144,...config?.hybrid_provider?.limits};
  const rollout=config?.rollout_effective??config?.rollout,credential=reservation_credential??readReservationCredential();
  const contextPaths=['CLAUDE.md',...(unit?.source_files??[])].filter((value,index,array)=>typeof value==='string'&&value&&array.indexOf(value)===index&&fs.existsSync(path.join(project,value)));
  if(!contextPaths.length)throw denied('HYBRID_CONTEXT_REQUIRED');
  const checkpoint=parent_checkpoint??gitHead(project),controllerSha=controller_sha??checkpoint,policyFingerprint=digest({rollout,hybrid_provider:config.hybrid_provider,reason_code:routing.reason_code});
  const spec=buildHybridReadOnlyInvocation({project,phase,unit_id:unitId,attempt:Number(unit?.attempt??1)||1,input_revision:Number(routing.input_revision??0),controller_sha:controllerSha,policy_fingerprint:policyFingerprint,objective,context_paths:contextPaths,route:routing,rollout,limits,output_schema,parent_checkpoint:checkpoint,run_id:String(routing.run_id)});
  const gateway=client??createBillingGatewayUnixClient({socket_path:config.hybrid_provider?.billing_gateway_socket??'/run/page-autodev/billing-gateway.sock',timeout_ms:Math.min(600000,limits.invocation_deadline_ms??120000)}),started=Date.now();
  const result=await executeHybridReadOnlyInvocation({client:gateway,reservation_credential:credential,spec,work_unit_budget_id:`${routing.run_id}:${unitId}`,priority:'P2',canary_wave:String(rollout?.mode??'default')});
  if(result?.outcome!=='success'||!result.structured_output)throw denied('HYBRID_PROVIDER_RESULT_INVALID');
  return {code:0,stdout:JSON.stringify({structured_output:result.structured_output,provider_result:{invocation_id:result.invocation_id,provider_request_id:result.provider_request_id,usage:result.usage}}),stderr:'',wall_duration_ms:Number(result.wall_ms??Date.now()-started),hybrid_dispatch:true};
}
