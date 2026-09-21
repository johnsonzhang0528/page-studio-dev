import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {DurableSpendLedger} from '../lib/durable-spend-ledger.mjs';

const ledgerAt=()=>new DurableSpendLedger({
  file:path.join(fs.mkdtempSync(path.join(os.tmpdir(),'recon-')),'spend-ledger.json'),
  daily_cap_microusd:1_000_000});

const FP='b'.repeat(64);
async function heldLease(ledger){
  const reservation=await ledger.reserve({fingerprint:FP,estimated_microusd:2000,project_id:'p',day:'2026-09-21'});
  await ledger.markDispatched(reservation.lease_id,'req-1');
  await ledger.markUnknown(reservation.lease_id);
  return reservation.lease_id;
}
const row=async(ledger,leaseId)=>(await ledger.snapshot()).find(r=>r.lease_id===leaseId);

test('not-billed reconciliation zeroes the lease and preserves history',async()=>{
  const ledger=ledgerAt(),leaseId=await heldLease(ledger);
  assert.equal((await row(ledger,leaseId)).status,'UNKNOWN_HOLD');
  await ledger.reconcileUnknownHold(leaseId,{provider_billed:false,reconciled_amount_microusd:0,
    actor:'user/manual',method:'manual provider dashboard verification',confirmed_at:'2026-09-21T04:00:00Z'});
  const record=await row(ledger,leaseId);
  assert.equal(record.status,'REJECTED','not billed must not consume budget');
  assert.equal(record.actual_microusd,0);
  assert.equal(record.reconciliation.original_status,'UNKNOWN_HOLD','history preserved');
  assert.equal(record.reconciliation.provider_billed,false);
  assert.equal(record.reconciliation.actor,'user/manual');
  assert.equal(record.lease_id,leaseId,'lease id unchanged');
});

test('billed reconciliation settles at the verified amount',async()=>{
  const ledger=ledgerAt(),leaseId=await heldLease(ledger);
  await ledger.reconcileUnknownHold(leaseId,{provider_billed:true,reconciled_amount_microusd:2000,
    actor:'user/manual',method:'manual provider dashboard verification'});
  const record=await row(ledger,leaseId);
  assert.equal(record.status,'SETTLED');
  assert.equal(record.actual_microusd,2000);
  assert.equal(record.cost_variance_ratio,0);
  assert.equal(record.reconciliation.original_status,'UNKNOWN_HOLD');
});

test('inconsistent billed/amount combinations are rejected',async()=>{
  const ledger=ledgerAt();
  const a=await heldLease(ledger);
  await assert.rejects(()=>ledger.reconcileUnknownHold(a,{provider_billed:false,reconciled_amount_microusd:2000,
    actor:'u',method:'m'}),/RECONCILE_NOT_BILLED_MUST_BE_ZERO/);
  await assert.rejects(()=>ledger.reconcileUnknownHold(a,{provider_billed:true,reconciled_amount_microusd:0,
    actor:'u',method:'m'}),/RECONCILE_BILLED_MUST_BE_NONZERO/);
  assert.equal((await row(ledger,a)).status,'UNKNOWN_HOLD','failed reconciliation leaves the hold intact');
});

test('actor and method are mandatory; hold survives omission',async()=>{
  const ledger=ledgerAt(),leaseId=await heldLease(ledger);
  await assert.rejects(()=>ledger.reconcileUnknownHold(leaseId,{provider_billed:false,reconciled_amount_microusd:0,method:'m'}),/RECONCILE_ACTOR_REQUIRED/);
  await assert.rejects(()=>ledger.reconcileUnknownHold(leaseId,{provider_billed:false,reconciled_amount_microusd:0,actor:'u'}),/RECONCILE_METHOD_REQUIRED/);
  await assert.rejects(()=>ledger.reconcileUnknownHold(leaseId,{reconciled_amount_microusd:0,actor:'u',method:'m'}),/RECONCILE_BILLED_FLAG_REQUIRED/);
  assert.equal((await row(ledger,leaseId)).status,'UNKNOWN_HOLD');
});

test('only UNKNOWN_HOLD may be reconciled',async()=>{
  const ledger=ledgerAt();
  const reservation=await ledger.reserve({fingerprint:FP,estimated_microusd:2000,project_id:'p',day:'2026-09-21'});
  await ledger.markDispatched(reservation.lease_id,'req-1');
  await ledger.settle(reservation.lease_id,2000);
  await assert.rejects(()=>ledger.reconcileUnknownHold(reservation.lease_id,{provider_billed:false,
    reconciled_amount_microusd:0,actor:'u',method:'m'}),/INVALID_TRANSITION:SETTLED->RECONCILED/);
});

test('reconciliation is idempotent and cannot be re-applied with a different verdict',async()=>{
  const ledger=ledgerAt(),leaseId=await heldLease(ledger);
  await ledger.reconcileUnknownHold(leaseId,{provider_billed:false,reconciled_amount_microusd:0,actor:'u',method:'m'});
  const second=await ledger.reconcileUnknownHold(leaseId,{provider_billed:true,reconciled_amount_microusd:2000,actor:'u',method:'m'});
  assert.equal(second.deduplicated,true);
  const record=await row(ledger,leaseId);
  assert.equal(record.status,'REJECTED','first verdict stands');
  assert.equal(record.actual_microusd,0);
});

test('reconciled not-billed lease is excluded from spend totals',async()=>{
  const ledger=ledgerAt(),leaseId=await heldLease(ledger);
  await ledger.reconcileUnknownHold(leaseId,{provider_billed:false,reconciled_amount_microusd:0,actor:'u',method:'m'});
  const rows=await ledger.snapshot();
  const cost=r=>r.status!=='REJECTED'?(r.actual_microusd??r.reserved_microusd):0;
  assert.equal(rows.reduce((sum,r)=>sum+cost(r),0),0,'REJECTED contributes nothing to spend');
});
