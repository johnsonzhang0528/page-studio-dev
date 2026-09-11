import crypto from 'node:crypto';
import {classifyDataForSeoStatus} from './dataforseo-errors.mjs';

export function decideRetry({phase, status_code, attempt, dispatch_confirmed_absent = false, retry_after_ms = null}, options = {}) {
  const maxAttempts = options.max_attempts ?? 3;
  if (!Number.isSafeInteger(attempt) || attempt < 1) return {action: 'HOLD', reason: 'INVALID_ATTEMPT'};
  if (!['BEFORE_DISPATCH', 'AFTER_DISPATCH'].includes(phase)) return {action: 'HOLD', reason: 'UNKNOWN_PHASE'};
  const classification = classifyDataForSeoStatus(status_code);
  if (!classification.retryable) return {action: 'STOP', reason: classification.class};
  if (phase === 'AFTER_DISPATCH' && !dispatch_confirmed_absent) return {action: 'HOLD', reason: 'AMBIGUOUS_PROVIDER_CHARGE'};
  if (attempt >= maxAttempts) return {action: 'STOP', reason: 'ATTEMPT_CAP_REACHED'};
  const base = Math.min(60_000, 1_000 * 2 ** (attempt - 1));
  const providerDelay = Number.isSafeInteger(retry_after_ms) && retry_after_ms >= 0 ? retry_after_ms : 0;
  const stableJitter = Number.parseInt(crypto.createHash('sha256').update(`${status_code}:${attempt}`).digest('hex').slice(0, 4), 16) % 501;
  return {action: 'RETRY', delay_ms: Math.max(base + stableJitter, providerDelay), reason: 'TRANSIENT_CONFIRMED_SAFE'};
}
