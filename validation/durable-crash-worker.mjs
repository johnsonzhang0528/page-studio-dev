#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import { beginTransaction, convergeTransaction, pendingTransactions, readTransaction, transactionsDir, writeDurableJson } from '../lib/transactions.mjs';

const [mode,target,stage]=process.argv.slice(2),faultInjector=current=>{ if(current===stage) process.kill(process.pid,'SIGKILL'); };
if(mode==='state') writeDurableJson(target,{schema_version:1,value:'new',padding:'x'.repeat(4096)},{faultInjector});
else if(mode==='transaction') beginTransaction(target,{type:'ARCH_REPAIR',phase:'architecture',gatePhase:'architecture_gate',inputRevision:7,sourceManifestFingerprint:'CRASH-MATRIX',faultInjector});
else if(mode==='lifecycle'){
  const effectsFile=path.join(target,'.ai','lifecycle-effects.json');
  const readEffects=()=>{ try{return JSON.parse(fs.readFileSync(effectsFile,'utf8'));}catch{return {promotions:[],finalized_findings:[]};} };
  const saveEffects=value=>writeDurableJson(effectsFile,value);
  let records=pendingTransactions(target);
  const transactionFiles=fs.existsSync(transactionsDir(target))?fs.readdirSync(transactionsDir(target)).filter(name=>name.endsWith('.json')):[];
  const committed=transactionFiles.map(name=>readTransaction(target,path.basename(name,'.json'))).filter(record=>record.state==='COMMITTED');
  if(!records.length&&!committed.length){
    records=[beginTransaction(target,{type:'GATE_COMMIT',phase:'architecture_gate',gatePhase:'architecture_gate',inputRevision:7,sourceManifestFingerprint:'LIFECYCLE-MATRIX'})];
    faultInjector('after_prepared');
  }
  for(const record of records) convergeTransaction(target,record,{
    faultInjector,
    apply:current=>{ const effects=readEffects(); effects.promotions=[...new Set([...effects.promotions,current.transaction_id])]; saveEffects(effects); },
    verify:current=>({ok:readEffects().promotions.includes(current.transaction_id)}),
    commit:current=>{ const effects=readEffects(); effects.finalized_findings=[...new Set([...effects.finalized_findings,current.transaction_id])]; saveEffects(effects); }
  });
}
else throw new Error(`unknown mode ${mode}`);
