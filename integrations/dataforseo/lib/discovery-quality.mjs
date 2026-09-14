const compactHanWhitespace=value=>{
  let output=value;
  while(/([\p{Script=Han}])\s+([\p{Script=Han}])/u.test(output))output=output.replace(/([\p{Script=Han}])\s+([\p{Script=Han}])/gu,'$1$2');
  return output;
};

export function canonicalKeyword(value){
  if(typeof value!=='string')return '';
  return compactHanWhitespace(value.normalize('NFKC').trim().toLocaleLowerCase('zh-TW').replace(/\s+/gu,' '));
}

const compileTerms=terms=>(terms??[]).map(term=>canonicalKeyword(term)).filter(Boolean);
const containsAny=(query,terms)=>terms.some(term=>query.includes(term));

export function classifyDiscoveryRow(row,profile={}){
  const query=canonicalKeyword(row?.query),seed=canonicalKeyword(row?.source_seed);
  if(!query||!seed)return {class:'contaminated',reason:'MISSING_QUERY_OR_SOURCE_SEED'};
  if([...query].length>200)return {class:'contaminated',reason:'QUERY_LENGTH_EXCEEDED'};
  const excludes=compileTerms(profile.exclude_terms),includes=[seed,...compileTerms(profile.include_terms)];
  if(containsAny(query,excludes))return {class:'contaminated',reason:'EXCLUDED_TOPIC_TERM'};
  if(containsAny(query,includes))return {class:'relevant',reason:query.includes(seed)?'CONTAINS_SOURCE_SEED':'CONTAINS_APPROVED_TOPIC_TERM'};
  return {class:'uncertain',reason:'NO_TOPIC_ANCHOR'};
}

export function balanceDiscoveryRows(rows,{seeds,profiles={},per_seed_quota=10,minimum_per_seed=5,maximum_contamination_ratio=0.1,maximum_duplicate_ratio=0.1,minimum_volume_coverage=0.95}={}){
  if(!Array.isArray(rows)||!Array.isArray(seeds)||!seeds.length)throw new Error('DISCOVERY_ROWS_AND_SEEDS_REQUIRED');
  if(!Number.isSafeInteger(per_seed_quota)||per_seed_quota<1)throw new Error('PER_SEED_QUOTA_INVALID');
  const canonicalSeeds=seeds.map(canonicalKeyword);
  if(canonicalSeeds.some(seed=>!seed)||new Set(canonicalSeeds).size!==canonicalSeeds.length)throw new Error('SEEDS_INVALID_OR_DUPLICATE');
  const seedLookup=new Map(canonicalSeeds.map((seed,index)=>[seed,seeds[index]]));
  const selected=[],review=[],contaminated=[],classified=[];
  let unattributedCount=0;
  const perSeed=Object.fromEntries(seeds.map(seed=>[seed,{received:0,selected:0,uncertain:0,contaminated:0}]));

  for(const row of rows){
    const sourceKey=canonicalKeyword(row?.source_seed),sourceSeed=seedLookup.get(sourceKey);
    if(!sourceSeed){unattributedCount++;contaminated.push({...row,quality_class:'contaminated',quality_reason:'UNKNOWN_SOURCE_SEED'});continue;}
    perSeed[sourceSeed].received++;
    const key=canonicalKeyword(row?.query);
    if(!key){contaminated.push({...row,quality_class:'contaminated',quality_reason:'QUERY_INVALID'});continue;}
    const classification=classifyDiscoveryRow(row,profiles[sourceSeed]);
    const enriched={...row,source_seed:sourceSeed,canonical_query:key,quality_class:classification.class,quality_reason:classification.reason};
    if(classification.class==='contaminated'){perSeed[sourceSeed].contaminated++;contaminated.push(enriched);continue;}
    classified.push(enriched);
  }

  const classRank={relevant:2,uncertain:1};
  const ordered=[...classified].sort((a,b)=>canonicalKeyword(a.query).localeCompare(canonicalKeyword(b.query),'zh-TW')||(classRank[b.quality_class]-classRank[a.quality_class])||((Number.isFinite(b.volume)?b.volume:-1)-(Number.isFinite(a.volume)?a.volume:-1))||canonicalKeyword(a.source_seed).localeCompare(canonicalKeyword(b.source_seed),'zh-TW'));
  const winners=[],seen=new Set();
  for(const row of ordered)if(!seen.has(row.canonical_query)){seen.add(row.canonical_query);winners.push(row);}
  const duplicateCount=classified.length-winners.length;
  for(const seed of seeds){
    const candidates=winners.filter(row=>row.source_seed===seed&&row.quality_class==='relevant').sort((a,b)=>((Number.isFinite(b.volume)?b.volume:-1)-(Number.isFinite(a.volume)?a.volume:-1))||a.canonical_query.localeCompare(b.canonical_query,'zh-TW'));
    selected.push(...candidates.slice(0,per_seed_quota));
    perSeed[seed].selected=Math.min(candidates.length,per_seed_quota);
    const uncertain=winners.filter(row=>row.source_seed===seed&&row.quality_class==='uncertain');
    perSeed[seed].uncertain=uncertain.length;review.push(...uncertain);
  }
  const inputCount=rows.length,contaminationRatio=inputCount?(contaminated.length/inputCount):1,duplicateRatio=inputCount?(duplicateCount/inputCount):1;
  const volumeCoverage=selected.length?selected.filter(row=>Number.isFinite(row.volume)&&row.volume>=0).length/selected.length:0;
  const kdCoverage=selected.length?selected.filter(row=>Number.isFinite(row.kd)&&row.kd>=0&&row.kd<=100).length/selected.length:0;
  const unknownIntentRows=selected.filter(row=>!['informational','commercial','transactional','navigational'].includes(row.intent)).length;
  const uncoveredSeeds=seeds.filter(seed=>perSeed[seed].selected<minimum_per_seed);
  const errors=[];
  if(unattributedCount)errors.push('UNATTRIBUTED_ROWS_PRESENT');
  if(uncoveredSeeds.length)errors.push('SEED_COVERAGE_INSUFFICIENT');
  if(contaminationRatio>maximum_contamination_ratio)errors.push('CONTAMINATION_RATIO_EXCEEDED');
  if(duplicateRatio>maximum_duplicate_ratio)errors.push('DUPLICATE_RATIO_EXCEEDED');
  if(volumeCoverage<minimum_volume_coverage)errors.push('VOLUME_COVERAGE_INSUFFICIENT');
  const needsFallback=kdCoverage<0.8;
  return {ok:errors.length===0,decision:errors.length?'HOLD_FOR_DISCOVERY_REPAIR':review.length||unknownIntentRows?'READY_WITH_MANUAL_REVIEW':needsFallback?'READY_WITH_SERP_KD_FALLBACK':'READY_FOR_SCORING',errors,required_fallbacks:needsFallback?['SERP_COMPETITION_ANALYSIS']:[],metrics:{input_rows:inputCount,selected_rows:selected.length,seed_coverage_ratio:(seeds.length-uncoveredSeeds.length)/seeds.length,contamination_ratio:contaminationRatio,duplicate_ratio:duplicateRatio,volume_coverage:volumeCoverage,kd_coverage:kdCoverage,unknown_intent_rows:unknownIntentRows,uncertain_rows:review.length,unattributed_rows:unattributedCount},per_seed:perSeed,uncovered_seeds:uncoveredSeeds,selected,manual_review:review,contaminated};
}
