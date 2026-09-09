import assert from 'node:assert/strict';
import { transitionFinding } from '../lib/gate-findings.mjs';

const transitions={
  open:['repairing','closed','stale'],
  repairing:['verifying','closed','reopened','stale'],
  verifying:['closed','reopened','stale'],
  closed:['reopened','stale'],
  reopened:['repairing','closed','stale'],
  stale:['reopened','closed']
};
let seed=0x5eed1234;
const random=()=>{ seed=(seed*1664525+1013904223)>>>0; return seed/0x100000000; };
const states=Object.keys(transitions),unknown=['invalid','passed','running',''];

for(let sequence=0;sequence<2000;sequence++){
  const finding={id:`GF-${sequence}`,status:states[Math.floor(random()*states.length)]};
  for(let step=0;step<30;step++){
    const before=finding.status,legal=transitions[before],chooseLegal=random()<0.7;
    const next=chooseLegal?legal[Math.floor(random()*legal.length)]:[...states,...unknown].filter(candidate=>!legal.includes(candidate))[Math.floor(random()*([...states,...unknown].filter(candidate=>!legal.includes(candidate)).length))];
    if(legal.includes(next)){
      assert.equal(transitionFinding(finding,next),finding);
      assert.equal(finding.status,next);
    }else{
      assert.throws(()=>transitionFinding(finding,next),/finding 狀態不可/);
      assert.equal(finding.status,before,'rejected transition must not mutate state');
    }
  }
}
console.log('STATE_TRANSITION_PROPERTY_TESTS_OK');
