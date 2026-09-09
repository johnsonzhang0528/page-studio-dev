#!/usr/bin/env node
import { createBillingGatewayUnixServer } from '../lib/billing-gateway-unix-server.mjs';

const unavailable=()=>{throw Object.assign(new Error('BILLING_CONTROL_UNAVAILABLE'),{code:'BILLING_CONTROL_UNAVAILABLE'});};
const runtimeUid=typeof process.getuid==='function'?process.getuid():null;
if(runtimeUid===null)throw new Error('BILLING_GATEWAY_UNSUPPORTED_PLATFORM');

const server=createBillingGatewayUnixServer({
  policy:{listener:{path:`/run/user/${runtimeUid}/page-autodev-billing-gateway.sock`}},
  handler:unavailable
});

await server.start({fd:3});
const stop=async()=>{await server.stop();process.exit(0);};
process.once('SIGTERM',stop);
process.once('SIGINT',stop);
