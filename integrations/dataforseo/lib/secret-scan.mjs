const patterns=[/Basic\s+[A-Za-z0-9+/=]{8,}/i,/Bearer\s+[A-Za-z0-9._=-]{8,}/i,/DFS_(?:LOGIN|PASSWORD)\s*=\s*\S+/i,/dataforseo_(?:login|password)\s*[:=]\s*["']?(?!\[REDACTED\]|\/etc\/)[^\s"']+/i];
export function scanSecretText(text){return patterns.flatMap((pattern,index)=>pattern.test(String(text))?[`SECRET_PATTERN_${index+1}`]:[]);}
