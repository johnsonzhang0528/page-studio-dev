import assert from 'node:assert/strict';
import {affectedClosure,workflowAffectedPhases,phaseReceipt,reusablePhaseReceipt,WORKFLOW_PHASE_ORDER} from '../lib/selective-invalidation.mjs';

const full=workflowAffectedPhases(['input_analysis']);
assert.equal(full.ok,true); assert.deepEqual(full.affected,WORKFLOW_PHASE_ORDER,'輸入語意改變預設必須安全失效全部下游');
const architecture=workflowAffectedPhases(['architecture']);
assert.deepEqual(architecture.affected,WORKFLOW_PHASE_ORDER.slice(WORKFLOW_PHASE_ORDER.indexOf('architecture')),'已證明只影響 architecture 時不得重跑 requirements');
const unknown=workflowAffectedPhases(['unknown']);
assert.equal(unknown.ok,false); assert.deepEqual(unknown.affected,WORKFLOW_PHASE_ORDER,'未知 phase 必須 fail closed 全量失效');

let seed=20260907;
const random=()=>{ seed=(seed*1664525+1013904223)>>>0; return seed/2**32; };
for(let round=0;round<200;round++){
  const count=3+Math.floor(random()*12),nodes=Array.from({length:count},(_,i)=>`N${i}`),edges=[];
  for(let downstream=1;downstream<count;downstream++) for(let upstream=0;upstream<downstream;upstream++) if(random()<0.25) edges.push([nodes[downstream],nodes[upstream]]);
  const changed=[nodes[Math.floor(random()*count)]],actual=affectedClosure({nodes,edges,changed});
  const expected=new Set(changed); let moved=true; while(moved){ moved=false; for(const [down,up] of edges) if(expected.has(up)&&!expected.has(down)){ expected.add(down); moved=true; } }
  assert.equal(actual.ok,true); assert.deepEqual(actual.affected,nodes.filter(id=>expected.has(id)),'隨機 DAG 的 affected closure 必須精準');
}

const expected={phase:'requirements',input_sha:'input',output_sha:'output',policy_version:'policy',controller_version:'controller',predecessor_approval:'approval',evidence_sha:'evidence'};
const receipt=phaseReceipt(expected);
assert.equal(reusablePhaseReceipt(receipt,expected).ok,true);
for(const field of Object.keys(expected)) assert.equal(reusablePhaseReceipt(receipt,{...expected,[field]:`${expected[field]}-changed`}).ok,false,`${field} 改變時禁止 reuse`);
assert.equal(reusablePhaseReceipt({...receipt,fingerprint:'tampered'},expected).ok,false,'竄改 receipt 必須拒絕');
assert.equal(reusablePhaseReceipt(null,expected).ok,false,'缺 receipt 必須 fail closed');
console.log('SELECTIVE_INVALIDATION_TESTS_OK');
