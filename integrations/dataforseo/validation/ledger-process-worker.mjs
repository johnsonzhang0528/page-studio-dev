import {DurableSpendLedger} from '../lib/durable-spend-ledger.mjs';
const ledger=new DurableSpendLedger({file:process.argv[2],daily_cap_microusd:Number(process.argv[3]??10000),lock_timeout_ms:10000});
const fingerprint=String(process.argv[4]??'a').repeat(64);
const result=await ledger.reserve({fingerprint,estimated_microusd:10000,project_id:'linux-crash',day:'2026-09-12'});
process.stdout.write(JSON.stringify(result));
