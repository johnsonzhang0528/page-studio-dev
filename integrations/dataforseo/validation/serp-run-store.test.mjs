import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {SerpRunStore,QUERY_STATUS,slugify} from '../lib/serp-run-store.mjs';

const tmpRoot=()=>fs.mkdtempSync(path.join(os.tmpdir(),'serp-store-'));
const envelope=keyword=>({status_code:20000,tasks:[{id:'task-abc',status_code:20000,cost:0.002,
  result:[{keyword,items:[{type:'organic',rank_group:1,domain:'example.tw',url:'https://example.tw/a',title:'t'}]}]}]});

// Test A: provider response survives a crash before the next query runs.
test('A: raw result persists across process restart; no re-purchase needed',()=>{
  const root=tmpRoot();
  const first=new SerpRunStore({root,run_id:'runA'});
  first.markDispatched('q1',{index:0,keyword:'玻璃隔間',request_id:'r1',estimated_microusd:2000});
  first.persistRawResponse('q1',{index:0,keyword:'玻璃隔間',envelope:envelope('玻璃隔間')});
  first.markSettled('q1',{actual_microusd:2000});
  // simulate crash before q2: brand new instance reads from disk only
  const resumed=new SerpRunStore({root,run_id:'runA'});
  const record=resumed.get('q1');
  assert.equal(record.status,QUERY_STATUS.SETTLED);
  assert.ok(fs.existsSync(record.raw_response_path),'raw file must survive restart');
  const saved=JSON.parse(fs.readFileSync(record.raw_response_path,'utf8'));
  assert.equal(saved.tasks[0].result[0].items[0].domain,'example.tw');
  assert.equal(resumed.isReusable('q1'),true);
  assert.equal(resumed.isRedispatchForbidden('q1'),true,'settled+raw must never be re-dispatched');
  assert.equal(record.response_sha256.length,64);
});

// Test B: dispatched then client timeout -> UNKNOWN_HOLD, never auto-retried.
test('B: timeout after dispatch becomes UNKNOWN_HOLD and blocks redispatch',()=>{
  const root=tmpRoot();
  const store=new SerpRunStore({root,run_id:'runB'});
  store.markDispatched('q4',{index:3,keyword:'店面玻璃門',request_id:'r4',estimated_microusd:2000});
  assert.equal(store.get('q4').status,QUERY_STATUS.UNKNOWN_HOLD);
  assert.equal(store.isRedispatchForbidden('q4'),true,'UNKNOWN_HOLD must block retry');
  assert.equal(store.isReusable('q4'),false,'no raw result to reuse');
  const resumed=new SerpRunStore({root,run_id:'runB'});
  assert.equal(resumed.isRedispatchForbidden('q4'),true,'must still block after restart');
});

// Test C: 3 settled then 4th fails -> all 3 raw files intact (the actual incident).
test('C: earlier paid results intact when a later query fails',()=>{
  const root=tmpRoot();
  const store=new SerpRunStore({root,run_id:'runC'});
  const keywords=['玻璃隔間','辦公室玻璃隔間','辦公室隔間費用'];
  keywords.forEach((keyword,index)=>{
    const key=`q${index+1}`;
    store.markDispatched(key,{index,keyword,request_id:`r${index+1}`,estimated_microusd:2000});
    store.persistRawResponse(key,{index,keyword,envelope:envelope(keyword)});
    store.markSettled(key,{actual_microusd:2000});
  });
  store.markDispatched('q4',{index:3,keyword:'店面玻璃門',request_id:'r4',estimated_microusd:2000});
  store.markFailed('q4',{status:QUERY_STATUS.FAILED_AFTER_DISPATCH,error:'TIMEOUT'});
  const resumed=new SerpRunStore({root,run_id:'runC'});
  keywords.forEach((keyword,index)=>{
    const record=resumed.get(`q${index+1}`);
    assert.equal(record.status,QUERY_STATUS.SETTLED);
    assert.ok(fs.existsSync(record.raw_response_path),`q${index+1} raw must exist`);
    assert.equal(JSON.parse(fs.readFileSync(record.raw_response_path,'utf8')).tasks[0].result[0].keyword,keyword);
  });
  assert.equal(resumed.get('q4').status,QUERY_STATUS.FAILED_AFTER_DISPATCH);
  assert.equal(resumed.isRedispatchForbidden('q4'),true,'failed-after-dispatch is billing-ambiguous');
});

// Test D: resume must not re-dispatch anything already paid.
test('D: resume produces no paid dispatch for completed queries',()=>{
  const root=tmpRoot();
  const store=new SerpRunStore({root,run_id:'runD'});
  ['a','b'].forEach((keyword,index)=>{
    store.markDispatched(keyword,{index,keyword,request_id:`r${index}`,estimated_microusd:2000});
    store.persistRawResponse(keyword,{index,keyword,envelope:envelope(keyword)});
    store.markSettled(keyword,{actual_microusd:2000});
  });
  const resumed=new SerpRunStore({root,run_id:'runD'});
  const toDispatch=['a','b','c'].filter(key=>!resumed.isRedispatchForbidden(key));
  assert.deepEqual(toDispatch,['c'],'only the never-started query may be dispatched');
  assert.equal(resumed.get('c').status,QUERY_STATUS.NOT_STARTED);
});

// Test E: aggregate/report failure must not damage raw provider responses.
test('E: aggregate crash leaves raw responses untouched',()=>{
  const root=tmpRoot();
  const store=new SerpRunStore({root,run_id:'runE'});
  store.markDispatched('q1',{index:0,keyword:'玻璃工程',request_id:'r1',estimated_microusd:2000});
  const record=store.persistRawResponse('q1',{index:0,keyword:'玻璃工程',envelope:envelope('玻璃工程')});
  store.markSettled('q1',{actual_microusd:2000});
  const before=fs.readFileSync(record.raw_response_path,'utf8');
  try{ throw new Error('AGGREGATE_REPORT_FAILED'); }catch{ /* downstream analysis blew up */ }
  const resumed=new SerpRunStore({root,run_id:'runE'});
  assert.equal(fs.readFileSync(resumed.get('q1').raw_response_path,'utf8'),before,'raw bytes unchanged');
  assert.equal(resumed.isReusable('q1'),true);
});

// Guard: settlement without a persisted raw response is a programming error.
test('F: cannot mark settled before raw response is durable',()=>{
  const root=tmpRoot();
  const store=new SerpRunStore({root,run_id:'runF'});
  store.markDispatched('q1',{index:0,keyword:'x',request_id:'r1',estimated_microusd:2000});
  assert.throws(()=>store.markSettled('q1',{actual_microusd:2000}),/SETTLE_WITHOUT_RAW_RESULT/);
});

// Guard: paid-but-unrecoverable is recorded distinctly and never re-dispatched silently.
test('G: unrecoverable paid result is tracked and blocks silent redispatch',()=>{
  const root=tmpRoot();
  const store=new SerpRunStore({root,run_id:'runG'});
  store.markUnrecoverable('q1',{reason:'Live mode returns no retrievable task',actual_microusd:2000});
  assert.equal(store.get('q1').status,QUERY_STATUS.SETTLED_RESULT_UNRECOVERABLE);
  assert.equal(store.isRedispatchForbidden('q1'),true);
  assert.equal(store.isReusable('q1'),false);
});

test('H: slug is filesystem-safe for CJK keywords',()=>{
  const slug=slugify('辦公室玻璃隔間',0);
  assert.match(slug,/^01-[0-9a-f]{16}$/);
});
