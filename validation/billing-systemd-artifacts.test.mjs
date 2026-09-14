import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=name=>fs.readFileSync(new URL(`../systemd/${name}`,import.meta.url),'utf8');
const gatewaySocket=read('page-autodev-billing-gateway.socket');
const gatewayService=read('page-autodev-billing-gateway.service');
const egressSocket=read('page-autodev-openai-egress.socket');
const egressService=read('page-autodev-openai-egress.service');
const tunnelSocket=read('page-autodev-openai-tunnel.socket');
const tunnelService=read('page-autodev-openai-tunnel.service');
const refreshService=read('page-autodev-controller-credential-refresh.service');
const refreshTimer=read('page-autodev-controller-credential-refresh.timer');
const gatewayDaemon=fs.readFileSync(new URL('../bin/page-autodev-billing-gateway-daemon.mjs',import.meta.url),'utf8');
const tunnelDaemon=fs.readFileSync(new URL('../bin/page-autodev-openai-tunnel-daemon.mjs',import.meta.url),'utf8');

for(const [name,text] of Object.entries({gatewaySocket,gatewayService,egressSocket,egressService,tunnelSocket,tunnelService})){
  assert.match(text,/^\[Unit\]$/m,`${name} missing Unit`);
  assert.doesNotMatch(text,/EnvironmentFile=|OPENAI_API_KEY|https:\/\//,`${name} leaks credential or remote endpoint`);
}
for(const socket of [gatewaySocket,egressSocket]){
  assert.match(socket,/^Accept=no$/m);
  assert.match(socket,/^SocketMode=0660$/m);
  assert.match(socket,/^RemoveOnStop=true$/m);
}
assert.match(tunnelSocket,/^Accept=no$/m);assert.match(tunnelSocket,/^RemoveOnStop=true$/m);
for(const service of [gatewayService,egressService]){
  for(const rule of ['NoNewPrivileges=true','CapabilityBoundingSet=','RemoveIPC=true','PrivateDevices=true','PrivateNetwork=true','PrivateTmp=true','ProtectHome=true','ProtectProc=invisible','ProcSubset=pid','ProtectSystem=strict','RestrictNamespaces=true','RestrictSUIDSGID=true','LockPersonality=true','IPAddressDeny=any']) assert.match(service,new RegExp(`^${rule}$`,'m'));
  assert.match(service,/^RestrictAddressFamilies=AF_UNIX$/m);
  assert.doesNotMatch(service,/DynamicUser=true|User=root|Group=root/);
  assert.doesNotMatch(service,/^MemoryDenyWriteExecute=/m,'HTTP brokers require Node WebAssembly support');
}
for(const service of [gatewayService,egressService]){
  assert.match(service,/^ExecStart=\/usr\/bin\/node \/opt\/page-autodev\/bin\/page-autodev-[a-z-]+-daemon\.mjs$/m,'HTTP brokers require Node WebAssembly support');
}
assert.match(tunnelService,/^ExecStart=\/usr\/bin\/node --jitless \/opt\/page-autodev\/bin\/page-autodev-openai-tunnel-daemon\.mjs$/m,'credential-free tunnel must remain compatible with MemoryDenyWriteExecute');
for(const rule of ['NoNewPrivileges=true','CapabilityBoundingSet=','PrivateDevices=true','PrivateTmp=true','ProtectHome=true','ProtectProc=invisible','ProcSubset=pid','ProtectSystem=strict','RestrictNamespaces=true','MemoryDenyWriteExecute=true'])assert.match(tunnelService,new RegExp(`^${rule}$`,'m'));
assert.match(tunnelService,/^RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6$/m);assert.doesNotMatch(tunnelService,/LoadCredential=|EnvironmentFile=|OPENAI_API_KEY|ANTHROPIC|PrivateNetwork=true/);
assert.match(tunnelDaemon,/createFixedTunnelServer/);assert.doesNotMatch(tunnelDaemon,/openai_api_key|authorization|Bearer|CREDENTIALS_DIRECTORY/i);
assert.match(gatewaySocket,/^ListenStream=\/run\/page-autodev\/billing-gateway\.sock$/m);
assert.match(egressSocket,/^ListenStream=\/run\/page-autodev\/openai-egress\.sock$/m);
assert.match(tunnelSocket,/^ListenStream=\/run\/page-autodev\/openai-tunnel\.sock$/m);assert.match(tunnelSocket,/^SocketMode=0600$/m);
assert.match(egressService,/^LoadCredential=egress_policy:/m);
assert.match(egressService,/^LoadCredential=gateway_assertion_secret:/m);
assert.match(egressService,/^LoadCredential=openai_api_key:/m);
assert.doesNotMatch(gatewayService,/LoadCredential=.*openai/i);
for(const credential of ['gateway_runtime_config','gateway_credential_secret','gateway_assertion_secret'])assert.match(gatewayService,new RegExp(`^LoadCredential=${credential}:`,'m'));
assert.match(gatewayService,/^StateDirectory=page-autodev-billing-gateway$/m);assert.match(gatewayService,/^StateDirectoryMode=0700$/m);
assert.match(gatewayDaemon,/createBillingGatewayRuntime/);assert.match(gatewayDaemon,/createBillingEgressUnixClient/);assert.doesNotMatch(gatewayDaemon,/BILLING_CONTROL_UNAVAILABLE|handler:\s*unavailable/);
assert.doesNotMatch(gatewayDaemon,/openai_api_key|OPENAI_API_KEY/);

assert.match(refreshService,/^ExecStart=\/usr\/bin\/node \/opt\/page-autodev\/bin\/page-autodev-issue-controller-credential\.mjs$/m);
assert.match(refreshService,/^LoadCredential=gateway_credential_secret:\/etc\/page-autodev\/credentials\/gateway-credential-secret$/m);
assert.match(refreshService,/^Environment=CONTROLLER_CREDENTIAL_OUTPUT=\/etc\/page-autodev\/credentials\/billing-reservation-credential$/m);
assert.match(refreshService,/^Group=page-autodev-workers$/m);assert.match(refreshService,/^Environment=CONTROLLER_CREDENTIAL_OUTPUT_MODE=0640$/m);
assert.match(refreshService,/^PrivateNetwork=true$/m);assert.match(refreshService,/^ProtectSystem=strict$/m);assert.match(refreshService,/^ReadWritePaths=\/etc\/page-autodev\/credentials$/m);
assert.match(refreshTimer,/^OnUnitActiveSec=12h$/m);assert.match(refreshTimer,/^Persistent=true$/m);assert.match(refreshTimer,/^WantedBy=timers\.target$/m);
console.log('BILLING_SYSTEMD_ARTIFACT_TESTS_OK');
