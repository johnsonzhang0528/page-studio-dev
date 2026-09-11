import {requestFingerprint} from './dataforseo-contract.mjs';

const allowedFields = new Set([
  'keyword','location_code','language_code','device','os','depth','tag'
]);
const devices = new Set(['desktop','mobile']);
const operatingSystems = new Set(['windows','macos','android','ios']);

export function validateSerpStandardRequest(request, options = {}) {
  const maxDepth = options.max_depth ?? 10;
  const errors = [];
  if (!request || typeof request !== 'object' || Array.isArray(request)) return {ok:false, errors:['REQUEST_NOT_OBJECT']};
  for (const key of Object.keys(request)) if (!allowedFields.has(key)) errors.push(`UNKNOWN_OR_PAID_FIELD:${key}`);
  if (typeof request.keyword !== 'string' || !request.keyword.trim()) errors.push('KEYWORD_REQUIRED');
  if (!Number.isSafeInteger(request.location_code) || request.location_code <= 0) errors.push('LOCATION_REQUIRED');
  if (typeof request.language_code !== 'string' || !/^[a-z]{2}(?:-[A-Z]{2})?$/.test(request.language_code)) errors.push('LANGUAGE_REQUIRED');
  if (!devices.has(request.device)) errors.push('DEVICE_REQUIRED');
  if (!operatingSystems.has(request.os)) errors.push('OS_REQUIRED');
  if (!Number.isSafeInteger(request.depth) || request.depth < 1 || request.depth > maxDepth) errors.push('SERP_DEPTH_EXCEEDED');
  if (request.tag !== undefined && (typeof request.tag !== 'string' || request.tag.length > 255)) errors.push('INVALID_TAG');
  return {ok:errors.length === 0, errors, fingerprint:errors.length ? null : requestFingerprint(request)};
}

export function validateSerpRoute(route) {
  if (route !== '/v3/serp/google/organic/task_post') return {ok:false, reason:'SERP_STANDARD_ROUTE_REQUIRED'};
  return {ok:true};
}
