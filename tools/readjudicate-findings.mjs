#!/usr/bin/env node
// 以確定性機器證據重新裁定既有 Gate findings。
// 預設 dry-run；加上 --apply 才會寫入，且一律走 gate-findings 的合法狀態機轉移。
import path from 'node:path';
import { adjudicateFindings, diagramVisualFacts, lifecycleCanonicalFacts, appendGateAudit, DISPOSITIONS } from '../lib/finding-adjudication.mjs';
import { loadFindings, saveFindings, beginRepair, beginVerification, finishVerification } from '../lib/gate-findings.mjs';

const project=path.resolve(process.argv[2]??'.');
const apply=process.argv.includes('--apply');
const gatePhase=process.argv.includes('--gate')?process.argv[process.argv.indexOf('--gate')+1]:'architecture_gate';
const quality=process.argv.includes('--quality')?process.argv[process.argv.indexOf('--quality')+1]:'standard';
const ACTIVE=['open','reopened','repairing','verifying'];

const facts={visual:diagramVisualFacts(project,quality),lifecycle:lifecycleCanonicalFacts(project)};
const store=loadFindings(project);
const active=store.findings.filter(item=>item.gate_phase===gatePhase&&ACTIVE.includes(item.status));
const results=adjudicateFindings(active,facts);
const contradicted=results.filter(item=>item.disposition===DISPOSITIONS.contradicted);
const surviving=results.filter(item=>item.disposition===DISPOSITIONS.survives);

console.log(`專案：${project}｜Gate：${gatePhase}｜visual profile：${quality}`);
console.log(`lifecycle canonical 完整：${facts.lifecycle.canonicalComplete}`);
console.log(`各圖 effective：${Object.entries(facts.visual).map(([key,item])=>`${key}=${item.effective_status}`).join('、')||'（無）'}`);
console.log(`\n有效 findings ${active.length}｜將機器推翻 ${contradicted.length}｜維持真實缺陷 ${surviving.length}\n`);
console.log('--- 將關閉（machine-contradicted）---');
for(const item of contradicted) console.log(`  ${item.finding.id} [${item.rule_id}] ${item.finding.title.slice(0,64)}`);
console.log('\n--- 維持 open（真實缺陷，交由 semantic owner）---');
for(const item of surviving) console.log(`  ${item.finding.id} ${item.finding.title.slice(0,64)}`);

if(!apply){ console.log('\n[dry-run] 未寫入任何變更；確認後加上 --apply。'); process.exit(0); }

const ids=contradicted.map(item=>item.finding.id);
const byId=new Map(store.findings.map(item=>[item.id,item]));
beginRepair(store,ids.filter(id=>['open','reopened'].includes(byId.get(id)?.status)));
beginVerification(store,ids);
finishVerification(store,contradicted.map(item=>({id:item.finding.id,pass:true,evidence:item.machine_evidence.join(' | ')})));
for(const item of contradicted){
  const record=byId.get(item.finding.id);
  if(!record) continue;
  record.adjudication_disposition=DISPOSITIONS.contradicted;
  record.rule_id=item.rule_id;
  record.machine_evidence=item.machine_evidence;
}
saveFindings(project,store);
appendGateAudit(project,{event:'finding_readjudication',gate_phase:gatePhase,contradicted:ids,surviving:surviving.length,rule_ids:[...new Set(contradicted.map(item=>item.rule_id))]});

const after=loadFindings(project);
console.log('\n[applied]');
for(const id of ids) console.log(`  ${id} -> ${after.findings.find(item=>item.id===id)?.status}`);
console.log(`剩餘有效 findings：${after.findings.filter(item=>item.gate_phase===gatePhase&&ACTIVE.includes(item.status)).length}`);
