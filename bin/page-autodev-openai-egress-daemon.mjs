#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createBillingEgressAssertionAuthority } from '../lib/billing-egress-assertion.mjs';
import { createBillingEgressHandler } from '../lib/billing-egress-handler.mjs';
import { createBillingEgressUnixServer } from '../lib/billing-egress-unix-server.mjs';
import { createOpenAiTlsTransport } from '../lib/billing-egress-tls.mjs';
import { createFixedTunnelConnection } from '../lib/fixed-egress-tunnel.mjs';

const credentialRoot=process.env.CREDENTIALS_DIRECTORY;
if(!credentialRoot)throw new Error('BILLING_EGRESS_CREDENTIALS_UNAVAILABLE');
const read=name=>fs.readFileSync(path.join(credentialRoot,name));
const policy=JSON.parse(read('egress_policy').toString('utf8'));
const assertion=createBillingEgressAssertionAuthority({secret:read('gateway_assertion_secret')});
const tlsTransport=createOpenAiTlsTransport({apiKey:read('openai_api_key'),create_connection:createFixedTunnelConnection()});
const handler=createBillingEgressHandler({
  policy,
  verifyGatewayAssertion:(token,scope)=>assertion.consume(token,scope),
  dispatchTls:tlsTransport
});
const server=createBillingEgressUnixServer({handler});
await server.start({fd:3});
const stop=async()=>{await server.stop();process.exit(0);};
process.once('SIGTERM',stop);
process.once('SIGINT',stop);
