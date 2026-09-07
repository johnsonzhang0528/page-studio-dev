import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawnSync } from 'node:child_process';
import { createGitCheckpoint } from '../lib/git-checkpoint.mjs';

const project=fs.mkdtempSync(path.join(os.tmpdir(),'git-checkpoint-')),git=args=>spawnSync('git',args,{cwd:project,encoding:'utf8'});
git(['init','-q']); git(['config','user.name','Test']); git(['config','user.email','test@example.invalid']); fs.writeFileSync(path.join(project,'README.md'),'base\n'); git(['add','README.md']); git(['commit','-qm','base']);
const count=()=>Number(git(['rev-list','--count','HEAD']).stdout.trim()); const before=count();
fs.mkdirSync(path.join(project,'.ai','telemetry'),{recursive:true}); fs.writeFileSync(path.join(project,'.ai','PROJECT_STATE.json'),'{}\n'); fs.writeFileSync(path.join(project,'.ai','telemetry','usage.jsonl'),'{}\n');
assert.ok(createGitCheckpoint(project,{},'runtime only')); assert.equal(count(),before); assert.match(git(['status','--short']).stdout,/\.ai/,'runtime 檔應保留於工作樹但不得提交');
fs.mkdirSync(path.join(project,'src')); fs.writeFileSync(path.join(project,'src','app.js'),'export const ok=true;\n'); const commit=createGitCheckpoint(project,{},'product'); assert.ok(commit); assert.equal(count(),before+1); assert.match(git(['show','--name-only','--format=','HEAD']).stdout,/src\/app\.js/); assert.doesNotMatch(git(['show','--name-only','--format=','HEAD']).stdout,/\.ai/);
fs.rmSync(project,{recursive:true,force:true}); console.log('GIT_CHECKPOINT_TESTS_OK');
