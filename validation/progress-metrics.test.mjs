import assert from 'node:assert/strict';
import { computeProgressMetrics } from '../lib/progress-metrics.mjs';

const phases=['planning','planning_gate','implementation','implementation_gate','qa','release_gate'],weights={planning:10,planning_gate:0,implementation:70,implementation_gate:10,qa:8,release_gate:2},taskGraph={tasks:[{id:'A',status:'done'},{id:'B',status:'ready'},{id:'C',status:'blocked'},{id:'REQ-1',status:'complete'}]},phaseGraph={phases:{implementation:{units:[{id:'A',status:'complete'},{id:'B',status:'ready'},{id:'C',status:'blocked'}]}}},state={phase:'implementation',status:'running',product_percent:99,workflow_percent:99,release_confidence_percent:99};
const metrics=computeProgressMetrics({state,phaseGraph,taskGraph,phases,weights}); assert.equal(metrics.product_percent,33); assert.equal(metrics.workflow_percent,33); assert.equal(metrics.release_confidence_percent,27); assert.equal(metrics.verification.percent,33);
const stale=computeProgressMetrics({state:{phase:'planning',status:'running',product_percent:100},phaseGraph:{phases:{}},taskGraph,phases,weights}); assert.equal(stale.product_percent,0); assert.equal(stale.release_confidence_percent,0,'planning Gate 尚未通過時不得沿用舊 TASK_GRAPH');
assert.equal(computeProgressMetrics({state:{...state,phase:'implementation_gate'},phaseGraph:{phases:{implementation_gate:{units:[{status:'complete'},{status:'ready'}]}}},taskGraph,phases,weights}).release_confidence_percent,32);
assert.deepEqual(computeProgressMetrics({state:{phase:'complete',status:'complete'},phaseGraph:{},taskGraph:{},phases,weights}),{product_percent:100,workflow_percent:100,current_phase_percent:100,journey_percent:100,is_rework:false,furthest_phase:'complete',release_confidence_percent:100,phase_fraction:1,verification:{done:0,total:0,percent:100}});
const rework=computeProgressMetrics({state:{phase:'planning',status:'repairing',history:[{phase:'implementation',outcome:'failed'}]},phaseGraph:{phases:{planning:{units:[{status:'ready'}]}}},taskGraph,phases,weights});
assert.equal(rework.workflow_percent,10,'定點返修時整體旅程不得從已抵達位置倒退');
assert.equal(rework.current_phase_percent,0);
assert.equal(rework.is_rework,true);
assert.equal(rework.furthest_phase,'implementation');
const futurePlan=computeProgressMetrics({state:{phase:'planning',status:'running'},phaseGraph:{phases:{release_gate:{units:[{status:'ready'}]}}},taskGraph,phases,weights});
assert.equal(futurePlan.workflow_percent,0,'預先建立但尚未開始的未來計畫不得虛增整體旅程');
assert.equal(futurePlan.is_rework,false);
console.log('PROGRESS_METRICS_TESTS_OK');
