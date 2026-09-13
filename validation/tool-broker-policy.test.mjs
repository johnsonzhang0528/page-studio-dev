import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createToolBrokerPolicy } from '../lib/tool-broker-policy.mjs';

const parent=fs.mkdtempSync(path.join(os.tmpdir(),'tool-broker-')),root=path.join(parent,'project');fs.mkdirSync(path.join(root,'src'),{recursive:true});fs.writeFileSync(path.join(root,'src','a.js'),'ok');fs.writeFileSync(path.join(parent,'secret'),'secret');
try{
  const readonly=createToolBrokerPolicy({project:root,read_scope:['src'],shell_argv:[['git','diff','--','src/a.js']],mode:'read_only'});
  assert.equal(readonly.authorizeRead('src/a.js'),path.join(root,'src','a.js'));assert.deepEqual(readonly.authorizeShell(['git','diff','--','src/a.js']),['git','diff','--','src/a.js']);
  for(const candidate of ['../secret','src/../../secret','/etc/passwd'])assert.throws(()=>readonly.authorizeRead(candidate),error=>error.code==='TOOL_BROKER_DENIED');
  assert.throws(()=>readonly.authorizeRead('package.json'),error=>error.code==='TOOL_BROKER_DENIED');assert.throws(()=>readonly.authorizeWrite('src/a.js'),error=>error.code==='TOOL_BROKER_DENIED');assert.throws(()=>readonly.authorizeShell(['node','-e','fetch("https://evil")']),error=>error.code==='TOOL_BROKER_DENIED');assert.throws(()=>readonly.authorizeShell(['git','push']),error=>error.code==='TOOL_BROKER_DENIED');assert.throws(()=>readonly.authorizeNetwork('https://example.com'),error=>error.code==='TOOL_BROKER_DENIED');
  if(process.platform!=='win32'){fs.symlinkSync(path.join(parent,'secret'),path.join(root,'src','escape.txt'));assert.throws(()=>readonly.authorizeRead('src/escape.txt'),error=>error.code==='TOOL_BROKER_DENIED');}
  const rootReader=createToolBrokerPolicy({project:root,read_scope:['.'],mode:'read_only'});assert.equal(rootReader.authorizeRead('.'),root);
  const writable=createToolBrokerPolicy({project:root,read_scope:['.'],write_scope:['.'],mode:'isolated_write'});assert.equal(writable.authorizeWrite('src/new.js'),path.join(root,'src','new.js'));assert.equal(writable.authorizeWrite('.ai/INPUT_INDEX.json'),path.join(root,'.ai','INPUT_INDEX.json'));assert.throws(()=>writable.authorizeWrite('.ai/PROJECT_STATE.json'),error=>error.code==='TOOL_BROKER_DENIED');
}finally{fs.rmSync(parent,{recursive:true,force:true});}
console.log('TOOL_BROKER_POLICY_TESTS_OK');
