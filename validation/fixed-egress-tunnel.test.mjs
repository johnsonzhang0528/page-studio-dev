import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createFixedTunnelConnection,createFixedTunnelServer } from '../lib/fixed-egress-tunnel.mjs';

let request='';const socket=new EventEmitter();socket.destroy=error=>{socket.destroyedByTest=error;};socket.setEncoding=()=>{};socket.write=value=>{request+=value;return true;};const connect=()=>{queueMicrotask(()=>socket.emit('connect'));return socket;};let tlsOptions=null;
const create=createFixedTunnelConnection({connect,tlsConnect(options,callback){tlsOptions=options;const secure=new EventEmitter();queueMicrotask(callback);return secure;}});create({hostname:'api.openai.com',port:443,servername:'api.openai.com'},()=>{});await new Promise(resolve=>setTimeout(resolve,5));assert.equal(request,'CONNECT api.openai.com:443\n');socket.emit('data','OK\n');await new Promise(resolve=>setTimeout(resolve,5));assert.equal(tlsOptions.servername,'api.openai.com');assert.equal(tlsOptions.minVersion,'TLSv1.2');assert.throws(()=>create({hostname:'evil.invalid',port:443,servername:'evil.invalid'}),error=>error.code==='FIXED_EGRESS_TUNNEL_DENIED');
let upstreamOptions=null;const client=new PassThrough();client.setEncoding('utf8');client.destroy=()=>{client.denied=true;};const handler=createFixedTunnelServer({connectUpstream(options){upstreamOptions=options;const upstream=new PassThrough();queueMicrotask(()=>upstream.emit('connect'));return upstream;}});handler(client);client.write('CONNECT api.openai.com:443\n');await new Promise(resolve=>setTimeout(resolve,5));assert.deepEqual(upstreamOptions,{host:'api.openai.com',port:443});
const attacker=new PassThrough();attacker.setEncoding('utf8');attacker.destroy=()=>{attacker.denied=true;};handler(attacker);attacker.write('CONNECT evil.invalid:443\n');await new Promise(resolve=>setTimeout(resolve,5));assert.equal(attacker.denied,true);
console.log('FIXED_EGRESS_TUNNEL_TESTS_OK');
