import crypto from 'node:crypto';
import fs from 'node:fs';

const hash=record=>crypto.createHash('sha256').update(JSON.stringify(record)).digest('hex');
const invalid=failures=>{const error=new Error(failures.join(';'));error.code='RELEASE_EVIDENCE_INCOMPLETE';error.failures=failures;throw error;};
const verifiedReceipt=(record,kind)=>{const copy=structuredClone(record),claimed=copy.sha256;delete copy.sha256;return record?.kind===kind&&typeof claimed==='string'&&hash(copy)===claimed;};
export function finalizeReleaseEvidence({candidate_branch,candidate_head,live_head,preflight,death,soak_lines,min_duration_ms=86400000,min_samples=250}={}){
  const failures=[],sameCandidate=record=>record?.candidate?.branch===candidate_branch&&record?.candidate?.head===candidate_head;
  if(!candidate_branch||!/^[a-f0-9]{40}$/.test(candidate_head??'')||!/^[a-f0-9]{40}$/.test(live_head??''))failures.push('IDENTITY_CONFIG_INVALID');
  const requiredPreflightChecks=new Set(['root:separate','candidate:expected-branch-configured','candidate:branch','candidate:expected-head-configured','candidate:frozen-head','candidate:clean','live:clean','live:frozen-head','credentials:not-in-environment','resource:disk','resource:inode']);
  const preflightChecks=new Map((preflight?.checks??[]).map(item=>[item.id,item]));
  const branchEvidence=preflightChecks.get('candidate:branch')?.evidence,headEvidence=preflightChecks.get('candidate:frozen-head')?.evidence,liveEvidence=preflightChecks.get('live:frozen-head')?.evidence;
  if(!verifiedReceipt(preflight,'release_soak_preflight')||preflight.decision!=='ALLOW_ISOLATED_SOAK'||preflight.candidate_head!==candidate_head||preflight.live_head!==live_head||(preflight.failures??[]).length!==0||[...requiredPreflightChecks].some(id=>preflightChecks.get(id)?.ok!==true)||branchEvidence?.expected!==candidate_branch||branchEvidence?.actual!==candidate_branch||headEvidence?.expected!==candidate_head||headEvidence?.actual!==candidate_head||liveEvidence?.expected!==live_head||liveEvidence?.actual!==live_head)failures.push('PREFLIGHT_INVALID');
  const deathEvidence=death?.evidence??[],deathIds=deathEvidence.map(item=>item.id),deathScenarios=deathEvidence.map(item=>item.scenario);
  if(!verifiedReceipt(death,'death_test_evidence_manifest')||death.ok!==true||death.total!==89||death.individually_evidenced!==89||deathEvidence.length!==89||!sameCandidate(death)||new Set(deathIds).size!==89||new Set(deathScenarios).size!==89||deathEvidence.some(item=>typeof item.id!=='string'||typeof item.scenario!=='string'||!item.id||!item.scenario))failures.push('DEATH_EVIDENCE_INVALID');
  if(!Array.isArray(soak_lines)||soak_lines.length<2)failures.push('SOAK_RECEIPT_MISSING');
  else{const start=soak_lines[0],complete=soak_lines.at(-1),failed=soak_lines.some(item=>item.event==='failed'),samples=soak_lines.filter(item=>item.event==='sample'),projects=start.projects??[],scenarios=start.resilience_scenarios??[];const sampleInvalid=samples.some((item,index)=>item.sample!==index+1||projects.some(project=>!Object.hasOwn(item.decisions??{},project))||scenarios.some(scenario=>item.resilience?.[scenario]?.ok!==true));if(start.event!=='start'||!sameCandidate(start)||start.duration_ms<min_duration_ms||projects.length===0||scenarios.length===0||complete.event!=='complete'||complete.ok!==true||!sameCandidate(complete)||complete.elapsed_ms<min_duration_ms||failed||complete.samples!==samples.length||complete.samples<min_samples||sampleInvalid)failures.push('SOAK_INVALID');}
  if(failures.length)invalid(failures);
  const receipt={schema_version:1,kind:'release_evidence_finalization',decision:'ELIGIBLE_FOR_OPERATOR_REVIEW',deploy_authorized:false,candidate:{branch:candidate_branch,head:candidate_head},live_head,preflight_sha256:preflight.sha256,death_evidence_sha256:death.sha256,soak:{samples:soak_lines.at(-1).samples,elapsed_ms:soak_lines.at(-1).elapsed_ms}};receipt.sha256=hash(receipt);return Object.freeze(receipt);
}

export const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8'));
export const readJsonLines=file=>fs.readFileSync(file,'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
