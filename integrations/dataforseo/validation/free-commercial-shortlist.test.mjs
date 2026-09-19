import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFreeCommercialShortlist} from '../lib/free-commercial-shortlist.mjs';
const row=(id,topic,category,hypotheses=[{id:'display-ads'},{id:'affiliate-commerce'}])=>({candidate_id:id,topic,category,monetization_prefilter:{decision:'ADVANCE_FREE_COMMERCIAL_VALIDATION',hypotheses}});
const source={mode:'FREE_MONETIZATION_PREFILTER',paid_research_authorized:false,candidate_count:4,candidates:[row('TW-001','貓砂比較','pets'),row('TW-002','寵物友善住宿','pets'),row('TW-003','Excel工作技巧','learning'),row('TW-004','圖片壓縮工具','digital',[{id:'display-ads'},{id:'automated-tool'}])]};
test('explicit product comparison outranks high-maintenance lodging and tool build',()=>{const out=buildFreeCommercialShortlist(source);assert.equal(out.candidates[0].topic,'貓砂比較');assert.equal(out.candidates.some(x=>x.topic==='寵物友善住宿'),false);});
test('shortlist never approves business state or paid research',()=>{const out=buildFreeCommercialShortlist(source);assert.equal(out.business_model_approved,false);assert.equal(out.paid_research_authorized,false);assert.equal(out.paid_api_spend_microusd,0);assert.ok(out.candidates.every(x=>x.free_commercial_assessment.decision==='DEATH_TEST_REQUIRED'));});
test('unverified source or unsafe limit fails closed',()=>{assert.throws(()=>buildFreeCommercialShortlist({...source,paid_research_authorized:true}),/VERIFIED_FREE_PREFILTER_REQUIRED/);assert.throws(()=>buildFreeCommercialShortlist(source,{limit:21}),/INVALID_SHORTLIST_LIMIT/);});
