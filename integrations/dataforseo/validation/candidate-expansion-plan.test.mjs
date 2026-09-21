import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildCandidateExpansionPlan} from '../lib/candidate-expansion-plan.mjs';

const seeds=['網站架設','SEO','記帳軟體','空氣清淨機','日本自由行','英文學習'];
const registry=JSON.parse(fs.readFileSync(new URL('../fixtures/provider-registry.test-snapshot.json',import.meta.url),'utf8'));
const selected=[9,10,8,5,6,9];
const shadow={mode:'offline_quality_shadow',network_dispatch:false,quality:{per_seed:Object.fromEntries(seeds.map((seed,index)=>[seed,{selected:selected[index]}]))}};
const args={shadow,seeds,registry,source_shadow_sha256:'a'.repeat(64),now:Date.parse('2026-09-15T00:00:00Z')};

test('builds an offline-only five-task proposal for deficient seeds',()=>{
  const plan=buildCandidateExpansionPlan(args);
  assert.equal(plan.decision,'AWAITING_OPERATOR_APPROVAL');
  assert.equal(plan.network_dispatch,false);
  assert.equal(plan.paid_service_activation,false);
  assert.equal(plan.requires_operator_approval,true);
  assert.equal(plan.task_count,5);
  assert.equal(plan.total_deficit,13);
  assert.equal(plan.requested_candidates,100);
  assert.equal(plan.max_microusd,72_000);
  assert.equal(plan.max_usd,0.072);
  assert.deepEqual(plan.deficits.map(item=>item.seed),['網站架設','記帳軟體','空氣清淨機','日本自由行','英文學習']);
  assert.ok(plan.requests.every(request=>request.offset===20&&request.limit===20&&request.include_serp_info===false&&request.include_clickstream_data===false));
});

test('does not propose calls when every seed is full',()=>{
  const full=structuredClone(shadow);
  for(const seed of seeds)full.quality.per_seed[seed].selected=10;
  const plan=buildCandidateExpansionPlan({...args,shadow:full});
  assert.equal(plan.decision,'NO_EXPANSION_REQUIRED');
  assert.equal(plan.task_count,0);
  assert.equal(plan.max_microusd,0);
  assert.equal(plan.requires_operator_approval,false);
});

test('fails closed on stale pricing, active provider, tampered shadow, or invalid counts',()=>{
  assert.throws(()=>buildCandidateExpansionPlan({...args,now:Date.parse('2026-09-17T00:00:00Z')}),/PRICE_SNAPSHOT_STALE/);
  assert.throws(()=>buildCandidateExpansionPlan({...args,registry:{...registry,activation:'canary'}}),/ACTIVATION_NOT_AUTHORIZED/);
  assert.throws(()=>buildCandidateExpansionPlan({...args,shadow:{...shadow,network_dispatch:true}}),/SHADOW_ARTIFACT_INVALID/);
  const invalid=structuredClone(shadow);invalid.quality.per_seed['網站架設'].selected=11;
  assert.throws(()=>buildCandidateExpansionPlan({...args,shadow:invalid}),/SELECTED_COUNT_INVALID/);
});

test('rejects unknown seeds and binds identity to source artifact',()=>{
  const unknown=structuredClone(shadow);unknown.quality.per_seed['未知主題']={selected:1};
  assert.throws(()=>buildCandidateExpansionPlan({...args,shadow:unknown}),/SHADOW_SEEDS_INVALID/);
  const first=buildCandidateExpansionPlan(args);
  const second=buildCandidateExpansionPlan({...args,source_shadow_sha256:'b'.repeat(64)});
  assert.notEqual(first.plan_sha256,second.plan_sha256);
  assert.equal(first.request_batch_sha256,second.request_batch_sha256);
});

test('caller cannot expand page size, offset, target, or add a seventh task',()=>{
  assert.throws(()=>buildCandidateExpansionPlan({...args,per_seed_limit:50}),/EXPANSION_BOUNDS_IMMUTABLE/);
  assert.throws(()=>buildCandidateExpansionPlan({...args,offset:40}),/EXPANSION_BOUNDS_IMMUTABLE/);
  assert.throws(()=>buildCandidateExpansionPlan({...args,target_per_seed:20}),/EXPANSION_BOUNDS_IMMUTABLE/);
  assert.throws(()=>buildCandidateExpansionPlan({...args,seeds:[...seeds,'第七組']}),/SEEDS_INVALID/);
});
