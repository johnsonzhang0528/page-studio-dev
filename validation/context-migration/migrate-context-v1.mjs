#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const root=path.join(os.homedir(),'page-studio-dev','projects');
const templates={
  'README.md':fs.readFileSync(new URL('./context-README.md',import.meta.url),'utf8'),
  'INPUT_DIGEST.md':fs.readFileSync(new URL('./INPUT_DIGEST.md',import.meta.url),'utf8'),
  'PROJECT_CONTEXT.md':fs.readFileSync(new URL('./PROJECT_CONTEXT.md',import.meta.url),'utf8'),
  'TRACEABILITY.md':fs.readFileSync(new URL('./TRACEABILITY.md',import.meta.url),'utf8')
};
const phaseGraphTemplate=fs.readFileSync(new URL('./PHASE_TASK_GRAPH.json',import.meta.url),'utf8');
const replacement=`## Context management

- When \`page-autodev\` invokes a stage, follow the stage-specific context route supplied by the controller instead of reading every Source of Truth file at startup.
- Prefer \`docs/context/*.md\` as the compact AI reading layer. Every derived Markdown document must retain source paths, hashes, extraction time, and conversion limitations.
- Originals in \`docs/input/\`, structured JSON, CSV, diagrams, and validation receipts remain authoritative evidence and must never be deleted or replaced by a Markdown conversion.
- Start with indexes, task IDs, acceptance criteria, \`Git diff\`, \`Glob\`, and \`Grep\`; read only relevant source sections.
- Do not load dependency directories, build output, coverage output, \`.git\`, \`.ai/logs\`, binary images, or complete generated Archify HTML into context.
- Gate and QA stages must preserve complete requirement traceability. Context optimization may change reading order, but may not omit required evidence.
- If a compact Markdown document conflicts with original Source of Truth, the original wins.`;

const requested=process.argv.slice(2);
if(!requested.length) throw new Error('必須明確提供要升級的專案名稱。');
for(const name of requested) {
  if(!/^[A-Za-z0-9._-]+$/.test(name)) throw new Error(`不安全的專案名稱：${name}`);
  const project=path.join(root,name), item={name};
  if(!fs.existsSync(project)||!fs.statSync(project).isDirectory()) throw new Error(`找不到專案：${name}`);
  if(!['.git','CLAUDE.md','.ai/PROJECT_STATE.json','.ai/AUTODEV_CONFIG.json'].every(rel=>fs.existsSync(path.join(project,rel)))) continue;
  if(fs.existsSync(path.join(project,'.ai','autodev.lock'))) { console.log(`【Context 升級延後】${item.name} 正在執行，為避免干擾，本次不修改專案檔案。`); continue; }
  const contextDir=path.join(project,'docs','context'); fs.mkdirSync(contextDir,{recursive:true});
  for(const [name,content] of Object.entries(templates)) { const target=path.join(contextDir,name); if(!fs.existsSync(target)) fs.writeFileSync(target,content); }
  const claudeFile=path.join(project,'CLAUDE.md'), original=fs.readFileSync(claudeFile,'utf8');
  const updated=original.replace(/## Required startup\r?\n\r?\nRead in order:[^\r\n]+/,replacement);
  if(updated!==original) fs.writeFileSync(claudeFile,updated);
  const configFile=path.join(project,'.ai','AUTODEV_CONFIG.json'), config=JSON.parse(fs.readFileSync(configFile,'utf8'));
  config.context_management={fresh_session_per_stage:true,no_session_persistence:true,phase_scoped_context:true,markdown_first:true,auto_compact_percent:80,...config.context_management};
  config.work_units={enabled:true,max_continuations_per_unit:3,max_no_progress_attempts:2,max_repair_attempts_per_unit:2,...config.work_units};
  const temporary=`${configFile}.tmp.${process.pid}`; fs.writeFileSync(temporary,JSON.stringify(config,null,2)+'\n'); fs.renameSync(temporary,configFile);
  const phaseGraphFile=path.join(project,'.ai','PHASE_TASK_GRAPH.json'); if(!fs.existsSync(phaseGraphFile)) fs.writeFileSync(phaseGraphFile,phaseGraphTemplate);
  console.log(`【Context 升級完成】${item.name}`);
}
