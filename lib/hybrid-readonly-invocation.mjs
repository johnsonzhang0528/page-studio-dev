import crypto from 'node:crypto';
import { createInvocationSpec } from './provider-contract.mjs';
import { buildReadOnlyContextBundle } from './provider-context-bundle.mjs';

const fail=(message,code='HYBRID_INVOCATION_DENIED')=>Object.assign(new Error(message),{code});
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function buildHybridReadOnlyInvocation({project,phase,unit_id,attempt=1,input_revision=0,controller_sha,policy_fingerprint,objective,context_paths,route,rollout,limits,output_schema,parent_checkpoint,run_id=crypto.randomUUID()}={}){
  if(route?.provider!=='openai'||route?.verification_mode!=='read_only'||route?.reason_code!=='TARGETED_LOW_RISK_RECHECK_LUNA')throw fail('HYBRID_ROUTE_NOT_ELIGIBLE');
  if(!['canary','active'].includes(rollout?.mode)||!['hybrid_provider','openai_adapter','hybrid_routing','quota_coordinator'].every(name=>rollout?.features?.[name]===true))throw fail('HYBRID_FEATURES_NOT_ACTIVE');
  if(!limits||!Number.isSafeInteger(limits.max_cost_microusd)||limits.max_cost_microusd<=0)throw fail('HYBRID_COST_CAP_REQUIRED');
  const context_manifest=buildReadOnlyContextBundle(project,context_paths,{max_file_bytes:limits.max_context_file_bytes??65536,max_total_bytes:limits.max_context_bytes??262144});
  const invocation_id=crypto.randomUUID(),idempotency_key=digest({run_id,phase,unit_id,attempt,input_revision,parent_checkpoint,context_sha256:context_manifest.sha256,model:route.model});
  return createInvocationSpec({schema_version:1,invocation_id,run_id,project:String(project),phase,unit_id,attempt,input_revision,controller_sha,policy_fingerprint,objective,context_manifest,allowed_write_scope:[],tool_capabilities:['filesystem_read'],network_policy:'billing_gateway_only',timeouts:{connect_ms:limits.connect_ms??5000,first_token_ms:limits.first_token_ms??30000,idle_ms:limits.idle_ms??30000,tool_ms:limits.tool_ms??30000,invocation_deadline_ms:limits.invocation_deadline_ms??120000,work_unit_deadline_ms:limits.work_unit_deadline_ms??180000},budget:{max_input_tokens:limits.max_input_tokens,max_output_tokens:limits.max_output_tokens,max_reasoning_tokens:limits.max_reasoning_tokens,max_tool_calls:1,max_api_round_trips:1,max_wall_ms:limits.max_wall_ms??120000,max_cost_microusd:limits.max_cost_microusd},output_schema,receipt_schema:{type:'object'},risk_tier:'low',required_quality_tier:'standard',verification_mode:'read_only',provider:'openai',model:route.model,reason_code:route.reason_code,fallback_policy:[],idempotency_key,parent_checkpoint});
}

export async function executeHybridReadOnlyInvocation({client,reservation_credential,spec,work_unit_budget_id,priority='P2',canary_wave='default'}={}){
  if(!client||typeof client.reserve!=='function'||typeof client.dispatch!=='function'||typeof reservation_credential!=='string'||!reservation_credential||!work_unit_budget_id)throw fail('HYBRID_CONTROL_PLANE_REQUIRED');
  const admission=await client.reserve({credential:reservation_credential,spec,work_unit_budget_id,priority,canary_wave});
  if(!admission?.reservation?.lease_id||typeof admission.credential!=='string'||!admission.credential)throw fail('HYBRID_RESERVATION_INVALID');
  return client.dispatch({credential:admission.credential,spec,spend_lease_id:admission.reservation.lease_id});
}
