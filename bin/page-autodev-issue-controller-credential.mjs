#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createBillingGatewayCredentialAuthority } from '../lib/billing-gateway-credential.mjs';

const credentialRoot=process.env.CREDENTIALS_DIRECTORY,output=process.env.CONTROLLER_CREDENTIAL_OUTPUT,generation=process.env.CONTROLLER_CREDENTIAL_GENERATION??'current',ttl=Number(process.env.CONTROLLER_CREDENTIAL_TTL_MS??86400000),outputMode=Number.parseInt(process.env.CONTROLLER_CREDENTIAL_OUTPUT_MODE??'600',8);
if(!credentialRoot||!path.isAbsolute(credentialRoot)||!output||!path.isAbsolute(output))throw new Error('CONTROLLER_CREDENTIAL_PROVISIONING_CONFIG_REQUIRED');
if(![0o600,0o640].includes(outputMode))throw new Error('CONTROLLER_CREDENTIAL_OUTPUT_MODE_INVALID');
const secret=fs.readFileSync(path.join(credentialRoot,'gateway_credential_secret')),authority=createBillingGatewayCredentialAuthority({secret,controller_credential_policy:{accepted_generations:[generation],revoked_before_ms:0,max_ttl_ms:2592000000}}),token=authority.issueControllerCredential({generation,ttl_ms:ttl}),claims=authority.verifyControllerCredential(token),temporary=`${output}.${process.pid}.tmp`;
fs.mkdirSync(path.dirname(output),{recursive:true,mode:0o700});try{fs.writeFileSync(temporary,`${token}\n`,{mode:outputMode,flag:'wx'});fs.renameSync(temporary,output);}finally{fs.rmSync(temporary,{force:true});}
process.stdout.write(JSON.stringify({ok:true,generation:claims.generation,output,issued_at_ms:claims.iat_ms,expires_at_ms:claims.exp_ms,ttl_ms:ttl})+'\n');
