import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const strings=value=>(Array.isArray(value)?value:value==null?[]:[value]).flat(Infinity).filter(item=>typeof item==='string'&&item.trim()).map(item=>item.trim());
const truncate=(value,max)=>String(value??'').slice(0,max);
export const handoffRoot=project=>path.join(project,'.ai','handoffs');

export function createCompactHandoff(project,{run_id,phase,unit_id,objective,verified_decisions=[],unresolved_findings=[],file_refs=[],next_step,evidence=[]},{maxBytes=4096}={}){
  const required={run_id,phase,unit_id,objective,next_step};
  for(const [field,value] of Object.entries(required)) if(typeof value!=='string'||!value.trim()) return {ok:false,error:`compact handoff ${field} missing`};
  const fullEvidence={schema_version:1,run_id,phase,unit_id,evidence:strings(evidence),created_at:new Date().toISOString()},blob=Buffer.from(JSON.stringify(fullEvidence)),evidenceSha=sha(blob);
  const dir=handoffRoot(project),blobDir=path.join(dir,'blobs'); fs.mkdirSync(blobDir,{recursive:true});
  const blobFile=path.join(blobDir,`${evidenceSha}.json`); if(!fs.existsSync(blobFile)) fs.writeFileSync(blobFile,blob,{flag:'wx',mode:0o600});
  const receipt={schema_version:1,run_id,phase,unit_id,objective:truncate(objective,800),verified_decisions:strings(verified_decisions).slice(0,8).map(value=>truncate(value,400)),unresolved_findings:strings(unresolved_findings).slice(0,12).map(value=>truncate(value,400)),file_refs:strings(file_refs).slice(0,16).map(value=>truncate(value,240)),next_step:truncate(next_step,800),evidence_blob:`blobs/${evidenceSha}.json`,evidence_sha:evidenceSha,created_at:new Date().toISOString()};
  while(Buffer.byteLength(JSON.stringify(receipt))>maxBytes&&(receipt.verified_decisions.length||receipt.unresolved_findings.length||receipt.file_refs.length)){
    const lists=['file_refs','verified_decisions','unresolved_findings'].sort((a,b)=>receipt[b].length-receipt[a].length); receipt[lists[0]].pop();
  }
  const bytes=Buffer.byteLength(JSON.stringify(receipt)); if(bytes>maxBytes) return {ok:false,error:`compact handoff exceeds ${maxBytes} bytes`,evidence_sha:evidenceSha};
  const receiptFile=path.join(dir,`${phase}-${unit_id}-${evidenceSha.slice(0,12)}.json`); fs.writeFileSync(receiptFile,`${JSON.stringify(receipt,null,2)}\n`,{mode:0o600});
  return {ok:true,receipt,bytes,receipt_file:receiptFile,blob_file:blobFile};
}

export function validateCompactHandoff(project,receipt,{maxBytes=4096}={}){
  for(const field of ['run_id','phase','unit_id','objective','next_step','evidence_blob','evidence_sha']) if(typeof receipt?.[field]!=='string'||!receipt[field]) return {ok:false,error:`compact handoff ${field} missing`};
  if(Buffer.byteLength(JSON.stringify(receipt))>maxBytes) return {ok:false,error:'compact handoff byte budget exceeded'};
  const root=fs.realpathSync(handoffRoot(project)),file=path.resolve(root,receipt.evidence_blob); if(file!==root&&!file.startsWith(`${root}${path.sep}`)) return {ok:false,error:'evidence blob path escapes handoff root'};
  let content; try{content=fs.readFileSync(file);}catch(error){return {ok:false,error:`evidence blob unavailable: ${error.message}`};}
  return sha(content)===receipt.evidence_sha?{ok:true}:{ok:false,error:'evidence blob SHA mismatch'};
}
