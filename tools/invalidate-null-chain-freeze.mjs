#!/usr/bin/env node
// 使以 null / legacy requirements-approval chain 建立的 Semantic Freeze 失效。
// 依 FINAL v5.1 §13/§14：不重做仍有效的 SPEC / FOUNDATION / ADR 成果，
// 只讓 Freeze 與其下游 provenance 重新建立。預設 dry-run，--apply 才寫入。
import fs from 'node:fs';
import path from 'node:path';
import { readSemanticFreeze } from '../lib/architecture-provenance.mjs';
import { requirementsApprovalGate, semanticFreezeUpstreamValid } from '../lib/requirements-approval.mjs';
import { invalidateDerivedWorkUnit, SEMANTIC_FREEZE_UNIT, EVIDENCE_SYNC_UNIT } from '../lib/architecture-model.mjs';

const project=path.resolve(process.argv[2]??'.');
const apply=process.argv.includes('--apply');
const statePath=path.join(project,'.ai','PROJECT_STATE.json');
const graphPath=path.join(project,'.ai','PHASE_TASK_GRAPH.json');
const state=JSON.parse(fs.readFileSync(statePath,'utf8'));
const graph=JSON.parse(fs.readFileSync(graphPath,'utf8'));
const revision=state.input_revision??0;

const upstream=requirementsApprovalGate(project,revision);
const freezeReceipt=readSemanticFreeze(project);
const chain=semanticFreezeUpstreamValid(freezeReceipt,upstream.fingerprint??null);

const units=graph.phases?.architecture?.units??[];
const freezeUnit=units.find(unit=>unit.id===SEMANTIC_FREEZE_UNIT);
const evidenceUnit=units.find(unit=>unit.id===EVIDENCE_SYNC_UNIT);
// SPEC 仍在修復時，其 BUILD/VERIFY 的既有產物已不對應現行語意。
const repairingSpecs=units.filter(unit=>/-SPEC$/.test(unit.id)&&['repairing','pending','running'].includes(unit.status)).map(unit=>unit.id);
const derived=units.filter(unit=>/-BUILD$|-VERIFY$/.test(unit.id)&&unit.status==='complete');

console.log(`專案：${project}｜input_revision：${revision}`);
console.log(`Requirements approval：${upstream.code}（${upstream.reason}）`);
console.log(`Semantic Freeze receipt：${freezeReceipt?'存在':'不存在'}｜chain 有效：${chain.valid}（${chain.reason}）`);
console.log(`ARCH-SPEC-FREEZE 目前狀態：${freezeUnit?.status??'(缺)'}`);
console.log(`仍在修復的 SPEC：${repairingSpecs.join('、')||'（無）'}`);
console.log(`將失效的既有 BUILD/VERIFY：${derived.map(unit=>unit.id).join('、')||'（無）'}`);

if(chain.valid&&freezeUnit?.status!=='complete'){ console.log('\n無需處理：freeze chain 已有效。'); process.exit(0); }
if(!apply){ console.log('\n[dry-run] 未寫入；確認後加上 --apply。'); process.exit(0); }

const at=new Date().toISOString();
if(freezeUnit){ invalidateDerivedWorkUnit(freezeUnit,{reason:'upstream requirements approval chain 不完整或 SPEC 仍在修復，Freeze 必須重新執行',at}); }
if(evidenceUnit&&evidenceUnit.status!=='pending'){ invalidateDerivedWorkUnit(evidenceUnit,{reason:'Semantic Freeze 重建後 evidence 必須重新同步',at}); }
for(const unit of derived) invalidateDerivedWorkUnit(unit,{reason:'既有產物建立於未經證明的 Freeze／舊語意，必須依新 generation key 重建',at});

delete state.architecture_spec_frozen_at; delete state.semantic_freeze_fingerprint; delete state.architecture_generation_key;
state.updated_at=at;
graph.revision=(graph.revision??0)+1;
graph.phases.architecture.status='in_progress';
graph.phases.architecture.updated_at=at;
fs.writeFileSync(graphPath,JSON.stringify(graph,null,2)+'\n');
fs.writeFileSync(statePath,JSON.stringify(state,null,2)+'\n');
try{ fs.rmSync(path.join(project,'.ai','architecture','semantic-freeze.json'),{force:true}); }catch{}
console.log(`\n[applied] ARCH-SPEC-FREEZE → pending；${derived.length} 個 BUILD/VERIFY 已整代失效；generation key 已清除。`);
console.log('既有 SPEC／FOUNDATION／ADR 語意成果未被重置。');
