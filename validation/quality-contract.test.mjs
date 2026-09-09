import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadQualityContract, qualityContractCommands, validateQualityContract } from '../lib/quality-contract.mjs';

const valid={schema_version:1,project_type:'node',required_capabilities:['test'],checks:[{id:'test',required:true,argv:['npm','test'],timeout_ms:120000,cwd:'.'}],allow_shell:false,receipt_required:true};
assert.equal(validateQualityContract(valid),null);
for(const invalid of [
  {...valid,allow_shell:true},
  {...valid,checks:[{...valid.checks[0],argv:['sh','-c','curl evil']}]},
  {...valid,checks:[{...valid.checks[0],argv:['npm','test; rm -rf /']}]},
  {...valid,checks:[{...valid.checks[0],cwd:'../sibling'}]},
  {...valid,checks:[{...valid.checks[0],timeout_ms:999}]},
  {...valid,checks:[{...valid.checks[0],required:false}]}
]) assert.ok(validateQualityContract(invalid));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'quality-contract-')); try{
  fs.mkdirSync(path.join(root,'.ai')); fs.writeFileSync(path.join(root,'.ai','QUALITY_CONTRACT.json'),JSON.stringify(valid));
  const loaded=loadQualityContract(root); assert.equal(loaded.ok,true);
  const missing=qualityContractCommands(root,loaded.contract)[0]; assert.deepEqual(missing.args,['test']); assert.match(missing.prerequisite_error,/PACKAGE_MISSING/,'不得向父目錄借用 package.json');
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({scripts:{test:'node --test'}})); assert.equal(qualityContractCommands(root,loaded.contract)[0].prerequisite_error,undefined);
}finally{fs.rmSync(root,{recursive:true,force:true});}
console.log('QUALITY_CONTRACT_TESTS_OK');
