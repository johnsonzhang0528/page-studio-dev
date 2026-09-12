export function validateCanaryApproval({approval,mode,uid,now=Date.now(),expected}={}){
  if(mode!==0o600||uid!==0)throw new Error('CANARY_APPROVAL_PERMISSIONS');
  const allowed=new Set(['schema_version','approval_id','expires_at','keyword','location_code','language_code','max_microusd']);
  if(Object.keys(approval).some(k=>!allowed.has(k))||approval.schema_version!==1||!/^canary-[a-f0-9]{16}$/.test(approval.approval_id)||Date.parse(approval.expires_at)<=now||Date.parse(approval.expires_at)>now+15*60*1000||approval.keyword!==expected.keyword||approval.location_code!==2158||approval.language_code!=='zh-TW'||approval.max_microusd!==12120)throw new Error('CANARY_APPROVAL_SCOPE');
  return Object.freeze(structuredClone(approval));
}
