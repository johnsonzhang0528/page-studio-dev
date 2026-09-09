import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=name=>fs.readFileSync(new URL(`../systemd/${name}`,import.meta.url),'utf8');
const gatewaySocket=read('page-autodev-billing-gateway.socket');
const gatewayService=read('page-autodev-billing-gateway.service');
const egressSocket=read('page-autodev-openai-egress.socket');
const egressService=read('page-autodev-openai-egress.service');
const gatewayDaemon=fs.readFileSync(new URL('../bin/page-autodev-billing-gateway-daemon.mjs',import.meta.url),'utf8');

for(const [name,text] of Object.entries({gatewaySocket,gatewayService,egressSocket,egressService})){
  assert.match(text,/^\[Unit\]$/m,`${name} missing Unit`);
  assert.doesNotMatch(text,/EnvironmentFile=|OPENAI_API_KEY|https:\/\//,`${name} leaks credential or remote endpoint`);
}
for(const socket of [gatewaySocket,egressSocket]){
  assert.match(socket,/^Accept=no$/m);
  assert.match(socket,/^SocketMode=0660$/m);
  assert.match(socket,/^RemoveOnStop=true$/m);
}
for(const service of [gatewayService,egressService]){
  for(const rule of ['NoNewPrivileges=true','CapabilityBoundingSet=','RemoveIPC=true','PrivateDevices=true','PrivateNetwork=true','PrivateTmp=true','ProtectHome=true','ProtectProc=invisible','ProcSubset=pid','ProtectSystem=strict','RestrictNamespaces=true','RestrictSUIDSGID=true','LockPersonality=true','MemoryDenyWriteExecute=true','IPAddressDeny=any']) assert.match(service,new RegExp(`^${rule}$`,'m'));
  assert.match(service,/^RestrictAddressFamilies=AF_UNIX$/m);
  assert.doesNotMatch(service,/DynamicUser=true|User=root|Group=root/);
}
assert.match(gatewaySocket,/^ListenStream=\/run\/page-autodev\/billing-gateway\.sock$/m);
assert.match(egressSocket,/^ListenStream=\/run\/page-autodev\/openai-egress\.sock$/m);
assert.match(egressService,/^LoadCredential=egress_policy:/m);
assert.match(egressService,/^LoadCredential=gateway_assertion_secret:/m);
assert.match(egressService,/^LoadCredential=openai_api_key:/m);
assert.doesNotMatch(gatewayService,/LoadCredential=.*openai/i);
for(const credential of ['gateway_runtime_config','gateway_credential_secret','gateway_assertion_secret'])assert.match(gatewayService,new RegExp(`^LoadCredential=${credential}:`,'m'));
assert.match(gatewayService,/^StateDirectory=page-autodev-billing-gateway$/m);assert.match(gatewayService,/^StateDirectoryMode=0700$/m);
assert.match(gatewayDaemon,/createBillingGatewayRuntime/);assert.match(gatewayDaemon,/createBillingEgressUnixClient/);assert.doesNotMatch(gatewayDaemon,/BILLING_CONTROL_UNAVAILABLE|handler:\s*unavailable/);
assert.doesNotMatch(gatewayDaemon,/openai_api_key|OPENAI_API_KEY/);

console.log('BILLING_SYSTEMD_ARTIFACT_TESTS_OK');
