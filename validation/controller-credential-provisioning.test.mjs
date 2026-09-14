import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createBillingGatewayCredentialAuthority } from '../lib/billing-gateway-credential.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'controller-credential-'));
const credentials=path.join(root,'credentials'),output=path.join(root,'out','controller.token');
fs.mkdirSync(credentials);const secret=Buffer.alloc(32,17);fs.writeFileSync(path.join(credentials,'gateway_credential_secret'),secret);
try{
  const run=spawnSync(process.execPath,[fileURLToPath(new URL('../bin/page-autodev-issue-controller-credential.mjs',import.meta.url))],{encoding:'utf8',env:{PATH:process.env.PATH,CREDENTIALS_DIRECTORY:credentials,CONTROLLER_CREDENTIAL_OUTPUT:output,CONTROLLER_CREDENTIAL_GENERATION:'wave-b',CONTROLLER_CREDENTIAL_TTL_MS:'60000'}});
  assert.equal(run.status,0,run.stderr);
  const metadata=JSON.parse(run.stdout);assert.equal(metadata.generation,'wave-b');assert.ok(metadata.expires_at_ms>metadata.issued_at_ms);
  assert.ok(!run.stdout.includes(fs.readFileSync(output,'utf8').trim()),'token must never be printed');
  const authority=createBillingGatewayCredentialAuthority({secret,controller_credential_policy:{accepted_generations:['wave-b'],revoked_before_ms:0,max_ttl_ms:2592000000}});
  assert.equal(authority.verifyControllerCredential(fs.readFileSync(output,'utf8').trim()).generation,'wave-b');
  if(process.platform!=='win32')assert.equal(fs.statSync(output).mode&0o777,0o600);
}finally{fs.rmSync(root,{recursive:true,force:true});}
console.log('CONTROLLER_CREDENTIAL_PROVISIONING_TESTS_OK');
