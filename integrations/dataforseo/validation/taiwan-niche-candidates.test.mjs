import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('candidate discovery emits 100 unique unscored non-YMYL hypotheses',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dfs-niches-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const output=path.join(dir,'pool.json');
  const run=spawnSync(process.execPath,[new URL('../bin/build-taiwan-niche-candidates.mjs',import.meta.url).pathname,output],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);
  const pool=JSON.parse(fs.readFileSync(output));assert.equal(pool.candidate_count,100);assert.equal(pool.paid_api_spend_microusd,0);assert.equal(pool.automatic_enter,false);assert.equal(new Set(pool.candidates.map(row=>row.topic)).size,100);
  assert.ok(pool.candidates.every(row=>Object.values(row.scores).every(value=>value===null)&&row.decision===null&&row.confidence==='C'&&row.validation_status==='UNVALIDATED'));
  assert.ok(pool.candidates.every(row=>!/(醫療|疾病|藥|保健|法律|律師|投資|股票|保險|貸款|加密貨幣|減肥|治療|診斷)/.test(row.topic)));
});
