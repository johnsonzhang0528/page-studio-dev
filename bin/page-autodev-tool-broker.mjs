#!/usr/bin/env node
import fs from 'node:fs';
import { runToolBrokerStdio } from '../lib/tool-broker-runtime.mjs';

const configPath=process.argv[2];
if(!configPath){process.stderr.write('TOOL_BROKER_CONFIG_PATH_REQUIRED\n');process.exit(64);}
let config;
try{config=JSON.parse(fs.readFileSync(configPath,'utf8'));}catch(error){process.stderr.write(`TOOL_BROKER_CONFIG_INVALID: ${error.message}\n`);process.exit(78);}
runToolBrokerStdio({config});
