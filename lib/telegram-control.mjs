#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import dns from 'node:dns';
import https from 'node:https';
import { spawnSync } from 'node:child_process';
import { writeDurableJson } from './transactions.mjs';

dns.setDefaultResultOrder('ipv4first');

const ROOT=path.join(os.homedir(),'page-studio-dev');
const PROJECTS=path.join(ROOT,'projects');
const AUTODEV=path.join(ROOT,'bin','page-autodev');
const SECRET_FILE=path.join(os.homedir(),'.config','page-autodev','telegram.env');
const STATE_DIR=path.join(os.homedir(),'.local','state','page-autodev');
const OFFSET_FILE=path.join(STATE_DIR,'telegram-control.json');
const AUDIT_FILE=path.join(STATE_DIR,'telegram-control-audit.jsonl');
const WATCH_FILE=path.join(STATE_DIR,'telegram-watch.json');
const PARALLEL_STATE_ROOT=path.join(ROOT,'system','parallel-state');
const PHASE_LABELS={not_started:'尚未開始',input_analysis:'原始資料分析與分類',requirements:'需求整理',requirements_gate:'需求審查關卡',architecture:'架構設計與 Archify',architecture_gate:'架構審查關卡',specification:'開發規格撰寫',specification_gate:'規格審查關卡',planning:'任務拆解與開發排程',planning_gate:'排程審查關卡',implementation:'Agent 程式開發',implementation_gate:'實作審查關卡',qa:'最終品質驗證',complete:'全部流程完成'};
const STATUS_LABELS={ready:'準備執行',running:'執行中',repairing:'自動修復中',quota_paused:'額度暫停',blocked:'等待操作者補充',failed:'執行失敗',stopped:'已停止',complete:'已完成'};
const PROGRESS_PHASES=['input_analysis','requirements','requirements_gate','architecture','architecture_gate','specification','specification_gate','planning','planning_gate','implementation','implementation_gate','qa'];
const PROGRESS_WEIGHTS={input_analysis:5,requirements:10,requirements_gate:5,architecture:15,architecture_gate:5,specification:10,specification_gate:5,planning:7,planning_gate:3,implementation:20,implementation_gate:5,qa:10};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8'));
function writeJson(file,value) { writeDurableJson(file,value); fs.chmodSync(file,0o600); }
function readSecrets() { return Object.fromEntries(fs.readFileSync(SECRET_FILE,'utf8').split(/\r?\n/).map(line=>line.trim()).filter(line=>line&&!line.startsWith('#')&&line.includes('=')).map(line=>{ const at=line.indexOf('='); return [line.slice(0,at).trim(),line.slice(at+1).trim().replace(/^['"]|['"]$/g,'')]; })); }
function safeProjectName(name) { if(!/^[A-Za-z0-9._-]+$/.test(name??'')) throw new Error('專案名稱只能包含英文字母、數字、句點、底線與連字號。'); return name; }
function projectPath(name) {
  const checked=safeProjectName(name), project=path.join(PROJECTS,checked);
  if(!fs.existsSync(project)||!fs.statSync(project).isDirectory()) throw new Error(`找不到受控專案：${checked}`);
  const real=fs.realpathSync(project), base=fs.realpathSync(PROJECTS)+path.sep;
  if(!real.startsWith(base)) throw new Error('專案不在頁構所受控根目錄內。');
  for(const required of ['.git','CLAUDE.md','.ai/PROJECT_STATE.json','.ai/AUTODEV_CONFIG.json']) if(!fs.existsSync(path.join(real,required))) throw new Error(`專案缺少必要檔案：${required}`);
  return real;
}
function listProjects() {
  return fs.readdirSync(PROJECTS,{withFileTypes:true}).filter(item=>item.isDirectory()&&/^[A-Za-z0-9._-]+$/.test(item.name)).map(item=>item.name).filter(name=>{ try { projectPath(name); return true; } catch { return false; } }).sort();
}
function stateOf(name) { return readJson(path.join(projectPath(name),'.ai','PROJECT_STATE.json')); }
function parallelStateOf(name){ try{return readJson(path.join(PARALLEL_STATE_ROOT,name,'CURRENT.json'));}catch{return null;} }
function formatParallel(name){
  projectPath(name); const run=parallelStateOf(name);
  if(!run) return `🧵 寫入型併行狀態\n\n專案：${name}\n目前尚無併行開發批次。`;
  const icons={ready:'⏳',running:'▶️',interrupted:'⏸️',quota_paused:'⏸️',candidate_ready:'📦',verifying:'🔍',integrated:'✅',complete:'✅',blocked:'🛑',failed:'❌',scope_violation:'🚫',verification_failed:'❌'};
  return [`🧵 寫入型併行狀態`,``,`專案：${name}`,`批次：${run.run_id}`,`狀態：${run.status}`,`基準版本：${String(run.base_commit??'未知').slice(0,8)}`,`Worker：${run.workers.filter(worker=>['running','verifying'].includes(worker.status)).length}/${run.workers.length} 執行中`,``,...run.workers.map(worker=>`${icons[worker.status]??'•'} ${worker.task_id}｜${worker.title}\n  狀態：${worker.status}${worker.commit?`｜候選 ${worker.commit.slice(0,8)}`:''}${worker.error?`\n  原因：${worker.error}`:''}`),...(run.integration?[``,`整合：${run.integration.status}`,`驗證收據：${run.integration.receipts?.length??0} 組`]:[])].join('\n');
}
function overallProgress(name,state=stateOf(name)) {
  if(state.phase==='complete'||state.status==='complete') return 100;
  if(state.phase==='not_started') return 0;
  const project=projectPath(name), currentIndex=PROGRESS_PHASES.indexOf(state.phase);
  let total=PROGRESS_PHASES.slice(0,Math.max(0,currentIndex)).reduce((sum,phase)=>sum+PROGRESS_WEIGHTS[phase],0), fraction=0;
  try {
    const plan=readJson(path.join(project,'.ai','PHASE_TASK_GRAPH.json')).phases?.[state.phase];
    if(plan?.units?.length) fraction=plan.units.filter(unit=>unit.status==='complete').length/plan.units.length;
  } catch {}
  if(state.phase==='implementation'&&!fraction) try {
    const tasks=readJson(path.join(project,'.ai','TASK_GRAPH.json')).tasks?.filter(task=>!String(task.id??'').startsWith('REQ-'))??[];
    if(tasks.length) fraction=tasks.filter(task=>['complete','completed','done','passed'].includes(String(task.status??'').toLowerCase())).length/tasks.length;
  } catch {}
  return Math.max(0,Math.min(100,Math.round(total+(PROGRESS_WEIGHTS[state.phase]??0)*fraction)));
}
function productProgress(name,state=stateOf(name)) {
  if(state.phase==='complete'||state.status==='complete') return 100;
  const project=projectPath(name); let taskFraction=0;
  try {
    const tasks=(readJson(path.join(project,'.ai','TASK_GRAPH.json')).tasks??[]).filter(task=>!String(task.id??'').startsWith('REQ-'));
    if(tasks.length) taskFraction=tasks.filter(task=>['complete','completed','done','passed'].includes(String(task.status??'').toLowerCase())).length/tasks.length;
  } catch {}
  let earned=80*taskFraction,graph={}; try { graph=readJson(path.join(project,'.ai','PHASE_TASK_GRAPH.json')); } catch {}
  const currentIndex=PROGRESS_PHASES.indexOf(state.phase);
  for(const [phase,weight] of [['implementation_gate',10],['qa',8],['release_gate',2]]) {
    const index=PROGRESS_PHASES.indexOf(phase),plan=graph.phases?.[phase]; let fraction=0;
    if(currentIndex>index) fraction=1;
    else if(plan?.units?.length) fraction=plan.units.filter(unit=>unit.status==='complete').length/plan.units.length;
    else if(state.gates?.[phase]?.status==='passed') fraction=1;
    earned+=weight*fraction;
  }
  return Math.max(0,Math.min(100,Math.round(earned)));
}
function audit(entry) { fs.mkdirSync(STATE_DIR,{recursive:true,mode:0o700}); fs.appendFileSync(AUDIT_FILE,JSON.stringify({at:new Date().toISOString(),...entry})+'\n',{mode:0o600}); fs.chmodSync(AUDIT_FILE,0o600); }
function cleanOutput(text) { return String(text??'').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').trim(); }

const secrets=readSecrets();
const TOKEN=secrets.TELEGRAM_BOT_TOKEN, ALLOWED_CHAT=String(secrets.TELEGRAM_CHAT_ID??'');
if(!TOKEN||!ALLOWED_CHAT) throw new Error('Telegram Bot Token 或 Chat ID 尚未設定完整。');

async function api(method, body={}, timeout=35000) {
  const url=`https://api.telegram.org/bot${TOKEN}/${method}`; let lastError;
  for(let attempt=1;attempt<=3;attempt++) try {
    const response=await new Promise((resolve,reject)=>{ const payload=JSON.stringify(body),request=https.request(url,{method:'POST',family:4,headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}},incoming=>{ let raw=''; incoming.setEncoding('utf8'); incoming.on('data',chunk=>raw+=chunk); incoming.on('end',()=>{ try{ resolve({ok:incoming.statusCode>=200&&incoming.statusCode<300,status:incoming.statusCode,result:JSON.parse(raw)}); }catch(error){ error.code='INVALID_TELEGRAM_JSON'; reject(error); } }); }); request.setTimeout(timeout,()=>{ const error=new Error(`Telegram IPv4 連線超過 ${Math.round(timeout/1000)} 秒`); error.code='ETIMEDOUT'; request.destroy(error); }); request.on('error',reject); request.end(payload); });
    if(!response.ok||!response.result.ok) throw new Error(response.result.description??`Telegram HTTP ${response.status}`); return response.result.result;
  } catch(error) { lastError=error; if(attempt<3){ const delay=1000*2**(attempt-1); console.error(`【Telegram 網路重試】${method} 第 ${attempt}/3 次失敗（${error.code??error.name??'未知網路錯誤'}）；${delay/1000} 秒後重試。`); await sleep(delay); } }
  throw lastError;
}
async function send(chatId,text) {
  const value=String(text||'（沒有內容）');
  for(let at=0;at<value.length;at+=3900) {
    let lastError;
    for(let attempt=1;attempt<=3;attempt++) {
      try { await api('sendMessage',{chat_id:chatId,text:value.slice(at,at+3900)},15000); lastError=null; break; }
      catch(error) { lastError=error; if(attempt<3) await sleep(attempt*1500); }
    }
    if(lastError) throw lastError;
  }
}
async function reply(chatId,text,context={}) {
  try { await send(chatId,text); return true; }
  catch(error) { audit({outcome:'回覆失敗',...context,error:error.message}); console.error(`【Telegram 回覆失敗】${error.message}；已執行的專案動作不受影響。`); return false; }
}
function requireProject(argument) { const name=argument?.trim(); if(!name) throw new Error('請在指令後指定專案名稱，例如：/status test-project'); projectPath(name); return name; }
function formatStatus(name) {
  const state=stateOf(name), graphFile=path.join(projectPath(name),'.ai','PHASE_TASK_GRAPH.json'); let plan=null; try { plan=readJson(graphFile).phases?.[state.phase]??null; } catch {}
  const unit=plan?.units.find(item=>item.status!=='complete'), done=plan?.units.filter(item=>item.status==='complete').length??0;
  const next=state.status==='running'?`正在執行「${PHASE_LABELS[state.phase]??state.phase}」${unit?`／${unit.id} ${unit.title}`:''}，完成後將解析結果並決定下一階段`:state.next_action||'尚未設定';
  return [`📋 專案狀態`,``,`專案：${name}`,`狀態：${STATUS_LABELS[state.status]??state.status}`,`產品完成度：${productProgress(name,state)}%`,`流程進度：${overallProgress(name,state)}%`,`階段：${PHASE_LABELS[state.phase]??state.phase}`,...(plan?[`子任務進度：${done}/${plan.units.length}（${Math.round(done/plan.units.length*100)}%）`,`目前子任務：${unit?`${unit.id}｜${unit.title}`:'全部完成'}`]:[]),`下一個動作：${next}`,`阻塞原因：${state.blocker||'無'}`].join('\n');
}
function runAutodev(command,name) {
  const result=spawnSync(AUTODEV,[command,name],{encoding:'utf8',timeout:30000});
  if(result.error) throw result.error;
  if(result.status!==0) throw new Error(cleanOutput(result.stderr||result.stdout)||`指令以代碼 ${result.status} 結束`);
  return cleanOutput(result.stdout);
}
function journalArgs(name,extra=[]) { return ['--user','--output','cat','--unit',`page-autodev@${name}.service`,'--unit',`page-autodev-telegram-${name}-*.service`,...extra]; }
function journalProgress(name,limit=25) {
  projectPath(name);
  const result=spawnSync('journalctl',journalArgs(name,['--lines',String(limit),'--no-pager']),{encoding:'utf8',timeout:15000});
  if(result.error) throw result.error; if(result.status!==0) throw new Error(cleanOutput(result.stderr)||'無法讀取背景進度。');
  return cleanOutput(result.stdout)||'目前尚無背景執行訊息。';
}
function currentJournalCursor() {
  const result=spawnSync('journalctl',['--user','--lines','0','--show-cursor','--no-pager'],{encoding:'utf8',timeout:10000});
  const match=String(result.stdout??'').match(/-- cursor: (.+)/); return match?.[1]?.trim()??null;
}
function readWatches() { try { return readJson(WATCH_FILE); } catch { return {projects:{}}; } }
function writeWatches(value) { writeJson(WATCH_FILE,value); fs.chmodSync(WATCH_FILE,0o600); }
function watchProject(name) { projectPath(name); const value=readWatches(); value.projects[name]={cursor:currentJournalCursor(),enabled_at:new Date().toISOString()}; writeWatches(value); }
function unwatchProject(name) { const value=readWatches(); const existed=Boolean(value.projects[name]); delete value.projects[name]; writeWatches(value); return existed; }
async function flushWatches() {
  const value=readWatches();
  for(const [name,subscription] of Object.entries(value.projects??{})) {
    try {
      projectPath(name);
      const extra=['--no-pager','--show-cursor']; if(subscription.cursor) extra.push('--after-cursor',subscription.cursor); else extra.push('--lines','0');
      const result=spawnSync('journalctl',journalArgs(name,extra),{encoding:'utf8',timeout:15000});
      if(result.status!==0) continue;
      const output=String(result.stdout??''), cursor=output.match(/-- cursor: (.+)/)?.[1]?.trim();
      const lines=output.split(/\r?\n/).filter(line=>line&&!line.startsWith('-- cursor:'));
      if(!lines.length) { if(cursor) subscription.cursor=cursor; continue; }
      const text=lines.join('\n');
      const delivered=await reply(ALLOWED_CHAT,`📡 即時進度\n\n專案：${name}\n\n${text.slice(-3400)}`,{command:'watch-update',project:name});
      if(delivered&&cursor) subscription.cursor=cursor;
    } catch(error) { audit({outcome:'進度訂閱失敗',project:name,error:error.message}); }
  }
  writeWatches(value);
}
function startResume(name) {
  const project=projectPath(name), lock=path.join(project,'.ai','autodev.lock');
  if(fs.existsSync(lock)) throw new Error('此專案已有自動化程序執行中，未重複啟動。');
  const unit=`page-autodev-telegram-${name}-${Date.now()}`;
  const result=spawnSync('systemd-run',['--user','--unit',unit,'--collect','--property=Type=exec',AUTODEV,'resume',name],{encoding:'utf8',timeout:15000});
  if(result.status!==0) throw new Error(cleanOutput(result.stderr||result.stdout)||'無法建立背景執行服務。');
  return unit;
}
function recentHistory(name) {
  const state=stateOf(name), rows=(state.history??[]).slice(-5);
  if(!rows.length) return `🧾 ${name} 尚無流程歷程。`;
  return [`🧾 最近流程摘要`,``,`專案：${name}`,...rows.map(row=>`\n• ${row.at??'時間不詳'}\n  階段：${PHASE_LABELS[row.phase]??row.phase??'未知'}\n  結果：${row.outcome??'未知'}${row.summary?`\n  摘要：${String(row.summary).slice(0,500)}`:''}`)].join('\n');
}
const HELP=[`🤖 頁構所 AI 控制指令`,``,`/projects－列出受控專案`,`/status 專案－查看階段與子任務進度`,`/plan 專案－查看原子工作單元計畫`,`/parallel 專案－查看寫入型併行批次與 Worker`,`/workers 專案－同上，查看各 Worker 狀態`,`/progress 專案－查看最近即時進度`,`/watch 專案－訂閱終端重點訊息`,`/unwatch 專案－停止進度訂閱`,`/resume 專案－背景繼續自動流程`,`/stop 專案－安全停止自動流程`,`/routing 專案－查看模型路由`,`/log 專案－查看最近流程摘要`,`/help－顯示本說明`,``,`安全限制：不接受 Shell、任意路徑、Git push、部署、刪除或重設指令。`].join('\n');

async function handle(update) {
  const message=update.message; if(!message?.text) return;
  const chatId=String(message.chat?.id??'');
  if(chatId!==ALLOWED_CHAT) { audit({outcome:'拒絕',chat_id:chatId,reason:'未授權 Chat ID'}); return; }
  const match=message.text.trim().match(/^\/([a-z-]+)(?:@\w+)?(?:\s+(.+))?$/i);
  if(!match) { await reply(chatId,'⚠️ 無法辨識。請輸入 /help 查看允許的固定指令。',{command:'無法辨識'}); return; }
  const command=match[1].toLowerCase(), argument=match[2]?.trim();
  audit({outcome:'收到',chat_id:chatId,user_id:message.from?.id,command,argument:argument??null,update_id:update.update_id});
  try {
    if(command==='help'||command==='start') await reply(chatId,HELP,{command});
    else if(command==='projects') {
      const projects=listProjects(); await reply(chatId,projects.length?`📁 受控專案\n\n${projects.map(name=>{ const state=stateOf(name); return `• ${name}｜產品 ${productProgress(name,state)}%｜流程 ${overallProgress(name,state)}%｜${STATUS_LABELS[state.status]??state.status}｜${PHASE_LABELS[state.phase]??state.phase}`; }).join('\n')}`:'目前沒有可操作的受控專案。',{command});
    } else if(command==='status') await reply(chatId,formatStatus(requireProject(argument)),{command,argument});
    else if(command==='plan') { const name=requireProject(argument); await reply(chatId,`🧩 原子工作單元計畫\n\n${runAutodev('plan',name)}`,{command,project:name}); }
    else if(command==='parallel'||command==='workers') { const name=requireProject(argument); await reply(chatId,formatParallel(name),{command,project:name}); }
    else if(command==='progress') { const name=requireProject(argument); await reply(chatId,`📡 最近即時進度\n\n專案：${name}\n產品完成度：${productProgress(name)}%\n流程進度：${overallProgress(name)}%\n\n${journalProgress(name)}`,{command,project:name}); }
    else if(command==='watch') { const name=requireProject(argument); watchProject(name); audit({outcome:'已執行',command,project:name}); await reply(chatId,`📡 已訂閱即時進度\n\n專案：${name}\n系統會把新的終端重點訊息分批推送到此對話。\n使用 /unwatch ${name} 可停止訂閱。`,{command,project:name}); }
    else if(command==='unwatch') { const name=requireProject(argument), existed=unwatchProject(name); audit({outcome:'已執行',command,project:name}); await reply(chatId,existed?`🔕 已停止「${name}」的即時進度訂閱。`:`「${name}」目前沒有啟用進度訂閱。`,{command,project:name}); }
    else if(command==='routing') { const name=requireProject(argument); await reply(chatId,`🧠 模型路由\n\n專案：${name}\n\n${runAutodev('routing',name)}`,{command,project:name}); }
    else if(command==='log') { const name=requireProject(argument); await reply(chatId,recentHistory(name),{command,project:name}); }
    else if(command==='resume') { const name=requireProject(argument), unit=startResume(name); audit({outcome:'已執行',command,project:name,unit}); await reply(chatId,`▶️ 已接受繼續指令\n\n專案：${name}\n動作：背景執行 page-autodev resume\n服務：${unit}\n\n後續若需要人工介入、發生錯誤或全部完成，系統會再次通知。`,{command,project:name,unit}); }
    else if(command==='stop') { const name=requireProject(argument); runAutodev('stop',name); audit({outcome:'已執行',command,project:name}); await reply(chatId,`⏹️ 已送出安全停止指令\n\n專案：${name}\n目前階段完成或 Claude 程序返回後將停止，不會啟動下一階段。`,{command,project:name}); }
    else await reply(chatId,'⚠️ 不允許此指令。請輸入 /help 查看允許的固定指令。',{command});
  } catch(error) { audit({outcome:'失敗',command,argument:argument??null,error:error.message}); await reply(chatId,`❌ 指令未執行\n\n原因：${error.message}\n\n輸入 /help 查看正確格式。`,{command,argument}); }
}

async function initializeOffset() {
  fs.mkdirSync(STATE_DIR,{recursive:true,mode:0o700});
  try { return Number(readJson(OFFSET_FILE).offset)||0; } catch {}
  const latest=await api('getUpdates',{offset:-1,limit:1,timeout:0},15000);
  const offset=latest.length?latest[latest.length-1].update_id+1:0; writeJson(OFFSET_FILE,{offset,updated_at:new Date().toISOString()}); return offset;
}
async function main() {
  await api('setMyCommands',{commands:[{command:'projects',description:'列出受控專案'},{command:'status',description:'查看階段與子任務進度'},{command:'plan',description:'查看原子工作單元計畫'},{command:'parallel',description:'查看寫入型併行狀態'},{command:'workers',description:'查看各 Worker 狀態'},{command:'progress',description:'查看最近即時進度'},{command:'watch',description:'訂閱終端重點訊息'},{command:'unwatch',description:'停止進度訂閱'},{command:'resume',description:'繼續自動流程'},{command:'stop',description:'安全停止流程'},{command:'routing',description:'查看模型路由'},{command:'log',description:'查看最近流程摘要'},{command:'help',description:'顯示操作說明'}]},15000);
  let offset=await initializeOffset(); console.log('【Telegram 控制服務】已啟動，只接受已授權 Chat ID 的固定指令。');
  while(true) {
    try {
      const updates=await api('getUpdates',{offset,timeout:10,allowed_updates:['message']},20000);
      for(const update of updates) { await handle(update); offset=update.update_id+1; writeJson(OFFSET_FILE,{offset,updated_at:new Date().toISOString()}); }
      await flushWatches();
    } catch(error) { console.error(`【Telegram 輪詢暫時失敗】${error.code??error.name??'NETWORK_ERROR'}｜${error.message}${error.cause?.message?`（${error.cause.message}）`:''}；完成三次退避重試後仍失敗，10 秒後重新輪詢。`); await sleep(10000); }
  }
}
main().catch(error=>{ console.error(`【Telegram 控制服務停止】${error.message}`); process.exitCode=1; });
