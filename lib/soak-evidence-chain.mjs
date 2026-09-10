import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const evidenceHash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function chainRecord(record,{sequence,previous_sha256=null}={}){
  const chained={...record,chain_sequence:sequence,previous_sha256};
  return Object.freeze({...chained,sha256:evidenceHash(chained)});
}
export function verifyEvidenceChain(records){
  if(!Array.isArray(records)||records.length===0)throw new Error('SOAK_EVIDENCE_EMPTY');
  let previous=null;
  for(let index=0;index<records.length;index+=1){
    const record=records[index],copy=structuredClone(record),claimed=copy.sha256;delete copy.sha256;
    if(record.chain_sequence!==index+1)throw new Error(`SOAK_CHAIN_SEQUENCE_INVALID:${index+1}`);
    if(record.previous_sha256!==previous)throw new Error(`SOAK_CHAIN_PREDECESSOR_INVALID:${index+1}`);
    if(typeof claimed!=='string'||evidenceHash(copy)!==claimed)throw new Error(`SOAK_CHAIN_HASH_INVALID:${index+1}`);
    previous=claimed;
  }
  return {ok:true,records:records.length,terminal_sha256:previous};
}
export function readEvidenceChain(file){
  const text=fs.readFileSync(file,'utf8');
  if(!text.endsWith('\n'))throw new Error('SOAK_EVIDENCE_TORN_TAIL');
  const records=text.split(/\r?\n/).filter(Boolean).map(JSON.parse);verifyEvidenceChain(records);return records;
}
function fsyncDirectory(file){let descriptor;try{descriptor=fs.openSync(path.dirname(path.resolve(file)),'r');try{fs.fsyncSync(descriptor);}catch(error){if(process.platform!=='win32')throw error;}}finally{if(descriptor!==undefined)fs.closeSync(descriptor);}}
export function appendEvidenceDurable(file,record,records=[]){
  const previous=records.at(-1)?.sha256??null,next=chainRecord(record,{sequence:records.length+1,previous_sha256:previous});
  const descriptor=fs.openSync(file,'a',0o600);try{fs.writeSync(descriptor,`${JSON.stringify(next)}\n`);fs.fsyncSync(descriptor);}finally{fs.closeSync(descriptor);}fsyncDirectory(file);records.push(next);return next;
}
export function writeJsonDurable(file,value){
  const absolute=path.resolve(file),temporary=`${absolute}.${process.pid}.tmp`,descriptor=fs.openSync(temporary,'w',0o600);
  try{fs.writeSync(descriptor,`${JSON.stringify(value,null,2)}\n`);fs.fsyncSync(descriptor);}finally{fs.closeSync(descriptor);}fs.renameSync(temporary,absolute);fsyncDirectory(absolute);
}
export function resumeSoak(records,configuration){
  verifyEvidenceChain(records);const start=records[0],terminal=records.at(-1);
  if(start.event!=='start')throw new Error('SOAK_START_MISSING');
  for(const key of ['candidate','duration_ms','interval_ms','projects','mode','resilience_scenarios'])if(JSON.stringify(start[key])!==JSON.stringify(configuration[key]))throw new Error(`SOAK_RESUME_CONFIG_MISMATCH:${key}`);
  if(['complete','failed'].includes(terminal.event))throw new Error(`SOAK_ALREADY_TERMINAL:${terminal.event}`);
  const samples=records.filter(item=>item.event==='sample');
  return {samples:samples.length,elapsed_ms:Number(terminal.elapsed_ms??samples.at(-1)?.elapsed_ms??0),terminal_sha256:terminal.sha256};
}
