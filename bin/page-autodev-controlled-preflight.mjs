#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const fail=code=>{process.stderr.write(`CONTROLLED_LAUNCH_PREFLIGHT_FAILED:${code}\n`);process.exit(78);};
const directory=process.env.CREDENTIALS_DIRECTORY;
if(typeof directory!=='string'||!path.isAbsolute(directory))fail('CREDENTIAL_DIRECTORY_UNAVAILABLE');
const credential=path.join(directory,'billing_reservation_credential');
let credentialStat;try{credentialStat=fs.statSync(credential);}catch{fail('BILLING_CREDENTIAL_UNREADABLE');}
if(!credentialStat.isFile()||credentialStat.size<=0||credentialStat.size>16384)fail('BILLING_CREDENTIAL_INVALID');
const socket='/run/page-autodev/billing-gateway.sock';
let socketStat;try{socketStat=fs.statSync(socket);}catch{fail('BILLING_GATEWAY_SOCKET_UNAVAILABLE');}
if(!socketStat.isSocket())fail('BILLING_GATEWAY_SOCKET_INVALID');
try{fs.accessSync(socket,fs.constants.R_OK|fs.constants.W_OK);}catch{fail('BILLING_GATEWAY_SOCKET_PERMISSION_DENIED');}
process.stdout.write('CONTROLLED_LAUNCH_PREFLIGHT_OK\n');
