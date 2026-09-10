import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'release-preflight-')),candidate=path.join(root,'candidate'),live=path.join(root,'live'),script=fileURLToPath(new URL('./release-soak-preflight.mjs',import.meta.url));
const git=(cwd,args)=>{const run=spawnSync('git',args,{cwd,encoding:'utf8'});assert.equal(run.status,0,run.stderr);return run.stdout.trim();};
const init=(dir,branch,artifacts=false)=>{fs.mkdirSync(dir,{recursive:true});git(dir,['init','-q','-b',branch]);git(dir,['config','user.name','Preflight Test']);git(dir,['config','user.email','preflight@example.invalid']);fs.writeFileSync(path.join(dir,'README.md'),'fixture\n');if(artifacts){fs.mkdirSync(path.join(dir,'validation'));for(const name of ['shadow-soak.mjs','isolated-project-flows.test.mjs','death-test-traceability.test.mjs','hybrid-controller-death.test.mjs','tool-broker-escape-death.test.mjs'])fs.writeFileSync(path.join(dir,'validation',name),'// fixture\n');}git(dir,['add','.']);git(dir,['commit','-qm','fixture']);};
try{
  init(candidate,'codex/test-rc',true);init(live,'main');const candidateHead=git(candidate,['rev-parse','HEAD']),liveHead=git(live,['rev-parse','HEAD']);
  const run=overrides=>{const output=path.join(root,`receipt-${Math.random()}.json`),result=spawnSync(process.execPath,[script],{encoding:'utf8',env:{PATH:process.env.PATH,RELEASE_CANDIDATE_ROOT:candidate,RELEASE_LIVE_ROOT:live,RELEASE_CANDIDATE_EXPECTED_BRANCH:'codex/test-rc',RELEASE_CANDIDATE_EXPECTED_HEAD:candidateHead,RELEASE_LIVE_EXPECTED_HEAD:liveHead,RELEASE_PREFLIGHT_OUTPUT:output,...overrides}});return {result,receipt:JSON.parse(fs.readFileSync(output,'utf8'))};};
  const allowed=run({}),allowedIdentity=allowed.receipt.checks.filter(check=>check.id.startsWith('candidate:'));assert.equal(allowedIdentity.every(check=>check.ok),true,JSON.stringify(allowedIdentity));assert.equal(allowed.receipt.failures.every(id=>id.startsWith('resource:')),true);console.log('RELEASE_PREFLIGHT_EVIDENCE explicit_branch_and_head_allowed');
  const wrongBranch=run({RELEASE_CANDIDATE_EXPECTED_BRANCH:'codex/wrong'});assert.equal(wrongBranch.receipt.checks.find(check=>check.id==='candidate:branch').ok,false);console.log('RELEASE_PREFLIGHT_EVIDENCE wrong_branch_denied');
  const wrongHead=run({RELEASE_CANDIDATE_EXPECTED_HEAD:'0'.repeat(40)});assert.equal(wrongHead.receipt.checks.find(check=>check.id==='candidate:frozen-head').ok,false);console.log('RELEASE_PREFLIGHT_EVIDENCE wrong_head_denied');
  const missing=run({RELEASE_CANDIDATE_EXPECTED_BRANCH:'',RELEASE_CANDIDATE_EXPECTED_HEAD:''});assert.equal(missing.receipt.checks.filter(check=>check.id.includes('configured')).every(check=>!check.ok),true);console.log('RELEASE_PREFLIGHT_EVIDENCE missing_expectations_denied');
}finally{fs.rmSync(root,{recursive:true,force:true});}
console.log('RELEASE_SOAK_PREFLIGHT_TESTS_OK');
