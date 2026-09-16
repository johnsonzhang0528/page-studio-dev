export function validateCanaryApproval({approval,mode,uid,now=Date.now(),expected}={}){
  if(mode!==0o600||uid!==0)throw new Error('CANARY_APPROVAL_PERMISSIONS');
  const allowed=new Set(['schema_version','approval_id','expires_at','keyword','location_code','language_code','max_microusd']);
  if(Object.keys(approval).some(k=>!allowed.has(k))||approval.schema_version!==1||!/^canary-[a-f0-9]{16}$/.test(approval.approval_id)||Date.parse(approval.expires_at)<=now||Date.parse(approval.expires_at)>now+15*60*1000||approval.keyword!==expected.keyword||approval.location_code!==2158||approval.language_code!=='zh-TW'||approval.max_microusd!==12120)throw new Error('CANARY_APPROVAL_SCOPE');
  return Object.freeze(structuredClone(approval));
}

export function validateCalibrationApproval({approval,mode,uid,now=Date.now(),expected_query_set_sha256}={}){
  if(mode!==0o600||uid!==0)throw new Error('CALIBRATION_APPROVAL_PERMISSIONS');
  const allowed=new Set(['schema_version','approval_id','expires_at','query_set_sha256','query_count','max_microusd']);
  if(Object.keys(approval??{}).some(key=>!allowed.has(key))||approval?.schema_version!==1||!/^calibration-[a-f0-9]{16}$/.test(approval.approval_id)||Date.parse(approval.expires_at)<=now||Date.parse(approval.expires_at)>now+15*60*1000||approval.query_set_sha256!==expected_query_set_sha256||approval.query_count!==60||approval.max_microusd!==19200)throw new Error('CALIBRATION_APPROVAL_SCOPE');
  return Object.freeze(structuredClone(approval));
}

export function validateBalancedCalibrationApproval({approval,mode,uid,now=Date.now(),expected_request_plan_sha256}={}){
  if(mode!==0o600||uid!==0)throw new Error('BALANCED_CALIBRATION_APPROVAL_PERMISSIONS');
  const allowed=new Set(['schema_version','approval_id','expires_at','request_plan_sha256','seed_count','per_seed_limit','max_microusd']);
  if(Object.keys(approval??{}).some(key=>!allowed.has(key))||approval?.schema_version!==2||!/^calibration-[a-f0-9]{16}$/.test(approval.approval_id)||Date.parse(approval.expires_at)<=now||Date.parse(approval.expires_at)>now+15*60*1000||approval.request_plan_sha256!==expected_request_plan_sha256||approval.seed_count!==6||approval.per_seed_limit!==20||approval.max_microusd!==86400)throw new Error('BALANCED_CALIBRATION_APPROVAL_SCOPE');
  return Object.freeze(structuredClone(approval));
}

export function validateExpansionApproval({approval,mode,uid,now=Date.now(),expected_plan_sha256,expected_request_batch_sha256}={}){
  if(mode!==0o600||uid!==0)throw new Error('EXPANSION_APPROVAL_PERMISSIONS');
  const allowed=new Set(['schema_version','approval_id','expires_at','plan_sha256','request_batch_sha256','task_count','offset','per_seed_limit','max_microusd']);
  if(Object.keys(approval??{}).some(key=>!allowed.has(key))||approval?.schema_version!==1||!/^expansion-[a-f0-9]{16}$/.test(approval.approval_id)||Date.parse(approval.expires_at)<=now||Date.parse(approval.expires_at)>now+15*60*1000||approval.plan_sha256!==expected_plan_sha256||approval.request_batch_sha256!==expected_request_batch_sha256||approval.task_count!==5||approval.offset!==20||approval.per_seed_limit!==20||approval.max_microusd!==72000)throw new Error('EXPANSION_APPROVAL_SCOPE');
  return Object.freeze(structuredClone(approval));
}

export function validateNicheKeywordApproval({approval,mode,uid,now=Date.now(),expected_source_plan_sha256,expected_request_plan_sha256}={}){
  if(mode!==0o600||uid!==0)throw new Error('NICHE_APPROVAL_PERMISSIONS');
  const allowed=new Set(['schema_version','approval_id','expires_at','source_plan_sha256','request_plan_sha256','task_count','per_task_limit','max_microusd']);
  if(Object.keys(approval??{}).some(key=>!allowed.has(key))||approval?.schema_version!==1||!/^niche-keywords-[a-f0-9]{16}$/.test(approval.approval_id)||Date.parse(approval.expires_at)<=now||Date.parse(approval.expires_at)>now+15*60*1000||approval.source_plan_sha256!==expected_source_plan_sha256||approval.request_plan_sha256!==expected_request_plan_sha256||approval.task_count!==10||approval.per_task_limit!==20||approval.max_microusd!==144000)throw new Error('NICHE_APPROVAL_SCOPE');
  return Object.freeze(structuredClone(approval));
}
