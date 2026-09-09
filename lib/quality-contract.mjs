import fs from 'node:fs';
import path from 'node:path';

const ALLOWED_COMMANDS=new Set(['npm','pnpm','yarn','bun','node','python','python3','pytest','cargo','go','docker']);
const META=/[;&|`$<>\r\n]/;
export const qualityContractPath=project=>path.join(project,'.ai','QUALITY_CONTRACT.json');
export function validateQualityContract(value){
  if(!value||value.schema_version!==1||!Array.isArray(value.required_capabilities)||!Array.isArray(value.checks)) return 'QUALITY_CONTRACT schema_version、required_capabilities 或 checks 無效';
  if(value.allow_shell!==false||value.receipt_required!==true) return 'QUALITY_CONTRACT 必須禁止 shell 並要求 receipt';
  const ids=new Set();
  for(const check of value.checks){
    if(!check?.id||ids.has(check.id)||typeof check.required!=='boolean'||!Array.isArray(check.argv)||check.argv.length<1||!check.argv.every(item=>typeof item==='string'&&item&&!META.test(item))) return `QUALITY_CONTRACT check 無效：${check?.id??'unknown'}`;
    if(!ALLOWED_COMMANDS.has(check.argv[0])) return `QUALITY_CONTRACT command 不在 allowlist：${check.argv[0]}`;
    if(!Number.isInteger(check.timeout_ms)||check.timeout_ms<1000||check.timeout_ms>3600000) return `QUALITY_CONTRACT timeout 無效：${check.id}`;
    const cwd=String(check.cwd??'.').replaceAll('\\','/'); if(path.posix.isAbsolute(cwd)||cwd==='..'||cwd.startsWith('../')||cwd.includes('/../')) return `QUALITY_CONTRACT cwd 越界：${check.id}`;
    ids.add(check.id);
  }
  for(const capability of value.required_capabilities) if(!value.checks.some(check=>check.id===capability&&check.required)) return `QUALITY_CONTRACT 缺少必要 capability：${capability}`;
  return null;
}
export function loadQualityContract(project){
  const file=qualityContractPath(project); if(!fs.existsSync(file)) return {ok:false,error:'QUALITY_CONTRACT_MISSING'};
  try{ const contract=JSON.parse(fs.readFileSync(file,'utf8')),error=validateQualityContract(contract); return error?{ok:false,error}:{ok:true,contract}; }catch(error){ return {ok:false,error:`QUALITY_CONTRACT_INVALID_JSON：${error.message}`}; }
}
export function qualityContractCommands(project,contract){
  return contract.checks.filter(check=>check.required).map(check=>({name:`Quality Contract ${check.id}`,cmd:check.argv[0],args:check.argv.slice(1),cwd:path.resolve(project,check.cwd??'.'),timeout:check.timeout_ms}));
}
