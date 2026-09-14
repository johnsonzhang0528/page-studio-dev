const modifiers=['指南','推薦','比較','價格','評價','教學','工具','免費','適合新手','常見問題'];
export function buildCalibrationCandidates(seeds,{count=60}={}){if(!Array.isArray(seeds)||!seeds.length||seeds.some(s=>typeof s!=='string'||!s.trim()))throw new Error('SEEDS_REQUIRED');const unique=[...new Set(seeds.map(s=>s.trim().normalize('NFKC')))],output=[];for(const seed of unique)for(const mod of modifiers)if(output.length<count)output.push(`${seed} ${mod}`);let i=0;while(output.length<count){output.push(`${unique[i%unique.length]} 問題 ${Math.floor(i/unique.length)+1}`);i++;}return output.slice(0,count).map(query=>({query,location_code:2158,language_code:'zh-TW',volume:null,kd:null,intent:'unknown',observed_at:null}));}

export function normalizeSeed(value){
  if(typeof value!=='string'||!value.trim())throw new Error('SEED_INVALID');
  return value.trim().normalize('NFKC').replace(/\s+/gu,' ');
}

export function buildSeedDiscoveryPlan(seeds,{per_seed_limit=20,location_code=2158,language_code='zh-TW'}={}){
  if(!Array.isArray(seeds)||!seeds.length)throw new Error('SEEDS_REQUIRED');
  if(!Number.isSafeInteger(per_seed_limit)||per_seed_limit<5||per_seed_limit>50)throw new Error('PER_SEED_LIMIT_INVALID');
  const normalized=seeds.map(normalizeSeed),folded=normalized.map(seed=>seed.toLocaleLowerCase('zh-TW'));
  if(new Set(folded).size!==folded.length)throw new Error('SEEDS_DUPLICATE');
  return normalized.map((seed,index)=>({
    source_seed:seed,
    ordinal:index,
    request:{keywords:[seed],location_code,language_code,closely_variants:false,ignore_synonyms:false,include_serp_info:false,include_clickstream_data:false,limit:per_seed_limit,filters:[['keyword_info.search_volume','>',0]],order_by:['relevance,desc'],tag:`page-autodev-seed-${index+1}`}
  }));
}
