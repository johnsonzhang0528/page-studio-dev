import crypto from 'node:crypto';

const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const sha=value=>crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const RATE_KEYS=['uncached_input_microusd_per_million','cached_input_microusd_per_million','output_microusd_per_million','reasoning_microusd_per_million'];

export function createPriceRegistry({version,currency='USD',effective_at,expires_at,source,models}){
  if(!Number.isSafeInteger(version)||version<1) throw new Error('INVALID_PRICE_REGISTRY_VERSION');
  if(currency!=='USD') throw new Error('UNSUPPORTED_PRICE_CURRENCY');
  const effective=Date.parse(effective_at),expires=Date.parse(expires_at); if(!Number.isFinite(effective)||!Number.isFinite(expires)||expires<=effective) throw new Error('INVALID_PRICE_WINDOW');
  if(typeof source!=='string'||!source.trim()||!Array.isArray(models)||!models.length) throw new Error('INVALID_PRICE_REGISTRY');
  const index=new Map();
  for(const item of models){ const key=`${item?.provider}:${item?.model}`; if(!item?.provider||!item?.model||index.has(key)) throw new Error(`INVALID_PRICE_ENTRY:${key}`); for(const rate of RATE_KEYS) if(!Number.isSafeInteger(item[rate])||item[rate]<0) throw new Error(`INVALID_PRICE_RATE:${key}:${rate}`); index.set(key,Object.freeze(structuredClone(item))); }
  const document={version,currency,effective_at:new Date(effective).toISOString(),expires_at:new Date(expires).toISOString(),source,models:structuredClone(models)};
  return Object.freeze({...document,fingerprint:sha(document),resolve(provider,model,at=new Date()){ const timestamp=new Date(at).getTime(); if(timestamp<effective||timestamp>=expires) return {ok:false,code:'PRICE_REGISTRY_STALE'}; const entry=index.get(`${provider}:${model}`); return entry?{ok:true,entry,version,fingerprint:sha(document),currency}:{ok:false,code:'PRICE_MODEL_UNKNOWN'}; }});
}

export function calculateUsageCost(usage,price){
  const pairs=[['input_tokens','uncached_input_microusd_per_million'],['cached_input_tokens','cached_input_microusd_per_million'],['output_tokens','output_microusd_per_million'],['reasoning_tokens','reasoning_microusd_per_million']];
  let total=0n; for(const [tokenKey,rateKey] of pairs){ const tokens=Number(usage?.[tokenKey]??0),rate=price[rateKey]; if(!Number.isSafeInteger(tokens)||tokens<0) throw new Error(`INVALID_USAGE_FOR_PRICING:${tokenKey}`); if(!Number.isSafeInteger(rate)||rate<0) throw new Error(`INVALID_RATE_FOR_PRICING:${rateKey}`); const product=BigInt(tokens)*BigInt(rate); total+=(product+999_999n)/1_000_000n; }
  if(total>BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('PRICE_CALCULATION_OVERFLOW'); return Number(total);
}
