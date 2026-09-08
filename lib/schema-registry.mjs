import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { quarantineCorruptArtifact, readControllerJson } from './state-store.mjs';

export const INPUT_INDEX_SCHEMA_VERSIONS=Object.freeze([1,2]);
export const LEGACY_INPUT_INDEX_VERSION=0;

const object=value=>Boolean(value)&&!Array.isArray(value)&&typeof value==='object';
const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');

function inputIndexError(value){
  if(!object(value)) return 'INPUT_INDEX 必須是 JSON object';
  if(value.schema_version===undefined&&Array.isArray(value.items)) return 'INPUT_INDEX_LEGACY_MIGRATION_REQUIRED：舊版 items[] 必須先由控制器遷移為 files[]';
  if(!Number.isInteger(value.schema_version)||!INPUT_INDEX_SCHEMA_VERSIONS.includes(value.schema_version)) return `INPUT_INDEX.schema_version 必須是支援版本：${INPUT_INDEX_SCHEMA_VERSIONS.join('、')}`;
  if(!Array.isArray(value.files)) return `INPUT_INDEX v${value.schema_version}.files 必須是陣列`;
  for(const [index,file] of value.files.entries()){
    if(!object(file)) return `INPUT_INDEX.files[${index}] 必須是 object`;
    for(const field of ['original_path','current_path','category','sha256']) if(typeof file[field]!=='string'||!file[field].trim()) return `INPUT_INDEX.files[${index}].${field} 必須是非空字串`;
    if(!/^[a-f0-9]{64}$/i.test(file.sha256)) return `INPUT_INDEX.files[${index}].sha256 必須是 SHA-256`;
    if(typeof file.readable!=='boolean') return `INPUT_INDEX.files[${index}].readable 必須是 boolean`;
    if(value.schema_version>=2&&(!file.id||typeof file.id!=='string')) return `INPUT_INDEX v2 files[${index}].id 必須是非空字串`;
  }
  return null;
}

export function validateControllerJson(relative,value){
  const name=path.basename(relative);
  if(!object(value)) return `${relative} 必須是 JSON object`;
  if(name==='PROJECT_STATE.json'&&(!value.status||!value.phase)) return 'PROJECT_STATE 必須包含 status 與 phase';
  if(name==='TASK_GRAPH.json'&&!Array.isArray(value.tasks)) return 'TASK_GRAPH.tasks 必須是陣列';
  if(name==='AUTODEV_CONFIG.json'&&typeof value.enabled!=='boolean') return 'AUTODEV_CONFIG.enabled 必須是 boolean';
  if(name==='PHASE_TASK_GRAPH.json'&&(!object(value.phases)||!Number.isInteger(value.schema_version))) return 'PHASE_TASK_GRAPH 必須包含 schema_version 與 phases object';
  if(name==='GATE_FINDINGS.json'&&(value.schema_version!==1||!Array.isArray(value.findings))) return 'GATE_FINDINGS 必須是 schema_version=1 且包含 findings[]';
  if(name==='INPUT_INDEX.json') return inputIndexError(value);
  return null;
}

export function runControllerStorePreflight(project){
  const checks=[],stores=[['.ai/PROJECT_STATE.json',true],['.ai/TASK_GRAPH.json',true],['.ai/AUTODEV_CONFIG.json',true],['.ai/PHASE_TASK_GRAPH.json',false],['.ai/GATE_FINDINGS.json',false]];
  for(const [relative,required] of stores){
    try { const value=readControllerJson(project,relative,{required,validate:item=>validateControllerJson(relative,item)}); checks.push({name:relative,ok:true,present:value!==null}); }
    catch(error){ checks.push({name:relative,ok:false,error_code:error.code,detail:error.message}); }
  }
  return {ok:checks.every(check=>check.ok),checks};
}

export function migrateInputIndexValue(value){
  const before=JSON.stringify(value);
  if(!object(value)) return {ok:false,changed:false,error:'INPUT_INDEX 必須是 JSON object'};
  if(INPUT_INDEX_SCHEMA_VERSIONS.includes(value.schema_version)&&Array.isArray(value.files)){
    const error=inputIndexError(value);
    return {ok:!error,changed:false,value,error,before_sha256:sha256(before),after_sha256:sha256(before)};
  }
  if(value.schema_version!==undefined||!Array.isArray(value.items)) return {ok:false,changed:false,error:inputIndexError(value)};
  const migrated={...value,schema_version:LEGACY_INPUT_INDEX_VERSION+1,files:value.items};
  delete migrated.items;
  const error=inputIndexError(migrated),after=JSON.stringify(migrated);
  return {ok:!error,changed:!error,value:migrated,error,before_sha256:sha256(before),after_sha256:sha256(after),from_version:LEGACY_INPUT_INDEX_VERSION,to_version:1};
}

export function migrateInputIndexFile(project,{write=false}={}){
  const file=path.join(project,'.ai','INPUT_INDEX.json');
  let value,raw;
  try{ raw=fs.readFileSync(file); value=JSON.parse(raw.toString('utf8')); }
  catch(error){ const quarantine=raw===undefined?null:quarantineCorruptArtifact(project,{kind:'corrupt_controller_json',file,raw,error}); return {ok:false,changed:false,error:`無法讀取 INPUT_INDEX：${error.message}`,quarantine}; }
  const receipt=migrateInputIndexValue(value);
  if(!receipt.ok||!receipt.changed||!write) return receipt;
  const temp=`${file}.migration-${process.pid}.tmp`;
  fs.writeFileSync(temp,`${JSON.stringify(receipt.value,null,2)}\n`,{flag:'wx'});
  fs.renameSync(temp,file);
  return {...receipt,written:true,file};
}

export function runControllerPreflight(project,{allowMissingInputIndex=false}={}){
  const checks=[];
  for(const relative of ['.ai/PROJECT_STATE.json','.ai/TASK_GRAPH.json','.ai/AUTODEV_CONFIG.json','.ai/INPUT_INDEX.json']){
    const file=path.join(project,relative);
    if(allowMissingInputIndex&&relative.endsWith('INPUT_INDEX.json')&&!fs.existsSync(file)) continue;
    try{
      const value=readControllerJson(project,relative,{validate:item=>validateControllerJson(relative,item)}),error=validateControllerJson(relative,value);
      checks.push({name:`JSON ${relative}`,ok:!error,detail:error??'格式與必要結構有效'});
    }catch(error){ checks.push({name:`JSON ${relative}`,ok:false,detail:error.message}); }
  }
  const failed=checks.filter(check=>!check.ok);
  const signature=sha256(JSON.stringify(failed.map(check=>({name:check.name,detail:check.detail}))));
  return {ok:failed.length===0,checks,signature};
}

export function prepareControllerDispatch(project,{allowMissingInputIndex=false,writeMigration=true}={}){
  const inputFile=path.join(project,'.ai','INPUT_INDEX.json');
  let migration={ok:true,changed:false};
  if(fs.existsSync(inputFile)) migration=migrateInputIndexFile(project,{write:writeMigration});
  const preflight=runControllerPreflight(project,{allowMissingInputIndex});
  return {...preflight,migration};
}
