import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');

function durableWriteExclusive(file,data){
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const temp=`${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const fd=fs.openSync(temp,'wx',0o600);
  try { fs.writeFileSync(fd,data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { fs.linkSync(temp,file); } catch(error) { if(error.code!=='EEXIST') throw error; } finally { fs.rmSync(temp,{force:true}); }
  const dir=fs.openSync(path.dirname(file),'r');
  try { fs.fsyncSync(dir); } catch(error) { if(!['EINVAL','EPERM'].includes(error.code)) throw error; } finally { fs.closeSync(dir); }
}

export function quarantineCorruptArtifact(project,{kind,file,raw,error,receiptKind=kind}){
  const digest=sha256(raw),root=path.join(project,'.ai','quarantine',kind),stem=`${path.basename(file)}.${digest}`;
  const evidencePath=path.join(root,`${stem}.corrupt`),receiptPath=path.join(root,`${stem}.receipt.json`);
  if(!fs.existsSync(evidencePath)) durableWriteExclusive(evidencePath,raw);
  const receipt={schema_version:1,kind:receiptKind,sha256:digest,bytes:raw.length,error_code:error instanceof SyntaxError?'INVALID_JSON':String(error?.code??'INTEGRITY_OR_SCHEMA_INVALID'),evidence_file:path.relative(project,evidencePath),created_at:new Date().toISOString()};
  if(!fs.existsSync(receiptPath)) durableWriteExclusive(receiptPath,`${JSON.stringify(receipt,null,2)}\n`);
  return receipt;
}

export function quarantineCorruptState(project,raw,error){
  const normalized=error instanceof SyntaxError?error:Object.assign(error,{code:'INVALID_STATE_SCHEMA'});
  return quarantineCorruptArtifact(project,{kind:'corrupt-state',receiptKind:'corrupt_project_state',file:'PROJECT_STATE.json',raw,error:normalized});
}

export function readControllerJson(project,relative,{required=true,validate=null}={}){
  const file=path.join(project,relative);
  if(!fs.existsSync(file)){ if(!required) return null; const error=new Error(`缺少必要 controller store：${relative}`); error.code='CONTROLLER_STORE_MISSING'; throw error; }
  let raw;
  try {
    raw=fs.readFileSync(file); const value=JSON.parse(raw.toString('utf8')),validationError=validate?.(value);
    if(validationError){ const error=new Error(validationError); error.code='INVALID_CONTROLLER_SCHEMA'; throw error; }
    return value;
  } catch(error){
    if(raw!==undefined){ const receipt=quarantineCorruptArtifact(project,{kind:'corrupt_controller_json',file,raw,error}); error.quarantine_receipt=receipt; }
    const failure=new Error(`CONTROLLER_STORE_UNRECOVERABLE：${relative} 已 fail-closed 隔離；${error.message}`); failure.code='CONTROLLER_STORE_UNRECOVERABLE'; failure.cause=error; failure.receipt=error.quarantine_receipt; throw failure;
  }
}

export function readProjectState(project){
  const file=path.join(project,'.ai','PROJECT_STATE.json'); let raw;
  try {
    raw=fs.readFileSync(file);
    const state=JSON.parse(raw.toString('utf8'));
    if(!state||typeof state!=='object'||Array.isArray(state)||typeof state.phase!=='string'||typeof state.status!=='string') throw new TypeError('PROJECT_STATE 必須包含字串 phase 與 status');
    return state;
  } catch(error){
    if(raw===undefined) throw error;
    const receipt=quarantineCorruptState(project,raw,error),failure=new Error(`STATE_UNRECOVERABLE：PROJECT_STATE 已 fail-closed 隔離（sha256 ${receipt.sha256.slice(0,16)}…；${receipt.evidence_file}）`);
    failure.code='STATE_UNRECOVERABLE'; failure.cause=error; failure.receipt=receipt; throw failure;
  }
}
