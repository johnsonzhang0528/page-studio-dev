import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { deriveArchitectureArtifacts, renderArchitectureIr, validateArchitectureIr } from '../lib/architecture-ir.mjs';

const ir={schema_version:1,meta:{title:'Repair Platform'},components:[{id:'web',type:'frontend',label:'Web',boundary_id:'app'},{id:'api',type:'service',label:'API',boundary_id:'app'},{id:'user',type:'external',label:'User'}],interfaces:[{id:'i-web-api',from:'web',to:'api',label:'HTTPS'}],data_flows:[{id:'f-user-web',from:'user',to:'web',label:'request',controls:['TLS','input validation']}],security_boundaries:[{id:'app',label:'Application boundary',component_ids:['web','api']}],deployments:[{id:'host',label:'Host',component_ids:['web','api']}],nfrs:[{id:'nfr-1',category:'security',requirement:'TLS',applies_to:['web']}],workflows:[{id:'wf',label:'Order flow',lanes:[{id:'customer',label:'Customer'}],nodes:[{id:'create',lane:'customer',label:'Create'},{id:'submit',lane:'customer',label:'Submit'}],edges:[{id:'e-create-submit',from:'create',to:'submit',label:'submit'}]}],lifecycles:[{id:'lc',label:'Order lifecycle',lanes:[{id:'main',label:'Main'}],states:[{id:'new',lane:'main',label:'New'},{id:'done',lane:'main',label:'Done'}],transitions:[{id:'t-done',from:'new',to:'done',label:'complete'}]}]};
assert.equal(validateArchitectureIr(ir).ok,true);
const first=deriveArchitectureArtifacts(ir),second=deriveArchitectureArtifacts({...ir,components:[...ir.components].reverse()});
assert.equal(first.ir_sha256,second.ir_sha256,'輸入陣列順序不得改變 canonical IR fingerprint');
assert.equal(JSON.stringify(first.artifacts),JSON.stringify(second.artifacts),'同一 IR 必須產生 byte-stable 衍生物');
assert.equal(first.artifacts['system-architecture.architecture.json'].components[0].id,'api'); assert.equal(first.artifacts['architecture-traceability.json'].ir_sha256,first.ir_sha256,'衍生物必須透過穩定 ID 與 matrix fingerprint 追溯 IR');
const unsafe=structuredClone(ir); unsafe.data_flows[0].controls=[];
assert.equal(validateArchitectureIr(unsafe).ok,false); assert.throws(()=>deriveArchitectureArtifacts(unsafe),/SECURITY_EDGE_UNCONTROLLED/);
const project=process.env.ARCH_IR_FIXTURE_OUT||fs.mkdtempSync(path.join(os.tmpdir(),'architecture-ir-')); fs.mkdirSync(project,{recursive:true}); const rendered=renderArchitectureIr(project,ir); assert.equal(rendered.written.length,6);
const before=fs.readFileSync(path.join(project,'docs/architecture/diagrams/system-architecture.architecture.json'),'utf8'); renderArchitectureIr(project,ir); assert.equal(fs.readFileSync(path.join(project,'docs/architecture/diagrams/system-architecture.architecture.json'),'utf8'),before);
if(!process.env.ARCH_IR_FIXTURE_OUT) fs.rmSync(project,{recursive:true,force:true}); console.log('ARCHITECTURE_IR_TESTS_OK');
