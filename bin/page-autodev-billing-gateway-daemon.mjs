#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createBillingEgressUnixClient } from '../lib/billing-egress-unix-client.mjs';
import { createBillingGatewayRuntime } from '../lib/billing-gateway-runtime.mjs';
import { createBillingGatewayUnixServer } from '../lib/billing-gateway-unix-server.mjs';

const credentialRoot=process.env.CREDENTIALS_DIRECTORY,stateRoot=process.env.STATE_DIRECTORY,runtimeUid=typeof process.getuid==='function'?process.getuid():null;
if(!credentialRoot||!stateRoot||runtimeUid===null)throw new Error('BILLING_GATEWAY_RUNTIME_UNAVAILABLE');
const read=name=>fs.readFileSync(path.join(credentialRoot,name)),config=JSON.parse(read('gateway_runtime_config').toString('utf8')),clock=()=>Date.now();
const policy={schema_version:1,service_identity:'page-autodev-billing-gateway',credential:{mode:'workload_identity',expires_at_ms:clock()+600000,worker_readable:false},upstream:{origin:'https://api.openai.com',paths:['/v1/responses'],methods:['POST'],allow_redirects:false,retries:0,fallback:false},admin_plane:{enabled:false},listener:{transport:'unix',path:`/run/user/${runtimeUid}/page-autodev-billing-gateway.sock`}};
const egressClient=createBillingEgressUnixClient(),runtime=createBillingGatewayRuntime({root:stateRoot,policy,billing_policy:config.billing_policy,price_registry:config.price_registry,capability_registry:config.capability_registry,gateway_credential_secret:read('gateway_credential_secret'),egress_assertion_secret:read('gateway_assertion_secret'),egressClient,clock});
const server=createBillingGatewayUnixServer({policy,handler:runtime.handler});
await server.start({fd:3});
const stop=async()=>{await server.stop();process.exit(0);};process.once('SIGTERM',stop);process.once('SIGINT',stop);
