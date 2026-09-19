import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyMonetizationHypotheses,buildNicheMonetizationPrefilter} from '../lib/niche-monetization-prefilter.mjs';

const candidate=(id,topic,category)=>({candidate_id:id,topic,category,stage:'CANDIDATE'});
test('informational tutorial is held before paid research',()=>{const out=classifyMonetizationHypotheses(candidate('TW-042','Excel工作技巧','learning'));assert.equal(out.monetization_prefilter.decision,'ADS_ONLY_HOLD');assert.equal(out.monetization_prefilter.paid_research_authorized,false);});
test('commercial comparison advances only to free validation',()=>{const out=classifyMonetizationHypotheses(candidate('TW-077','筆記軟體比較','digital'));assert.equal(out.monetization_prefilter.decision,'ADVANCE_FREE_COMMERCIAL_VALIDATION');assert.ok(out.monetization_prefilter.hypotheses.some(row=>row.id==='affiliate-commerce'));assert.equal(out.monetization_prefilter.automatic_enter,false);});
test('tool topic receives an automated-tool hypothesis without approval',()=>{const out=classifyMonetizationHypotheses(candidate('TW-080','圖片壓縮工具','digital'));assert.ok(out.monetization_prefilter.hypotheses.some(row=>row.id==='automated-tool'));assert.equal(out.monetization_prefilter.paid_research_authorized,false);});
test('batch requires exactly 100 and cannot authorize spend',()=>{const candidates=Array.from({length:100},(_,i)=>candidate(`TW-${String(i+1).padStart(3,'0')}`,i===0?'用品比較':`資訊主題${i}`,'home'));const out=buildNicheMonetizationPrefilter({schema_version:1,mode:'FREE_SOURCE_TAXONOMY_DISCOVERY',candidate_count:100,candidates});assert.equal(out.paid_api_spend_microusd,0);assert.equal(out.paid_research_authorized,false);assert.equal(out.advance_count,1);assert.equal(out.hold_count,99);});
test('partial candidate pools fail closed',()=>{assert.throws(()=>buildNicheMonetizationPrefilter({schema_version:1,candidate_count:1,candidates:[candidate('TW-001','用品比較','home')]}),/EXACT_100_CANDIDATES_REQUIRED/);});
