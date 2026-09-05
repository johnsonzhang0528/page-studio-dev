#!/usr/bin/env node
// 既有專案的 legacy provenance 標記。
// 舊的 architecture_spec_frozen_at 只是 timestamp，沒有 content-addressed 證明，
// 不可當成 Semantic Freeze authority；舊 HTML 沒有 build receipt 亦不可視為已證明。
// 預設 dry-run，--apply 才寫入。
import fs from 'node:fs';
import path from 'node:path';
import { readSemanticFreeze, buildProvenanceStatus, DIAGRAMS } from '../lib/architecture-provenance.mjs';

const project=path.resolve(process.argv[2]??'.');
const apply=process.argv.includes('--apply');
const statePath=path.join(project,'.ai','PROJECT_STATE.json');
const state=JSON.parse(fs.readFileSync(statePath,'utf8'));

const notes=[];
if(state.architecture_spec_frozen_at&&!readSemanticFreeze(project))
  notes.push(`architecture_spec_frozen_at=${state.architecture_spec_frozen_at} → LEGACY_UNTRUSTED_FREEZE（無 content-addressed receipt）`);
for(const key of Object.keys(DIAGRAMS)){
  const status=buildProvenanceStatus(project,key,{});
  if(!status.current) notes.push(`${key} → ${status.reason}`);
}

console.log(`專案：${project}`);
console.log(`目前 status：${state.status}｜blocker：${state.blocker??'（無）'}`);
console.log('\n--- legacy provenance ---');
for(const note of notes) console.log(`  ${note}`);

if(!apply){ console.log('\n[dry-run] 未寫入；確認後加上 --apply。'); process.exit(0); }

// 舊 freeze timestamp 保留為 audit，但不再作為 authority。
if(state.architecture_spec_frozen_at&&!readSemanticFreeze(project)){
  state.legacy_architecture_spec_frozen_at=state.architecture_spec_frozen_at;
  delete state.architecture_spec_frozen_at;
  state.legacy_freeze_untrusted=true;
}
state.legacy_build_provenance_pending=true;
state.updated_at=new Date().toISOString();
fs.writeFileSync(statePath,JSON.stringify(state,null,2)+'\n');
console.log('\n[applied] 舊 freeze timestamp 已移入 legacy_architecture_spec_frozen_at；必須重新建立 content-addressed Freeze 與 build provenance。');
