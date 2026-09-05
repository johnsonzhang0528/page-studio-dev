import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const CONCURRENCY_CODES = Object.freeze({
  automation: 'AUTOMATION_ERROR',
  conflict: 'CONCURRENCY_CONFLICT',
  multipleWriter: 'MULTIPLE_WRITER_DETECTED',
  lease: 'LEASE_CONFLICT'
});
const conflictPrefix=()=>`${CONCURRENCY_CODES.automation}/${CONCURRENCY_CODES.conflict}/${CONCURRENCY_CODES.multipleWriter}/${CONCURRENCY_CODES.lease}`;

export function processAlive(pid) {
  if (!Number.isInteger(pid) || pid < 2) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}
export function processIdentity(pid) {
  if(!processAlive(pid)) return null;
  try {
    const stat=fs.readFileSync(`/proc/${pid}/stat`,'utf8'),close=stat.lastIndexOf(')'),fields=stat.slice(close+2).trim().split(/\s+/),startTicks=fields[19];
    const cmdline=fs.readFileSync(`/proc/${pid}/cmdline`,'utf8').replaceAll('\0',' ').trim();
    return {start_ticks:startTicks,cmdline};
  } catch { return null; }
}
function sameProcessAlive(pid,expected){ if(!processAlive(pid)) return false; if(!expected) return true; const actual=processIdentity(pid); return !actual||(actual.start_ticks===expected.start_ticks&&actual.cmdline===expected.cmdline); }

export function leaseIdentity({project,inputRevision=0,phase,unitId,attempt=0}) {
  return [path.basename(project),String(inputRevision),phase,unitId,String(attempt)].join(':');
}

export function acquireWorkUnitLease(project, identity, {ttlMs=2*60*60*1000, controllerPid=process.pid, now=Date.now()}={}) {
  const root=path.join(project,'.ai','runtime','work-unit-leases');
  fs.mkdirSync(root,{recursive:true});
  const key=crypto.createHash('sha256').update(identity).digest('hex');
  const dir=path.join(root,key), metadataPath=path.join(dir,'lease.json');
  const create=()=>{
    fs.mkdirSync(dir);
    const metadata={lease_id:key,identity,project:path.basename(project),controller_pid:controllerPid,controller_identity:processIdentity(controllerPid),worker_pid:null,worker_identity:null,started_at:new Date(now).toISOString(),heartbeat_at:new Date(now).toISOString(),expires_at:new Date(now+ttlMs).toISOString()};
    fs.writeFileSync(metadataPath,JSON.stringify(metadata,null,2)+'\n',{mode:0o600});
    return metadata;
  };
  let metadata;
  try { metadata=create(); }
  catch(error) {
    if(error.code!=='EEXIST') throw error;
    let owner=null; try { owner=JSON.parse(fs.readFileSync(metadataPath,'utf8')); } catch {}
    const expired=!owner||Date.parse(owner.expires_at??0)<=now;
    const controllerAlive=owner&&sameProcessAlive(owner.controller_pid,owner.controller_identity),workerAlive=owner&&sameProcessAlive(owner.worker_pid,owner.worker_identity);
    if(controllerAlive||workerAlive) {
      const live=[controllerAlive?`controller PID ${owner.controller_pid}`:null,workerAlive?`worker PID ${owner.worker_pid}`:null].filter(Boolean).join('、'); const conflict=new Error(`${conflictPrefix()}: ${identity} 已由存活的 ${live} 持有`); conflict.code=CONCURRENCY_CODES.lease; conflict.owner=owner; throw conflict;
    }
    if(!owner&&!expired) {
      const conflict=new Error(`${conflictPrefix()}: ${identity} 的 owner 狀態不明且租約尚未到期`); conflict.code=CONCURRENCY_CODES.lease; conflict.owner=owner; throw conflict;
    }
    fs.rmSync(dir,{recursive:true,force:true});
    try { metadata=create(); } catch {
      const conflict=new Error(`${conflictPrefix()}: ${identity} stale reclaim 競賽失敗`); conflict.code=CONCURRENCY_CODES.lease; throw conflict;
    }
  }
  let released=false;
  return {
    metadata,
    setWorker(pid){ metadata.worker_pid=pid; metadata.worker_identity=processIdentity(pid); metadata.heartbeat_at=new Date().toISOString(); fs.writeFileSync(metadataPath,JSON.stringify(metadata,null,2)+'\n',{mode:0o600}); },
    heartbeat(){ metadata.heartbeat_at=new Date().toISOString(); metadata.expires_at=new Date(Date.now()+ttlMs).toISOString(); fs.writeFileSync(metadataPath,JSON.stringify(metadata,null,2)+'\n',{mode:0o600}); },
    release(){ if(released) return; released=true; let current=null; try { current=JSON.parse(fs.readFileSync(metadataPath,'utf8')); } catch {} if(current?.lease_id===metadata.lease_id&&current?.controller_pid===controllerPid) fs.rmSync(dir,{recursive:true,force:true}); }
  };
}

const activeChildren=new Map();
let handlersInstalled=false;
export function terminateChildGroup(child, signal='SIGTERM') {
  if(!child?.pid) return;
  try { process.kill(-child.pid,signal); } catch { try { child.kill(signal); } catch {} }
}
export function trackChild(child, lease) {
  activeChildren.set(child.pid,{child,lease});
  lease?.setWorker(child.pid);
  const done=()=>{ activeChildren.delete(child.pid); lease?.release(); };
  child.once('close',done); child.once('error',done);
  return done;
}
export function terminateAllChildren(signal='SIGTERM') { for(const {child} of activeChildren.values()) terminateChildGroup(child,signal); }
export function installChildCleanupHandlers() {
  if(handlersInstalled) return; handlersInstalled=true;
  for(const signal of ['SIGTERM','SIGINT']) process.once(signal,()=>{
    const exitCode=128+(signal==='SIGTERM'?15:2); terminateAllChildren('SIGTERM');
    const poll=setInterval(()=>{ if(activeChildren.size===0){ clearInterval(poll); process.exit(exitCode); } },25);
    setTimeout(()=>{ clearInterval(poll); terminateAllChildren('SIGKILL'); process.exit(exitCode); },5000);
  });
  process.once('exit',()=>terminateAllChildren('SIGTERM'));
}
export function activeChildCount(){ return activeChildren.size; }
