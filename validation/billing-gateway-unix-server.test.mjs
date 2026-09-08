import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import { createBillingGatewayUnixServer } from '../lib/billing-gateway-unix-server.mjs';

if(process.platform==='win32'){console.log('BILLING_GATEWAY_UNIX_SERVER_TESTS_SKIPPED_WINDOWS');process.exit(0);}
const socketPath=`/run/user/${process.getuid()}/page-autodev-billing-gateway-test-${process.pid}.sock`,policy={listener:{path:socketPath}};
const request=(body,headers={'content-type':'application/json'})=>new Promise((resolve,reject)=>{const req=http.request({socketPath,path:'/v1/dispatch',method:'POST',headers},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks))}));});req.on('error',reject);req.end(body);});
const server=createBillingGatewayUnixServer({policy,handler:async input=>({bytes:input.body.length})});
try{
  await server.start();assert.equal(fs.statSync(socketPath).mode&0o777,0o600);
  const ok=await request('{}');assert.equal(ok.status,200);assert.equal(ok.body.result.bytes,2);
  const duplicate=createBillingGatewayUnixServer({policy,handler:async()=>({})});
  await assert.rejects(duplicate.start(),error=>error.code==='BILLING_GATEWAY_SERVER_ERROR');
}finally{await server.stop();}
assert.equal(fs.existsSync(socketPath),false);
fs.writeFileSync(socketPath,'unsafe');
try{const unsafe=createBillingGatewayUnixServer({policy,handler:async()=>({})});await assert.rejects(unsafe.start(),error=>error.code==='BILLING_GATEWAY_SERVER_ERROR');}finally{fs.unlinkSync(socketPath);}
console.log('BILLING_GATEWAY_UNIX_SERVER_TESTS_OK');
