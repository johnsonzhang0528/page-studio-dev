import crypto from 'node:crypto';

const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const decisions=new Set(['PILOT','HOLD','REJECT']);

export function applySerpReviewToQueryClusters({clusters_bytes,review_bytes,expected_clusters_sha256,expected_review_sha256}={}) {
  if(!Buffer.isBuffer(clusters_bytes)||!Buffer.isBuffer(review_bytes))throw new Error('SOURCE_BYTES_REQUIRED');
  const clusterHash=sha(clusters_bytes),reviewHash=sha(review_bytes);
  if(clusterHash!==expected_clusters_sha256||reviewHash!==expected_review_sha256)throw new Error('SOURCE_HASH_MISMATCH');
  const clusters=JSON.parse(clusters_bytes),review=JSON.parse(review_bytes);
  if(clusters.schema_version!==1||clusters.assignments?.length!==60||review.schema_version!==1||review.assessments?.length!==12||review.automatic_enter!==false||review.url_approval!==false)throw new Error('SOURCE_CONTRACT_INVALID');
  const evidence=new Map();
  for(const row of review.assessments){
    if(evidence.has(row.query)||!decisions.has(row.decision)||!['LOW','MEDIUM','HIGH'].includes(row.opportunity)||!/^[a-f0-9]{64}$/.test(row.source_sha256??''))throw new Error('REVIEW_ROW_INVALID');
    evidence.set(row.query,row);
  }
  const seen=new Set();
  const assignments=clusters.assignments.map(row=>{
    const evidenceRow=evidence.get(row.query);
    if(!evidenceRow)return {...row,decision_status:'PENDING_SERP_VALIDATION'};
    if(seen.has(row.query))throw new Error('DUPLICATE_CLUSTER_QUERY');
    seen.add(row.query);
    return {...row,verdict:evidenceRow.decision,decision_status:'SERP_VALIDATED',opportunity:evidenceRow.opportunity,decision_reason:evidenceRow.reason,serp_evidence:{source_sha256:evidenceRow.source_sha256,provider_task_id:evidenceRow.provider_task_id,cost_microusd:evidenceRow.cost_microusd,organic_count:evidenceRow.organic_count,unique_domain_count:evidenceRow.unique_domain_count,ugc_count:evidenceRow.ugc_count,has_ai_overview:evidenceRow.has_ai_overview,has_paid_results:evidenceRow.has_paid_results,has_video:evidenceRow.has_video}};
  });
  if(seen.size!==12||[...evidence.keys()].some(query=>!seen.has(query)))throw new Error('REVIEW_QUERY_NOT_IN_CLUSTER');
  const counts={total:assignments.length,serp_validated:assignments.filter(row=>row.decision_status==='SERP_VALIDATED').length,pending_serp_validation:assignments.filter(row=>row.decision_status==='PENDING_SERP_VALIDATION').length,pilot:assignments.filter(row=>row.verdict==='PILOT').length,hold:assignments.filter(row=>row.verdict==='HOLD').length,reject:assignments.filter(row=>row.verdict==='REJECT').length};
  if(counts.total!==60||counts.serp_validated!==12||counts.pending_serp_validation!==48||counts.pilot!==4)throw new Error('BACKWRITE_COUNTS_INVALID');
  return {schema_version:2,mode:'localized_serp_evidence_backwrite',source_clusters_sha256:clusterHash,source_review_sha256:reviewHash,market:clusters.market,language:clusters.language,network_dispatch:false,automatic_enter:false,url_approval:false,assignment_status:'PARTIALLY_SERP_VALIDATED',counts,assignments,next_gate:'SELECT_REAL_NICHE_THEN_VALIDATE_ITS_OWN_QUERIES'};
}
