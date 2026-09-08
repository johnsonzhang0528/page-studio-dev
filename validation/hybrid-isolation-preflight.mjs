import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const expected={
  liveRoot:'/home/ubuntu/page-studio-dev',
  soakRoot:'/tmp/page-autodev-wave-a-20260907',
  isolatedRoot:'/tmp/page-autodev-hybrid-20260908',
  runtimeRoot:'/tmp/page-autodev-hybrid-runtime-20260908',
  cacheRoot:'/tmp/page-autodev-hybrid-cache-20260908',
  tempRoot:'/tmp/page-autodev-hybrid-tmp-20260908',
  telemetryRoot:'/tmp/page-autodev-hybrid-telemetry-20260908',
  soakPidFile:'/tmp/wp11-shadow-soak-24h-v2.pid',
  soakSha:'71e730585f9efc35f8218d2583784eb141e9bea9',
  isolatedBranch:'refs/heads/hybrid-isolated/provider-v4'
};
const run=(command,args,{allowFailure=false}={})=>{
  const result=spawnSync(command,args,{encoding:'utf8',env:{PATH:process.env.PATH,HOME:os.homedir(),LANG:'C.UTF-8',XDG_RUNTIME_DIR:process.env.XDG_RUNTIME_DIR,DBUS_SESSION_BUS_ADDRESS:process.env.DBUS_SESSION_BUS_ADDRESS}});
  if(!allowFailure&&result.status!==0) throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr||result.stdout}`);
  return {status:result.status,stdout:(result.stdout??'').trim(),stderr:(result.stderr??'').trim()};
};
const git=(root,...args)=>run('git',['-C',root,...args]).stdout;
const sha=value=>crypto.createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const resolveExisting=value=>fs.realpathSync(value);
const isAncestor=(parent,child)=>child.startsWith(`${parent}${path.sep}`);
const record=(id,ok,evidence)=>({id,ok:Boolean(ok),evidence});

const roots=Object.fromEntries(['liveRoot','soakRoot','isolatedRoot','runtimeRoot','cacheRoot','tempRoot','telemetryRoot'].map(key=>[key,resolveExisting(expected[key])]));
const checks=[];
for(const [leftName,left] of Object.entries(roots)) for(const [rightName,right] of Object.entries(roots)) if(leftName<rightName){
  checks.push(record(`path:${leftName}:${rightName}`,left!==right&&!isAncestor(left,right)&&!isAncestor(right,left),{left,right}));
}
const commonDir=resolveExisting(path.resolve(expected.isolatedRoot,git(expected.isolatedRoot,'rev-parse','--git-common-dir')));
checks.push(record('git:isolated-branch',git(expected.isolatedRoot,'symbolic-ref','HEAD')===expected.isolatedBranch,git(expected.isolatedRoot,'symbolic-ref','HEAD')));
checks.push(record('git:frozen-sha',git(expected.isolatedRoot,'rev-parse','HEAD')===expected.soakSha,git(expected.isolatedRoot,'rev-parse','HEAD')));
checks.push(record('git:shared-object-db-explicit-exception',commonDir===resolveExisting(path.join(expected.liveRoot,'.git')),{commonDir,policy:'objects only; no config/hooks/gc/prune/remove/repair'}));
checks.push(record('git:live-clean',git(expected.liveRoot,'status','--porcelain=v1')==='',sha(git(expected.liveRoot,'status','--porcelain=v1'))));
checks.push(record('git:soak-clean',git(expected.soakRoot,'status','--porcelain=v1')==='',sha(git(expected.soakRoot,'status','--porcelain=v1'))));
checks.push(record('git:soak-sha',git(expected.soakRoot,'rev-parse','HEAD')===expected.soakSha,git(expected.soakRoot,'rev-parse','HEAD')));

const wrapperPid=Number(fs.readFileSync(expected.soakPidFile,'utf8').trim()),children=run('pgrep',['-P',String(wrapperPid),'-f','node validation/shadow-soak.mjs'],{allowFailure:true}).stdout.split(/\s+/).filter(Boolean).map(Number);
checks.push(record('soak:wrapper-alive',fs.existsSync(`/proc/${wrapperPid}`),{pid:wrapperPid}));
checks.push(record('soak:single-node-child',children.length===1,{children}));
if(children[0]) checks.push(record('soak:node-cwd',resolveExisting(`/proc/${children[0]}/cwd`)===roots.soakRoot,{pid:children[0],cwd:resolveExisting(`/proc/${children[0]}/cwd`)}));

const stat=fs.statfsSync(roots.isolatedRoot),freeDiskRatio=Number(stat.bavail)/Number(stat.blocks),freeInodeRatio=Number(stat.ffree)/Number(stat.files);
checks.push(record('resource:disk-reserve',freeDiskRatio>=0.20,{free_ratio:Number(freeDiskRatio.toFixed(4))}));
checks.push(record('resource:inode-reserve',freeInodeRatio>=0.10,{free_ratio:Number(freeInodeRatio.toFixed(4))}));
const scope=run('systemd-run',['--user','--scope','--quiet','-p','CPUQuota=25%','-p','MemoryMax=1G','-p','TasksMax=128','-p','IOWeight=1','-p','IPAddressDeny=any','/usr/bin/node','-e','process.stdout.write("scope-ok")'],{allowFailure:true});
checks.push(record('resource:offline-scope',scope.status===0&&scope.stdout==='scope-ok',{exit_status:scope.status,stdout:scope.stdout,stderr:scope.stderr}));
const sensitiveNames=Object.keys(process.env).filter(name=>/OPENAI|ANTHROPIC|CLAUDE|TELEGRAM/i.test(name));
checks.push(record('credential:no-provider-env',sensitiveNames.length===0,{present_names:sensitiveNames}));
checks.push(record('telemetry:fake-sink',roots.telemetryRoot.startsWith('/tmp/')&&!roots.telemetryRoot.includes('/page-studio-dev/'),{destination:roots.telemetryRoot}));

const failures=checks.filter(item=>!item.ok),decision=failures.length?'WAIT_FOR_SOAK':'SAFE_FOR_ISOLATED_OFFLINE';
const receipt={schema_version:1,kind:'hybrid_isolation_preflight',created_at:new Date().toISOString(),decision,environment_namespace:'hybrid-20260908',run_namespace:`preflight-${process.pid}`,roots,git:{common_dir:commonDir,isolated_branch:expected.isolatedBranch,frozen_sha:expected.soakSha},soak:{wrapper_pid:wrapperPid,node_pid:children[0]??null},limits:{cpu_quota:'25%',memory_max_bytes:1073741824,tasks_max:128,io_weight:1,network:'deny-all'},checks,failures:failures.map(item=>item.id)};
const integritySha=sha(canonical(receipt)),signed={...receipt,integrity:{algorithm:'sha256',manifest_sha256:integritySha,signature:'not_configured_offline'}};
const output=process.env.HYBRID_PREFLIGHT_OUTPUT??path.join(roots.telemetryRoot,`isolation-preflight-${new Date().toISOString().replace(/[:.]/g,'-')}.json`),temporary=`${output}.${process.pid}.tmp`;
fs.writeFileSync(temporary,`${JSON.stringify(signed,null,2)}\n`,{mode:0o600}); fs.renameSync(temporary,output);
console.log(JSON.stringify({decision,receipt:output,manifest_sha256:integritySha,checks:checks.length,failed:failures.length},null,2));
assert.equal(decision,'SAFE_FOR_ISOLATED_OFFLINE',`Isolation preflight failed: ${failures.map(item=>item.id).join(', ')}`);
