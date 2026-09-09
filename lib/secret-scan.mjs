import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const RULES=[
  ['private_key',new RegExp(['-----BEGIN ','(?:RSA |EC |OPENSSH )?','PRIVATE KEY-----','[\\s\\S]{0,80}','[A-Za-z0-9+/=\\r\\n]{64,}','-----END ','(?:RSA |EC |OPENSSH )?','PRIVATE KEY-----'].join(''),'i')],
  ['anthropic_key',new RegExp(['sk-','ant-','[A-Za-z0-9_-]{20,}'].join(''),'g')],
  ['github_token',new RegExp(['gh','[pousr]_','[A-Za-z0-9]{30,}'].join(''),'g')],
  ['aws_access_key',new RegExp(['AKIA','[A-Z0-9]{16}'].join(''),'g')],
  ['telegram_token',new RegExp(['\\b\\d{8,10}',':','[A-Za-z0-9_-]{30,}'].join(''),'g')],
  ['bearer_token',new RegExp(['Bearer','\\s+','[A-Za-z0-9._~+/-]{24,}'].join(''),'gi')]
];
const textFile=file=>{ try{ const raw=fs.readFileSync(file); if(raw.includes(0)) return null; return raw.toString('utf8'); }catch{return null;} };
export function scanSecretFiles(root,relativeFiles){
  const findings=[];
  for(const relative of [...new Set(relativeFiles)].sort()){
    const text=textFile(path.join(root,relative)); if(text===null) continue;
    for(const [rule,pattern] of RULES){ pattern.lastIndex=0; if(pattern.test(text)) findings.push({path:relative.replaceAll('\\','/'),rule}); }
  }
  return findings;
}
export function scanTrackedSecrets(root){
  const listed=spawnSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}); if(listed.status!==0) throw new Error('SECRET_SCAN_GIT_LIST_FAILED');
  return scanSecretFiles(root,String(listed.stdout??'').split('\0').filter(Boolean));
}
export function scanRuntimeSecrets(project){
  const roots=['.ai/logs','.ai/runtime','.ai/receipts'],files=[];
  const walk=(directory,relative)=>{ try{ for(const entry of fs.readdirSync(directory,{withFileTypes:true})){ const child=path.join(directory,entry.name),rel=path.posix.join(relative,entry.name); if(entry.isDirectory()) walk(child,rel); else if(entry.isFile()) files.push(rel); } }catch{} };
  for(const relative of roots) walk(path.join(project,relative),relative); return scanSecretFiles(project,files);
}
