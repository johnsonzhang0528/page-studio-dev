import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createToolBrokerRuntime } from '../lib/tool-broker-runtime.mjs';

const parent=fs.mkdtempSync(path.join(os.tmpdir(),'broker-death-')),project=path.join(parent,'project');fs.mkdirSync(path.join(project,'src'),{recursive:true});fs.writeFileSync(path.join(parent,'credential'),'never-read');fs.writeFileSync(path.join(project,'src','ok'),'ok');
try{
  const broker=createToolBrokerRuntime({project,mode:'read_only',read_scope:['.'],shell_argv:[['git','status','--short']]});
  const attacks=[
    ['DT-047','parent_path_secret_read',()=>broker.call('read_file',{path:'../credential'})],
    ['DT-048','nested_traversal_secret_read',()=>broker.call('read_file',{path:'src/../../credential'})],
    ['DT-049','readonly_write_attempt',()=>broker.call('write_file',{path:'src/pwned',content:'x'})],
    ['DT-050','network_process_escape',()=>broker.call('run_argv',{argv:['node','-e','require("net").connect(443,"evil.example")']})],
    ['DT-051','git_push_escape',()=>broker.call('run_argv',{argv:['git','push']})],
    ['DT-052','shell_secret_escape',()=>broker.call('run_argv',{argv:['sh','-c','cat ../credential']})],
    ['DT-053','unknown_tool_escape',()=>broker.call('unknown_tool',{})]
  ];
  for(const [id,name,attack] of attacks){assert.throws(attack);console.log(`DEATH_EVIDENCE ${id} ${name}`);}assert.equal(fs.existsSync(path.join(project,'src','pwned')),false);
}finally{fs.rmSync(parent,{recursive:true,force:true});}
console.log('TOOL_BROKER_ESCAPE_DEATH_TESTS_OK');
