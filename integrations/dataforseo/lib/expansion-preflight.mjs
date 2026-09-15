import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {buildCandidateExpansionPlan} from './candidate-expansion-plan.mjs';

const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

export function validateLiveExpansionPlan({plan,shadow_bytes,seeds,registry,now=Date.now()}={}){
  const shadow=JSON.parse(shadow_bytes.toString('utf8'));
  const expected=buildCandidateExpansionPlan({shadow,seeds,registry,source_shadow_sha256:hash(shadow_bytes),now});
  if(plan?.plan_sha256!==expected.plan_sha256||plan?.request_batch_sha256!==expected.request_batch_sha256||JSON.stringify(plan)!==JSON.stringify(expected))throw new Error('EXPANSION_PLAN_MUTATED');
  if(expected.max_microusd!==72000||expected.task_count!==5||expected.network_dispatch!==false)throw new Error('EXPANSION_SCOPE_CHANGED');
  return expected;
}

export function atomicExpansionArtifact(file,value){
  const temporary=`${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const fd=fs.openSync(temporary,'wx',0o600);
  try{fs.writeSync(fd,`${JSON.stringify(value,null,2)}\n`);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(temporary,file);
  const dir=fs.openSync(path.dirname(file),'r');
  try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
}
