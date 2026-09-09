import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { redactSecrets } from './subprocess-policy.mjs';

const fail=(message,code='PROVIDER_CONTEXT_DENIED')=>Object.assign(new Error(message),{code});
const allowedExtensions=new Set(['.md','.txt','.json','.yaml','.yml','.js','.mjs','.cjs','.ts','.tsx','.jsx','.css','.html']);
const blockedParts=new Set(['.git','node_modules','dist','build','coverage','logs','archive']);
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');

export function buildReadOnlyContextBundle(project,relativePaths,{max_file_bytes=65536,max_total_bytes=262144}={}){
  if(!Array.isArray(relativePaths)||!relativePaths.length||!Number.isSafeInteger(max_file_bytes)||max_file_bytes<1||!Number.isSafeInteger(max_total_bytes)||max_total_bytes<max_file_bytes)throw fail('PROVIDER_CONTEXT_CONFIG_INVALID');
  const root=fs.realpathSync(project),entries=[];let total=0;
  for(const requested of [...new Set(relativePaths)].sort()){
    if(typeof requested!=='string'||!requested||path.isAbsolute(requested))throw fail('PROVIDER_CONTEXT_PATH_INVALID');
    const normalized=requested.replaceAll('\\','/'),parts=normalized.split('/');
    if(parts.some(part=>!part||part==='.'||part==='..'||blockedParts.has(part))||!allowedExtensions.has(path.extname(normalized).toLowerCase()))throw fail(`PROVIDER_CONTEXT_PATH_DENIED:${normalized}`);
    const candidate=path.join(root,...parts),stat=fs.lstatSync(candidate);if(!stat.isFile()||stat.isSymbolicLink())throw fail(`PROVIDER_CONTEXT_FILE_DENIED:${normalized}`);
    const resolved=fs.realpathSync(candidate);if(resolved!==root&&!resolved.startsWith(root+path.sep))throw fail(`PROVIDER_CONTEXT_ESCAPE:${normalized}`);
    if(stat.size>max_file_bytes)throw fail(`PROVIDER_CONTEXT_FILE_TOO_LARGE:${normalized}`,'PROVIDER_CONTEXT_TOO_LARGE');
    const raw=fs.readFileSync(resolved);if(raw.includes(0))throw fail(`PROVIDER_CONTEXT_BINARY_DENIED:${normalized}`);
    const text=redactSecrets(raw.toString('utf8')),bytes=Buffer.byteLength(text);total+=bytes;if(total>max_total_bytes)throw fail('PROVIDER_CONTEXT_TOTAL_TOO_LARGE','PROVIDER_CONTEXT_TOO_LARGE');
    entries.push(Object.freeze({path:normalized,sha256:digest(raw),bytes,text}));
  }
  const manifest={schema_version:1,mode:'bounded_read_only',files:entries,total_bytes:total};
  return Object.freeze({...manifest,sha256:digest(JSON.stringify(manifest))});
}
