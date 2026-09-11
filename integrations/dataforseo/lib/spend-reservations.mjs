import crypto from 'node:crypto';

const terminal = new Set(['SETTLED','REJECTED','UNKNOWN_HOLD']);
const sha = value => crypto.createHash('sha256').update(String(value)).digest('hex');

export class SpendReservations {
  #records = new Map();
  #dailyCap;
  constructor({daily_cap_microusd = 250_000} = {}) {
    if (!Number.isSafeInteger(daily_cap_microusd) || daily_cap_microusd < 0) throw new Error('INVALID_DAILY_CAP');
    this.#dailyCap = daily_cap_microusd;
  }
  reserve({fingerprint, estimated_microusd, project_id, day}) {
    if (!/^[a-f0-9]{64}$/.test(fingerprint ?? '')) throw new Error('INVALID_FINGERPRINT');
    if (!Number.isSafeInteger(estimated_microusd) || estimated_microusd < 0) throw new Error('INVALID_ESTIMATE');
    const key = `${project_id}|${day}|${fingerprint}`;
    const existing = this.#records.get(key);
    if (existing) return {...existing, deduplicated:true};
    const used = [...this.#records.values()].filter(item => item.project_id === project_id && item.day === day && item.status !== 'REJECTED').reduce((sum,item) => sum + item.reserved_microusd, 0);
    if (used + estimated_microusd > this.#dailyCap) return {status:'REJECTED', reason:'DAILY_CAP_EXCEEDED', deduplicated:false};
    const record = {lease_id:sha(key), key, fingerprint, project_id, day, reserved_microusd:estimated_microusd, status:'RESERVED'};
    this.#records.set(key, record);
    return {...record, deduplicated:false};
  }
  markDispatched(leaseId, providerRequestId) {
    const record = this.#find(leaseId);
    if (record.status === 'DISPATCHED' && record.provider_request_id === providerRequestId) return {...record, deduplicated:true};
    if (record.status !== 'RESERVED') throw new Error(`INVALID_TRANSITION:${record.status}->DISPATCHED`);
    record.status = 'DISPATCHED'; record.provider_request_id = providerRequestId;
    return {...record, deduplicated:false};
  }
  settle(leaseId, actualMicrousd) {
    const record = this.#find(leaseId);
    if (record.status === 'SETTLED') return {...record, deduplicated:true};
    if (record.status !== 'DISPATCHED') throw new Error(`INVALID_TRANSITION:${record.status}->SETTLED`);
    if (!Number.isSafeInteger(actualMicrousd) || actualMicrousd < 0) throw new Error('INVALID_ACTUAL_COST');
    record.actual_microusd = actualMicrousd;
    record.cost_variance_ratio = record.reserved_microusd === 0 ? (actualMicrousd === 0 ? 0 : Infinity) : (actualMicrousd - record.reserved_microusd) / record.reserved_microusd;
    record.status = record.cost_variance_ratio > 0.2 ? 'UNKNOWN_HOLD' : 'SETTLED';
    return {...record, deduplicated:false};
  }
  markUnknown(leaseId) {
    const record = this.#find(leaseId);
    if (terminal.has(record.status)) return {...record, deduplicated:true};
    if (!['RESERVED','DISPATCHED'].includes(record.status)) throw new Error(`INVALID_TRANSITION:${record.status}->UNKNOWN_HOLD`);
    record.status = 'UNKNOWN_HOLD';
    return {...record, deduplicated:false};
  }
  snapshot() { return structuredClone([...this.#records.values()]); }
  #find(leaseId) {
    const record = [...this.#records.values()].find(item => item.lease_id === leaseId);
    if (!record) throw new Error('LEASE_NOT_FOUND');
    return record;
  }
}
