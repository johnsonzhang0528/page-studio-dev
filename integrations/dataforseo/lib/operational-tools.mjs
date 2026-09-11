import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const sha = value => crypto.createHash('sha256').update(value).digest('hex');

export async function createVerifiedSnapshot({ledger, destination}) {
  if (!ledger || typeof ledger.snapshot !== 'function') throw new Error('LEDGER_REQUIRED');
  if (!path.isAbsolute(destination)) throw new Error('BACKUP_PATH_MUST_BE_ABSOLUTE');
  const records = await ledger.snapshot();
  const payload = JSON.stringify({schema: 1, created_at: new Date().toISOString(), records});
  const output = JSON.stringify({payload, checksum: sha(payload)}) + '\n';
  await fs.mkdir(path.dirname(destination), {recursive: true});
  const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const handle = await fs.open(temporary, 'wx', 0o600);
  try { await handle.writeFile(output); await handle.sync(); }
  finally { await handle.close(); }
  await fs.rename(temporary, destination);
  return {records: records.length, checksum: sha(payload), destination};
}
export async function verifySnapshot(file) {
  let envelope;
  try { envelope = JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { return {ok: false, reason: 'BACKUP_UNREADABLE'}; }
  if (typeof envelope?.payload !== 'string' || sha(envelope.payload) !== envelope.checksum) return {ok: false, reason: 'BACKUP_CHECKSUM_MISMATCH'};
  try {
    const content = JSON.parse(envelope.payload);
    if (content.schema !== 1 || !Array.isArray(content.records)) return {ok: false, reason: 'BACKUP_SCHEMA_INVALID'};
    return {ok: true, records: content.records.length, checksum: envelope.checksum};
  } catch { return {ok: false, reason: 'BACKUP_PAYLOAD_INVALID'}; }
}

export async function inspectLock(lockFile, {now = Date.now()} = {}) {
  try {
    const stat = await fs.stat(lockFile);
    return {exists: true, age_ms: Math.max(0, now - stat.mtimeMs), path: lockFile, action: 'OPERATOR_REVIEW_REQUIRED'};
  } catch (error) {
    if (error.code === 'ENOENT') return {exists: false, path: lockFile, action: 'NONE'};
    throw error;
  }
}
