import assert from 'node:assert/strict';
import test from 'node:test';
import {validateSerpLiveAdvancedRequest,allowedSerpLocationCodes,SERP_LOCATION_ALLOWLIST} from '../lib/dataforseo-serp-contract.mjs';

const base=(overrides={})=>({keyword:'玻璃隔間',location_code:2158,language_code:'zh-TW',
  device:'desktop',os:'windows',depth:10,tag:'dfs-serp-calibration-01',...overrides});

test('Taiwan country code is allowed',()=>{
  assert.equal(validateSerpLiveAdvancedRequest(base()).ok,true);
});

test('verified Taichung City code is allowed',()=>{
  assert.equal(validateSerpLiveAdvancedRequest(base({location_code:9040380})).ok,true);
  const entry=SERP_LOCATION_ALLOWLIST[9040380];
  assert.equal(entry.verified,true);
  assert.equal(entry.name,'Taichung City,Taiwan');
  assert.equal(entry.parent,2158);
  assert.equal(entry.location_type,'City');
  assert.match(entry.evidence,/locations_serp_google_2026_09_01\.csv/,'must cite official CSV');
});

test('allowlist is exactly the two verified codes',()=>{
  assert.deepEqual(allowedSerpLocationCodes().sort((a,b)=>a-b),[2158,9040380]);
});

test('nested sub-city Taichung code is rejected',()=>{
  // 9195800 = "Taichung,Taichung City,Taiwan", parent 9040380 -> inside the city, wrong granularity.
  const result=validateSerpLiveAdvancedRequest(base({location_code:9195800}));
  assert.equal(result.ok,false);
  assert.ok(result.errors.includes('SERP_LOCATION_NOT_ALLOWLISTED'));
});

test('Taichung districts and postal codes are rejected',()=>{
  for(const code of [9207410,9251456,9210117,9249768,9197734,9199024,9041338]){
    assert.equal(validateSerpLiveAdvancedRequest(base({location_code:code})).ok,false,
      `narrower-than-city code ${code} must be rejected`);
  }
});

test('non-allowlisted location code is rejected',()=>{
  // 2840 = United States; must never be dispatchable for this project.
  const result=validateSerpLiveAdvancedRequest(base({location_code:2840}));
  assert.equal(result.ok,false);
  assert.ok(result.errors.includes('SERP_LOCATION_NOT_ALLOWLISTED'));
});

test('fake/guessed Taichung code is rejected',()=>{
  // 1012724 was a plausible guess before official verification; it is not the real code.
  const result=validateSerpLiveAdvancedRequest(base({location_code:1012724}));
  assert.equal(result.ok,false);
  assert.ok(result.errors.includes('SERP_LOCATION_NOT_ALLOWLISTED'),'guessed codes must fail closed');
});

test('location_name bypass is rejected',()=>{
  const result=validateSerpLiveAdvancedRequest(base({location_name:'Taichung,Taiwan'}));
  assert.equal(result.ok,false);
  assert.ok(result.errors.some(e=>e.startsWith('UNKNOWN_OR_PAID_FIELD:location_name')));
});

test('location_name bypass rejected even without location_code',()=>{
  const request=base();
  delete request.location_code;
  request.location_name='Taichung,Taiwan';
  const result=validateSerpLiveAdvancedRequest(request);
  assert.equal(result.ok,false);
  assert.ok(result.errors.includes('SERP_LOCATION_NOT_ALLOWLISTED'));
});

test('malformed location codes are rejected',()=>{
  for(const value of [null,undefined,'2158',2158.5,NaN,-2158,[2158],{code:2158},Number.MAX_SAFE_INTEGER]){
    const result=validateSerpLiveAdvancedRequest(base({location_code:value}));
    assert.equal(result.ok,false,`location_code ${String(value)} must be rejected`);
  }
});

test('allowlist entries are frozen against runtime mutation',()=>{
  assert.throws(()=>{SERP_LOCATION_ALLOWLIST[9040380].verified=false;},TypeError);
  assert.throws(()=>{SERP_LOCATION_ALLOWLIST[2158].verified=false;},TypeError);
  assert.equal(SERP_LOCATION_ALLOWLIST[9040380].verified,true);
  assert.deepEqual(allowedSerpLocationCodes().sort((a,b)=>a-b),[2158,9040380]);
});

test('an unverified allowlist entry would not be dispatchable',()=>{
  // Guards the fail-closed rule itself: verified:false never yields a dispatchable code.
  const unverified=Object.entries(SERP_LOCATION_ALLOWLIST).filter(([,e])=>e.verified!==true).map(([k])=>k);
  for(const key of unverified){
    if(/^\d+$/.test(key))assert.ok(!allowedSerpLocationCodes().includes(Number(key)),`${key} must not be dispatchable`);
  }
});

test('other security constraints still hold',()=>{
  assert.equal(validateSerpLiveAdvancedRequest(base({language_code:'zh-CN'})).ok,false,'simplified Chinese rejected');
  assert.equal(validateSerpLiveAdvancedRequest(base({depth:100})).ok,false,'depth inflation rejected');
  assert.equal(validateSerpLiveAdvancedRequest(base({keyword:'site:example.com'})).ok,false,'search operators rejected');
});
