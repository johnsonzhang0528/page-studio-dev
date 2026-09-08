import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawnSync } from 'node:child_process';
import { gateArtifactManifest, gateCacheProbe, saveGateCachePass } from '../lib/gate-artifact-cache.mjs';

const project=fs.mkdtempSync(path.join(os.tmpdir(),'gate-cache-')),git=args=>spawnSync('git',args,{cwd:project,encoding:'utf8'}),policy={cache_version:4,result_schema:'v1',policy_fingerprint:'policy-a'};
git(['init','-q']); git(['config','user.name','Test']); git(['config','user.email','test@example.invalid']); fs.mkdirSync(path.join(project,'docs','architecture'),{recursive:true}); fs.writeFileSync(path.join(project,'docs','architecture','ARCHITECTURE.md'),'v1\n'); git(['add','.']); git(['commit','-qm','base']);
const unit={id:'ARCH-GATE-TRACE',prompt:'review'}; saveGateCachePass(project,'architecture_gate',unit,{summary:'pass',evidence:[]},{verification_mode:'targeted',active_findings:['GF-B','GF-A']},policy);
assert.equal(gateCacheProbe(project,'architecture_gate',unit,{verification_mode:'targeted',active_findings:['GF-A','GF-B']},policy).hit,true);
assert.equal(gateCacheProbe(project,'architecture_gate',unit,{verification_mode:'targeted',active_findings:['GF-A']},policy).hit,false);
assert.equal(gateCacheProbe(project,'architecture_gate',unit,{verification_mode:'full',active_findings:[]},policy).hit,false);
fs.writeFileSync(path.join(project,'docs','architecture','ARCHITECTURE.md'),'v2\n'); const changed=gateCacheProbe(project,'architecture_gate',unit,{verification_mode:'targeted',active_findings:['GF-A','GF-B']},policy); assert.equal(changed.hit,false); assert.ok(changed.changed.includes('docs/architecture/ARCHITECTURE.md'));
assert.notEqual(gateArtifactManifest(project,'architecture_gate',unit,{},policy)['@policy'],gateArtifactManifest(project,'architecture_gate',unit,{}, {...policy,policy_fingerprint:'policy-b'})['@policy']);
fs.writeFileSync(path.join(project,'.ai','GATE_CACHE.json'),'{broken'); assert.equal(gateCacheProbe(project,'architecture_gate',unit,{},policy).hit,false);
assert.equal(fs.readdirSync(path.join(project,'.ai','quarantine','corrupt_rebuildable_cache')).filter(name=>name.endsWith('.corrupt')).length,1,'損壞 cache 必須隔離後強制 miss');
fs.rmSync(project,{recursive:true,force:true}); console.log('GATE_ARTIFACT_CACHE_TESTS_OK');
