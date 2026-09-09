import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createBillingGatewayUnixClient } from '../lib/billing-gateway-unix-client.mjs';

const socket='/tmp/page-autodev-billing-gateway-client-test.sock',spec={invocation_id:'inv-1'};
const fakeRequest=(options,onResponse)=>{const handle=new EventEmitter();handle.destroy=()=>{};handle.end=payload=>{assert.equal(options.socketPath,socket);assert.equal(options.path,'/v1/dispatch');assert.deepEqual(JSON.parse(payload),{credential:'credential',spec,spend_lease_id:'lease'});const response=new EventEmitter();response.statusCode=200;queueMicrotask(()=>{onResponse(response);response.emit('data',Buffer.from(JSON.stringify({ok:true,result:{outcome:'success'}})));response.emit('end');});};return handle;};
const client=createBillingGatewayUnixClient({socket_path:socket,allow_test_socket:true,request:fakeRequest,timeout_ms:1000});
assert.deepEqual(await client.dispatch({credential:'credential',spec,spend_lease_id:'lease'}),{outcome:'success'});
await assert.rejects(client.dispatch({credential:'',spec,spend_lease_id:'lease'}),error=>error.code==='BILLING_GATEWAY_CLIENT_DENIED');
assert.throws(()=>createBillingGatewayUnixClient({socket_path:'/tmp/unapproved.sock'}),error=>error.code==='BILLING_GATEWAY_CLIENT_CONFIG_INVALID');
const denied=createBillingGatewayUnixClient({socket_path:socket,allow_test_socket:true,timeout_ms:1000,request:(options,onResponse)=>{const handle=new EventEmitter();handle.destroy=()=>{};handle.end=()=>{const response=new EventEmitter();response.statusCode=403;queueMicrotask(()=>{onResponse(response);response.emit('data',Buffer.from(JSON.stringify({ok:false,code:'BILLING_CONTROL_UNAVAILABLE'})));response.emit('end');});};return handle;}});
await assert.rejects(denied.dispatch({credential:'credential',spec,spend_lease_id:'lease'}),error=>error.message==='BILLING_CONTROL_UNAVAILABLE');
console.log('BILLING_GATEWAY_UNIX_CLIENT_TESTS_OK');
