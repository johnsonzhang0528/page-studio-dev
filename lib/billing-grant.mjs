import crypto from 'node:crypto';

const KEYS=new Set(['schema_version','grant_id','issued_at','expires_at','project','work_unit_budget_id','priority','max_microusd','reason','nonce','signature']);
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const payload=grant=>Object.fromEntries(Object.entries(grant).filter(([key])=>key!=='signature'));
const fail=message=>{throw Object.assign(new Error(message),{code:'BILLING_GRANT_INVALID'});};

export function signBudgetGrant(input,privateKey){
  const grant={...structuredClone(input),schema_version:1};
  validateFields({...grant,signature:'pending'});
  grant.signature=crypto.sign(null,Buffer.from(JSON.stringify(stable(payload(grant)))),privateKey).toString('base64');
  return Object.freeze(grant);
}

const validateFields=grant=>{
  if(!grant||typeof grant!=='object'||Array.isArray(grant)||Object.keys(grant).some(key=>!KEYS.has(key))||Object.keys(grant).length!==KEYS.size)fail('BILLING_GRANT_SCHEMA_INVALID');
  if(grant.schema_version!==1)fail('BILLING_GRANT_VERSION_INVALID');
  for(const key of ['grant_id','issued_at','expires_at','project','work_unit_budget_id','priority','reason','nonce','signature'])if(typeof grant[key]!=='string'||!grant[key].trim())fail(`BILLING_GRANT_FIELD_INVALID:${key}`);
  if(!['P0','P1'].includes(grant.priority)||!Number.isSafeInteger(grant.max_microusd)||grant.max_microusd<=0)fail('BILLING_GRANT_LIMIT_INVALID');
  const issued=Date.parse(grant.issued_at),expires=Date.parse(grant.expires_at);if(!Number.isFinite(issued)||!Number.isFinite(expires)||expires<=issued)fail('BILLING_GRANT_WINDOW_INVALID');
  return {issued,expires};
};

export function verifyBudgetGrant(grant,{publicKey,now,project,work_unit_budget_id,priority}){
  const {issued,expires}=validateFields(grant);if(!publicKey)fail('BILLING_GRANT_KEY_REQUIRED');
  if(now<issued||now>=expires)fail('BILLING_GRANT_EXPIRED');
  if(grant.project!==project||grant.work_unit_budget_id!==work_unit_budget_id||grant.priority!==priority)fail('BILLING_GRANT_SCOPE_MISMATCH');
  let signature;try{signature=Buffer.from(grant.signature,'base64');}catch{fail('BILLING_GRANT_SIGNATURE_INVALID');}
  if(!crypto.verify(null,Buffer.from(JSON.stringify(stable(payload(grant)))),publicKey,signature))fail('BILLING_GRANT_SIGNATURE_INVALID');
  return Object.freeze({grant_id:grant.grant_id,max_microusd:grant.max_microusd,expires_at:grant.expires_at,reason:grant.reason,nonce:grant.nonce});
}
