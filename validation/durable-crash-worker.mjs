#!/usr/bin/env node
import path from 'node:path';
import { beginTransaction, writeDurableJson } from '../lib/transactions.mjs';

const [mode,target,stage]=process.argv.slice(2),faultInjector=current=>{ if(current===stage) process.kill(process.pid,'SIGKILL'); };
if(mode==='state') writeDurableJson(target,{schema_version:1,value:'new',padding:'x'.repeat(4096)},{faultInjector});
else if(mode==='transaction') beginTransaction(target,{type:'ARCH_REPAIR',phase:'architecture',gatePhase:'architecture_gate',inputRevision:7,sourceManifestFingerprint:'CRASH-MATRIX',faultInjector});
else throw new Error(`unknown mode ${mode}`);
