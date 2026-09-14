import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildBalancedCalibrationApprovalPlan} from '../lib/balanced-calibration-plan.mjs';

const seeds=JSON.parse(fs.readFileSync(new URL('../fixtures/taiwan-zhtw-calibration-seeds.json',import.meta.url),'utf8'));
const registry=JSON.parse(fs.readFileSync(new URL('../fixtures/provider-registry.json',import.meta.url),'utf8'));

test('plan is deterministic, offline and produces an exactly scoped approval template',()=>{
  const first=buildBalancedCalibrationApprovalPlan({seeds,registry,now:0}),second=buildBalancedCalibrationApprovalPlan({seeds,registry,now:0});
  assert.deepEqual(first,second);assert.equal(first.network_dispatch,false);assert.equal(first.paid_service_activation,false);
  assert.equal(first.seed_count,6);assert.equal(first.raw_candidate_limit,120);assert.equal(first.balanced_output_limit,60);assert.equal(first.max_microusd,86400);assert.match(first.request_plan_sha256,/^[a-f0-9]{64}$/);assert.equal(first.approval_template.request_plan_sha256,first.request_plan_sha256);
});

test('seed mutation changes approval identity and duplicate seeds fail closed',()=>{
  const original=buildBalancedCalibrationApprovalPlan({seeds,registry,now:0}),changed=buildBalancedCalibrationApprovalPlan({seeds:[...seeds.slice(0,5),'德文學習'],registry,now:0});
  assert.notEqual(original.request_plan_sha256,changed.request_plan_sha256);
  assert.throws(()=>buildBalancedCalibrationApprovalPlan({seeds:['SEO',' seo '],registry,now:0}),/SEEDS_DUPLICATE/);
});
