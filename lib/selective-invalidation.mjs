import crypto from 'node:crypto';

export const WORKFLOW_PHASE_ORDER=Object.freeze(['input_analysis','requirements','requirements_gate','architecture','architecture_gate','specification','specification_gate','planning','planning_gate','implementation','implementation_gate','qa']);
export const WORKFLOW_DEPENDENCY_MANIFEST_VERSION=1;

export const WORKFLOW_DEPENDENCY_MANIFEST=Object.freeze({
  version:WORKFLOW_DEPENDENCY_MANIFEST_VERSION,
  phases:Object.freeze(Object.fromEntries(WORKFLOW_PHASE_ORDER.map((phase,index)=>[phase,Object.freeze({depends_on:index?[WORKFLOW_PHASE_ORDER[index-1]]:[],input_patterns:index===0?['docs/input/**']:[]} )])))
});

const stable=value=>JSON.stringify(value,Object.keys(value??{}).sort());
export const receiptFingerprint=value=>crypto.createHash('sha256').update(stable(value)).digest('hex');

export function affectedClosure({nodes,edges,changed}){
  const known=new Set(nodes),affected=new Set(changed.filter(id=>known.has(id))),unknown=changed.filter(id=>!known.has(id));
  if(unknown.length) return {ok:false,affected:[...nodes],unknown,reason:'unknown dependency node; fail closed to full invalidation'};
  let progressed=true;
  while(progressed){
    progressed=false;
    for(const [downstream,upstream] of edges){
      if(!known.has(downstream)||!known.has(upstream)) return {ok:false,affected:[...nodes],unknown:[`${upstream}->${downstream}`],reason:'manifest edge references unknown node; fail closed to full invalidation'};
      if(affected.has(upstream)&&!affected.has(downstream)){ affected.add(downstream); progressed=true; }
    }
  }
  return {ok:true,affected:nodes.filter(id=>affected.has(id)),unknown:[]};
}

export function workflowAffectedPhases(changedPhases,{manifest=WORKFLOW_DEPENDENCY_MANIFEST}={}){
  const nodes=Object.keys(manifest.phases??{}),edges=[];
  for(const [phase,definition] of Object.entries(manifest.phases??{})) for(const dependency of definition.depends_on??[]) edges.push([phase,dependency]);
  return affectedClosure({nodes,edges,changed:changedPhases});
}

export function phaseReceipt({phase,input_sha,output_sha,policy_version,controller_version,predecessor_approval,evidence_sha,outcome='pass'}){
  const receipt={schema_version:1,phase,input_sha,output_sha,policy_version,controller_version,predecessor_approval,evidence_sha,outcome};
  return {...receipt,fingerprint:receiptFingerprint(receipt)};
}

export function reusablePhaseReceipt(receipt,expected){
  if(!receipt||receipt.schema_version!==1||receipt.outcome!=='pass') return {ok:false,reason:'missing or non-pass phase receipt'};
  for(const field of ['phase','input_sha','output_sha','policy_version','controller_version','predecessor_approval','evidence_sha']){
    if(typeof receipt[field]!=='string'||!receipt[field]) return {ok:false,reason:`receipt ${field} missing`};
    if(receipt[field]!==expected[field]) return {ok:false,reason:`receipt ${field} changed`};
  }
  const unsigned={...receipt}; delete unsigned.fingerprint;
  if(receipt.fingerprint!==receiptFingerprint(unsigned)) return {ok:false,reason:'receipt fingerprint mismatch'};
  return {ok:true,reason:'all provenance fields unchanged'};
}
