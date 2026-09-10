#!/usr/bin/env node
import fs from 'node:fs';
import { validateBillingRuntimeConfig } from '../lib/billing-runtime-config.mjs';

const file=process.argv[2];
if(!file)throw Object.assign(new Error('Usage: page-autodev-validate-billing-config <gateway-runtime.json>'),{code:'BILLING_RUNTIME_CONFIG_PATH_REQUIRED'});
const result=validateBillingRuntimeConfig(JSON.parse(fs.readFileSync(file,'utf8')));
process.stdout.write(`${JSON.stringify(result)}\n`);
