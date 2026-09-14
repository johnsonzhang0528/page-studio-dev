import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSeedDiscoveryPlan} from '../lib/query-candidate-builder.mjs';
import {balanceDiscoveryRows,canonicalKeyword} from '../lib/discovery-quality.mjs';

const seeds=['網站架設','SEO','記帳軟體','空氣清淨機','日本自由行','英文學習'];
const profiles=Object.fromEntries(seeds.map(seed=>[seed,{include_terms:[seed]}]));

test('discovery plan isolates every seed with an equal bounded request',()=>{
  const plan=buildSeedDiscoveryPlan(seeds,{per_seed_limit:20});
  assert.equal(plan.length,6);
  assert.deepEqual(plan.map(item=>item.request.keywords.length),[1,1,1,1,1,1]);
  assert.ok(plan.every(item=>item.request.limit===20&&item.request.include_serp_info===false&&item.request.include_clickstream_data===false));
  assert.throws(()=>buildSeedDiscoveryPlan(['SEO',' seo ']),/SEEDS_DUPLICATE/);
  assert.throws(()=>buildSeedDiscoveryPlan(seeds,{per_seed_limit:100}),/PER_SEED_LIMIT_INVALID/);
});

test('canonicalization merges spacing, width and case variants',()=>{
  assert.equal(canonicalKeyword(' SEO  網 站 優化 '),'seo 網站優化');
  assert.equal(canonicalKeyword('ＳＥＯ'),'seo');
});

test('balanced selection prevents one seed from starving the others',()=>{
  const rows=seeds.flatMap(seed=>Array.from({length:12},(_,index)=>({source_seed:seed,query:`${seed} 主題 ${index}`,volume:100-index,kd:20,intent:'informational'})));
  const result=balanceDiscoveryRows(rows,{seeds,profiles,per_seed_quota:10,minimum_per_seed:5});
  assert.equal(result.ok,true);
  assert.equal(result.selected.length,60);
  assert.ok(seeds.every(seed=>result.per_seed[seed].selected===10));
});

test('topic contamination, duplicates and unattributed rows fail closed',()=>{
  const rows=seeds.flatMap(seed=>Array.from({length:5},(_,index)=>({source_seed:seed,query:`${seed} 指南 ${index}`,volume:10,kd:20,intent:'informational'})));
  rows.push({source_seed:'網站架設',query:'網 站 架設 指南 0'});
  rows.push({source_seed:'網站架設',query:'真空泵浦',volume:390});
  rows.push({source_seed:'來源不明',query:'SEO 來源不明'});
  const strict={...profiles,'網站架設':{include_terms:['網站','網頁','架站'],exclude_terms:['真空泵浦','空壓機']}};
  const result=balanceDiscoveryRows(rows,{seeds,profiles:strict,maximum_duplicate_ratio:0,maximum_contamination_ratio:0});
  assert.equal(result.ok,false);
  assert.ok(result.errors.includes('UNATTRIBUTED_ROWS_PRESENT'));
  assert.ok(result.errors.includes('CONTAMINATION_RATIO_EXCEEDED'));
  assert.ok(result.errors.includes('DUPLICATE_RATIO_EXCEEDED'));
  assert.equal(result.contaminated.some(row=>row.query==='真空泵浦'),true);
});

test('unknown semantic relationship is held for review rather than silently accepted',()=>{
  const rows=seeds.flatMap(seed=>Array.from({length:5},(_,index)=>({source_seed:seed,query:`${seed} ${index}`,volume:10,kd:20,intent:'informational'})));
  rows.push({source_seed:'SEO',query:'排名成長方法'});
  const result=balanceDiscoveryRows(rows,{seeds,profiles});
  assert.equal(result.decision,'READY_WITH_MANUAL_REVIEW');
  assert.equal(result.manual_review.some(row=>row.query==='排名成長方法'),true);
});

test('missing seed quota blocks scoring even when total row count is high',()=>{
  const rows=Array.from({length:60},(_,index)=>({source_seed:'SEO',query:`SEO 工具 ${index}`,volume:10,kd:20,intent:'informational'}));
  const result=balanceDiscoveryRows(rows,{seeds,profiles});
  assert.equal(result.ok,false);
  assert.equal(result.metrics.seed_coverage_ratio,1/6);
  assert.ok(result.errors.includes('SEED_COVERAGE_INSUFFICIENT'));
});

test('duplicate ownership and output are invariant to provider row order',()=>{
  const base=seeds.flatMap(seed=>Array.from({length:5},(_,index)=>({source_seed:seed,query:`${seed} ${index}`,volume:10+index,kd:20,intent:'informational'})));
  base.push({source_seed:'SEO',query:'網站架設 0',volume:999,kd:1,intent:'commercial'});
  const forward=balanceDiscoveryRows(base,{seeds,profiles}),reverse=balanceDiscoveryRows([...base].reverse(),{seeds,profiles});
  assert.deepEqual(forward.selected,reverse.selected);
  assert.deepEqual(forward.metrics,reverse.metrics);
});

test('missing volume blocks scoring while missing KD requires bounded SERP fallback',()=>{
  const complete=seeds.flatMap(seed=>Array.from({length:5},(_,index)=>({source_seed:seed,query:`${seed} ${index}`,volume:10,kd:null,intent:'informational'})));
  const fallback=balanceDiscoveryRows(complete,{seeds,profiles});
  assert.equal(fallback.ok,true);
  assert.equal(fallback.decision,'READY_WITH_SERP_KD_FALLBACK');
  assert.deepEqual(fallback.required_fallbacks,['SERP_COMPETITION_ANALYSIS']);
  const missingVolume=structuredClone(complete);missingVolume[0].volume=null;missingVolume[1].volume=null;
  const held=balanceDiscoveryRows(missingVolume,{seeds,profiles});
  assert.equal(held.ok,false);
  assert.ok(held.errors.includes('VOLUME_COVERAGE_INSUFFICIENT'));
});

test('oversized and malformed queries are rejected without expensive processing',()=>{
  const rows=seeds.flatMap(seed=>Array.from({length:5},(_,index)=>({source_seed:seed,query:`${seed} ${index}`,volume:10,kd:20,intent:'informational'})));
  rows.push({source_seed:'SEO',query:'SEO'+('x'.repeat(5000)),volume:10,kd:20,intent:'informational'});
  const result=balanceDiscoveryRows(rows,{seeds,profiles,maximum_contamination_ratio:0});
  assert.equal(result.ok,false);
  assert.ok(result.contaminated.some(row=>row.quality_reason==='QUERY_LENGTH_EXCEEDED'));
});
