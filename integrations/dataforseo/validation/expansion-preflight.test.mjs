import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {buildCandidateExpansionPlan} from '../lib/candidate-expansion-plan.mjs';
import {validateLiveExpansionPlan,atomicExpansionArtifact} from '../lib/expansion-preflight.mjs';
const seeds=['網站架設','SEO','記帳軟體','空氣清淨機','日本自由行','英文學習'];
const registry=JSON.parse(fs.readFileSync(new URL('../fixtures/provider-registry.json',import.meta.url),'utf8'));
const shadow={mode:'offline_quality_shadow',network_dispatch:false,quality:{per_seed:Object.fromEntries(seeds.map((seed,index)=>[seed,{selected:[9,10,8,5,6,9][index]}]))}};
const bytes=Buffer.from(JSON.stringify(shadow)),now=Date.parse('2026-09-15T05:00:00Z');
const plan=buildCandidateExpansionPlan({shadow,seeds,registry,source_shadow_sha256:crypto.createHash('sha256').update(bytes).digest('hex'),now});
test('live preflight binds complete plan to original shadow and valid disabled registry',()=>{
  assert.equal(validateLiveExpansionPlan({plan,shadow_bytes:bytes,seeds,registry,now}).plan_sha256,plan.plan_sha256);
  assert.throws(()=>validateLiveExpansionPlan({plan:{...plan,requests:[...plan.requests].reverse()},shadow_bytes:bytes,seeds,registry,now}),/EXPANSION_PLAN_MUTATED/);
  assert.throws(()=>validateLiveExpansionPlan({plan,shadow_bytes:Buffer.from(JSON.stringify({...shadow,other:true})),seeds,registry,now}),/EXPANSION_PLAN_MUTATED/);
  assert.throws(()=>validateLiveExpansionPlan({plan,shadow_bytes:bytes,seeds,registry,now:Date.parse('2026-09-17T00:00:00Z')}),/PRICE_SNAPSHOT_STALE/);
});
test('artifact write is atomic, root-only mode and replaceable without partial JSON',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'expansion-preflight-'));
  try{const file=path.join(folder,'artifact.json');atomicExpansionArtifact(file,{first:1});atomicExpansionArtifact(file,{second:2});assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),{second:2});if(process.platform!=='win32')assert.equal(fs.statSync(file).mode&0o777,0o600);}finally{fs.rmSync(folder,{recursive:true,force:true});}
});
