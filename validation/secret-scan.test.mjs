import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { scanRuntimeSecrets, scanTrackedSecrets } from '../lib/secret-scan.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'secret-scan-'));
try{
  fs.mkdirSync(path.join(root,'.ai','logs'),{recursive:true}); fs.writeFileSync(path.join(root,'safe.txt'),'no credentials here');
  fs.writeFileSync(path.join(root,'leaked.txt'),['sk-','ant-','THISISNOTAREALSECRETBUTLONG'].join(''));
  fs.writeFileSync(path.join(root,'.ai','logs','worker.log'),['Bearer',' ','abcdefghijklmnopqrstuvwxyz0123456789'].join(''));
  for(const args of [['init','-q'],['add','safe.txt','leaked.txt']]) assert.equal(spawnSync('git',args,{cwd:root}).status,0);
  assert.deepEqual(scanTrackedSecrets(root),[{path:'leaked.txt',rule:'anthropic_key'}]);
  assert.deepEqual(scanRuntimeSecrets(root),[{path:'.ai/logs/worker.log',rule:'bearer_token'}]);
  fs.writeFileSync(path.join(root,'.ai','logs','key.log'),['-----BEGIN ','PRIVATE KEY-----\n','A'.repeat(96),'\n-----END ','PRIVATE KEY-----'].join('')); assert.ok(scanRuntimeSecrets(root).some(item=>item.path==='.ai/logs/key.log'&&item.rule==='private_key'));
  fs.rmSync(path.join(root,'leaked.txt')); assert.deepEqual(scanTrackedSecrets(root),[],'deleted tracked files must not leak content through scanner output');
}finally{fs.rmSync(root,{recursive:true,force:true});}
console.log('SECRET_SCAN_TESTS_OK');
