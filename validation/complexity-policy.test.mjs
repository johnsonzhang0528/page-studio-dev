import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { selectComplexityPolicy, complexityInstruction, recordComplexityMetric } from '../lib/complexity-policy.mjs';

const run=(cwd,args)=>spawnSync('git',args,{cwd,encoding:'utf8'});

test('selective Ponytail policy protects high-risk work and records shadow metrics',()=>{
  const config={complexity_control:{enabled:true,rollout:'shadow',default_mode:'full',high_risk_mode:'lite',allow_ultra:false,review:{strategy:'conditional',file_threshold:5,added_lines_threshold:150}}};
  const ordinary={id:'FE-001',title:'日期輸入元件',risk:'low',write_scope:['src/date.tsx']};
  const highRisk={id:'BE-SEC-001',title:'RBAC 權限與稽核',risk:'high',write_scope:['src/auth.ts']};
  const ordinaryPolicy=selectComplexityPolicy(ordinary,config),protectedPolicy=selectComplexityPolicy(highRisk,config);
  assert.equal(ordinaryPolicy.mode,'full'); assert.equal(protectedPolicy.mode,'lite'); assert.equal(ordinaryPolicy.max_review_rounds,1);
  assert.match(complexityInstruction(ordinaryPolicy),/shadow pilot/); assert.match(complexityInstruction(protectedPolicy),/不可覆蓋需求、ADR/);

  const project=fs.mkdtempSync(path.join(os.tmpdir(),'complexity-policy-test-'));
  try {
    fs.mkdirSync(path.join(project,'.ai')); fs.mkdirSync(path.join(project,'src'));
    fs.writeFileSync(path.join(project,'src','date.tsx'),'export const value = 1;\n');
    run(project,['init','-q']); run(project,['config','user.name','Test']); run(project,['config','user.email','test@example.invalid']); run(project,['add','-A']); run(project,['commit','-qm','baseline']);
    fs.writeFileSync(path.join(project,'src','date.tsx'),Array.from({length:180},(_,index)=>`export const value${index} = ${index};`).join('\n')+'\n');
    const metric=recordComplexityMetric(project,ordinary,ordinaryPolicy,{complexity_receipt:{review_performed:true,applied:true,triggers:['large diff'],reuse_decision:'checked',native_or_stdlib_option:'native input',new_dependency_justification:null,protected_complexity:[],simplifications:['native input'],deferred_debt:[]}});
    assert.ok(metric.added_lines>=150); assert.equal(metric.receipt.applied,false); assert.ok(metric.triggers.some(value=>value.includes('實際新增')));
    const store=JSON.parse(fs.readFileSync(path.join(project,'.ai','COMPLEXITY_METRICS.json'),'utf8')); assert.equal(store.entries.length,1);
  } finally { fs.rmSync(project,{recursive:true,force:true}); }
});
