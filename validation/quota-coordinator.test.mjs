import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import {quotaAdmission,estimateQuotaCost,fairQueue,staggeredWake,reserveAccountQuota,releaseAccountQuota,accountCoordinatorPath} from '../lib/quota-coordinator.mjs';

const now=Date.parse('2026-09-07T10:00:00Z'),usage={available:true,fiveHour:{remaining:100,resetsAt:'2026-09-07T15:00:00Z'},sevenDay:{remaining:100,resetsAt:'2026-09-14T00:00:00Z'}},cost=estimateQuotaCost({model:'opus',turns:20});
assert.equal(quotaAdmission({usage,request:{project:'a',cost},now}).ok,true);
assert.equal(quotaAdmission({usage:null,request:{project:'a',cost},now}).ok,false,'usage 不可用必須 fail closed');
const staleUsage={...usage,stale:true};
assert.equal(quotaAdmission({usage:staleUsage,request:{project:'a',cost:{five_hour_percent:93,seven_day_percent:1}},now,fiveHourFloor:3,staleSafetyFloor:5}).ok,false,'快取額度必須額外保留安全緩衝');
const occupied=[{project:'a',cost,expires_at:'2026-09-07T11:00:00Z'}]; assert.equal(quotaAdmission({usage,request:{project:'b',cost},reservations:occupied,now,maxConcurrent:1}).reason,'account_concurrency_limit');
const low={available:true,fiveHour:{remaining:3,resetsAt:'2026-09-07T15:00:00Z'},sevenDay:{remaining:100,resetsAt:'2026-09-14T00:00:00Z'}}; assert.equal(quotaAdmission({usage:low,request:{project:'a',cost},now}).reason,'insufficient_reserved_quota');
assert.deepEqual(fairQueue([{project:'new',priority:0,queued_at:'2026-09-07T09:59:00Z'},{project:'old',priority:0,queued_at:'2026-09-07T09:00:00Z'}],{now}).map(x=>x.project),['old','new'],'等待較久者優先，避免 starvation');
const wakes=['a','b','c'].map(project=>staggeredWake('2026-09-07T15:00:00Z',project,['a','b','c'])); assert.equal(new Set(wakes).size,3); assert(wakes.every((value,index)=>Date.parse(value)>=Date.parse('2026-09-07T15:00:00Z')+index*15000),'喚醒必須 stagger 並帶 deterministic jitter');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'quota-coordinator-')),project=path.join(root,'projects','a'); process.env.PAGE_AUTODEV_COORDINATOR_DIR=path.join(root,'runtime'); fs.mkdirSync(project,{recursive:true}); const admitted=reserveAccountQuota(project,{usage,runId:'run',unitId:'unit',model:'sonnet',turns:10,now}); assert.equal(admitted.ok,true); assert.equal(fs.existsSync(accountCoordinatorPath(project)),true); assert.equal(releaseAccountQuota(project,admitted.token,{now:now+1}),true); fs.mkdirSync(`${accountCoordinatorPath(project)}.lock`); fs.writeFileSync(path.join(`${accountCoordinatorPath(project)}.lock`,'owner.json'),JSON.stringify({pid:99999999,token:'dead'})); assert.equal(reserveAccountQuota(project,{usage,runId:'run-2',unitId:'unit-2',model:'sonnet',turns:10,now:now+2}).ok,true,'死亡 owner 的 coordinator lock 必須可回收'); fs.rmSync(root,{recursive:true,force:true});
console.log('QUOTA_COORDINATOR_TESTS_OK');
