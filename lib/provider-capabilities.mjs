import crypto from 'node:crypto';

const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const sha=value=>crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const REQUIRED_CAPABILITIES=['structured_output','tool_loop','cancellation','usage_receipt','read_only','isolated_write'];

export function createCapabilityRegistry({version,models}){
  if(!Number.isSafeInteger(version)||version<1) throw new Error('INVALID_CAPABILITY_REGISTRY_VERSION');
  if(!Array.isArray(models)||!models.length) throw new Error('CAPABILITY_MODELS_REQUIRED');
  const index=new Map();
  for(const entry of models){
    if(!entry||typeof entry.provider!=='string'||typeof entry.model!=='string'||!entry.snapshot||!entry.capabilities) throw new Error('INVALID_CAPABILITY_ENTRY');
    const key=`${entry.provider}:${entry.model}`; if(index.has(key)) throw new Error(`DUPLICATE_CAPABILITY_ENTRY:${key}`);
    const normalized=structuredClone(entry); normalized.fingerprint=sha({version,...normalized}); index.set(key,Object.freeze(normalized));
  }
  return Object.freeze({version,fingerprint:sha({version,models}),resolve(provider,model){ return index.get(`${provider}:${model}`)??null; }});
}

export function authorizeCapability(registry,{provider,model,required=[]}){
  const entry=registry.resolve(provider,model); if(!entry) return {ok:false,code:'UNKNOWN_PROVIDER_CAPABILITY',missing:required};
  const unknown=required.filter(name=>!REQUIRED_CAPABILITIES.includes(name)); if(unknown.length) return {ok:false,code:'UNKNOWN_REQUIRED_CAPABILITY',missing:unknown};
  const missing=required.filter(name=>entry.capabilities[name]!==true);
  return {ok:missing.length===0,code:missing.length?'CAPABILITY_MISMATCH':'CAPABILITY_AUTHORIZED',missing,entry};
}
