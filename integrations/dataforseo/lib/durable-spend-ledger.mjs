import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const VERSION = 1;
const terminal = new Set(['SETTLED', 'REJECTED', 'UNKNOWN_HOLD']);
const sha = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function validateIdentity({fingerprint, estimated_microusd, project_id, day}) {
  if (!/^[a-f0-9]{64}$/.test(fingerprint ?? '')) throw new Error('INVALID_FINGERPRINT');
  if (!Number.isSafeInteger(estimated_microusd) || estimated_microusd < 0) throw new Error('INVALID_ESTIMATE');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(project_id ?? '')) throw new Error('INVALID_PROJECT_ID');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? '')) throw new Error('INVALID_DAY');
}

function encode(records) {
  const payload = JSON.stringify({version: VERSION, records});
  return JSON.stringify({payload, checksum: sha(payload)}) + '\n';
}

function decode(raw) {
  let envelope;
  try { envelope = JSON.parse(raw); } catch { throw new Error('LEDGER_CORRUPT_JSON'); }
  if (typeof envelope?.payload !== 'string' || !/^[a-f0-9]{64}$/.test(envelope?.checksum ?? '')) throw new Error('LEDGER_CORRUPT_ENVELOPE');
  if (sha(envelope.payload) !== envelope.checksum) throw new Error('LEDGER_CHECKSUM_MISMATCH');
  let state;
  try { state = JSON.parse(envelope.payload); } catch { throw new Error('LEDGER_CORRUPT_PAYLOAD'); }
  if (state.version !== VERSION || !Array.isArray(state.records)) throw new Error('LEDGER_UNSUPPORTED_SCHEMA');
  return state.records;
}

export class DurableSpendLedger {
  constructor({file, daily_cap_microusd = 250_000, lock_timeout_ms = 2_000, lock_retry_ms = 10} = {}) {
    if (!file || !path.isAbsolute(file)) throw new Error('LEDGER_PATH_MUST_BE_ABSOLUTE');
    if (!Number.isSafeInteger(daily_cap_microusd) || daily_cap_microusd < 0) throw new Error('INVALID_DAILY_CAP');
    if (!Number.isSafeInteger(lock_timeout_ms) || lock_timeout_ms < 1) throw new Error('INVALID_LOCK_TIMEOUT');
    this.file = file;
    this.lockFile = `${file}.lock`;
    this.dailyCap = daily_cap_microusd;
    this.lockTimeout = lock_timeout_ms;
    this.lockRetry = lock_retry_ms;
  }

  async reserve(input) {
    validateIdentity(input);
    return this.#mutate(records => {
      const key = `${input.project_id}|${input.day}|${input.fingerprint}`;
      const existing = records.find(item => item.key === key);
      if (existing) return {result: {...existing, deduplicated: true}, changed: false};
      const used = records.filter(item => item.project_id === input.project_id && item.day === input.day && item.status !== 'REJECTED')
        .reduce((sum, item) => sum + item.reserved_microusd, 0);
      if (used + input.estimated_microusd > this.dailyCap) return {result: {status: 'REJECTED', reason: 'DAILY_CAP_EXCEEDED', deduplicated: false}, changed: false};
      const record = {lease_id: sha(key), key, fingerprint: input.fingerprint, project_id: input.project_id, day: input.day, reserved_microusd: input.estimated_microusd, status: 'RESERVED'};
      records.push(record);
      return {result: {...record, deduplicated: false}, changed: true};
    });
  }

  async markDispatched(leaseId, providerRequestId) {
    if (!/^[a-f0-9]{64}$/.test(leaseId ?? '')) throw new Error('INVALID_LEASE_ID');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/.test(providerRequestId ?? '')) throw new Error('INVALID_PROVIDER_REQUEST_ID');
    return this.#mutate(records => {
      const record = this.#find(records, leaseId);
      if (record.status === 'DISPATCHED' && record.provider_request_id === providerRequestId) return {result: {...record, deduplicated: true}, changed: false};
      if (record.status !== 'RESERVED') throw new Error(`INVALID_TRANSITION:${record.status}->DISPATCHED`);
      record.status = 'DISPATCHED';
      record.provider_request_id = providerRequestId;
      return {result: {...record, deduplicated: false}, changed: true};
    });
  }

  async settle(leaseId, actualMicrousd) {
    if (!Number.isSafeInteger(actualMicrousd) || actualMicrousd < 0) throw new Error('INVALID_ACTUAL_COST');
    return this.#mutate(records => {
      const record = this.#find(records, leaseId);
      if (record.status === 'SETTLED') return {result: {...record, deduplicated: true}, changed: false};
      if (record.status !== 'DISPATCHED') throw new Error(`INVALID_TRANSITION:${record.status}->SETTLED`);
      record.actual_microusd = actualMicrousd;
      record.cost_variance_ratio = record.reserved_microusd === 0 ? (actualMicrousd === 0 ? 0 : null) : (actualMicrousd - record.reserved_microusd) / record.reserved_microusd;
      record.status = record.cost_variance_ratio === null || record.cost_variance_ratio > 0.2 ? 'UNKNOWN_HOLD' : 'SETTLED';
      return {result: {...record, deduplicated: false}, changed: true};
    });
  }

  async markUnknown(leaseId) {
    return this.#mutate(records => {
      const record = this.#find(records, leaseId);
      if (terminal.has(record.status)) return {result: {...record, deduplicated: true}, changed: false};
      if (!['RESERVED', 'DISPATCHED'].includes(record.status)) throw new Error(`INVALID_TRANSITION:${record.status}->UNKNOWN_HOLD`);
      record.status = 'UNKNOWN_HOLD';
      return {result: {...record, deduplicated: false}, changed: true};
    });
  }

  async snapshot() {
    return this.#withLock(async () => structuredClone(await this.#read()));
  }

  async reconcileNoDispatch(leaseId, {reason, evidence_sha256} = {}) {
    if (!['SERVICE_CRASHED_BEFORE_LISTENER','DNS_FAILED_BEFORE_CONNECT','SOCKET_PARENT_TRAVERSAL_DENIED','TLS_FAILED_BEFORE_HTTP'].includes(reason) || !/^[a-f0-9]{64}$/.test(evidence_sha256 ?? '')) throw new Error('RECONCILIATION_EVIDENCE_REQUIRED');
    return this.#mutate(records => {
      const record = this.#find(records, leaseId);
      if (record.status !== 'UNKNOWN_HOLD') throw new Error(`INVALID_TRANSITION:${record.status}->REJECTED`);
      record.status = 'REJECTED';
      record.reconciliation = {reason, evidence_sha256};
      return {result: {...record}, changed: true};
    });
  }

  async #mutate(operation) {
    return this.#withLock(async () => {
      const records = await this.#read();
      const outcome = operation(records);
      if (outcome.changed) await this.#write(records);
      return outcome.result;
    });
  }

  async #withLock(operation) {
    await fs.mkdir(path.dirname(this.file), {recursive: true});
    const started = Date.now();
    let handle;
    while (!handle) {
      try { handle = await fs.open(this.lockFile, 'wx', 0o600); }
      catch (error) {
        const transientWindowsLock = process.platform === 'win32' && error.code === 'EPERM';
        if (error.code !== 'EEXIST' && !transientWindowsLock) throw error;
        if (Date.now() - started >= this.lockTimeout) throw new Error('LEDGER_LOCK_TIMEOUT');
        await pause(this.lockRetry);
      }
    }
    try { return await operation(); }
    finally {
      await handle.close();
      await fs.unlink(this.lockFile).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }

  async #read() {
    try { return decode(await fs.readFile(this.file, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  async #write(records) {
    const temporary = `${this.file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    const handle = await fs.open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(encode(records), 'utf8');
      await handle.sync();
    } finally { await handle.close(); }
    try { await fs.rename(temporary, this.file); }
    catch (error) {
      await fs.unlink(temporary).catch(() => {});
      throw error;
    }
  }

  #find(records, leaseId) {
    const record = records.find(item => item.lease_id === leaseId);
    if (!record) throw new Error('LEASE_NOT_FOUND');
    return record;
  }
}
