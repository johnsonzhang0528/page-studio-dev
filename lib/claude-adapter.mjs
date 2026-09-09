import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { trackChild, terminateChildGroup } from './concurrency.mjs';
import { redactSecrets } from './subprocess-policy.mjs';

export const CLAUDE_ADAPTER_VERSION=1;

export function buildClaudeCliArguments({prompt,agent,kind,resultSchema,turnLimit,model,effort,resumeSessionId=null,resumable=false,fallback=null,allowedTools=null,disallowedTools=[]}){
  const args=['-p',prompt,'--agent',agent,'--permission-mode',kind==='gate'?'dontAsk':'auto','--output-format','json','--json-schema',resultSchema,'--max-turns',String(turnLimit),'--model',model,'--effort',effort,'--no-chrome'];
  if(resumeSessionId) args.push('--resume',resumeSessionId); else if(!resumable) args.push('--no-session-persistence');
  if(fallback&&fallback!==model) args.push('--fallback-model',fallback);
  if(allowedTools) args.push('--allowedTools',allowedTools);
  args.push('--disallowedTools',disallowedTools.join(','));
  return Object.freeze(args);
}

export function invokeClaudeCli({executable,args,cwd,env,timeoutSeconds,lease,logPath,phase,logTimestamp,onHeartbeat=()=>{},onTimeout=()=>{},spawnProcess=spawn,track=trackChild,terminate=terminateChildGroup}){
  if(!Array.isArray(args)||!args.length) throw new Error('CLAUDE_ADAPTER_ARGS_REQUIRED');
  if(!lease||typeof lease.release!=='function'||typeof lease.heartbeat!=='function') throw new Error('CLAUDE_ADAPTER_LEASE_REQUIRED');
  return new Promise((resolve,reject)=>{
    const out=[],err=[]; let child,settled=false;
    try { child=spawnProcess(executable,args,{cwd,detached:true,stdio:['ignore','pipe','pipe'],env}); track(child,lease); }
    catch(error){ lease.release(); reject(error); return; }
    const started=Date.now(),heartbeat=setInterval(()=>{ lease.heartbeat(); const elapsed=Math.floor((Date.now()-started)/1000),remaining=Math.max(0,timeoutSeconds-elapsed); onHeartbeat({elapsed,remaining,child}); },10000);
    const timer=setTimeout(()=>{ onTimeout({child,timeoutSeconds}); terminate(child,'SIGTERM'); },timeoutSeconds*1000);
    child.stdout.on('data',data=>out.push(data)); child.stderr.on('data',data=>err.push(data));
    child.on('error',error=>{ if(settled)return; settled=true; clearTimeout(timer); clearInterval(heartbeat); lease.release(); reject(error); });
    child.on('close',code=>{ if(settled)return; settled=true; clearTimeout(timer); clearInterval(heartbeat); lease.release(); const stdout=Buffer.concat(out).toString(),stderr=Buffer.concat(err).toString(),wall_duration_ms=Date.now()-started; fs.appendFileSync(logPath,redactSecrets(`\n=== ${logTimestamp()} ${phase} exit=${code}\n${stdout}\nSTDERR\n${stderr}\n`)); resolve({code,stdout,stderr,wall_duration_ms}); });
  });
}
