import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import {createCompactHandoff,validateCompactHandoff} from '../lib/handoff-engine.mjs';

const project=fs.mkdtempSync(path.join(os.tmpdir(),'compact-handoff-')); fs.mkdirSync(path.join(project,'.ai'));
const created=createCompactHandoff(project,{run_id:'run-1',phase:'architecture',unit_id:'ARCH-1',objective:'完成架構',verified_decisions:['決策 A'],unresolved_findings:['GF-1'],file_refs:['docs/a.md'],next_step:'只完成剩餘驗證',evidence:['x'.repeat(20000)]},{maxBytes:1200});
assert.equal(created.ok,true); assert(created.bytes<=1200); assert.equal(validateCompactHandoff(project,created.receipt,{maxBytes:1200}).ok,true);
assert.equal(createCompactHandoff(project,{run_id:'',phase:'a',unit_id:'b',objective:'c',next_step:'d'}).ok,false,'缺必要欄位必須 fail closed');
fs.appendFileSync(created.blob_file,'tampered'); assert.match(validateCompactHandoff(project,created.receipt,{maxBytes:1200}).error,/SHA mismatch/,'blob 竄改必須被拒絕');
assert.equal(validateCompactHandoff(project,{...created.receipt,evidence_blob:'../../escape'}).ok,false,'blob 不得逃出 handoff root');
fs.rmSync(project,{recursive:true,force:true}); console.log('HANDOFF_ENGINE_TESTS_OK');
