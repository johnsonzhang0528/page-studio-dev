import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {applySerpReviewToQueryClusters} from '../lib/serp-review-backwrite.mjs';

const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
function fixture(){
  const assignments=Array.from({length:60},(_,i)=>({seed:'s',query:`q${i}`,cluster:`C${i}`,verdict:'PROVISIONAL'}));
  const assessments=Array.from({length:12},(_,i)=>({query:`q${i}`,decision:i<4?'PILOT':i===11?'REJECT':'HOLD',opportunity:i<4?'HIGH':'LOW',reason:'TEST_REASON',source_sha256:'a'.repeat(64),provider_task_id:`p${i}`,cost_microusd:2000,organic_count:8,unique_domain_count:8,ugc_count:0,has_ai_overview:false,has_paid_results:false,has_video:false}));
  const clusters=Buffer.from(JSON.stringify({schema_version:1,market:'Taiwan',language:'zh-TW',assignments}));
  const review=Buffer.from(JSON.stringify({schema_version:1,automatic_enter:false,url_approval:false,assessments}));
  return {clusters,review};
}
test('backwrite updates exactly reviewed queries and never approves URLs',()=>{const {clusters,review}=fixture(),result=applySerpReviewToQueryClusters({clusters_bytes:clusters,review_bytes:review,expected_clusters_sha256:sha(clusters),expected_review_sha256:sha(review)});assert.deepEqual(result.counts,{total:60,serp_validated:12,pending_serp_validation:48,pilot:4,hold:7,reject:1});assert.equal(result.url_approval,false);assert.equal(result.automatic_enter,false);assert.equal(result.assignments[12].verdict,'PROVISIONAL');assert.equal(result.assignments[12].decision_status,'PENDING_SERP_VALIDATION');});
test('backwrite fails closed on source mutation or unknown query',()=>{const {clusters,review}=fixture();assert.throws(()=>applySerpReviewToQueryClusters({clusters_bytes:Buffer.concat([clusters,Buffer.from(' ')]),review_bytes:review,expected_clusters_sha256:sha(clusters),expected_review_sha256:sha(review)}),/SOURCE_HASH_MISMATCH/);const changed=JSON.parse(review);changed.assessments[0].query='not-in-clusters';const changedBytes=Buffer.from(JSON.stringify(changed));assert.throws(()=>applySerpReviewToQueryClusters({clusters_bytes:clusters,review_bytes:changedBytes,expected_clusters_sha256:sha(clusters),expected_review_sha256:sha(changedBytes)}),/REVIEW_QUERY_NOT_IN_CLUSTER/);});
