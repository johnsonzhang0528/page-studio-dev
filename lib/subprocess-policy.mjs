const BASE_ENV_KEYS=Object.freeze(['HOME','USER','LOGNAME','SHELL','PATH','LANG','LC_ALL','TERM','TMPDIR','TEMP','TMP','XDG_CONFIG_HOME','XDG_CACHE_HOME','DOCKER_HOST','DOCKER_CONTEXT']);

export function safeSubprocessEnv(source=process.env,extra={}){
  const output={};
  for(const key of BASE_ENV_KEYS) if(source[key]!==undefined) output[key]=String(source[key]);
  for(const [key,value] of Object.entries(extra)) if(value!==undefined) output[key]=String(value);
  return output;
}

export function redactSecrets(value){
  return String(value??'')
    .replace(/-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/gi,'[REDACTED_PRIVATE_KEY]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,'Bearer [REDACTED]')
    .replace(/\b((?:api[_-]?key|access[_-]?token|token|auth(?:orization)?|password|passwd|secret|client[_-]?secret)\s*[:=]\s*)[^\s,;]+/gi,'$1[REDACTED]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^\s:/?#]+:)[^\s@/?#]+@/gi,'$1[REDACTED]@');
}
