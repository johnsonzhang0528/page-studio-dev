import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createBillingEgressUnixServer } from '../lib/billing-egress-unix-server.mjs';

if(process.platform==='win32'){console.log('BILLING_EGRESS_UNIX_SERVER_TESTS_SKIPPED_WINDOWS');process.exit(0);}
const root=fs.mkdtempSync(path.join(os.tmpdir(),'billing-egress-socket-')),socketPath=path.join(root,'broker.sock');let calls=0;
const responseFixture=Buffer.from('{"id":"resp_fixture","object":"response"}');
const server=createBillingEgressUnixServer({handler:async input=>{calls+=1;assert.equal(input.body.toString(),'{}');return {status:200,provider_request_id:'req_fixture',body:responseFixture};}});
const request=body=>new Promise((resolve,reject)=>{const req=http.request({socketPath,path:'/dispatch',method:'POST',headers:{'content-type':'application/json'}},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks))}));});req.on('error',reject);req.end(JSON.stringify(body));});
try{
  await server.start({path:socketPath});
  const valid={gateway_assertion:'signed',request_id:'request-1',method:'POST',path:'/v1/responses',model_snapshot:'snapshot',body_base64:Buffer.from('{}').toString('base64'),body_sha256:'a'.repeat(64)};
  const accepted=await request(valid);assert.equal(accepted.status,200);assert.equal(accepted.body.result.body,undefined);assert.equal(accepted.body.result.body_base64,responseFixture.toString('base64'));assert.equal(calls,1);
  assert.equal((await request({...valid,body_base64:'%%%'})).status,403);assert.equal(calls,1);
  assert.equal((await request({...valid,base_url:'https://evil.invalid'})).status,403);assert.equal(calls,1);
}finally{await server.stop();fs.rmSync(root,{recursive:true,force:true});}
console.log('BILLING_EGRESS_UNIX_SERVER_TESTS_OK');
