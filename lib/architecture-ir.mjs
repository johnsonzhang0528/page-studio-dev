import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ARCHITECTURE_IR_SCHEMA_VERSION=1;
export const ARCHITECTURE_IR_PATH='docs/architecture/ARCHITECTURE_IR.json';

const list=value=>Array.isArray(value)?value:[];
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
export const stableJson=value=>`${JSON.stringify(stable(value),null,2)}\n`;
const byId=items=>[...items].sort((a,b)=>String(a.id).localeCompare(String(b.id)));
const ids=(items,label,issues)=>{ const seen=new Set(); for(const item of items){ if(!item?.id) issues.push(`${label} 缺少 id`); else if(seen.has(item.id)) issues.push(`${label} id 重複：${item.id}`); else seen.add(item.id); } return seen; };

export function validateArchitectureIr(ir){
  const issues=[];
  if(!ir||typeof ir!=='object'||Array.isArray(ir)) return {ok:false,issues:['Architecture IR 必須是 object']};
  if(ir.schema_version!==ARCHITECTURE_IR_SCHEMA_VERSION) issues.push(`不支援的 Architecture IR schema_version：${ir.schema_version??'缺少'}`);
  const components=list(ir.components),interfaces=list(ir.interfaces),flows=list(ir.data_flows),boundaries=list(ir.security_boundaries),deployments=list(ir.deployments),nfrs=list(ir.nfrs),workflows=list(ir.workflows),lifecycles=list(ir.lifecycles);
  if(!components.length) issues.push('components 不得為空');
  const componentIds=ids(components,'component',issues),boundaryIds=ids(boundaries,'security_boundary',issues);
  for(const collection of [[interfaces,'interface'],[flows,'data_flow'],[deployments,'deployment'],[nfrs,'nfr'],[workflows,'workflow'],[lifecycles,'lifecycle']]) ids(collection[0],collection[1],issues);
  const owner=new Map(); for(const boundary of boundaries) for(const componentId of list(boundary.component_ids)){ if(!componentIds.has(componentId)) issues.push(`security_boundary ${boundary.id} 參照未知 component：${componentId}`); if(owner.has(componentId)) issues.push(`component ${componentId} 同時屬於多個 security boundary`); owner.set(componentId,boundary.id); }
  for(const component of components) if(component.boundary_id&&!boundaryIds.has(component.boundary_id)) issues.push(`component ${component.id} 參照未知 boundary：${component.boundary_id}`); else if(component.boundary_id){ if(owner.has(component.id)&&owner.get(component.id)!==component.boundary_id) issues.push(`component ${component.id} 的 boundary 宣告矛盾`); owner.set(component.id,component.boundary_id); }
  for(const edge of [...interfaces,...flows]){ if(!componentIds.has(edge.from)) issues.push(`${edge.id} 參照未知來源 component：${edge.from}`); if(!componentIds.has(edge.to)) issues.push(`${edge.id} 參照未知目的 component：${edge.to}`); }
  for(const flow of flows){ const crosses=(owner.get(flow.from)??'external')!==(owner.get(flow.to)??'external'); if(crosses&&!list(flow.controls).length) issues.push(`SECURITY_EDGE_UNCONTROLLED：${flow.id} 跨越信任邊界但沒有 controls`); }
  for(const deployment of deployments) for(const componentId of list(deployment.component_ids)) if(!componentIds.has(componentId)) issues.push(`deployment ${deployment.id} 參照未知 component：${componentId}`);
  return {ok:issues.length===0,issues};
}

function canonicalIr(ir){
  const keys=['components','interfaces','data_flows','security_boundaries','deployments','nfrs','workflows','lifecycles'];
  return {schema_version:ARCHITECTURE_IR_SCHEMA_VERSION,meta:stable(ir.meta??{}),...Object.fromEntries(keys.map(key=>[key,byId(list(ir[key])).map(stable)]))};
}

export function deriveArchitectureArtifacts(ir){
  const checked=validateArchitectureIr(ir); if(!checked.ok){ const error=new Error(`ARCHITECTURE_IR_INVALID：${checked.issues.join('；')}`); error.code='ARCHITECTURE_IR_INVALID'; error.issues=checked.issues; throw error; }
  const source=canonicalIr(ir),fingerprint=sha(stableJson(source)),meta={title:source.meta.title??'System Architecture',quality_profile:source.meta.quality_profile??'showcase'};
  const typeMap={service:'backend',api:'backend',web:'frontend',queue:'messagebus',storage:'database'};
  const components=source.components.map((item,index)=>({id:item.id,type:typeMap[item.type]??item.type,label:item.label,sublabel:item.sublabel,pos:item.pos??[40+index*230,220],size:item.size??[180,70]}));
  const centers=new Map(components.map(item=>[item.id,[item.pos[0]+item.size[0]/2,item.pos[1]+item.size[1]/2]]));
  const connections=source.interfaces.map((item,index)=>{ const from=centers.get(item.from),to=centers.get(item.to),lane=60+index*24; return {id:item.id,from:item.from,to:item.to,label:item.label,variant:item.variant,fromSide:'top',toSide:'top',via:[[from[0],lane],[to[0],lane]],labelAt:[(from[0]+to[0])/2,lane-10]}; });
  const boundaries=source.security_boundaries.map(item=>({kind:item.kind??'security-group',label:item.label,wraps:item.component_ids}));
  const workflow=source.workflows[0]??{id:'workflow-main',label:'Main workflow',lanes:[],nodes:[],edges:[],phases:[],mainPath:[]};
  const lifecycle=source.lifecycles[0]??{id:'lifecycle-main',label:'Main lifecycle',lanes:[],states:[],transitions:[]};
  const system={schema_version:1,diagram_type:'architecture',meta:{...meta,output:'system-architecture.html'},components,connections,boundaries,cards:[]};
  const workflowNodes=list(workflow.nodes).map((item,index)=>({...item,col:item.col??index,type:item.type??'frontend'}));
  const workflowEdges=list(workflow.edges),outgoing=new Set(workflowEdges.map(item=>item.from)),incoming=new Set(workflowEdges.map(item=>item.to)),roots=workflowNodes.filter(item=>!incoming.has(item.id)).map(item=>item.id),terminals=workflowNodes.filter(item=>!outgoing.has(item.id)).map(item=>item.id);
  const generatedSemanticChecks={allowedRoots:roots.length?roots:[workflowNodes[0]?.id].filter(Boolean),allowedTerminals:terminals.length?terminals:[workflowNodes.at(-1)?.id].filter(Boolean),requiredEdges:workflowEdges.map(({from,to})=>({from,to})),requiredPaths:workflowNodes.length>1?[{from:workflowNodes[0].id,to:workflowNodes.at(-1).id}]:[]};
  const workflowSpec={schema_version:1,diagram_type:'workflow',meta:{...meta,title:workflow.label,output:'work-order-flow.html'},lanes:list(workflow.lanes),nodes:workflowNodes,edges:workflowEdges,phases:list(workflow.phases),mainPath:list(workflow.mainPath).length?list(workflow.mainPath):workflowNodes.map(item=>item.id),semanticChecks:workflow.semanticChecks&&typeof workflow.semanticChecks==='object'&&!Array.isArray(workflow.semanticChecks)?workflow.semanticChecks:generatedSemanticChecks,cards:[]};
  const lifecycleSource=list(lifecycle.states),lifecycleStates=lifecycleSource.map((item,index)=>({...item,col:item.col??index,type:item.type??(index===0?'start':index===lifecycleSource.length-1?'success':'active'),step:item.step??String(index+1).padStart(2,'0')}));
  const lifecycleSpec={schema_version:1,diagram_type:'lifecycle',meta:{...meta,title:lifecycle.label,output:'work-order-lifecycle.html'},lanes:list(lifecycle.lanes),states:lifecycleStates,transitions:list(lifecycle.transitions).map(item=>({...item,labelDy:item.labelDy??55})),cards:[]};
  const boundaryStage=new Map(source.security_boundaries.flatMap((item,index)=>list(item.component_ids).map(id=>[id,index+1])));
  const dataflow={schema_version:1,diagram_type:'dataflow',meta:{...meta,output:'data-trust-boundary.html'},nodes:components.map(({id,type,label,sublabel},index)=>({id,type,label,sublabel,stage:boundaryStage.get(id)??0,row:index+1})),flows:source.data_flows.map(item=>({id:item.id,from:item.from,to:item.to,label:item.label,classification:item.classification??'internal',variant:item.variant})),stages:[{label:'External / Untrusted'},...source.security_boundaries.map(item=>({label:item.label}))],cards:[]};
  const traceability={schema_version:1,ir_sha256:fingerprint,components:source.components.map(item=>({ir_id:item.id,interfaces:source.interfaces.filter(x=>x.from===item.id||x.to===item.id).map(x=>x.id),data_flows:source.data_flows.filter(x=>x.from===item.id||x.to===item.id).map(x=>x.id),nfrs:source.nfrs.filter(x=>list(x.applies_to).includes(item.id)).map(x=>x.id)}))};
  const summary=[`# ${meta.title} — Architecture IR Summary`,'',`- IR SHA-256: \`${fingerprint}\``,`- Components: ${source.components.length}`,`- Interfaces: ${source.interfaces.length}`,`- Data flows: ${source.data_flows.length}`,`- Security boundaries: ${source.security_boundaries.length}`,`- Deployments: ${source.deployments.length}`,`- NFRs: ${source.nfrs.length}`,''].join('\n');
  return {ir:source,ir_sha256:fingerprint,artifacts:{'system-architecture.architecture.json':system,'work-order-flow.workflow.json':workflowSpec,'work-order-lifecycle.lifecycle.json':lifecycleSpec,'data-trust-boundary.dataflow.json':dataflow,'architecture-traceability.json':traceability,'ARCHITECTURE_IR_SUMMARY.md':summary}};
}

function durableWrite(file,body){ fs.mkdirSync(path.dirname(file),{recursive:true}); const temp=`${file}.${process.pid}.tmp`,descriptor=fs.openSync(temp,'w',0o600); try{ fs.writeFileSync(descriptor,body); fs.fsyncSync(descriptor); }finally{ fs.closeSync(descriptor); } fs.renameSync(temp,file); }
export function renderArchitectureIr(project,ir,{only=null}={}){
  const derived=deriveArchitectureArtifacts(ir),diagramDir=path.join(project,'docs','architecture','diagrams'),written=[];
  for(const [name,value] of Object.entries(derived.artifacts)){
    if(only&&name!==only) continue;
    const file=name.endsWith('.md')?path.join(project,'docs','architecture',name):path.join(diagramDir,name);
    durableWrite(file,typeof value==='string'?value:stableJson(value)); written.push(path.relative(project,file).split(path.sep).join('/'));
  }
  return {...derived,written};
}
