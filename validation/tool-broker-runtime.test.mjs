import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createToolBrokerRuntime, handleToolBrokerMessage } from '../lib/tool-broker-runtime.mjs';
import { createToolBrokerConfig, CLAUDE_BUILTIN_TOOLS } from '../lib/tool-broker-config.mjs';

const parent=fs.mkdtempSync(path.join(os.tmpdir(),'broker-runtime-')),project=path.join(parent,'project');fs.mkdirSync(path.join(project,'src'),{recursive:true});fs.mkdirSync(path.join(project,'.git'));fs.mkdirSync(path.join(project,'.ai','runtime'),{recursive:true});fs.writeFileSync(path.join(project,'src','a.txt'),'hello');fs.writeFileSync(path.join(project,'.env'),'TOKEN=secret');
try{
  const runtime=createToolBrokerRuntime({project,mode:'isolated_write',read_scope:['.'],write_scope:['src'],shell_argv:[[process.execPath,'--version']]});
  const initialized=handleToolBrokerMessage(runtime,{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25'}});assert.equal(initialized.serverInfo.name,'page-autodev-tool-broker');
  const listed=handleToolBrokerMessage(runtime,{jsonrpc:'2.0',id:2,method:'tools/list'});assert.deepEqual(listed.tools.map(tool=>tool.name),['read_file','list_directory','sha256_file','write_file','move_file','run_argv']);
  assert.match(runtime.call('list_directory',{path:'.'}).content[0].text,/dir\tsrc/);
  assert.equal(runtime.call('read_file',{path:'src/a.txt'}).content[0].text,'hello');assert.match(runtime.call('sha256_file',{path:'src/a.txt'}).content[0].text,/^[a-f0-9]{64}$/);runtime.call('write_file',{path:'src/b.txt',content:'safe'});assert.equal(fs.readFileSync(path.join(project,'src','b.txt'),'utf8'),'safe');
  fs.writeFileSync(path.join(project,'src','large.txt'),Array.from({length:520},(_,index)=>`LINE-${index} ${'x'.repeat(50)}`).join('\n'));
  const first=JSON.parse(runtime.call('read_file',{path:'src/large.txt'}).content[0].text);
  const later=JSON.parse(runtime.call('read_file',{path:'src/large.txt',offset:500,limit:20}).content[0].text);
  assert.equal(first.total_lines,520);assert.match(first.content,/LINE-0/);assert.doesNotMatch(first.content,/LINE-500/);
  assert.match(later.content,/LINE-500/);assert.match(later.content,/LINE-519/);
  assert.throws(()=>runtime.call('read_file',{path:'src/large.txt',offset:-1,limit:20}));
  runtime.call('move_file',{source:'src/b.txt',destination:'src/moved.txt'});assert.equal(fs.readFileSync(path.join(project,'src','moved.txt'),'utf8'),'safe');assert.throws(()=>runtime.call('move_file',{source:'src/a.txt',destination:'src/moved.txt'}));
  for(const target of ['.env','.git/config','.ai/PROJECT_STATE.json','.ai/runtime/tool-broker/x'])assert.throws(()=>runtime.call('read_file',{path:target}));
  assert.throws(()=>runtime.call('write_file',{path:'outside.txt',content:'escape'}));assert.throws(()=>runtime.call('run_argv',{argv:[process.execPath,'-e','fetch("https://evil")']}));
  const command=runtime.call('run_argv',{argv:[process.execPath,'--version']});assert.match(command.content[0].text,/exit=0/);
  const broker=createToolBrokerConfig({project,mode:'read_only',shellArgv:[]});try{for(const tool of CLAUDE_BUILTIN_TOOLS)assert.ok(broker.disallowedTools.includes(tool));assert.match(broker.allowedTools,/^mcp__page_autodev__/);assert.ok(!broker.allowedTools.includes('write_file'));assert.ok(!broker.allowedTools.includes('move_file'));const mcp=JSON.parse(fs.readFileSync(broker.mcpConfigPath,'utf8'));assert.equal(mcp.mcpServers.page_autodev.type,'stdio');assert.equal(mcp.mcpServers.page_autodev.args.at(-1),broker.policyPath);const input=['{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25"}}','{"jsonrpc":"2.0","method":"notifications/initialized"}','{"jsonrpc":"2.0","id":2,"method":"tools/list"}'].join('\n')+'\n';const child=spawnSync(mcp.mcpServers.page_autodev.command,mcp.mcpServers.page_autodev.args,{input,encoding:'utf8',timeout:5000});assert.equal(child.status,0,child.stderr);const frames=child.stdout.trim().split('\n').map(JSON.parse);assert.equal(frames.length,2);assert.equal(frames[0].result.serverInfo.name,'page-autodev-tool-broker');assert.equal(frames[1].result.tools.length,6);}finally{broker.cleanup();}
}finally{fs.rmSync(parent,{recursive:true,force:true});}
console.log('TOOL_BROKER_RUNTIME_TESTS_OK');
