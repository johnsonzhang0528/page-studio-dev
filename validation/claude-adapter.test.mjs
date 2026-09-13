import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildClaudeCliArguments, buildControlledAgentDefinition, invokeClaudeCli } from '../lib/claude-adapter.mjs';

const controllerSource=fs.readFileSync(new URL('../lib/autodev.mjs',import.meta.url),'utf8');
assert.match(controllerSource,/invokeClaudeCli\(\{/); assert.doesNotMatch(controllerSource,/spawn\(path\.join\(os\.homedir\(\),'\.local','bin','claude'/);

const base={prompt:'same prompt',agent:'reviewer',kind:'gate',resultSchema:'{"type":"object"}',turnLimit:18,model:'opus',effort:'high',resumeSessionId:'session-1',resumable:true,fallback:'sonnet',allowedTools:'mcp__page_autodev__read_file',disallowedTools:['Read','Write','Edit','Bash','WebFetch'],mcpConfigPath:'/tmp/broker.mcp.json'};
const args=[...buildClaudeCliArguments(base)],agentsIndex=args.indexOf('--agents'),agentDefinition=JSON.parse(args[agentsIndex+1]);
assert.equal(args[0],'-p');assert.equal(args[1],'same prompt');assert.equal(args[agentsIndex+2],'--agent');assert.deepEqual(agentDefinition.reviewer.tools,['mcp__page_autodev__read_file']);assert.doesNotMatch(args[agentsIndex+1],/\b(?:Read|Write|Edit|Bash|Glob|Grep)\b/);
for(const required of ['--strict-mcp-config','--disable-slash-commands','--allowedTools','--disallowedTools'])assert.ok(args.includes(required));
assert.throws(()=>buildControlledAgentDefinition('reviewer','Read,mcp__page_autodev__read_file'),/CLAUDE_CONTROLLED_TOOLS_REQUIRED/);
assert.ok(buildClaudeCliArguments({...base,resumeSessionId:null,resumable:false,fallback:'opus'}).includes('--no-session-persistence'));
{const produce=buildClaudeCliArguments({...base,kind:'produce'}),permission=produce.indexOf('--permission-mode');assert.equal(produce[permission+1],'auto');}
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'claude-adapter-test-')),logPath=path.join(temporary,'adapter.log'); let captured=null,tracked=0,released=0;
const spawnProcess=(executable,args,options)=>{ captured={executable,args,options}; const child=new EventEmitter(); child.stdout=new PassThrough(); child.stderr=new PassThrough(); queueMicrotask(()=>{ child.stdout.end('{"ok":true,"token":"plain-secret"}'); child.stderr.end('Authorization=Bearer abc.def'); child.emit('close',0); }); return child; };
const lease={release(){released+=1;},heartbeat(){}};
const result=await invokeClaudeCli({executable:'/fake/claude',args:['--version'],cwd:temporary,env:{PATH:'/fake'},timeoutSeconds:2,lease,logPath,phase:'fixture',logTimestamp:()=> '2026-09-08T00:00:00Z',spawnProcess,track(){tracked+=1;}});
assert.equal(result.code,0); assert.match(result.stdout,/plain-secret/); assert.match(result.stderr,/abc\.def/); assert.ok(result.wall_duration_ms>=0); assert.equal(captured.executable,'/fake/claude'); assert.deepEqual(captured.args,['--version']); assert.equal(captured.options.detached,true); assert.equal(tracked,1); assert.equal(released,1); const persisted=fs.readFileSync(logPath,'utf8'); assert.match(persisted,/fixture exit=0/); assert.doesNotMatch(persisted,/plain-secret|abc\.def/); assert.match(persisted,/\[REDACTED\]/);
await assert.rejects(invokeClaudeCli({executable:'/missing',args:['x'],cwd:temporary,env:{},timeoutSeconds:1,lease,logPath,phase:'fixture',logTimestamp:()=>'',spawnProcess(){ throw new Error('spawn failed'); }}),/spawn failed/); assert.equal(released,2);
fs.rmSync(temporary,{recursive:true,force:true}); console.log('CLAUDE_ADAPTER_TESTS_OK');
