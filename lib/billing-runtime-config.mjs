import { createPriceRegistry } from './price-registry.mjs';
import { createCapabilityRegistry } from './provider-capabilities.mjs';

const invalid=issues=>{const error=new Error(issues.join(';'));error.code='BILLING_RUNTIME_CONFIG_INVALID';error.issues=issues;throw error;};
const positive=(value)=>Number.isSafeInteger(value)&&value>0;

export function validateBillingRuntimeConfig(config,{now_ms=Date.now()}={}){
  const issues=[],policy=config?.billing_policy,controller=config?.controller_credential_policy;
  let prices=null,capabilities=null;
  try{prices=createPriceRegistry(config?.price_registry??{});}catch(error){issues.push(`PRICE_REGISTRY:${error.message}`);}
  try{capabilities=createCapabilityRegistry(config?.capability_registry??{});}catch(error){issues.push(`CAPABILITY_REGISTRY:${error.message}`);}
  if(!Number.isSafeInteger(now_ms)||now_ms<0)issues.push('INVALID_VALIDATION_TIME');
  if(!Number.isSafeInteger(policy?.uncertainty_percent)||policy.uncertainty_percent<10)issues.push('INVALID_UNCERTAINTY_PERCENT');
  if(!positive(policy?.work_unit_default))issues.push('INVALID_WORK_UNIT_DEFAULT');
  for(const [scope,windows] of Object.entries({account:policy?.account??{},...Object.fromEntries(Object.entries(policy?.project??{}).map(([name,value])=>[`project:${name}`,value])),...Object.fromEntries(Object.entries(policy?.canary??{}).map(([name,value])=>[`canary:${name}`,{cap:value}]))}))for(const [window,value] of Object.entries(windows))if(!positive(value))issues.push(`INVALID_CAP:${scope}:${window}`);
  if(!Array.isArray(controller?.accepted_generations)||controller.accepted_generations.length<1||new Set(controller.accepted_generations).size!==controller.accepted_generations.length||controller.accepted_generations.some(value=>typeof value!=='string'||!/^[A-Za-z0-9._-]{1,64}$/.test(value)))issues.push('INVALID_CONTROLLER_CREDENTIAL_GENERATIONS');
  if(!Number.isSafeInteger(controller?.revoked_before_ms)||controller.revoked_before_ms<0)issues.push('INVALID_CONTROLLER_REVOKED_BEFORE');
  if(!Number.isSafeInteger(controller?.max_ttl_ms)||controller.max_ttl_ms<60000||controller.max_ttl_ms>2592000000)issues.push('INVALID_CONTROLLER_MAX_TTL');
  if(prices&&capabilities){
    for(const item of config.capability_registry.models??[]){const resolved=prices.resolve(item.provider,item.model,new Date(now_ms));if(!resolved.ok)issues.push(`${resolved.code}:${item.provider}:${item.model}`);}
  }
  if(issues.length)invalid(issues);
  return Object.freeze({ok:true,price_registry_fingerprint:prices.fingerprint,models:config.capability_registry.models.length,controller_generations:[...controller.accepted_generations]});
}
