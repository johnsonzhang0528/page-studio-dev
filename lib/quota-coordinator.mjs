import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';

const nowIso=now=>new Date(now).toISOString();
const hash=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const activeReservations=(reservations,now)=>reservations.filter(item=>Date.parse(item.expires_at)>now);
export const accountCoordinatorPath=project=>path.join(process.env.PAGE_AUTODEV_COORDINATOR_DIR||process.env.XDG_RUNTIME_DIR||path.join(os.tmpdir(),`page-autodev-${process.getuid?.()??'user'}`),'claude-account-coordinator.json');

export function estimateQuotaCost({model='sonnet',turns=12}={}){
  const weight=String(model).toLowerCase().includes('opus')?1.5:1;
  return {five_hour_percent:Math.min(12,Math.max(0.5,Number(turns)*0.18*weight)),seven_day_percent:Math.min(4,Math.max(0.1,Number(turns)*0.035*weight))};
}

export function modelDemandPolicy({candidates=[],currentModel='sonnet',complete=false,modelReserveFive=8,modelReserveSeven=2}={}){
  const dispatchable=candidates.filter(item=>item?.dispatch!==false&&item?.model),routed=dispatchable.map(item=>String(item.model).toLowerCase());
  const allHardOpus=complete&&dispatchable.length>0&&dispatchable.every(item=>String(item.model).toLowerCase().includes('opus')&&item.hard_required===true);
  const current=String(currentModel).toLowerCase(),reserveReleased=allHardOpus&&current.includes('opus');
  return {complete,all_hard_opus:allHardOpus,alternative_model_needed:routed.some(model=>model!==current),reserve_released:reserveReleased,five_hour_reserve:reserveReleased?0:Math.max(0,Number(modelReserveFive)),seven_day_reserve:reserveReleased?0:Math.max(0,Number(modelReserveSeven)),models:[...new Set(routed)]};
}

export function capTurnsForQuota({model='sonnet',requestedTurns=12,usage,settings={},demandPolicy={}}={}){
  const requested=Math.max(1,Number(requestedTurns)||1);
  if(!String(model).toLowerCase().includes('opus')) return {turns:requested,capped:false,reason:null};
  let cap=Math.min(requested,Math.max(8,Number(settings.opus_max_turns_per_unit??16)));
  if(usage?.available&&usage.fiveHour&&usage.sevenDay){
    const stale=usage.stale?Math.max(0,Number(settings.stale_safety_floor??5)):0;
    const five=Math.max(0,usage.fiveHour.remaining-Number(settings.five_hour_floor??3)-Number(demandPolicy.five_hour_reserve??0)-stale);
    const seven=Math.max(0,usage.sevenDay.remaining-Number(settings.seven_day_floor??5)-Number(demandPolicy.seven_day_reserve??0)-stale);
    cap=Math.min(cap,Math.max(0,Math.floor(five/(0.18*1.5))),Math.max(0,Math.floor(seven/(0.035*1.5))));
  }
  return {turns:cap,capped:cap<requested,reason:cap<8?'insufficient_quota_for_minimum_safe_unit':cap<requested?'opus_unit_safety_cap':null};
}

export function quotaAdmission({usage,request,reservations=[],now=Date.now(),maxConcurrent=1,fiveHourFloor=3,sevenDayFloor=5,staleSafetyFloor=5,modelReserveFive=0,modelReserveSeven=0}={}){
  if(!usage?.available||!usage.fiveHour||!usage.sevenDay) return {ok:false,reason:'usage_unavailable_fail_closed',resume_at:null};
  const active=activeReservations(reservations,now),own=active.filter(item=>item.project===request.project),other=active.filter(item=>item.project!==request.project);
  if(other.length>=Math.max(1,maxConcurrent)&&!own.length) return {ok:false,reason:'account_concurrency_limit',resume_at:other.map(item=>item.expires_at).sort()[0]};
  const reservedFive=active.reduce((sum,item)=>sum+Number(item.cost?.five_hour_percent??0),0),reservedSeven=active.reduce((sum,item)=>sum+Number(item.cost?.seven_day_percent??0),0);
  const staleBuffer=usage.stale?Math.max(0,Number(staleSafetyFloor)):0;
  const fiveAvailable=usage.fiveHour.remaining-reservedFive-fiveHourFloor-staleBuffer-modelReserveFive,sevenAvailable=usage.sevenDay.remaining-reservedSeven-sevenDayFloor-staleBuffer-modelReserveSeven;
  if(fiveAvailable<request.cost.five_hour_percent||sevenAvailable<request.cost.seven_day_percent){
    const windows=[usage.fiveHour,usage.sevenDay].filter(window=>window?.resetsAt).sort((a,b)=>Date.parse(a.resetsAt)-Date.parse(b.resetsAt));
    return {ok:false,reason:'insufficient_reserved_quota',resume_at:windows[0]?.resetsAt??null,five_available:fiveAvailable,seven_available:sevenAvailable};
  }
  return {ok:true,reason:'admitted',active_reservations:active.length,five_available:fiveAvailable,seven_available:sevenAvailable};
}

export function fairQueue(requests,{now=Date.now()}={}){
  return [...requests].sort((a,b)=>{
    const score=item=>Number(item.priority??0)*3600000+Math.max(0,now-Date.parse(item.queued_at??now));
    return score(b)-score(a)||String(a.project).localeCompare(String(b.project));
  });
}

export function staggeredWake(resetAt,project,projects,{spacingMs=15000,jitterMs=5000}={}){
  const ordered=[...new Set(projects)].sort(),slot=Math.max(0,ordered.indexOf(project)),jitter=parseInt(hash(project).slice(0,8),16)%(Math.max(0,jitterMs)+1);
  return new Date(Date.parse(resetAt)+slot*Math.max(0,spacingMs)+jitter).toISOString();
}

function readState(file){ try{ const value=JSON.parse(fs.readFileSync(file,'utf8')); return value.schema_version===1?value:{schema_version:1,reservations:[]}; }catch{return {schema_version:1,reservations:[]};} }
function writeState(file,state){ fs.mkdirSync(path.dirname(file),{recursive:true}); const temp=`${file}.${process.pid}.tmp`; fs.writeFileSync(temp,`${JSON.stringify(state,null,2)}\n`,{mode:0o600}); fs.renameSync(temp,file); }
function ownerAlive(owner){ if(!Number.isInteger(owner?.pid)||owner.pid<2) return false; try{process.kill(owner.pid,0);return true;}catch{return false;} }
function withLock(file,operation){
  const lock=`${file}.lock`,ownerFile=path.join(lock,'owner.json'),token=crypto.randomUUID(); fs.mkdirSync(path.dirname(file),{recursive:true}); const deadline=Date.now()+3000;
  while(true){
    try{ fs.mkdirSync(lock); fs.writeFileSync(ownerFile,JSON.stringify({pid:process.pid,token,created_at:new Date().toISOString()}),{flag:'wx',mode:0o600}); break; }
    catch{
      let owner=null; try{owner=JSON.parse(fs.readFileSync(ownerFile,'utf8'));}catch{}
      if(owner&&!ownerAlive(owner)){ try{fs.rmSync(lock,{recursive:true,force:true});continue;}catch{} }
      if(Date.now()>deadline) throw new Error('account quota coordinator lock timeout'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,25);
    }
  }
  try{return operation();}finally{ let owner=null; try{owner=JSON.parse(fs.readFileSync(ownerFile,'utf8'));}catch{} if(owner?.token===token) fs.rmSync(lock,{recursive:true,force:true}); }
}

export function reserveAccountQuota(project,{usage,runId,unitId,model,turns,ttlMs=2*60*60*1000,now=Date.now(),settings={},demandPolicy={}}={}){
  const file=accountCoordinatorPath(project),cost=estimateQuotaCost({model,turns}),request={project:path.basename(project),cost};
  return withLock(file,()=>{
    const state=readState(file); state.reservations=activeReservations(state.reservations??[],now);
    const decision=quotaAdmission({usage,request,reservations:state.reservations,now,maxConcurrent:settings.max_concurrent??1,fiveHourFloor:settings.five_hour_floor??3,sevenDayFloor:settings.seven_day_floor??5,staleSafetyFloor:settings.stale_safety_floor??5,modelReserveFive:demandPolicy.five_hour_reserve??settings.model_reserve_five_hour??8,modelReserveSeven:demandPolicy.seven_day_reserve??settings.model_reserve_seven_day??2});
    if(!decision.ok) return decision;
    const token=hash(`${request.project}|${runId}|${unitId}|${now}|${process.pid}`),reservation={token,project:request.project,run_id:runId,unit_id:unitId,cost,created_at:nowIso(now),expires_at:nowIso(now+ttlMs)};
    state.reservations.push(reservation); state.updated_at=nowIso(now); writeState(file,state); return {...decision,token,reservation};
  });
}

export function releaseAccountQuota(project,token,{now=Date.now()}={}){
  if(!token) return false; const file=accountCoordinatorPath(project);
  return withLock(file,()=>{ const state=readState(file),before=state.reservations?.length??0; state.reservations=(state.reservations??[]).filter(item=>item.token!==token&&Date.parse(item.expires_at)>now); state.updated_at=nowIso(now); writeState(file,state); return state.reservations.length<before; });
}
