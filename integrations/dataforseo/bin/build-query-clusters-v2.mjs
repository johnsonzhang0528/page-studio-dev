import fs from 'node:fs';
import {applySerpReviewToQueryClusters} from '../lib/serp-review-backwrite.mjs';
import {atomicExpansionArtifact} from '../lib/expansion-preflight.mjs';

const base=process.argv[2]??'/var/lib/page-autodev/dataforseo';
const clustersFile=`${base}/query-clusters-v1.json`,reviewFile=`${base}/serp-calibration-12-review-v1.json`,output=`${base}/query-clusters-v2.json`;
if(fs.existsSync(output))throw new Error('OUTPUT_ALREADY_EXISTS');
const result=applySerpReviewToQueryClusters({
  clusters_bytes:fs.readFileSync(clustersFile),review_bytes:fs.readFileSync(reviewFile),
  expected_clusters_sha256:'bee5e30883370f108a96196e230d3f03336e83a77b7d190627c2b932aff52ecf',
  expected_review_sha256:'3cb258898ff6177c85f9bed9be816cdd479a870d19c06e887348bfff1dd5ef1c'
});
atomicExpansionArtifact(output,{...result,generated_at:new Date().toISOString()});
console.log(JSON.stringify({ok:true,output,counts:result.counts}));
