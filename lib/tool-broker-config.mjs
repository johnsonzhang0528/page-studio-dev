import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const BROKER_TOOL_NAMES=Object.freeze(['mcp__page_autodev__read_file','mcp__page_autodev__list_directory','mcp__page_autodev__sha256_file','mcp__page_autodev__write_file','mcp__page_autodev__move_file','mcp__page_autodev__run_argv']);
export const CLAUDE_BUILTIN_TOOLS=Object.freeze(['Bash','Read','Write','Edit','Glob','Grep','WebFetch','WebSearch','NotebookEdit','Task']);

export function createToolBrokerConfig({project,mode='read_only',readScope=['.'],writeScope=[],shellArgv=[]}){
  const directory=path.join(project,'.ai','runtime','tool-broker');fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const id=crypto.randomUUID(),policyPath=path.join(directory,`${id}.policy.json`),mcpPath=path.join(directory,`${id}.mcp.json`);
  const policy={project,mode,read_scope:readScope,write_scope:writeScope,shell_argv:shellArgv,timeout_ms:30000};
  fs.writeFileSync(policyPath,JSON.stringify(policy),{mode:0o600,flag:'wx'});
  const command=process.execPath,script=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','bin','page-autodev-tool-broker.mjs');
  fs.writeFileSync(mcpPath,JSON.stringify({mcpServers:{page_autodev:{type:'stdio',command,args:[script,policyPath],env:{}}}}),{mode:0o600,flag:'wx'});
  const tools=mode==='read_only'?BROKER_TOOL_NAMES.filter(name=>!name.endsWith('__write_file')&&!name.endsWith('__move_file')):BROKER_TOOL_NAMES;
  return Object.freeze({mcpConfigPath:mcpPath,policyPath,allowedTools:tools.join(','),disallowedTools:[...CLAUDE_BUILTIN_TOOLS],cleanup(){fs.rmSync(mcpPath,{force:true});fs.rmSync(policyPath,{force:true});}});
}
