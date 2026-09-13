import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';

const USAGE_URL='https://api.anthropic.com/api/oauth/usage',BETA='oauth-2025-04-20';
const MIN_POLL_MS=120000,MAX_STALE_MS=15*60*1000;
let cached=null,inFlight=null;

function credentialsFile(){return path.join(process.env.CLAUDE_CONFIG_DIR||path.join(os.homedir(),'.claude'),'.credentials.json');}
function accessToken(){try{return JSON.parse(fs.readFileSync(credentialsFile(),'utf8'))?.claudeAiOauth?.accessToken??null;}catch{return null;}}
export function claudeUsageCachePath(){
  if(process.env.CLAUDE_USAGE_CACHE_FILE)return process.env.CLAUDE_USAGE_CACHE_FILE;
  const runtime=process.env.XDG_RUNTIME_DIR||(process.getuid?`/run/user/${process.getuid()}`:null)||os.tmpdir();
  return path.join(runtime,'page-autodev','claude-usage-cache.json');
}
function readShared(){try{const value=JSON.parse(fs.readFileSync(claudeUsageCachePath(),'utf8'));return value.schema_version===1?value:null;}catch{return null;}}
function writeShared(value){const file=claudeUsageCachePath();fs.mkdirSync(path.dirname(file),{recursive:true});const temp=`${file}.${process.pid}.tmp`;fs.writeFileSync(temp,`${JSON.stringify(value,null,2)}\n`,{mode:0o600});fs.renameSync(temp,file);}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function withSharedLock(operation){
  const lock=`${claudeUsageCachePath()}.lock`,deadline=Date.now()+5000;fs.mkdirSync(path.dirname(lock),{recursive:true});
  while(true){try{fs.mkdirSync(lock);break;}catch{try{if(Date.now()-fs.statSync(lock).mtimeMs>30000){fs.rmSync(lock,{recursive:true,force:true});continue;}}catch{}if(Date.now()>deadline)return operation(false);await wait(50);}}
  try{return await operation(true);}finally{try{fs.rmSync(lock,{recursive:true,force:true});}catch{}}
}
function requestUsage(token,timeoutMs){return new Promise((resolve,reject)=>{
  const request=https.get(USAGE_URL,{family:4,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','anthropic-beta':BETA}},response=>{let raw='';response.setEncoding('utf8');response.on('data',chunk=>raw+=chunk);response.on('end',()=>{if(response.statusCode<200||response.statusCode>=300){const error=new Error(`Claude usage API HTTP ${response.statusCode}`);error.statusCode=response.statusCode;error.retryAfter=response.headers['retry-after'];return reject(error);}try{resolve(JSON.parse(raw));}catch{reject(new Error('Claude usage API 回傳無效 JSON'));}});});
  request.setTimeout(timeoutMs,()=>request.destroy(new Error('Claude usage API 逾時')));request.on('error',reject);
});}
function windowFrom(data,kind,legacyKey){const limits=Array.isArray(data?.limits)?data.limits:[],found=limits.find(item=>item?.kind===kind&&!item?.scope?.model),raw=found?{utilization:found.percent,resets_at:found.resets_at}:data?.[legacyKey];if(!raw||!Number.isFinite(Number(raw.utilization)))return null;const used=Math.max(0,Math.min(100,Number(raw.utilization)));return{used,remaining:Math.max(0,100-used),resetsAt:raw.resets_at??null};}
export function normalizeClaudeUsage(data,fetchedAt=new Date().toISOString()){return{available:true,fetchedAt,fiveHour:windowFrom(data,'session','five_hour'),sevenDay:windowFrom(data,'weekly_all','seven_day')};}
function sharedValue(state,now=Date.now()){if(!state?.value?.available)return null;const ageMs=now-Date.parse(state.value.fetchedAt??0);if(!Number.isFinite(ageMs)||ageMs<0||ageMs>MAX_STALE_MS)return null;return{...state.value,stale:ageMs>MIN_POLL_MS,cacheAgeMs:ageMs,reason:state.last_error??undefined,nextPollAt:state.next_poll_at??null};}
function retryDelay(error,failures){const seconds=Number(error.retryAfter);if(Number.isFinite(seconds)&&seconds>0)return seconds*1000;return Math.min(15*60*1000,MIN_POLL_MS*2**Math.min(3,Math.max(0,failures-1)));}
export async function getClaudeUsage({maxAgeMs=115000,timeoutMs=8000,force=false}={}){
  if(!force&&cached&&Date.now()-cached.at<maxAgeMs)return cached.value;if(inFlight)return inFlight;
  inFlight=withSharedLock(async locked=>{const now=Date.now(),shared=readShared(),usable=sharedValue(shared,now),nextPoll=Date.parse(shared?.next_poll_at??0);
    if(usable&&((!force&&now-Date.parse(usable.fetchedAt)<maxAgeMs)||nextPoll>now)){cached={at:now,value:usable};return usable;}
    if(!usable&&nextPoll>now)return{available:false,reason:shared?.last_error??'額度查詢正在退避',fiveHour:null,sevenDay:null,nextPollAt:shared.next_poll_at};
    if(!locked&&usable){cached={at:now,value:{...usable,stale:true,reason:'額度查詢由另一程序更新中'}};return cached.value;}
    const token=accessToken();if(!token)return usable??{available:false,reason:'尚未登入 Claude Code',fiveHour:null,sevenDay:null};
    try{const value=normalizeClaudeUsage(await requestUsage(token,timeoutMs)),state={schema_version:1,value,fetched_at:value.fetchedAt,next_poll_at:new Date(now+MIN_POLL_MS).toISOString(),failures:0,last_error:null};writeShared(state);cached={at:now,value};return value;}
    catch(error){const failures=Number(shared?.failures??0)+1,next=new Date(now+retryDelay(error,failures)).toISOString(),state={schema_version:1,value:shared?.value??null,fetched_at:shared?.fetched_at??null,next_poll_at:next,failures,last_error:error.message};writeShared(state);const fallback=sharedValue(state,now);if(fallback){const value={...fallback,stale:true,reason:error.message,nextPollAt:next};cached={at:now,value};return value;}return{available:false,reason:error.message,fiveHour:null,sevenDay:null,nextPollAt:next};}
  }).finally(()=>{inFlight=null;});return inFlight;
}
const percent=value=>`${Math.round(value)}%`;
export function claudeUsageLines(usage,{brackets=false}={}){const label=value=>brackets?`【${value}】`:value;if(!usage?.available)return[label('Claude 5 小時額度：暫時無法取得'),label('Claude 7 天額度：暫時無法取得')];const suffix=usage.stale?`｜快取於 ${Math.max(1,Math.round(Number(usage.cacheAgeMs??0)/60000))} 分鐘前`:'';const line=(name,window)=>label(window?`${name}：剩餘 ${percent(window.remaining)}（已用 ${percent(window.used)}）${suffix}`:`${name}：帳戶未回傳此窗口`);return[line('Claude 5 小時額度',usage.fiveHour),line('Claude 7 天額度',usage.sevenDay)];}
