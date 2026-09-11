const secretKey = /(?:authorization|password|passwd|secret|api[_-]?key|credential|dataforseo[_-]?(?:login|password))/i;
const authValue = /\b(?:Basic|Bearer)\s+[A-Za-z0-9+/_.=-]+/gi;

export function redact(value) {
  if (typeof value === 'string') return value.replace(authValue, match => `${match.split(/\s+/, 1)[0]} [REDACTED]`);
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, secretKey.test(key) ? '[REDACTED]' : redact(item)]));
}
export function safeAuditEvent(event) {
  const clean = redact(event);
  return JSON.stringify({...clean, audit_schema: 1});
}
