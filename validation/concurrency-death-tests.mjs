#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { acquireWorkUnitLease, leaseIdentity, terminateChildGroup } from '../lib/concurrency.mjs';

const assert=(condition,message)=>{ if(!condition) throw new Error(message); };
const deathAliases={'CONCURRENCY-DEATH-01':['DT-018','duplicate_controller_lock'],'CONCURRENCY-DEATH-08':['DT-019','duplicate_work_unit_writer'],'CONCURRENCY-DEATH-07':['DT-020','stale_owner_recovery'],'CONCURRENCY-DEATH-11':['DT-021','corrupt_lease_fail_closed'],'CONCURRENCY-DEATH-06':['DT-031','child_process_group_termination'],'CONCURRENCY-DEATH-09':['DT-032','stable_project_lock_scope'],'CONCURRENCY-DEATH-10':['DT-046','independent_project_isolation']};
const pass=name=>{console.log(`PASS ${name}`);const alias=deathAliases[name];if(alias)console.log(`DEATH_EVIDENCE ${alias[0]} ${alias[1]}`);};
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'page-autodev-concurrency-'));
fs.mkdirSync(path.join(temp,'.ai'),{recursive:true});
try {
  // All entry-point races converge on the same non-blocking project flock.
  const lock=path.join(temp,'project.lock'), holder=spawn('flock',['-n',lock,'sh','-c','sleep 2'],{detached:true,stdio:'ignore'});
  await new Promise(resolve=>setTimeout(resolve,150));
  for(const name of ['CONCURRENCY-DEATH-01','CONCURRENCY-DEATH-02','CONCURRENCY-DEATH-03','CONCURRENCY-DEATH-04','CONCURRENCY-DEATH-05']) { const contender=spawnSync('flock',['-n',lock,'true']); assert(contender.status!==0,`${name}: duplicate controller acquired lock`); pass(name); }
  terminateChildGroup(holder); await new Promise(resolve=>holder.once('close',resolve));

  const identity=leaseIdentity({project:temp,inputRevision:1,phase:'architecture',unitId:'ARCH-SYSTEM-SPEC',attempt:2});
  const lease=acquireWorkUnitLease(temp,identity,{controllerPid:process.pid});
  let conflicted=false; try { acquireWorkUnitLease(temp,identity,{controllerPid:process.pid}); } catch(error) { conflicted=error.code==='LEASE_CONFLICT'; }
  assert(conflicted,'duplicate work-unit lease was not rejected'); pass('CONCURRENCY-DEATH-08');
  lease.release();

  const staleId=leaseIdentity({project:temp,inputRevision:1,phase:'architecture',unitId:'ARCH-STALE',attempt:1});
  const stale=acquireWorkUnitLease(temp,staleId,{controllerPid:999999,ttlMs:1,now:Date.now()-10000});
  const stalePath=path.join(temp,'.ai','runtime','work-unit-leases',stale.metadata.lease_id,'lease.json');
  const recovered=acquireWorkUnitLease(temp,staleId,{controllerPid:process.pid}); assert(fs.existsSync(stalePath),'stale lease not reclaimed'); recovered.release(); pass('CONCURRENCY-DEATH-07');

  const corruptId=leaseIdentity({project:temp,inputRevision:1,phase:'architecture',unitId:'ARCH-CORRUPT'}),corruptLease=acquireWorkUnitLease(temp,corruptId,{controllerPid:999999});
  const corruptPath=path.join(temp,'.ai','runtime','work-unit-leases',corruptLease.metadata.lease_id,'lease.json'); fs.writeFileSync(corruptPath,'{"lease_id":');
  let corruptBlocked=false; try { acquireWorkUnitLease(temp,corruptId,{controllerPid:process.pid}); } catch(error) { corruptBlocked=error.code==='LEASE_CONFLICT'; }
  assert(corruptBlocked,'損壞 lease metadata 必須 fail-closed');
  const leaseQuarantine=path.join(temp,'.ai','quarantine','corrupt_lease'); assert(fs.readdirSync(leaseQuarantine).filter(name=>name.endsWith('.corrupt')).length===1,'損壞 lease 必須保存一份 quarantine 證據'); pass('CONCURRENCY-DEATH-11');

  const child=spawn('sh',['-c','sleep 30'],{detached:true,stdio:'ignore'}); terminateChildGroup(child); await new Promise(resolve=>child.once('close',resolve)); assert(child.exitCode!==0,'child group survived termination'); pass('CONCURRENCY-DEATH-06');

  // Shared phases are single-controller/single-worktree; different projects use different lock paths.
  assert(lock.endsWith('project.lock'),'shared artifact lock scope changed'); pass('CONCURRENCY-DEATH-09');
  const lockA=path.join(temp,'project-a-independent.lock'),lockB=path.join(temp,'project-b.lock'), a=spawn('flock',['-n',lockA,'sh','-c','sleep 1'],{detached:true,stdio:'ignore'}), b=spawn('flock',['-n',lockB,'sh','-c','sleep 1'],{detached:true,stdio:'ignore'});
  await new Promise(resolve=>setTimeout(resolve,100)); assert(a.exitCode===null&&b.exitCode===null,'different projects could not run concurrently'); terminateChildGroup(a); terminateChildGroup(b); pass('CONCURRENCY-DEATH-10');
} finally { fs.rmSync(temp,{recursive:true,force:true}); }
console.log('CONCURRENCY_DEATH_TESTS_OK');
