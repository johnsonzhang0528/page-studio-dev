import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateBusinessModelCandidate,evaluateBusinessModelGate} from '../lib/business-model-gate.mjs';

const verified={channel_eligibility:'VERIFIED',search_intent_fit:'VERIFIED',revenue_rate:'VERIFIED',traffic_requirement:'VERIFIED',operating_cost:'VERIFIED',legal_policy:'VERIFIED',dependency_resilience:'VERIFIED',worst_case_viability:'VERIFIED',kill_rule:'VERIFIED'};
const model={id:'ads',type:'DISPLAY_ADS',requires_manual_product_production:false,requires_manual_customer_fulfillment:false,automation_ratio_bps:9800,ongoing_manual_hours_per_1000_visits:1,evidence:verified,economic_scenarios:[{name:'CONSERVATIVE'},{name:'BASE'},{name:'UPSIDE'}]};
const base={schema_version:2,niche_id:'excel-work-tips',pilot_cash_cap_twd:1500,pilot_hour_cap:20,models:[model]};
test('manual product production is rejected even with perfect evidence',()=>{const out=evaluateBusinessModelCandidate({...model,id:'template',requires_manual_product_production:true});assert.equal(out.decision,'REJECT');assert.ok(out.rejection_reasons.includes('MANUAL_PRODUCT_PRODUCTION_FORBIDDEN'));});
test('manual fulfilment and low automation cannot hide behind revenue',()=>{const out=evaluateBusinessModelCandidate({...model,requires_manual_customer_fulfillment:true,automation_ratio_bps:8999});assert.equal(out.decision,'REJECT');assert.equal(out.rejection_reasons.length,2);});
test('unknown commercial evidence hard-stops an otherwise automated model',()=>{const out=evaluateBusinessModelGate({...base,models:[{...model,evidence:{...verified,revenue_rate:'UNVERIFIED'}}]});assert.equal(out.decision,'HOLD_BUSINESS_MODEL_NOT_VALIDATED');assert.equal(out.can_release_pilot,false);});
test('one fully evidenced automated model permits only a pilot',()=>{const out=evaluateBusinessModelGate(base);assert.equal(out.decision,'PILOT_BUSINESS_MODEL_APPROVED');assert.equal(out.can_release_pilot,true);assert.equal(out.can_build_site,false);assert.deepEqual(out.approved_model_ids,['ads']);});
test('a niche with only manual models is rejected',()=>{const out=evaluateBusinessModelGate({...base,models:[{...model,id:'consulting',requires_manual_customer_fulfillment:true}]});assert.equal(out.decision,'REJECT_NICHE_NO_AUTOMATED_MODEL');});
test('missing death-test dimensions fail closed',()=>{assert.throws(()=>evaluateBusinessModelCandidate({...model,evidence:{}}),/INVALID_EVIDENCE_channel_eligibility/);});
