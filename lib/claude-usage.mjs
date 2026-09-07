import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';

const USAGE_URL='https://api.anthropic.com/api/oauth/usage';
const BETA='oauth-2025-04-20';
let cached=null;

function credentialsFile(){ return path.join(process.env.CLAUDE_CONFIG_DIR||path.join(os.homedir(),'.claude'),'.credentials.json'); }
function accessToken(){ try { return JSON.parse(fs.readFileSync(credentialsFile(),'utf8'))?.claudeAiOauth?.accessToken??null; } catch { return null; } }
function requestUsage(token,timeoutMs){
  return new Promise((resolve,reject)=>{
    const request=https.get(USAGE_URL,{family:4,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','anthropic-beta':BETA}},response=>{
      let raw=''; response.setEncoding('utf8'); response.on('data',chunk=>raw+=chunk);
      response.on('end',()=>{ if(response.statusCode<200||response.statusCode>=300) return reject(new Error(`Claude usage API HTTP ${response.statusCode}`)); try { resolve(JSON.parse(raw)); } catch { reject(new Error('Claude usage API 回傳無效 JSON')); } });
    });
    request.setTimeout(timeoutMs,()=>request.destroy(new Error('Claude usage API 逾時'))); request.on('error',reject);
  });
}
function windowFrom(data,kind,legacyKey){
  const limits=Array.isArray(data?.limits)?data.limits:[],found=limits.find(item=>item?.kind===kind&&!item?.scope?.model);
  const raw=found?{utilization:found.percent,resets_at:found.resets_at}:data?.[legacyKey];
  if(!raw||!Number.isFinite(Number(raw.utilization))) return null;
  const used=Math.max(0,Math.min(100,Number(raw.utilization)));
  return {used,remaining:Math.max(0,100-used),resetsAt:raw.resets_at??null};
}
export function normalizeClaudeUsage(data,fetchedAt=new Date().toISOString()){ return {available:true,fetchedAt,fiveHour:windowFrom(data,'session','five_hour'),sevenDay:windowFrom(data,'weekly_all','seven_day')}; }
export async function getClaudeUsage({maxAgeMs=115000,timeoutMs=8000,force=false}={}){
  if(!force&&cached&&Date.now()-cached.at<maxAgeMs) return cached.value;
  const token=accessToken(); if(!token) return {available:false,reason:'尚未登入 Claude Code',fiveHour:null,sevenDay:null};
  try { const value=normalizeClaudeUsage(await requestUsage(token,timeoutMs)); cached={at:Date.now(),value}; return value; }
  catch(error) { if(cached?.value) return {...cached.value,stale:true,reason:error.message}; return {available:false,reason:error.message,fiveHour:null,sevenDay:null}; }
}
const percent=value=>`${Math.round(value)}%`;
export function claudeUsageLines(usage,{brackets=false}={}){
  const label=value=>brackets?`【${value}】`:value;
  if(!usage?.available) return [label('Claude 5 小時額度：暫時無法取得'),label('Claude 7 天額度：暫時無法取得')];
  const line=(name,window)=>label(window?`${name}：剩餘 ${percent(window.remaining)}（已用 ${percent(window.used)}）`:`${name}：帳戶未回傳此窗口`);
  return [line('Claude 5 小時額度',usage.fiveHour),line('Claude 7 天額度',usage.sevenDay)];
}
