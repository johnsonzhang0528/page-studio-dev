import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildReadOnlyContextBundle } from '../lib/provider-context-bundle.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'provider-context-'));
try{
  fs.mkdirSync(path.join(root,'docs'),{recursive:true});
  fs.writeFileSync(path.join(root,'docs','review.md'),'finding\ntoken=super-secret\n');
  fs.writeFileSync(path.join(root,'docs','data.bin'),Buffer.from([0,1,2]));
  const bundle=buildReadOnlyContextBundle(root,['docs/review.md']);
  assert.equal(bundle.files.length,1);assert.equal(bundle.files[0].path,'docs/review.md');assert.match(bundle.files[0].text,/\[REDACTED\]/);assert.doesNotMatch(bundle.files[0].text,/super-secret/);assert.match(bundle.sha256,/^[a-f0-9]{64}$/);assert.equal(bundle.total_bytes,Buffer.byteLength(bundle.files[0].text));
  assert.throws(()=>buildReadOnlyContextBundle(root,['../outside.md']),error=>error.code==='PROVIDER_CONTEXT_DENIED');
  assert.throws(()=>buildReadOnlyContextBundle(root,['.git/config']),error=>error.code==='PROVIDER_CONTEXT_DENIED');
  assert.throws(()=>buildReadOnlyContextBundle(root,['docs/data.bin']),error=>error.code==='PROVIDER_CONTEXT_DENIED');
  assert.throws(()=>buildReadOnlyContextBundle(root,['docs/review.md'],{max_file_bytes:5,max_total_bytes:5}),error=>error.code==='PROVIDER_CONTEXT_TOO_LARGE');
  if(process.platform!=='win32'){
    fs.symlinkSync('/etc/passwd',path.join(root,'docs','escape.txt'));
    assert.throws(()=>buildReadOnlyContextBundle(root,['docs/escape.txt']),error=>error.code==='PROVIDER_CONTEXT_DENIED');
  }
}finally{fs.rmSync(root,{recursive:true,force:true});}
console.log('PROVIDER_CONTEXT_BUNDLE_TESTS_OK');
