import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBillingEgressAssertionAuthority } from '../lib/billing-egress-assertion.mjs';
import { createBillingEgressHandler } from '../lib/billing-egress-handler.mjs';
import { createBillingEgressUnixClient } from '../lib/billing-egress-unix-client.mjs';
import { createBillingEgressUnixServer } from '../lib/billing-egress-unix-server.mjs';

if(process.platform==='win32'){console.log('BILLING_EGRESS_UNIX_CLIENT_TESTS_SKIPPED_WINDOWS');process.exit(0);}
const root=fs.mkdtempSync(path.join(os.tmpdir(),'billing-egress-client-')),socketPath=path.join(root,'egress.sock'),secret=Buffer.alloc(32,13),assertion=createBillingEgressAssertionAuthority({secret});
const policy={schema_version:1,activation:'active',service_identity:'page-autodev-openai-egress',listener:{transport:'unix',path:'/run/page-autodev/openai-egress.sock'},upstream:{hostname:'api.openai.com',port:443,tls_servername:'api.openai.com',minimum_tls:'TLSv1.2',paths:['/v1/responses'],methods:['POST'],redirects:0,retries:0},credential:{source:'systemd',gateway_readable:false,worker_readable:false},approved_model_snapshots:['offline-snapshot']};
let tlsCalls=0;
const handler=createBillingEgressHandler({policy,verifyGatewayAssertion:(token,scope)=>assertion.consume(token,scope),dispatchTls:async input=>{tlsCalls+=1;assert.equal(input.hostname,'api.openai.com');return {status:200,provider_request_id:'req_fixture'};}}),server=createBillingEgressUnixServer({handler}),client=createBillingEgressUnixClient({socket_path:socketPath,allow_test_socket:true,timeout_ms:1000});
const body=Buffer.from('{"store":false}'),body_sha256=crypto.createHash('sha256').update(body).digest('hex'),scope={request_id:'invocation-1',body_sha256,model_snapshot:'offline-snapshot'};
try{
  await server.start({path:socketPath});
  const result=await client.dispatch({gateway_assertion:assertion.issue(scope),...scope,method:'POST',path:'/v1/responses',body});assert.equal(result.provider_request_id,'req_fixture');assert.equal(tlsCalls,1);
  await assert.rejects(client.dispatch({gateway_assertion:'invalid',...scope,method:'POST',path:'/v1/responses',body}),error=>error.code==='BILLING_EGRESS_CLIENT_DENIED');assert.equal(tlsCalls,1);
}finally{await server.stop();fs.rmSync(root,{recursive:true,force:true});}
assert.throws(()=>createBillingEgressUnixClient({socket_path:'https://evil.invalid',allow_test_socket:true}),error=>error.code==='BILLING_EGRESS_CONFIG_INVALID');
console.log('BILLING_EGRESS_UNIX_CLIENT_TESTS_OK');
