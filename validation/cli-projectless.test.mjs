import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const controller=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','lib','autodev.mjs');
for(const [command,pattern] of [['help',/使用方式：page-autodev/],['version',/^0\.1\.0\s*$/]]){
  const result=spawnSync(process.execPath,[controller,command],{cwd:os.tmpdir(),encoding:'utf8'});
  assert.equal(result.status,0,`${command} must run without resolving a Project: ${result.stderr}`);
  assert.match(result.stdout,pattern);
}
console.log('CLI_PROJECTLESS_TESTS_OK');
