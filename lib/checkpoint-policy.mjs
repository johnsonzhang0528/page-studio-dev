const MACHINE_AI=/^\.ai\/(?:PROJECT_STATE|TASK_GRAPH|PHASE_TASK_GRAPH|GATE_FINDINGS|GATE_CACHE|GATE_AUDIT[^/]*|INPUT_INDEX)\.json$|^\.ai\/(?:runtime|logs|telemetry|handoffs|transactions|approvals|architecture|archive)\//;
const MACHINE_RECEIPT=/^docs\/architecture\/(?:ARCHIFY_EVIDENCE\.json|diagrams\/.+\.(?:build-receipt|visual-acceptance|visual-check)\.json)$/;
const BACKUP=/(?:^|\/)(?:.+\.(?:bak|backup|orig)|.+~)$/i;
const USER_NOTES=/(^|\/)(?:user[-_ ]?notes?|notes?)(?:\.[^/]*)?$/i;

export function checkpointPathDecision(file){
  const normalized=String(file??'').replaceAll('\\','/').replace(/^\.\//,'');
  if(!normalized) return {eligible:false,reason:'empty'};
  if(MACHINE_AI.test(normalized)) return {eligible:false,reason:'machine_runtime'};
  if(MACHINE_RECEIPT.test(normalized)) return {eligible:false,reason:'machine_receipt'};
  if(normalized.endsWith('.lock')) return {eligible:false,reason:'lock'};
  if(BACKUP.test(normalized)) return {eligible:false,reason:'backup'};
  if(USER_NOTES.test(normalized)) return {eligible:false,reason:'user_notes'};
  return {eligible:true,reason:'product_change'};
}

export const checkpointEligiblePath=file=>checkpointPathDecision(file).eligible;
